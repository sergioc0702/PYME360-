"""SQLite outbox primitives shared by the local Pyme360 server."""

from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from typing import Any


SYNCED_SECTIONS = (
    "contacts",
    "products",
    "recipes",
    "sales",
    "purchases",
    "productionOrders",
    "environmentalRecords",
    "resourceReadings",
    "emissionFactors",
    "indicatorTargets",
    "environmentalActions",
    "receiptImports",
    "inventoryMovements",
    "financialAccounts",
    "cashMovements",
    "importExtras",
    "electronicDocuments",
    "supplierInvoices",
)
SINGLETONS = ("company", "environmentalConfig", "taxConfiguration")


def initialize_sync_tables(connection: Any) -> None:
    connection.execute(
        """CREATE TABLE IF NOT EXISTS sync_configuration (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            api_url TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            remote_user_id TEXT,
            device_id TEXT NOT NULL,
            cursor INTEGER NOT NULL DEFAULT 0,
            last_validation_json TEXT,
            connected_by_user_id TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )"""
    )
    columns = {
        row["name"] for row in connection.execute("PRAGMA table_info(sync_configuration)").fetchall()
    }
    if "remote_user_id" not in columns:
        connection.execute("ALTER TABLE sync_configuration ADD COLUMN remote_user_id TEXT")
    if "last_validation_json" not in columns:
        connection.execute("ALTER TABLE sync_configuration ADD COLUMN last_validation_json TEXT")
    if "central_auth_error" not in columns:
        connection.execute("ALTER TABLE sync_configuration ADD COLUMN central_auth_error TEXT")
    connection.execute(
        """CREATE TABLE IF NOT EXISTS sync_outbox (
            batch_id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            actor_user_id TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'conflict')),
            payload_json TEXT NOT NULL,
            last_error TEXT,
            accepted_at TEXT
        )"""
    )
    outbox_columns = {row["name"] for row in connection.execute("PRAGMA table_info(sync_outbox)").fetchall()}
    if "rejected_at" not in outbox_columns:
        connection.execute("ALTER TABLE sync_outbox ADD COLUMN rejected_at TEXT")
    connection.execute(
        """CREATE TABLE IF NOT EXISTS sync_entity_versions (
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            remote_version INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (entity_type, entity_id)
        )"""
    )
    connection.execute(
        """CREATE TABLE IF NOT EXISTS sync_conflicts (
            conflict_id TEXT PRIMARY KEY,
            batch_id TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            local_change_json TEXT NOT NULL,
            remote_change_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            resolved_at TEXT,
            resolution TEXT
        )"""
    )
    connection.execute(
        """CREATE TABLE IF NOT EXISTS sync_user_links (
            local_user_id TEXT PRIMARY KEY,
            remote_user_id TEXT NOT NULL UNIQUE,
            workspace_id TEXT NOT NULL,
            email TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('admin', 'operator', 'viewer')),
            auth_error TEXT,
            updated_at TEXT NOT NULL
        )"""
    )
    link_columns = {
        row["name"] for row in connection.execute("PRAGMA table_info(sync_user_links)").fetchall()
    }
    if "auth_error" not in link_columns:
        connection.execute("ALTER TABLE sync_user_links ADD COLUMN auth_error TEXT")
    legacy_link = connection.execute(
        """SELECT workspace_id, remote_user_id, connected_by_user_id, updated_at, central_auth_error
           FROM sync_configuration WHERE id=1"""
    ).fetchone()
    if legacy_link and legacy_link["remote_user_id"] and legacy_link["connected_by_user_id"]:
        local_user = connection.execute(
            "SELECT username, role FROM users WHERE id=?", (legacy_link["connected_by_user_id"],)
        ).fetchone()
        if local_user:
            connection.execute(
                """INSERT OR IGNORE INTO sync_user_links
                   (local_user_id, remote_user_id, workspace_id, email, role, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    legacy_link["connected_by_user_id"], legacy_link["remote_user_id"],
                    legacy_link["workspace_id"], local_user["username"], local_user["role"],
                    legacy_link["updated_at"],
                ),
            )
            if legacy_link["central_auth_error"]:
                connection.execute(
                    "UPDATE sync_user_links SET auth_error=COALESCE(auth_error, ?) WHERE local_user_id=?",
                    (legacy_link["central_auth_error"], legacy_link["connected_by_user_id"]),
                )


def _records(state: dict, section: str) -> dict[str, dict]:
    rows = state.get(section, [])
    if not isinstance(rows, list):
        return {}
    return {
        str(row["id"]): row
        for row in rows
        if isinstance(row, dict) and row.get("id") is not None
    }


def _pending_changes(connection: Any) -> dict[tuple[str, str], int]:
    counts: dict[tuple[str, str], int] = {}
    rows = connection.execute(
        "SELECT payload_json FROM sync_outbox WHERE status = 'pending' AND rejected_at IS NULL ORDER BY created_at, batch_id"
    ).fetchall()
    for row in rows:
        try:
            batch = json.loads(row["payload_json"])
        except (TypeError, json.JSONDecodeError):
            continue
        for change in batch.get("changes", []):
            key = (str(change.get("entityType", "")), str(change.get("entityId", "")))
            counts[key] = counts.get(key, 0) + 1
    return counts


def make_changes(connection: Any, previous: dict, updated: dict) -> list[dict]:
    pending = _pending_changes(connection)
    changes: list[dict] = []
    for section in SYNCED_SECTIONS:
        before = _records(previous, section)
        after = _records(updated, section)
        for entity_id in sorted(before.keys() | after.keys()):
            old_record = before.get(entity_id)
            new_record = after.get(entity_id)
            if old_record == new_record:
                continue
            version_row = connection.execute(
                "SELECT remote_version FROM sync_entity_versions WHERE entity_type = ? AND entity_id = ?",
                (section, entity_id),
            ).fetchone()
            remote_version = int(version_row["remote_version"]) if version_row else 0
            base_version = remote_version + pending.get((section, entity_id), 0)
            changes.append(
                {
                    "entityType": section,
                    "entityId": entity_id,
                    "baseVersion": base_version,
                    "action": "delete" if new_record is None else "upsert",
                    "payload": new_record,
                }
            )
    for section in SINGLETONS:
        if previous.get(section) == updated.get(section):
            continue
        entity_id = "settings"
        version_row = connection.execute(
            "SELECT remote_version FROM sync_entity_versions WHERE entity_type = ? AND entity_id = ?",
            (section, entity_id),
        ).fetchone()
        remote_version = int(version_row["remote_version"]) if version_row else 0
        base_version = remote_version + pending.get((section, entity_id), 0)
        changes.append(
            {
                "entityType": section,
                "entityId": entity_id,
                "baseVersion": base_version,
                "action": "delete" if updated.get(section) is None else "upsert",
                "payload": updated.get(section),
            }
        )
    return changes


def enqueue_state_change(
    connection: Any,
    previous: dict,
    updated: dict,
    actor_user_id: str,
    device_id: str,
) -> dict | None:
    changes = make_changes(connection, previous, updated)
    if not changes:
        return None
    created_at = datetime.now(timezone.utc).isoformat()
    batch = {
        "batchId": secrets.token_urlsafe(24),
        "deviceId": device_id,
        "createdAt": created_at,
        "actorLocalUserId": actor_user_id,
        "changes": changes,
    }
    connection.execute(
        """INSERT INTO sync_outbox (batch_id, created_at, actor_user_id, status, payload_json)
           VALUES (?, ?, ?, 'pending', ?)""",
        (batch["batchId"], created_at, actor_user_id, json.dumps(batch, ensure_ascii=False, separators=(",", ":"))),
    )
    return batch


def enqueue_snapshot(connection: Any, state: dict, actor_user_id: str, device_id: str) -> dict:
    empty: dict = {section: [] for section in SYNCED_SECTIONS}
    empty.update({section: None for section in SINGLETONS})
    return enqueue_state_change(connection, empty, state, actor_user_id, device_id) or {
        "batchId": "",
        "changes": [],
    }


def synchronization_status(connection: Any) -> dict:
    configuration = connection.execute("SELECT * FROM sync_configuration WHERE id = 1").fetchone()
    counts = connection.execute(
        """SELECT status, COUNT(*) AS count FROM sync_outbox GROUP BY status"""
    ).fetchall()
    status_counts = {row["status"]: int(row["count"]) for row in counts}
    rejected_rows = connection.execute(
        """SELECT batch_id, created_at, last_error FROM sync_outbox
           WHERE status='pending' AND rejected_at IS NOT NULL ORDER BY created_at LIMIT 10"""
    ).fetchall()
    rejected_count = int(connection.execute(
        "SELECT COUNT(*) FROM sync_outbox WHERE status='pending' AND rejected_at IS NOT NULL"
    ).fetchone()[0])
    pending_errors = connection.execute(
        """SELECT batch_id, created_at, last_error FROM sync_outbox
           WHERE status='pending' AND rejected_at IS NULL AND last_error IS NOT NULL
           ORDER BY created_at LIMIT 10"""
    ).fetchall()
    conflict_count = int(
        connection.execute(
            "SELECT COUNT(*) FROM sync_conflicts WHERE resolved_at IS NULL"
        ).fetchone()[0]
    )
    try:
        validation = json.loads(configuration["last_validation_json"]) if configuration and configuration["last_validation_json"] else None
    except (TypeError, json.JSONDecodeError):
        validation = None
    return {
        "configured": configuration is not None,
        "workspaceId": configuration["workspace_id"] if configuration else None,
        "centralUserId": configuration["remote_user_id"] if configuration else None,
        "apiUrl": configuration["api_url"] if configuration else None,
        "deviceId": configuration["device_id"] if configuration else None,
        "cursor": int(configuration["cursor"]) if configuration else 0,
        "pendingBatches": status_counts.get("pending", 0) - rejected_count,
        "rejectedBatches": rejected_count,
        "rejectedRecords": [
            {"batchId": row["batch_id"], "createdAt": row["created_at"], "error": row["last_error"] or "El servidor central rechazó el lote."}
            for row in rejected_rows
        ],
        "pendingErrors": [
            {"batchId": row["batch_id"], "createdAt": row["created_at"], "error": row["last_error"]}
            for row in pending_errors
        ],
        "centralAuthError": configuration["central_auth_error"] if configuration and "central_auth_error" in configuration.keys() else None,
        "acceptedBatches": status_counts.get("accepted", 0),
        "conflicts": conflict_count,
        "lastSyncedAt": configuration["updated_at"] if configuration else None,
        "lastValidation": validation,
    }


def rebuild_rejected_batch(connection: Any, maximum_changes: int = 5000) -> dict | None:
    """Merge failed and later offline edits into one corrected idempotent batch.

    The user must first correct the rejected records in Pyme360. The original
    batch id is retained because the central server did not accept rejected
    batches; accepted or conflicted batches are never rewritten here.
    """
    rejected = connection.execute(
        """SELECT * FROM sync_outbox WHERE status='pending' AND rejected_at IS NOT NULL
           ORDER BY created_at, batch_id LIMIT 1"""
    ).fetchone()
    if not rejected:
        return None
    rows = connection.execute(
        """SELECT * FROM sync_outbox WHERE status='pending' AND created_at >= ?
           ORDER BY created_at, batch_id""",
        (rejected["created_at"],),
    ).fetchall()
    merged_changes: dict[tuple[str, str], dict] = {}
    original = None
    for row in rows:
        try:
            batch = json.loads(row["payload_json"])
        except (TypeError, json.JSONDecodeError) as exc:
            raise ValueError("No se pudo leer un lote provisional para reconstruirlo.") from exc
        if row["batch_id"] == rejected["batch_id"]:
            original = batch
        for change in batch.get("changes", []):
            key = (str(change.get("entityType", "")), str(change.get("entityId", "")))
            first_base_version = (
                merged_changes[key]["baseVersion"]
                if key in merged_changes
                else int(change.get("baseVersion", 0))
            )
            merged_changes[key] = {
                **change,
                # Keep the earliest observed base. If another device changed this
                # entity while the rejected batch waited, the server must raise a
                # conflict instead of silently accepting a stale local overwrite.
                "baseVersion": first_base_version,
            }
    if not original:
        raise ValueError("No se encontró el contenido del lote rechazado.")
    if len(merged_changes) > maximum_changes:
        raise ValueError("El lote reconstruido supera el tamaño permitido; divide la importación antes de sincronizar.")
    rebuilt = {
        key: merged_changes[key]
        for key in sorted(merged_changes)
    }
    batch = {**original, "changes": list(rebuilt.values())}
    connection.execute(
        """UPDATE sync_outbox SET status='pending', payload_json=?, rejected_at=NULL, last_error=NULL
           WHERE batch_id=?""",
        (json.dumps(batch, ensure_ascii=False, separators=(",", ":")), rejected["batch_id"]),
    )
    connection.executemany(
        "DELETE FROM sync_outbox WHERE batch_id=?",
        [(row["batch_id"],) for row in rows if row["batch_id"] != rejected["batch_id"]],
    )
    return batch
