#!/usr/bin/env python3
"""Servidor local de Pyme360: archivos estáticos, SQLite y consulta ONU opcional."""

from __future__ import annotations

import json
import argparse
import hashlib
import hmac
import math
import os
import re
import secrets
import socket
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.cookies import SimpleCookie
from contextlib import contextmanager
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from environment_benchmarks import get_benchmark_response
from electronic_invoicing import (
    InvoiceXmlError,
    ProviderNotConfiguredError,
    ProviderRequestError,
    ProviderResult,
    build_submission_document,
    get_provider,
    load_env_file,
    normalize_provider_status,
    parse_supplier_invoice_xml,
    provider_status,
)
from sync_local import (
    SYNCED_SECTIONS,
    SINGLETONS,
    enqueue_snapshot,
    enqueue_state_change,
    initialize_sync_tables,
    rebuild_rejected_batch,
    synchronization_status,
)


MIN_PYTHON = (3, 11)
MAX_BODY_BYTES = 20 * 1024 * 1024
APP_NAME = "Pyme360"
SCHEMA_VERSION = 1
TYPESCRIPT_MODEL_SCHEMA_VERSION = 7
PASSWORD_ITERATIONS = 600_000
SESSION_TTL_SECONDS = 12 * 60 * 60
PORTS = range(8765, 8791)
PROJECT_ROOT = Path(
    getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent)
).resolve()
WEB_ROOT = PROJECT_ROOT / "web"
TYPESCRIPT_MODEL_ROOT = PROJECT_ROOT / "typescript-model" / "dist"
benchmark_cache: dict | None = None
benchmark_cached_at = 0.0
benchmark_lock = threading.Lock()


def data_directory() -> Path:
    if sys.platform == "win32":
        root = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
        return root / APP_NAME
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_NAME
    root = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return root / APP_NAME.lower()


DATA_DIR = data_directory()
DB_PATH = DATA_DIR / "pyme360.sqlite3"
BACKUP_DIR = DATA_DIR / "backups"
BENCHMARK_DIR = DATA_DIR / "benchmarks"
BENCHMARK_SNAPSHOT_PATH = BENCHMARK_DIR / "official_snapshots.csv"
BENCHMARK_TEMPLATE_PATH = PROJECT_ROOT / "server" / "benchmark-data" / "official_snapshots.template.csv"


def connect_db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout = 10000")
    return connection


@contextmanager
def db_session():
    connection = connect_db()
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_database() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    BENCHMARK_DIR.mkdir(parents=True, exist_ok=True)
    if os.name != "nt":
        DATA_DIR.chmod(0o700)
        BACKUP_DIR.chmod(0o700)
    if not BENCHMARK_SNAPSHOT_PATH.exists() and BENCHMARK_TEMPLATE_PATH.exists():
        BENCHMARK_SNAPSHOT_PATH.write_text(
            BENCHMARK_TEMPLATE_PATH.read_text(encoding="utf-8"),
            encoding="utf-8",
        )
    with db_session() as connection:
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute(
            """CREATE TABLE IF NOT EXISTS app_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                schema_version INTEGER NOT NULL,
                revision INTEGER NOT NULL,
                payload_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"""
        )
        connection.execute(
            """CREATE TABLE IF NOT EXISTS typescript_model_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                schema_version INTEGER NOT NULL,
                revision INTEGER NOT NULL,
                payload_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"""
        )
        connection.execute(
            """CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL COLLATE NOCASE UNIQUE,
                display_name TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('admin', 'operator', 'viewer')),
                active INTEGER NOT NULL DEFAULT 1,
                password_salt TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                password_algorithm TEXT NOT NULL,
                password_iterations INTEGER NOT NULL,
                created_at TEXT NOT NULL
            )"""
        )
        connection.execute(
            """CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            )"""
        )
        connection.execute(
            """CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                actor_user_id TEXT,
                actor_username TEXT NOT NULL,
                action TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                occurred_at TEXT NOT NULL,
                details_json TEXT NOT NULL DEFAULT '{}'
            )"""
        )
        connection.execute(
            """CREATE TABLE IF NOT EXISTS environment_benchmark_cache (
                source_id TEXT PRIMARY KEY,
                payload_json TEXT NOT NULL,
                fetched_at TEXT NOT NULL,
                last_error TEXT
            )"""
        )
        initialize_sync_tables(connection)
    if os.name != "nt" and DB_PATH.exists():
        DB_PATH.chmod(0o600)


def create_daily_backup(force: bool = False) -> None:
    """Crea una copia coherente con la API de respaldo de SQLite y conserva siete."""
    today = datetime.now().astimezone().date().isoformat()
    target = BACKUP_DIR / f"pyme360-{today}.sqlite3"
    with db_session() as connection:
        has_data = connection.execute(
            "SELECT 1 FROM app_state WHERE id = 1 UNION ALL SELECT 1 FROM typescript_model_state WHERE id = 1"
        ).fetchone() is not None
    if has_data and (force or not target.exists()):
        source = connect_db()
        try:
            destination = sqlite3.connect(target)
            try:
                source.backup(destination)
            finally:
                destination.close()
                if os.name != "nt" and target.exists():
                    target.chmod(0o600)
        finally:
            source.close()
    backups = sorted(BACKUP_DIR.glob("pyme360-*.sqlite3"), key=lambda item: item.name, reverse=True)
    for old_backup in backups[7:]:
        try:
            old_backup.unlink()
        except OSError:
            pass


def create_pre_cloud_backup() -> Path | None:
    """Keep a dedicated, non-rotating copy immediately before first cloud linking."""
    with db_session() as connection:
        has_data = connection.execute(
            "SELECT 1 FROM typescript_model_state WHERE id=1"
        ).fetchone() is not None
    if not has_data:
        return None
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().astimezone().strftime("%Y%m%d-%H%M%S")
    target = BACKUP_DIR / f"pyme360-before-cloud-{stamp}.sqlite3"
    source = connect_db()
    try:
        destination = sqlite3.connect(target)
        try:
            source.backup(destination)
        finally:
            destination.close()
    finally:
        source.close()
    if os.name != "nt":
        target.chmod(0o600)
    return target


def state_row() -> dict:
    with db_session() as connection:
        row = connection.execute(
            "SELECT schema_version, revision, payload_json, updated_at FROM app_state WHERE id = 1"
        ).fetchone()
    if row is None:
        return {"revision": 0, "state": None, "schemaVersion": SCHEMA_VERSION}
    return {
        "revision": row["revision"],
        "state": json.loads(row["payload_json"]),
        "schemaVersion": row["schema_version"],
        "updatedAt": row["updated_at"],
    }


def typescript_model_state_row() -> dict:
    with db_session() as connection:
        row = connection.execute(
            "SELECT schema_version, revision, payload_json, updated_at FROM typescript_model_state WHERE id = 1"
        ).fetchone()
    if row is None:
        return {"revision": 0, "state": None, "schemaVersion": TYPESCRIPT_MODEL_SCHEMA_VERSION}
    return {
        "revision": row["revision"],
        "state": json.loads(row["payload_json"]),
        "schemaVersion": row["schema_version"],
        "updatedAt": row["updated_at"],
    }


def persist_connector_result(
    document_id: str,
    result: ProviderResult,
    actor: dict,
    action: str,
    attempt_result: str | None = None,
) -> tuple[int, dict]:
    """Store a provider response atomically and keep the electronic document append-only.

    Only this connector path may move a draft away from ``draft`` or assign a provider
    reference. The generic state endpoint continues to reject forged statuses.
    """
    updated_at = datetime.now(timezone.utc).isoformat()
    with db_session() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            "SELECT revision, payload_json FROM typescript_model_state WHERE id = 1"
        ).fetchone()
        if row is None:
            connection.rollback()
            raise LookupError("No hay datos guardados del modelo TypeScript.")
        previous_state = json.loads(row["payload_json"])
        if int(previous_state.get("schemaVersion", 0) or 0) != TYPESCRIPT_MODEL_SCHEMA_VERSION:
            connection.rollback()
            raise ValueError("Actualiza la base de datos antes de transmitir documentos electrónicos.")
        updated_state = json.loads(row["payload_json"])
        documents = updated_state.get("electronicDocuments")
        if not isinstance(documents, list):
            connection.rollback()
            raise ValueError("La sección electronicDocuments no tiene un formato válido.")
        index = next(
            (
                position
                for position, item in enumerate(documents)
                if isinstance(item, dict) and str(item.get("id")) == document_id
            ),
            None,
        )
        if index is None:
            connection.rollback()
            raise LookupError("No encontramos el documento electrónico.")
        document = documents[index]
        current_status = str(document.get("status") or "draft")
        if attempt_result == "error":
            next_status = current_status
        else:
            next_status = normalize_provider_status(result.status, default="transmitted")
            if current_status in {"accepted", "delivered"} and next_status not in {
                "accepted",
                "delivered",
            }:
                next_status = current_status
        attempts = document.get("attempts")
        attempts = list(attempts) if isinstance(attempts, list) else []
        attempt = {
            "id": f"attempt-{secrets.token_hex(8)}",
            "attemptedAt": updated_at,
            "result": "error" if attempt_result == "error" else next_status,
            "message": (result.message or "")[:500],
        }
        if result.provider_reference:
            attempt["providerReference"] = result.provider_reference
        updated_document = {
            **document,
            "status": next_status,
            "attempts": [*attempts, attempt],
        }
        if result.provider_reference:
            updated_document["providerReference"] = result.provider_reference
        if result.document_number:
            updated_document["documentNumber"] = result.document_number
        if result.cufe:
            updated_document["cufe"] = result.cufe
        if result.message:
            updated_document["validationMessage"] = result.message[:500]
        documents[index] = updated_document
        next_revision = int(row["revision"] or 0) + 1
        connection.execute(
            """INSERT INTO typescript_model_state (id, schema_version, revision, payload_json, updated_at)
               VALUES (1, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET schema_version=excluded.schema_version,
                 revision=excluded.revision, payload_json=excluded.payload_json, updated_at=excluded.updated_at""",
            (
                TYPESCRIPT_MODEL_SCHEMA_VERSION,
                next_revision,
                json.dumps(updated_state, ensure_ascii=False, separators=(",", ":")),
                updated_at,
            ),
        )
        write_audit(
            connection,
            actor,
            action,
            "electronic_document",
            document_id,
            {
                "attemptResult": "error" if attempt_result == "error" else next_status,
                "status": next_status,
                "providerReference": result.provider_reference,
            },
        )
        # Connector results stay in the local ledger. The shared API intentionally
        # stores only draft documents and treats electronicDocuments as immutable,
        # so pushing a provider status would be rejected by design.
        connection.commit()
    return next_revision, updated_document


def benchmark_cache_load(source_id: str) -> dict | None:
    with db_session() as connection:
        row = connection.execute(
            "SELECT payload_json, fetched_at, last_error FROM environment_benchmark_cache WHERE source_id = ?",
            (source_id,),
        ).fetchone()
    if row is None:
        return None
    try:
        payload = json.loads(row["payload_json"])
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    return {**payload, "fetchedAt": row["fetched_at"], "lastError": row["last_error"]}


def benchmark_cache_save(source_id: str, payload: dict, fetched_at: str, last_error: str | None) -> None:
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    with db_session() as connection:
        connection.execute(
            """INSERT INTO environment_benchmark_cache (source_id, payload_json, fetched_at, last_error)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(source_id) DO UPDATE SET payload_json=excluded.payload_json,
                 fetched_at=excluded.fetched_at, last_error=excluded.last_error""",
            (source_id, serialized, fetched_at, last_error),
        )


def current_benchmark_payload(force_refresh: bool = False) -> dict:
    saved_state = typescript_model_state_row().get("state")
    state = saved_state if isinstance(saved_state, dict) else {}
    return get_benchmark_response(
        state,
        load_cache=benchmark_cache_load,
        save_cache=benchmark_cache_save,
        snapshot_path=BENCHMARK_SNAPSHOT_PATH,
        force_refresh=force_refresh,
    )


def normalize_benchmark_rows(api_response: object) -> dict:
    rows = api_response.get("data", []) if isinstance(api_response, dict) else api_response
    if not isinstance(rows, list):
        rows = []
    observations = []
    base_period = ""
    descriptions = []
    sources = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        area_code = str(row.get("geoAreaCode", ""))
        if area_code not in ("1", "170"):
            continue
        year_value = str(row.get("timePeriodStart", row.get("timePeriod", "")))
        year_match = re.search(r"\d{4}", year_value)
        try:
            value = float(row.get("value"))
        except (TypeError, ValueError):
            continue
        if not year_match:
            continue
        if not base_period and row.get("basePeriod"):
            base_period = str(row["basePeriod"])
        if row.get("seriesDescription"):
            descriptions.append(str(row["seriesDescription"]))
        if row.get("source"):
            sources.append(str(row["source"]))
        observations.append(
            {
                "areaCode": area_code,
                "area": row.get("geoAreaName") or ("Mundo" if area_code == "1" else "Colombia"),
                "year": int(year_match.group(0)),
                "value": value,
                "source": str(row.get("source") or ""),
                "basePeriod": str(row.get("basePeriod") or ""),
                "seriesDescription": str(row.get("seriesDescription") or ""),
            }
        )
    if not observations:
        raise ValueError("La API pública no devolvió observaciones para el indicador solicitado.")
    unique_sources = list(dict.fromkeys(item for item in sources if item))
    return {
        "indicator": "7.3.1",
        "series": "EG_EGY_PRIM",
        "unit": "MJ por USD de PIB en PPA constante" + (f" de {base_period}" if base_period else ""),
        "description": descriptions[0] if descriptions else "Intensidad energética de la economía respecto al PIB.",
        "source": "; ".join(unique_sources) if unique_sources else "ONU · Base mundial de indicadores ODS",
        "sourceUrl": "https://unstats.un.org/SDGAPI/swagger/",
        "metadataUrl": "https://unstats.un.org/sdgs/metadata/?Goal=7&Target=7.3",
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "stale": False,
        "observations": sorted(observations, key=lambda item: (item["year"], item["areaCode"])),
    }


def public_benchmark() -> tuple[int, dict]:
    global benchmark_cache, benchmark_cached_at
    with benchmark_lock:
        now = time.time()
        if benchmark_cache is not None and now - benchmark_cached_at < 24 * 60 * 60:
            return 200, benchmark_cache
        query = urllib.parse.urlencode(
            [("seriesCode", "EG_EGY_PRIM"), ("areaCode", "1"), ("areaCode", "170"), ("page", "1"), ("pageSize", "200")]
        )
        request = urllib.request.Request(
            "https://unstats.un.org/SDGAPI/v1/sdg/Series/Data?" + query,
            headers={"Accept": "application/json", "User-Agent": "Pyme360-local/1.0"},
        )
        try:
            with urllib.request.urlopen(request, timeout=18) as response:
                payload = normalize_benchmark_rows(json.loads(response.read().decode("utf-8")))
            benchmark_cache = payload
            benchmark_cached_at = now
            return 200, payload
        except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
            if benchmark_cache is not None:
                stale = dict(benchmark_cache)
                stale["stale"] = True
                stale["cacheAgeHours"] = round(max(0, (now - benchmark_cached_at) / 3600), 1)
                return 200, stale
            return 502, {"error": "No fue posible consultar la referencia pública de la ONU.", "detail": str(exc)}


def password_record(password: str) -> tuple[str, str, str, int]:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS)
    return salt.hex(), digest.hex(), "pbkdf2_sha256", PASSWORD_ITERATIONS


def public_user(row: sqlite3.Row | dict) -> dict:
    return {
        "id": row["id"],
        "username": row["username"],
        "displayName": row["display_name"],
        "role": row["role"],
        "active": bool(row["active"]),
        "createdAt": row["created_at"],
    }


def write_audit(
    connection: sqlite3.Connection,
    actor: dict,
    action: str,
    entity_type: str,
    entity_id: str,
    details: dict | None = None,
) -> None:
    connection.execute(
        """INSERT INTO audit_log (actor_user_id, actor_username, action, entity_type, entity_id, occurred_at, details_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            actor.get("id"),
            actor.get("username", "sistema"),
            action,
            entity_type,
            entity_id,
            datetime.now(timezone.utc).isoformat(),
            json.dumps(details or {}, ensure_ascii=False, separators=(",", ":")),
        ),
    )


def state_changes(previous: dict, updated: dict) -> list[tuple[str, str, str, list[str]]]:
    """Return changed entity summaries without persisting personal field values in audit."""
    changes: list[tuple[str, str, str, list[str]]] = []
    array_sections = (
        "contacts", "products", "recipes", "sales", "purchases", "productionOrders",
        "environmentalRecords", "resourceReadings", "environmentalActions",
        "receiptImports", "inventoryMovements", "financialAccounts", "cashMovements",
        "emissionFactors", "indicatorTargets", "importExtras", "electronicDocuments",
        "supplierInvoices",
    )
    for section in array_sections:
        before_rows = {str(item.get("id")): item for item in previous.get(section, []) if isinstance(item, dict) and item.get("id") is not None}
        after_rows = {str(item.get("id")): item for item in updated.get(section, []) if isinstance(item, dict) and item.get("id") is not None}
        for entity_id in before_rows.keys() | after_rows.keys():
            before = before_rows.get(entity_id)
            after = after_rows.get(entity_id)
            if before == after:
                continue
            action = "created" if before is None else "deleted" if after is None else "updated"
            before_keys = set(before or {})
            after_keys = set(after or {})
            fields = sorted(key for key in before_keys | after_keys if (before or {}).get(key) != (after or {}).get(key))
            changes.append((section, entity_id, action, fields))
    for key in ("company", "environmentalConfig", "taxConfiguration"):
        if previous.get(key) != updated.get(key):
            changes.append((key, "settings", "updated", sorted(set(previous.get(key) or {}) | set(updated.get(key) or {}))))
    return changes


def operator_change_error(previous: dict, updated: dict) -> str | None:
    editable_sections = {
        "contacts", "products", "recipes", "sales", "purchases", "productionOrders",
        "environmentalRecords", "resourceReadings", "environmentalActions",
        "receiptImports", "inventoryMovements", "cashMovements", "importExtras",
        "electronicDocuments", "supplierInvoices",
    }
    for key in set(previous) | set(updated):
        migration_default = (
            int(previous.get("schemaVersion", 0) or 0) < TYPESCRIPT_MODEL_SCHEMA_VERSION
            and key in {"environmentalConfig", "inventoryMovements", "financialAccounts", "cashMovements", "taxConfiguration", "electronicDocuments", "supplierInvoices"}
            and key not in previous
        )
        if key == "environmentalConfig" and int(previous.get("schemaVersion", 0) or 0) < 5:
            old_config = previous.get("environmentalConfig")
            new_config = updated.get("environmentalConfig")
            if isinstance(old_config, dict) and isinstance(new_config, dict):
                migrated_config = dict(new_config)
                migrated_config.pop("benchmarking", None)
                migration_default = migrated_config == old_config
        if previous.get(key) != updated.get(key) and key not in editable_sections and key not in {"schemaVersion"} and not migration_default:
            return f"El rol operador no puede modificar la sección {key}."

    for section in editable_sections:
        before_rows = previous.get(section, [])
        after_rows = updated.get(section, [])
        if not isinstance(before_rows, list) or not isinstance(after_rows, list):
            continue
        before_ids = {str(row.get("id")) for row in before_rows if isinstance(row, dict) and row.get("id") is not None}
        after_by_id = {str(row.get("id")): row for row in after_rows if isinstance(row, dict) and row.get("id") is not None}
        if before_ids - after_by_id.keys():
            return f"Solo el administrador puede eliminar registros de {section}."

    before_extras = {
        str(extra.get("id")): extra
        for extra in previous.get("importExtras", [])
        if isinstance(extra, dict) and extra.get("id") is not None
    }
    for extra in updated.get("importExtras", []):
        if not isinstance(extra, dict):
            return "Los campos adicionales deben ser registros válidos."
        if before_extras.get(str(extra.get("id"))) == extra:
            continue
        owner_section = extra.get("entityType")
        if owner_section not in editable_sections or owner_section == "importExtras":
            return "El rol operador no puede importar campos adicionales de esta sección."
        owner_rows = updated.get(owner_section, [])
        if not any(isinstance(row, dict) and str(row.get("id")) == str(extra.get("entityId")) for row in owner_rows):
            return "Los campos adicionales deben pertenecer a un registro existente de una sección editable."

    for section in ("inventoryMovements", "cashMovements"):
        before_rows = previous.get(section, [])
        after_rows = updated.get(section, [])
        if isinstance(before_rows, list) and isinstance(after_rows, list) and after_rows[:len(before_rows)] != before_rows:
            return "Los libros de movimientos son inmutables; registra una reversión para corregir un dato."

    for section in ("electronicDocuments", "supplierInvoices"):
        before_rows = previous.get(section, [])
        after_rows = updated.get(section, [])
        if not isinstance(before_rows, list) or not isinstance(after_rows, list):
            return f"La sección {section} debe conservar el formato de lista."
        if len(after_rows) < len(before_rows) or after_rows[:len(before_rows)] != before_rows:
            return "Los documentos tributarios y sus importaciones se conservan como historial; no se editan ni eliminan desde el estado general."

    previous_electronic_documents = previous.get("electronicDocuments", [])
    for document in updated.get("electronicDocuments", [])[len(previous_electronic_documents):]:
        if document.get("status") != "draft":
            return "El estado de aceptación solo puede cambiar desde un conector autorizado; el estado general crea borradores."
        if document.get("documentNumber") or document.get("providerReference") or document.get("cufe") or document.get("attempts"):
            return "Solo un conector autorizado puede asignar número, respuesta o intentos de transmisión."

    # On first v2 to v3 migration stock is preserved while opening balances are added.
    if int(previous.get("schemaVersion", 0) or 0) >= TYPESCRIPT_MODEL_SCHEMA_VERSION:
        before_stock = {str(row.get("id")): float(row.get("stock", 0) or 0) for row in previous.get("products", []) if isinstance(row, dict)}
        after_stock = {str(row.get("id")): float(row.get("stock", 0) or 0) for row in updated.get("products", []) if isinstance(row, dict)}
        appended_movements = updated.get("inventoryMovements", [])[len(previous.get("inventoryMovements", [])):]
        movement_delta: dict[str, float] = {}
        for movement in appended_movements:
            if isinstance(movement, dict):
                product_id = str(movement.get("productId", ""))
                movement_delta[product_id] = movement_delta.get(product_id, 0) + float(movement.get("quantity", 0) or 0)
        for product_id in before_stock.keys() | after_stock.keys():
            stock_change = after_stock.get(product_id, 0) - before_stock.get(product_id, 0)
            if abs(stock_change - movement_delta.get(product_id, 0)) > 0.0001:
                return "Cada cambio de existencia debe estar respaldado por un movimiento de inventario."
    return None


def ledger_change_error(previous: dict, updated: dict) -> str | None:
    """Protect append-only books and require stock changes to match their ledger."""
    previous_electronic_documents = previous.get("electronicDocuments", [])
    updated_electronic_documents = updated.get("electronicDocuments", [])
    if not isinstance(previous_electronic_documents, list) or not isinstance(updated_electronic_documents, list):
        return "La sección electronicDocuments debe conservar el formato de lista."
    if len(updated_electronic_documents) >= len(previous_electronic_documents):
        for document in updated_electronic_documents[len(previous_electronic_documents):]:
            if document.get("status") != "draft":
                return "El estado de aceptación solo puede cambiar desde un conector autorizado; el estado general crea borradores."
            if document.get("documentNumber") or document.get("providerReference") or document.get("cufe") or document.get("attempts"):
                return "Solo un conector autorizado puede asignar número, respuesta o intentos de transmisión."
    if int(previous.get("schemaVersion", 0) or 0) < TYPESCRIPT_MODEL_SCHEMA_VERSION:
        # The v2 -> v3 migration creates the opening-balance ledger from current stock.
        return None

    for section in ("inventoryMovements", "cashMovements"):
        before_rows = previous.get(section, [])
        after_rows = updated.get(section, [])
        if not isinstance(before_rows, list) or not isinstance(after_rows, list):
            return f"La sección {section} debe conservar el formato de lista."
        if len(after_rows) < len(before_rows) or after_rows[:len(before_rows)] != before_rows:
            return "Los libros de movimientos son inmutables; registra una reversión para corregir un dato."

    for section in ("electronicDocuments", "supplierInvoices"):
        before_rows = previous.get(section, [])
        after_rows = updated.get(section, [])
        if not isinstance(before_rows, list) or not isinstance(after_rows, list):
            return f"La sección {section} debe conservar el formato de lista."
        if len(after_rows) < len(before_rows) or after_rows[:len(before_rows)] != before_rows:
            return "Los documentos tributarios y sus importaciones se conservan como historial; no se editan ni eliminan desde el estado general."

    before_products = previous.get("products", [])
    after_products = updated.get("products", [])
    if not isinstance(before_products, list) or not isinstance(after_products, list):
        return "El inventario debe conservar el formato de lista."
    try:
        before_stock = {
            str(row.get("id")): float(row.get("stock", 0) or 0)
            for row in before_products if isinstance(row, dict)
        }
        after_stock = {
            str(row.get("id")): float(row.get("stock", 0) or 0)
            for row in after_products if isinstance(row, dict)
        }
    except (TypeError, ValueError):
        return "Un producto contiene una existencia no válida."
    if any(not math.isfinite(stock) for stock in (*before_stock.values(), *after_stock.values())):
        return "Un producto contiene una existencia no válida."
    before_movements = previous.get("inventoryMovements", [])
    appended_movements = updated.get("inventoryMovements", [])[len(before_movements):]
    movement_delta: dict[str, float] = {}
    running_stock = dict(before_stock)
    for movement in appended_movements:
        if isinstance(movement, dict):
            product_id = str(movement.get("productId", ""))
            try:
                quantity = float(movement.get("quantity", 0) or 0)
                balance_after = float(movement.get("balanceAfter", 0) or 0)
            except (TypeError, ValueError):
                return "Un movimiento de inventario contiene cantidades no válidas."
            if not math.isfinite(quantity) or not math.isfinite(balance_after):
                return "Un movimiento de inventario contiene cantidades no válidas."
            if product_id not in after_stock:
                return "Un movimiento de inventario debe pertenecer a un producto existente."
            balance = running_stock.get(product_id, 0) + quantity
            if balance < -0.0001:
                return "Un movimiento no puede dejar existencias negativas."
            if abs(balance - balance_after) > 0.0001:
                return "El saldo posterior del movimiento no coincide con el inventario calculado."
            running_stock[product_id] = balance
            movement_delta[product_id] = movement_delta.get(product_id, 0) + quantity
    for product_id in before_stock.keys() | after_stock.keys():
        stock_change = after_stock.get(product_id, 0) - before_stock.get(product_id, 0)
        if abs(stock_change - movement_delta.get(product_id, 0)) > 0.0001:
            return "Cada cambio de existencia debe estar respaldado por un movimiento de inventario."
    return None


def sync_api_url(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("Escribe la dirección HTTPS de la API central.")
    parsed = urllib.parse.urlsplit(value.strip())
    local_http = parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}
    if parsed.scheme != "https" and not local_http:
        raise ValueError("La API central debe usar HTTPS.")
    if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("La dirección de la API central no es válida.")
    return value.strip().rstrip("/")


def sync_keyring():
    try:
        import keyring
    except ImportError as exc:
        raise RuntimeError(
            "Para conectar la nube instala el almacén seguro del sistema con: py -m pip install -r server/requirements-sync.txt"
        ) from exc
    backend = keyring.get_keyring()
    if getattr(backend, "priority", 0) <= 0:
        raise RuntimeError("No se encontró un almacén seguro de credenciales en este equipo.")
    return keyring


def sync_keyring_username(workspace_id: str, user_id: str) -> str:
    return f"{workspace_id}:{user_id}"


def cloud_json_request(
    api_url: str,
    path: str,
    payload: dict | None = None,
    access_token: str | None = None,
    method: str | None = None,
) -> tuple[int, dict]:
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Accept": "application/json", "User-Agent": "Pyme360-local/1.0"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"
    request = urllib.request.Request(api_url + path, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            result = json.loads(response.read().decode("utf-8"))
            result = result if isinstance(result, dict) else {}
            if isinstance(result.get("detail"), dict):
                result = result["detail"]
            elif isinstance(result.get("detail"), str):
                result["error"] = result["detail"]
            return response.status, result
    except urllib.error.HTTPError as exc:
        try:
            result = json.loads(exc.read().decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            result = {"error": "La API central devolvió una respuesta no válida."}
        result = result if isinstance(result, dict) else {}
        if isinstance(result.get("detail"), dict):
            result = result["detail"]
        elif isinstance(result.get("detail"), str):
            result["error"] = result["detail"]
        return exc.code, result


def public_sync_conflicts(connection: sqlite3.Connection) -> list[dict]:
    rows = connection.execute(
        """SELECT conflict_id, batch_id, entity_type, entity_id, local_change_json,
                  remote_change_json, created_at
           FROM sync_conflicts WHERE resolved_at IS NULL ORDER BY created_at"""
    ).fetchall()
    return [
        {
            "conflictId": row["conflict_id"],
            "batchId": row["batch_id"],
            "entityType": row["entity_type"],
            "entityId": row["entity_id"],
            "localChange": json.loads(row["local_change_json"]),
            "remoteChange": json.loads(row["remote_change_json"]),
            "createdAt": row["created_at"],
        }
        for row in rows
    ]


def empty_sync_state() -> dict:
    state = {
        "schemaVersion": TYPESCRIPT_MODEL_SCHEMA_VERSION,
        "company": None,
        "taxConfiguration": {
            "countryCode": "CO", "currency": "COP", "legalAddress": "", "invoiceEmail": "",
            "taxRegime": "", "taxResponsibilities": [], "providerId": "", "environment": "test",
            "resolutionNumber": "", "prefix": "", "rangeFrom": None, "rangeTo": None,
            "validFrom": "", "validTo": "", "contingencyPrefix": "",
            "contingencyRangeFrom": None, "contingencyRangeTo": None,
        },
        "environmentalConfig": {
            "providerId": "local-receipt", "providerName": "Enel Colombia", "accountNumber": "",
            "businessUnit": "", "geography": "Colombia SIN",
            "benchmarking": {"countryCode": "CO", "region": "Antioquia", "sectorCode": "1104",
                              "outputUnit": "L", "assumedMonthlyOutput": 100000,
                              "preferredSources": ["dane-eai", "xm", "unsd", "eia-mecs", "company-public"]},
        },
    }
    state.update({section: [] for section in SYNCED_SECTIONS})
    state.update({section: None for section in SINGLETONS})
    state["taxConfiguration"] = {
        "countryCode": "CO", "currency": "COP", "legalAddress": "", "invoiceEmail": "",
        "taxRegime": "", "taxResponsibilities": [], "providerId": "", "environment": "test",
        "resolutionNumber": "", "prefix": "", "rangeFrom": None, "rangeTo": None,
        "validFrom": "", "validTo": "", "contingencyPrefix": "",
        "contingencyRangeFrom": None, "contingencyRangeTo": None,
    }
    state["environmentalConfig"] = {
        "providerId": "local-receipt", "providerName": "Enel Colombia", "accountNumber": "",
        "businessUnit": "", "geography": "Colombia SIN",
        "benchmarking": {"countryCode": "CO", "region": "Antioquia", "sectorCode": "1104",
                          "outputUnit": "L", "assumedMonthlyOutput": 100000,
                          "preferredSources": ["dane-eai", "xm", "unsd", "eia-mecs", "company-public"]},
    }
    return state


def sync_record_counts(state: dict | None) -> dict[str, int]:
    value = state if isinstance(state, dict) else empty_sync_state()
    counts: dict[str, int] = {}
    for section in SYNCED_SECTIONS:
        rows = value.get(section, [])
        counts[section] = len(rows) if isinstance(rows, list) else 0
    for section in SINGLETONS:
        counts[section] = 1 if isinstance(value.get(section), dict) else 0
    return counts


class Pyme360Handler(SimpleHTTPRequestHandler):
    server_version = "Pyme360Local/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        # Evita imprimir datos personales o consultas con parámetros en la terminal.
        if self.path.startswith("/api/"):
            print("Solicitud API local de Pyme360 atendida.")
        else:
            super().log_message(fmt, *args)

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def guess_type(self, path: str) -> str:
        explicit_types = {".wasm": "application/wasm", ".mjs": "text/javascript"}
        extension = Path(path).suffix.lower()
        return explicit_types.get(extension, super().guess_type(path))

    def _is_local_request(self) -> bool:
        try:
            if not self.client_address[0].startswith(("127.", "::1")):
                return False
            host = self.headers.get("Host", "").lower()
            allowed_hosts = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
            if host not in allowed_hosts:
                return False
            origin = self.headers.get("Origin")
            if origin:
                parsed = urllib.parse.urlsplit(origin)
                if parsed.scheme != "http" or parsed.netloc.lower() not in allowed_hosts:
                    return False
            return True
        except (AttributeError, ValueError):
            return False

    def _is_typescript_model_request(self) -> bool:
        if self._is_local_request():
            return True
        try:
            if not self.client_address[0].startswith(("127.", "::1")):
                return False
            host = self.headers.get("Host", "").lower()
            allowed_hosts = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
            if host not in allowed_hosts:
                return False
            origin = self.headers.get("Origin")
            if not origin:
                return True
            parsed = urllib.parse.urlsplit(origin)
            return (
                parsed.scheme == "http"
                and parsed.hostname in {"127.0.0.1", "localhost"}
                and parsed.port is not None
                and 5173 <= parsed.port <= 5199
            )
        except (AttributeError, ValueError):
            return False

    def _read_auth_json(self) -> dict:
        raw_length = self.headers.get("Content-Length", "")
        try:
            length = int(raw_length)
        except ValueError as exc:
            raise ValueError("La solicitud no indicó un tamaño válido.") from exc
        if length < 1 or length > 1_000_000:
            raise OverflowError("La solicitud supera el límite permitido.")
        if "application/json" not in self.headers.get("Content-Type", "").lower():
            raise ValueError("El servidor esperaba datos JSON.")
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("Los datos recibidos no forman un JSON válido.") from exc
        if not isinstance(payload, dict):
            raise ValueError("La solicitud debe contener un objeto JSON.")
        return payload

    def _read_supplier_invoice_xml(self) -> str:
        raw_length = self.headers.get("Content-Length", "")
        try:
            length = int(raw_length)
        except ValueError as exc:
            raise ValueError("La solicitud no indicó un tamaño válido.") from exc
        if length < 1 or length > 2 * 1024 * 1024:
            raise OverflowError("El archivo XML supera el límite local de 2 MB.")
        content_type = self.headers.get("Content-Type", "").lower()
        if "xml" not in content_type and "text/plain" not in content_type:
            raise ValueError("El servidor esperaba el contenido de un archivo XML.")
        try:
            return self.rfile.read(length).decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise ValueError("El XML debe estar codificado en UTF-8.") from exc

    def _session_user(self) -> dict | None:
        try:
            cookie = SimpleCookie(self.headers.get("Cookie", ""))
            token = cookie.get("pyme360_session").value if cookie.get("pyme360_session") else ""
        except (KeyError, AttributeError):
            token = ""
        if not token:
            return None
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        now = datetime.now(timezone.utc).isoformat()
        with db_session() as connection:
            row = connection.execute(
                """SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
                   WHERE s.token_hash=? AND s.expires_at>?""",
                (token_hash, now),
            ).fetchone()
            if row is not None and not row["active"]:
                connection.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash,))
                return None
        return public_user(row) if row else None

    def _make_session(self, user_id: str) -> tuple[str, str]:
        token = secrets.token_urlsafe(32)
        now = datetime.now(timezone.utc)
        expires = now.timestamp() + SESSION_TTL_SECONDS
        expires_at = datetime.fromtimestamp(expires, timezone.utc).isoformat()
        with db_session() as connection:
            connection.execute("DELETE FROM sessions WHERE expires_at<=?", (now.isoformat(),))
            connection.execute(
                "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                (hashlib.sha256(token.encode("utf-8")).hexdigest(), user_id, now.isoformat(), expires_at),
            )
        cookie = f"pyme360_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_TTL_SECONDS}"
        return cookie, expires_at

    def _clear_session(self) -> str:
        try:
            cookie = SimpleCookie(self.headers.get("Cookie", ""))
            token = cookie.get("pyme360_session").value if cookie.get("pyme360_session") else ""
        except (KeyError, AttributeError):
            token = ""
        if token:
            with db_session() as connection:
                connection.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode("utf-8")).hexdigest(),))
        return "pyme360_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"

    def _json(self, status: int, payload: dict, headers: dict[str, str] | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _read_json(self) -> dict:
        raw_length = self.headers.get("Content-Length", "")
        try:
            length = int(raw_length)
        except ValueError as exc:
            raise ValueError("La solicitud no indicó un tamaño válido.") from exc
        if length < 1 or length > MAX_BODY_BYTES:
            raise OverflowError("El archivo de datos supera el límite local de 20 MB.")
        if "application/json" not in self.headers.get("Content-Type", "").lower():
            raise ValueError("El servidor esperaba datos JSON.")
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("Los datos recibidos no forman un JSON válido.") from exc
        if not isinstance(payload, dict) or not isinstance(payload.get("state"), dict):
            raise ValueError("No encontramos el estado de Pyme360 en la solicitud.")
        if not isinstance(payload.get("expectedRevision"), int) or payload["expectedRevision"] < 0:
            raise ValueError("La versión de los datos no es válida.")
        state = payload["state"]
        for key in ("contacts", "inventory", "sales", "purchases", "production", "environment", "activity", "importExtras"):
            if key in state and not isinstance(state[key], list):
                raise ValueError(f"La sección {key} debe ser una lista.")
        return payload

    def _read_typescript_model_json(self) -> dict:
        raw_length = self.headers.get("Content-Length", "")
        try:
            length = int(raw_length)
        except ValueError as exc:
            raise ValueError("La solicitud no indicó un tamaño válido.") from exc
        if length < 1 or length > MAX_BODY_BYTES:
            raise OverflowError("El archivo de datos supera el límite local de 20 MB.")
        if "application/json" not in self.headers.get("Content-Type", "").lower():
            raise ValueError("El servidor esperaba datos JSON.")
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("Los datos recibidos no forman un JSON válido.") from exc
        if not isinstance(payload, dict) or not isinstance(payload.get("state"), dict):
            raise ValueError("No encontramos el estado del modelo TypeScript en la solicitud.")
        expected_revision = payload.get("expectedRevision")
        if isinstance(expected_revision, bool) or not isinstance(expected_revision, int) or expected_revision < 0:
            raise ValueError("La versión de los datos no es válida.")
        state = payload["state"]
        if state.get("schemaVersion") != TYPESCRIPT_MODEL_SCHEMA_VERSION:
            raise ValueError("La aplicación debe migrar los datos al esquema ambiental actualizado antes de guardarlos.")
        if state.get("company") is not None and not isinstance(state.get("company"), dict):
            raise ValueError("La empresa debe ser un objeto o estar vacía.")
        for key in ("contacts", "products", "recipes", "sales", "purchases", "productionOrders", "environmentalRecords", "resourceReadings", "emissionFactors", "indicatorTargets", "environmentalActions"):
            rows = state.get(key)
            if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
                raise ValueError(f"La sección {key} debe ser una lista de registros.")
        if "receiptImports" in state and (not isinstance(state["receiptImports"], list) or any(not isinstance(row, dict) for row in state["receiptImports"])):
            raise ValueError("La sección receiptImports debe ser una lista de registros.")
        for key in ("inventoryMovements", "financialAccounts", "cashMovements"):
            rows = state.get(key)
            if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
                raise ValueError(f"La sección {key} debe ser una lista de registros.")
        for key in ("electronicDocuments", "supplierInvoices"):
            rows = state.get(key)
            if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
                raise ValueError(f"La sección {key} debe ser una lista de registros.")
        tax_configuration = state.get("taxConfiguration")
        if not isinstance(tax_configuration, dict):
            raise ValueError("La configuración tributaria debe conservar un objeto válido.")
        if tax_configuration.get("countryCode") != "CO" or tax_configuration.get("currency") != "COP":
            raise ValueError("Esta instalación local está configurada únicamente para Colombia y COP.")
        if tax_configuration.get("environment") not in {"test", "production"}:
            raise ValueError("El ambiente de facturación debe ser de pruebas o producción.")
        for key in ("rangeFrom", "rangeTo", "contingencyRangeFrom", "contingencyRangeTo"):
            value = tax_configuration.get(key)
            if value is not None and (
                isinstance(value, bool)
                or not isinstance(value, int)
                or value < 1
            ):
                raise ValueError("Los rangos de numeración deben ser enteros positivos.")
        responsibilities = tax_configuration.get("taxResponsibilities")
        if not isinstance(responsibilities, list) or len(responsibilities) > 100 or any(not isinstance(item, str) or len(item) > 100 for item in responsibilities):
            raise ValueError("Las responsabilidades tributarias deben ser una lista de códigos o nombres.")
        forbidden_tax_keys = {"apikey", "api_key", "access_token", "client_secret", "password", "privatekey", "private_key", "certificate", "certificatefile", "pfx", "credentials"}
        if any(str(key).replace("-", "").lower() in forbidden_tax_keys for key in tax_configuration):
            raise ValueError("No guardes credenciales ni certificados en la configuración tributaria.")
        for start_key, end_key in (("rangeFrom", "rangeTo"), ("contingencyRangeFrom", "contingencyRangeTo")):
            start, end = tax_configuration.get(start_key), tax_configuration.get(end_key)
            if (start is None) != (end is None) or (start is not None and end < start):
                raise ValueError("Cada rango de numeración debe tener inicio y fin válidos.")
        if tax_configuration.get("validFrom") and tax_configuration.get("validTo") and tax_configuration["validFrom"] > tax_configuration["validTo"]:
            raise ValueError("La vigencia de numeración debe tener fechas ordenadas.")
        sales_by_id = {str(sale.get("id")): sale for sale in state["sales"]}
        documents_by_id = {str(document.get("id")): document for document in state["electronicDocuments"]}
        invoice_sale_ids: set[str] = set()
        for document in state["electronicDocuments"]:
            if document.get("kind") not in {"invoice", "credit_note", "debit_note"}:
                raise ValueError("El tipo de documento electrónico no es válido.")
            if document.get("status") not in {"draft", "queued", "transmitted", "accepted", "rejected", "delivered", "contingency_pending"}:
                raise ValueError("El estado del documento electrónico no es válido.")
            if not isinstance(document.get("snapshot"), dict) or not isinstance(document.get("validationIssues"), list) or not isinstance(document.get("attempts"), list):
                raise ValueError("El documento electrónico debe contener una instantánea y su historial.")
            if str(document.get("saleId")) not in sales_by_id:
                raise ValueError("El borrador electrónico debe estar relacionado con una venta existente.")
            if document.get("kind") == "invoice":
                sale = sales_by_id[str(document.get("saleId"))]
                sale_id = str(document.get("saleId"))
                if sale_id in invoice_sale_ids:
                    raise ValueError("Una venta no puede tener más de una factura electrónica asociada.")
                invoice_sale_ids.add(sale_id)
                try:
                    snapshot_total = float(document["snapshot"].get("total", -1))
                    sale_total = float(sale.get("total", -2))
                except (TypeError, ValueError):
                    raise ValueError("El total de la factura debe ser numérico.") from None
                if not math.isfinite(snapshot_total) or not math.isfinite(sale_total) or abs(snapshot_total - sale_total) > 1:
                    raise ValueError("El borrador de factura debe conservar el total de la venta original.")
            else:
                original = documents_by_id.get(str(document.get("relatedDocumentId", "")))
                if not original or original.get("kind") != "invoice" or original.get("saleId") != document.get("saleId") or original.get("status") not in {"accepted", "delivered"}:
                    raise ValueError("La nota debe relacionarse con una factura aceptada o entregada de la misma venta.")
                amount = document.get("adjustmentAmount")
                if isinstance(amount, bool) or not isinstance(amount, (int, float)) or not math.isfinite(amount) or amount <= 0:
                    raise ValueError("La nota debe conservar un valor de ajuste positivo.")
        for invoice in state["supplierInvoices"]:
            if not all(isinstance(invoice.get(key), str) for key in ("id", "fileName", "documentNumber", "issueDate", "supplierTaxId", "supplierName", "buyerTaxId", "status")):
                raise ValueError("La factura de proveedor importada contiene campos de identificación inválidos.")
            if invoice.get("status") not in {"pending_review", "linked"} or not isinstance(invoice.get("lines"), list):
                raise ValueError("El estado o el detalle de la factura de proveedor no es válido.")
            if any(key in invoice for key in ("xml", "rawXml", "textPreview")):
                raise ValueError("No se permite guardar el archivo XML ni su texto original.")
            if invoice.get("purchaseId"):
                purchase = next((item for item in state["purchases"] if item.get("id") == invoice.get("purchaseId")), None)
                supplier = next((item for item in state["contacts"] if purchase and item.get("id") == purchase.get("supplierId")), None)
                company_tax_id = str((state.get("company") or {}).get("taxId", "")).strip().lower()
                if not purchase or not supplier or str(supplier.get("taxId", "")).strip().lower() != str(invoice.get("supplierTaxId", "")).strip().lower():
                    raise ValueError("La factura importada no coincide con el proveedor de la compra seleccionada.")
                if str(invoice.get("buyerTaxId", "")).strip().lower() != company_tax_id:
                    raise ValueError("No vincules a una compra una factura que identifica a otro adquirente.")
            if invoice.get("supplierContactId") and not any(
                contact.get("id") == invoice.get("supplierContactId")
                and str(contact.get("taxId", "")).strip().lower() == str(invoice.get("supplierTaxId", "")).strip().lower()
                for contact in state["contacts"]
            ):
                raise ValueError("El proveedor relacionado no coincide con la identificación de la factura importada.")
        seen_supplier_invoices: set[tuple[str, str]] = set()
        for invoice in state["supplierInvoices"]:
            key = (str(invoice.get("supplierTaxId", "")).strip().lower(), str(invoice.get("documentNumber", "")).strip().lower())
            if key in seen_supplier_invoices:
                raise ValueError("Hay facturas XML duplicadas para el mismo proveedor.")
            seen_supplier_invoices.add(key)
        if "importExtras" not in state or not isinstance(state["importExtras"], list) or any(not isinstance(row, dict) for row in state["importExtras"]):
            raise ValueError("La sección importExtras debe ser una lista de registros.")
        environment_config = state.get("environmentalConfig")
        if not isinstance(environment_config, dict):
            raise ValueError("La configuración ambiental debe conservar un objeto válido.")
        benchmark_config = environment_config.get("benchmarking")
        if not isinstance(benchmark_config, dict):
            raise ValueError("La configuración de referencias debe conservar un objeto válido.")
        for field in ("countryCode", "region", "sectorCode", "outputUnit"):
            if not isinstance(benchmark_config.get(field), str) or len(benchmark_config[field]) > 100:
                raise ValueError(f"El campo {field} del perfil ambiental no es válido.")
        preferred_sources = benchmark_config.get("preferredSources")
        if (
            not isinstance(preferred_sources, list)
            or len(preferred_sources) > 25
            or any(not isinstance(source, str) or not source.strip() or len(source) > 100 for source in preferred_sources)
        ):
            raise ValueError("La lista de fuentes preferidas no es válida.")
        assumed_output = benchmark_config.get("assumedMonthlyOutput")
        if isinstance(assumed_output, bool) or not isinstance(assumed_output, (int, float)) or not math.isfinite(assumed_output) or assumed_output < 0:
            raise ValueError("El volumen mensual ilustrativo debe ser un número no negativo.")
        for product in state["products"]:
            if product.get("taxCategory", "unclassified") not in {"unclassified", "taxable", "exempt", "excluded", "not_applicable"}:
                raise ValueError("La clasificación tributaria del producto no es válida.")
            factor = product.get("benchmarkOutputFactor")
            unit = product.get("benchmarkOutputUnit")
            if (factor is None) != (unit is None):
                raise ValueError("La conversión a litros debe incluir factor y unidad juntos.")
            if factor is not None and (
                isinstance(factor, bool)
                or not isinstance(factor, (int, float))
                or not math.isfinite(factor)
                or factor <= 0
                or unit != "L"
                or product.get("type") != "finished"
            ):
                raise ValueError("La conversión a litros debe ser positiva y pertenecer a un producto terminado.")
        products_by_id = {str(product.get("id")): product for product in state["products"]}
        recipe_ids: set[str] = set()
        recipe_product_ids: set[str] = set()
        for recipe in state["recipes"]:
            recipe_id = str(recipe.get("id", ""))
            product_id = str(recipe.get("productId", ""))
            if not recipe_id or recipe_id in recipe_ids or product_id in recipe_product_ids:
                raise ValueError("Cada receta debe tener un identificador único y pertenecer a un solo producto.")
            recipe_ids.add(recipe_id)
            recipe_product_ids.add(product_id)
            finished = products_by_id.get(product_id)
            versions = recipe.get("versions")
            if not finished or finished.get("type") != "finished" or not isinstance(versions, list) or not versions:
                raise ValueError("La receta debe pertenecer a un producto terminado y conservar versiones.")
            version_ids: set[str] = set()
            version_numbers: set[int] = set()
            active_ids: list[str] = []
            for version in versions:
                if not isinstance(version, dict):
                    raise ValueError("Una versión de receta debe ser un objeto válido.")
                version_id = str(version.get("id", ""))
                number = version.get("versionNumber")
                if not version_id or version_id in version_ids or isinstance(number, bool) or not isinstance(number, int) or number < 1 or number in version_numbers:
                    raise ValueError("Las versiones de receta deben tener identificadores y números únicos.")
                version_ids.add(version_id)
                version_numbers.add(number)
                status = version.get("status")
                if status not in {"draft", "active", "archived"}:
                    raise ValueError("El estado de versión de receta no es válido.")
                if status == "active":
                    active_ids.append(version_id)
                base_quantity = version.get("baseQuantity")
                yield_percent = version.get("expectedYieldPercent")
                if isinstance(base_quantity, bool) or not isinstance(base_quantity, (int, float)) or not math.isfinite(base_quantity) or base_quantity <= 0:
                    raise ValueError("La cantidad base de la receta debe ser positiva.")
                if isinstance(yield_percent, bool) or not isinstance(yield_percent, (int, float)) or not math.isfinite(yield_percent) or not 0 < yield_percent <= 100:
                    raise ValueError("El rendimiento esperado debe estar entre 0 y 100 %.")
                components = version.get("components")
                if not isinstance(components, list) or not components:
                    raise ValueError("Cada versión de receta debe incluir materiales.")
                component_ids: set[str] = set()
                for component in components:
                    if not isinstance(component, dict):
                        raise ValueError("Cada componente de receta debe ser un objeto válido.")
                    material_id = str(component.get("productId", "")) if isinstance(component, dict) else ""
                    material = products_by_id.get(material_id)
                    quantity = component.get("quantity") if isinstance(component, dict) else None
                    if not material or material.get("type") == "finished" or material_id == product_id:
                        raise ValueError("Una receta solo puede utilizar materiales o insumos existentes.")
                    if material_id in component_ids:
                        raise ValueError("Una versión de receta no puede repetir el mismo material.")
                    component_ids.add(material_id)
                    if isinstance(quantity, bool) or not isinstance(quantity, (int, float)) or not math.isfinite(quantity) or quantity <= 0:
                        raise ValueError("La cantidad de cada material debe ser positiva.")
            active_version_id = recipe.get("activeVersionId")
            if (active_version_id is None and active_ids) or (active_version_id is not None and (active_ids != [str(active_version_id)] or str(active_version_id) not in version_ids)):
                raise ValueError("La receta debe apuntar a su única versión activa o no tener versión activa.")
        for contact in state["contacts"]:
            if contact.get("identificationType") not in {None, "", "NIT", "CC", "CE", "PASSPORT", "OTHER"}:
                raise ValueError("El tipo de identificación de un contacto no es válido.")
        allowed_extra_entities = {
            "company", "contacts", "products", "recipes", "sales", "purchases", "inventoryMovements",
            "financialAccounts", "cashMovements", "productionOrders", "environmentalRecords",
            "resourceReadings", "emissionFactors", "indicatorTargets", "environmentalActions",
            "receiptImports", "environmentalConfig", "electronicDocuments", "supplierInvoices",
        }
        for extra in state["importExtras"]:
            if extra.get("entityType") not in allowed_extra_entities:
                raise ValueError("Un campo adicional hace referencia a una sección no válida.")
            if any(not isinstance(extra.get(key), str) or len(extra.get(key, "")) > limit for key, limit in (("id", 128), ("entityId", 1024), ("fieldName", 32768), ("sourceSheet", 128))):
                raise ValueError("Un campo adicional contiene una referencia o nombre no válido.")
            value = extra.get("value")
            if value is not None and not isinstance(value, (str, int, float, bool)):
                raise ValueError("El valor de un campo adicional debe ser texto, número, booleano o vacío.")
        return payload

    def _handle_auth(self, method: str, path: str) -> bool:
        """Handle the local authentication, user-administration and audit API."""
        if not path.startswith("/api/v1/auth/") and path != "/api/v1/audit":
            return False
        if not self._is_typescript_model_request():
            self._json(403, {"error": "Esta API solo acepta solicitudes locales de Pyme360."})
            return True
        current_user = self._session_user()

        if method == "GET" and path == "/api/v1/auth/status":
            with db_session() as connection:
                user_count = connection.execute("SELECT COUNT(*) AS amount FROM users").fetchone()["amount"]
            self._json(200, {"setupRequired": user_count == 0, "user": current_user})
            return True
        if method == "GET" and path == "/api/v1/auth/session":
            if not current_user:
                self._json(401, {"error": "Inicia sesión para continuar."})
            else:
                self._json(200, {"user": current_user})
            return True
        if method == "GET" and path == "/api/v1/auth/users":
            if not current_user or current_user["role"] != "admin":
                self._json(403, {"error": "Solo un administrador puede consultar los usuarios."})
                return True
            with db_session() as connection:
                users = connection.execute("SELECT * FROM users ORDER BY username COLLATE NOCASE").fetchall()
            self._json(200, {"users": [public_user(user) for user in users]})
            return True
        if method == "GET" and path == "/api/v1/audit":
            if not current_user or current_user["role"] != "admin":
                self._json(403, {"error": "Solo un administrador puede consultar la auditoría."})
                return True
            with db_session() as connection:
                rows = connection.execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT 300").fetchall()
            events = [{
                "id": row["id"],
                "actorUsername": row["actor_username"],
                "action": row["action"],
                "entityType": row["entity_type"],
                "entityId": row["entity_id"],
                "occurredAt": row["occurred_at"],
                "details": json.loads(row["details_json"]),
            } for row in rows]
            self._json(200, {"events": events})
            return True

        if method == "POST" and path == "/api/v1/auth/migrate-legacy":
            try:
                payload = self._read_auth_json()
            except (OverflowError, ValueError) as exc:
                self._json(400, {"error": str(exc)})
                return True
            users = payload.get("users")
            if not isinstance(users, list) or len(users) > 100:
                self._json(400, {"error": "La lista de usuarios heredados no es válida."})
                return True
            if not users:
                self._json(200, {"migrated": False})
                return True
            normalized = []
            for user in users:
                if not isinstance(user, dict):
                    self._json(400, {"error": "Hay un usuario heredado con datos incorrectos."})
                    return True
                username = str(user.get("username", "")).strip()
                role = user.get("role")
                password_hash = str(user.get("passwordHash", ""))
                if not re.fullmatch(r"[A-Za-z0-9_.-]{3,64}", username) or role not in {"admin", "operator", "viewer"} or not re.fullmatch(r"[a-fA-F0-9]{64}", password_hash):
                    self._json(400, {"error": "Un usuario heredado no cumple el formato esperado."})
                    return True
                normalized.append({
                    "id": str(user.get("id") or secrets.token_hex(16)),
                    "username": username,
                    "display_name": str(user.get("displayName") or username).strip()[:120],
                    "role": role,
                    "active": 1 if user.get("active", True) else 0,
                    "password_salt": "",
                    "password_hash": password_hash.lower(),
                    "password_algorithm": "legacy_sha256",
                    "password_iterations": 0,
                    "created_at": str(user.get("createdAt") or datetime.now(timezone.utc).isoformat()),
                })
            if not any(user["role"] == "admin" and user["active"] for user in normalized):
                self._json(400, {"error": "La migración debe conservar al menos un administrador activo."})
                return True
            try:
                with db_session() as connection:
                    connection.execute("BEGIN IMMEDIATE")
                    count = connection.execute("SELECT COUNT(*) AS amount FROM users").fetchone()["amount"]
                    if count:
                        connection.rollback()
                        self._json(200, {"migrated": False})
                        return True
                    for user in normalized:
                        connection.execute(
                            """INSERT INTO users (id, username, display_name, role, active, password_salt, password_hash,
                               password_algorithm, password_iterations, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                            tuple(user[key] for key in ("id", "username", "display_name", "role", "active", "password_salt", "password_hash", "password_algorithm", "password_iterations", "created_at")),
                        )
                    first_admin = next(user for user in normalized if user["role"] == "admin" and user["active"])
                    write_audit(connection, {"id": first_admin["id"], "username": first_admin["username"]}, "migrated", "users", "legacy", {"count": len(normalized)})
                self._json(200, {"migrated": True})
            except sqlite3.IntegrityError:
                self._json(409, {"error": "No fue posible migrar los usuarios heredados porque hay nombres duplicados."})
            except sqlite3.Error as exc:
                self._json(500, {"error": "SQLite no pudo migrar los usuarios locales.", "detail": str(exc)})
            return True

        if method == "POST" and path in {"/api/v1/auth/bootstrap", "/api/v1/auth/login"}:
            try:
                payload = self._read_auth_json()
            except (OverflowError, ValueError) as exc:
                self._json(400, {"error": str(exc)})
                return True
            username = str(payload.get("username", "")).strip()
            password = str(payload.get("password", ""))
            if path.endswith("/bootstrap"):
                if not re.fullmatch(r"[A-Za-z0-9_.-]{3,64}", username) or len(password) < 8 or len(password) > 256:
                    self._json(400, {"error": "El usuario debe tener 3–64 caracteres válidos y la contraseña al menos 8."})
                    return True
                salt, digest, algorithm, iterations = password_record(password)
                user_id = secrets.token_hex(16)
                created_at = datetime.now(timezone.utc).isoformat()
                try:
                    with db_session() as connection:
                        connection.execute("BEGIN IMMEDIATE")
                        if connection.execute("SELECT 1 FROM users LIMIT 1").fetchone():
                            connection.rollback()
                            self._json(409, {"error": "Ya existe una cuenta; inicia sesión o pide ayuda a un administrador."})
                            return True
                        connection.execute(
                            """INSERT INTO users (id, username, display_name, role, active, password_salt, password_hash,
                               password_algorithm, password_iterations, created_at) VALUES (?, ?, ?, 'admin', 1, ?, ?, ?, ?, ?)""",
                            (user_id, username, username, salt, digest, algorithm, iterations, created_at),
                        )
                        user_row = connection.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
                        actor = public_user(user_row)
                        write_audit(connection, actor, "created", "user", user_id, {"role": "admin"})
                    cookie, _ = self._make_session(user_id)
                    self._json(200, {"user": public_user(user_row)}, {"Set-Cookie": cookie})
                except sqlite3.Error as exc:
                    self._json(500, {"error": "No se pudo crear el administrador en SQLite.", "detail": str(exc)})
                return True

            if not username or not password:
                self._json(400, {"error": "Escribe el usuario y la contraseña."})
                return True
            with db_session() as connection:
                row = connection.execute("SELECT * FROM users WHERE username=? COLLATE NOCASE", (username,)).fetchone()
                if row is None or not row["active"]:
                    self._json(401, {"error": "Usuario o contraseña incorrectos."})
                    return True
                if row["password_algorithm"] == "legacy_sha256":
                    candidate = hashlib.sha256(password.encode("utf-8")).hexdigest()
                    valid_password = hmac.compare_digest(candidate, row["password_hash"])
                    if valid_password:
                        salt, digest, algorithm, iterations = password_record(password)
                        connection.execute("UPDATE users SET password_salt=?, password_hash=?, password_algorithm=?, password_iterations=? WHERE id=?", (salt, digest, algorithm, iterations, row["id"]))
                        row = connection.execute("SELECT * FROM users WHERE id=?", (row["id"],)).fetchone()
                else:
                    candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(row["password_salt"]), int(row["password_iterations"])).hex()
                    valid_password = hmac.compare_digest(candidate, row["password_hash"])
            if not valid_password:
                self._json(401, {"error": "Usuario o contraseña incorrectos."})
                return True
            cookie, expires_at = self._make_session(row["id"])
            with db_session() as connection:
                write_audit(connection, public_user(row), "login", "session", row["id"])
            self._json(200, {"user": public_user(row), "expiresAt": expires_at}, {"Set-Cookie": cookie})
            return True

        if method == "POST" and path == "/api/v1/auth/logout":
            if current_user:
                try:
                    with db_session() as connection:
                        sync_config = connection.execute("SELECT * FROM sync_configuration WHERE id=1").fetchone()
                    if sync_config:
                        keyring = sync_keyring()
                        keyring_user = sync_keyring_username(sync_config["workspace_id"], current_user["id"])
                        cloud_token = keyring.get_password(APP_NAME, keyring_user)
                        if cloud_token:
                            try:
                                cloud_json_request(
                                    sync_config["api_url"], "/api/v1/auth/logout", {}, cloud_token, "POST"
                                )
                            except (OSError, TimeoutError, urllib.error.URLError):
                                pass
                            keyring.delete_password(APP_NAME, keyring_user)
                except Exception:
                    # Local logout must still finish if the cloud or OS credential store is unavailable.
                    pass
                with db_session() as connection:
                    write_audit(connection, current_user, "logout", "session", current_user["id"])
            self._json(200, {"ok": True}, {"Set-Cookie": self._clear_session()})
            return True

        if path == "/api/v1/auth/users" and method == "POST":
            if not current_user or current_user["role"] != "admin":
                self._json(403, {"error": "Solo un administrador puede crear usuarios."})
                return True
            try:
                payload = self._read_auth_json()
            except (OverflowError, ValueError) as exc:
                self._json(400, {"error": str(exc)})
                return True
            username = str(payload.get("username", "")).strip()
            display_name = str(payload.get("displayName", "")).strip() or username
            password = str(payload.get("password", ""))
            role = payload.get("role")
            if not re.fullmatch(r"[A-Za-z0-9_.-]{3,64}", username) or len(password) < 8 or len(password) > 256 or role not in {"admin", "operator", "viewer"}:
                self._json(400, {"error": "Revisa el nombre de usuario, la contraseña y el rol."})
                return True
            salt, digest, algorithm, iterations = password_record(password)
            user_id = secrets.token_hex(16)
            created_at = datetime.now(timezone.utc).isoformat()
            try:
                with db_session() as connection:
                    connection.execute(
                        """INSERT INTO users (id, username, display_name, role, active, password_salt, password_hash,
                           password_algorithm, password_iterations, created_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)""",
                        (user_id, username, display_name[:120], role, salt, digest, algorithm, iterations, created_at),
                    )
                    row = connection.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
                    write_audit(connection, current_user, "created", "user", user_id, {"role": role})
                self._json(201, {"user": public_user(row)})
            except sqlite3.IntegrityError:
                self._json(409, {"error": "Ese nombre de usuario ya existe."})
            return True

        if path.startswith("/api/v1/auth/users/") and method in {"PATCH", "DELETE"}:
            if not current_user or current_user["role"] != "admin":
                self._json(403, {"error": "Solo un administrador puede modificar usuarios."})
                return True
            user_id = urllib.parse.unquote(path.rsplit("/", 1)[-1])
            with db_session() as connection:
                target = connection.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
                if target is None:
                    self._json(404, {"error": "No encontramos el usuario."})
                    return True
                if method == "DELETE":
                    if user_id == current_user["id"]:
                        self._json(400, {"error": "No puedes eliminar tu propia cuenta."})
                        return True
                    if target["role"] == "admin" and target["active"]:
                        admins = connection.execute("SELECT COUNT(*) AS amount FROM users WHERE role='admin' AND active=1").fetchone()["amount"]
                        if admins <= 1:
                            self._json(400, {"error": "Debe quedar al menos un administrador activo."})
                            return True
                    connection.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
                    connection.execute("DELETE FROM users WHERE id=?", (user_id,))
                    write_audit(connection, current_user, "deleted", "user", user_id, {"role": target["role"]})
                    self._json(200, {"ok": True})
                    return True
                try:
                    payload = self._read_auth_json()
                except (OverflowError, ValueError) as exc:
                    self._json(400, {"error": str(exc)})
                    return True
                role = payload.get("role", target["role"])
                active = payload.get("active", bool(target["active"]))
                if role not in {"admin", "operator", "viewer"} or not isinstance(active, bool):
                    self._json(400, {"error": "El rol o estado del usuario no es válido."})
                    return True
                if target["active"] and target["role"] == "admin" and (not active or role != "admin"):
                    admins = connection.execute("SELECT COUNT(*) AS amount FROM users WHERE role='admin' AND active=1").fetchone()["amount"]
                    if admins <= 1:
                        self._json(400, {"error": "Debe quedar al menos un administrador activo."})
                        return True
                if user_id == current_user["id"] and not active:
                    self._json(400, {"error": "No puedes bloquear tu propia sesión."})
                    return True
                connection.execute("UPDATE users SET role=?, active=? WHERE id=?", (role, 1 if active else 0, user_id))
                if not active:
                    connection.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
                updated = connection.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
                write_audit(connection, current_user, "updated", "user", user_id, {"role": role, "active": active})
            self._json(200, {"user": public_user(updated)})
            return True

        self._json(404, {"error": "No encontramos esta dirección de autenticación."})
        return True

    def do_GET(self) -> None:
        path = urllib.parse.urlsplit(self.path).path
        if self._handle_auth("GET", path):
            return
        is_authorized = (
            self._is_typescript_model_request()
            if path.startswith(("/api/v1/typescript-model/", "/api/v1/sync/"))
            else self._is_local_request()
        )
        if path.startswith("/api/") and not is_authorized:
            return self._json(403, {"error": "Esta API solo acepta solicitudes del mismo computador."})
        if path == "/api/v1/state":
            if not self._session_user():
                return self._json(401, {"error": "Inicia sesión para consultar los datos."})
            return self._json(200, state_row())
        if path == "/api/v1/typescript-model/state":
            if not self._session_user():
                return self._json(401, {"error": "Inicia sesión para consultar los datos."})
            return self._json(200, typescript_model_state_row())
        if path == "/api/v1/sync/status":
            actor = self._session_user()
            if not actor:
                return self._json(401, {"error": "Inicia sesión para consultar la sincronización."})
            with db_session() as connection:
                status = synchronization_status(connection)
                conflicts = public_sync_conflicts(connection)
                link = connection.execute(
                    """SELECT remote_user_id, workspace_id, email, role, auth_error FROM sync_user_links
                       WHERE local_user_id=?""",
                    (actor["id"],),
                ).fetchone()
                local_user = connection.execute(
                    "SELECT role FROM users WHERE id=?", (actor["id"],)
                ).fetchone()
            link_matches = bool(
                link
                and status.get("workspaceId") == link["workspace_id"]
                and local_user
                and local_user["role"] == link["role"]
            )
            try:
                keyring = sync_keyring()
                has_token = bool(
                    link_matches
                    and keyring.get_password(
                        APP_NAME,
                        sync_keyring_username(status["workspaceId"], actor["id"]),
                    )
                )
                secure_store_available = True
            except RuntimeError:
                has_token = False
                secure_store_available = False
            return self._json(
                200,
                {
                    **status,
                    "centralUserId": link["remote_user_id"] if link else None,
                    "centralEmail": link["email"] if link else None,
                    "centralAuthError": (
                        "role_mismatch"
                        if link and local_user and local_user["role"] != link["role"]
                        else (link["auth_error"] if link else None)
                    ),
                    "connectedForCurrentUser": has_token,
                    "secureStoreAvailable": secure_store_available,
                    "conflictRecords": conflicts,
                },
            )
        if path == "/api/v1/sync/members":
            actor = self._session_user()
            if not actor:
                return self._json(401, {"error": "Inicia sesión para consultar las cuentas centrales."})
            if actor["role"] != "admin":
                return self._json(403, {"error": "Solo un administrador puede gestionar miembros centrales."})
            with db_session() as connection:
                config = connection.execute("SELECT * FROM sync_configuration WHERE id=1").fetchone()
            if not config:
                return self._json(409, {"error": "Vincula primero el espacio de trabajo."})
            try:
                token = self._sync_token(actor, config["workspace_id"])
                status, response = cloud_json_request(
                    config["api_url"], "/api/v1/members", None, token, "GET"
                )
            except (RuntimeError, OSError, TimeoutError, urllib.error.URLError) as exc:
                return self._json(502, {"error": f"No se pudieron consultar los miembros centrales: {exc}"})
            return self._json(status, response)
        if path == "/api/v1/environment/public-benchmark":
            status, payload = public_benchmark()
            return self._json(status, payload)
        if path == "/api/v1/environment/benchmarks":
            if not self._session_user():
                return self._json(401, {"error": "Inicia sesión para consultar las referencias ambientales."})
            try:
                return self._json(200, current_benchmark_payload())
            except (OSError, sqlite3.Error, ValueError) as exc:
                return self._json(502, {"error": f"No se pudieron consultar las referencias ambientales: {exc}"})
        if path == "/api/v1/e-invoicing/provider-status":
            if not self._is_typescript_model_request():
                return self._json(403, {"error": "Esta API solo acepta solicitudes locales de Pyme360."})
            if not self._session_user():
                return self._json(401, {"error": "Inicia sesión para consultar el estado de facturación."})
            return self._json(200, provider_status())
        document_status_match = re.fullmatch(r"/api/v1/e-invoicing/documents/([A-Za-z0-9_-]+)/status", path)
        if document_status_match:
            if not self._is_typescript_model_request():
                return self._json(403, {"error": "Esta API solo acepta solicitudes locales de Pyme360."})
            actor = self._session_user()
            if not actor:
                return self._json(401, {"error": "Inicia sesión para consultar el estado del documento."})
            row = typescript_model_state_row()
            state = row.get("state") if isinstance(row, dict) else None
            document_id = document_status_match.group(1)
            document = next(
                (item for item in state.get("electronicDocuments", []) if isinstance(item, dict) and item.get("id") == document_id),
                None,
            ) if isinstance(state, dict) else None
            if not document:
                return self._json(404, {"error": "No encontramos el documento electrónico."})
            checked_at = datetime.now(timezone.utc).isoformat()
            provider_reference = str(document.get("providerReference") or "").strip()
            if not provider_reference:
                return self._json(200, {
                    "documentId": document_id,
                    "status": document.get("status"),
                    "documentNumber": document.get("documentNumber"),
                    "providerReference": None,
                    "environment": document.get("environment"),
                    "checkedAt": checked_at,
                    "providerQueried": False,
                    "message": "Estado local registrado. No se consultó un proveedor porque no hay un conector configurado.",
                })
            tax_config = state.get("taxConfiguration") if isinstance(state, dict) else {}
            try:
                provider = get_provider(str((tax_config or {}).get("providerId", "")))
            except ProviderNotConfiguredError as exc:
                return self._json(200, {
                    "documentId": document_id,
                    "status": document.get("status"),
                    "documentNumber": document.get("documentNumber"),
                    "providerReference": provider_reference,
                    "environment": document.get("environment"),
                    "checkedAt": checked_at,
                    "providerQueried": False,
                    "message": str(exc),
                })
            try:
                result = provider.get_status(provider_reference)
            except ProviderRequestError as exc:
                return self._json(502, {"error": str(exc), "providerQueried": True})
            if actor["role"] == "viewer":
                return self._json(200, {
                    "documentId": document_id,
                    "status": result.status,
                    "documentNumber": result.document_number or document.get("documentNumber"),
                    "providerReference": result.provider_reference or provider_reference,
                    "environment": document.get("environment"),
                    "checkedAt": checked_at,
                    "providerQueried": True,
                    "message": result.message or "El proveedor respondió; inicia sesión con un rol de edición para guardar el cambio.",
                })
            try:
                revision, updated_document = persist_connector_result(
                    document_id, result, actor, "status_checked"
                )
            except (LookupError, ValueError) as exc:
                return self._json(409, {"error": str(exc)})
            return self._json(200, {
                "documentId": document_id,
                "status": updated_document.get("status"),
                "documentNumber": updated_document.get("documentNumber"),
                "providerReference": updated_document.get("providerReference"),
                "cufe": updated_document.get("cufe"),
                "environment": updated_document.get("environment"),
                "checkedAt": checked_at,
                "providerQueried": True,
                "revision": revision,
                "message": result.message or "Estado actualizado desde el proveedor tecnológico.",
            })
        return super().do_GET()

    def do_PUT(self) -> None:
        path = urllib.parse.urlsplit(self.path).path
        if path == "/api/v1/typescript-model/state":
            return self._put_typescript_model_state()
        if path != "/api/v1/state":
            return self._json(404, {"error": "No encontramos esta dirección."})
        if not self._is_local_request():
            return self._json(403, {"error": "Esta API solo acepta solicitudes del mismo computador."})
        actor = self._session_user()
        if not actor:
            return self._json(401, {"error": "Inicia sesión para guardar cambios."})
        if actor["role"] != "admin":
            return self._json(403, {"error": "La interfaz antigua solo admite cambios de administradores. Usa el espacio de trabajo actual de Pyme360."})
        try:
            request_payload = self._read_json()
        except OverflowError as exc:
            return self._json(413, {"error": str(exc)})
        except ValueError as exc:
            return self._json(400, {"error": str(exc)})

        serialized = json.dumps(request_payload["state"], ensure_ascii=False, separators=(",", ":"))
        current_time = datetime.now(timezone.utc).isoformat()
        try:
            with db_session() as connection:
                connection.execute("BEGIN IMMEDIATE")
                row = connection.execute("SELECT revision FROM app_state WHERE id = 1").fetchone()
                current_revision = int(row["revision"]) if row else 0
                if current_revision != request_payload["expectedRevision"]:
                    connection.rollback()
                    return self._json(409, {"error": "Los datos cambiaron en otra pestaña.", **state_row()})
                previous_payload_row = connection.execute("SELECT payload_json FROM app_state WHERE id = 1").fetchone()
                previous_state = json.loads(previous_payload_row["payload_json"]) if previous_payload_row else {}
                next_revision = current_revision + 1
                connection.execute(
                    """INSERT INTO app_state (id, schema_version, revision, payload_json, updated_at)
                       VALUES (1, ?, ?, ?, ?)
                       ON CONFLICT(id) DO UPDATE SET schema_version=excluded.schema_version,
                         revision=excluded.revision, payload_json=excluded.payload_json, updated_at=excluded.updated_at""",
                    (SCHEMA_VERSION, next_revision, serialized, current_time),
                )
                before_keys = set(previous_state) if isinstance(previous_state, dict) else set()
                after_state = request_payload["state"]
                after_keys = set(after_state) if isinstance(after_state, dict) else set()
                write_audit(connection, actor, "updated", "legacy_application_state", "legacy", {"fields": sorted(before_keys | after_keys)})
                connection.commit()
        except sqlite3.Error as exc:
            return self._json(500, {"error": "SQLite no pudo guardar los datos. Revisa el espacio y los permisos del computador.", "detail": str(exc)})
        try:
            create_daily_backup(force=True)
        except (OSError, sqlite3.Error) as exc:
            print(f"Aviso: no se pudo actualizar la copia diaria: {exc}")
        self._json(200, {"revision": next_revision, "schemaVersion": SCHEMA_VERSION, "updatedAt": current_time})

    def _put_typescript_model_state(self) -> None:
        if not self._is_typescript_model_request():
            return self._json(403, {"error": "Esta API solo acepta solicitudes del mismo computador."})
        actor = self._session_user()
        if not actor:
            return self._json(401, {"error": "Inicia sesión para guardar cambios."})
        if actor["role"] == "viewer":
            return self._json(403, {"error": "El rol de consulta no puede modificar información."})
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        restore_requested = query.get("restore", ["0"])[0] == "1"
        if restore_requested and actor["role"] != "admin":
            return self._json(403, {"error": "Solo un administrador puede restaurar un respaldo."})
        try:
            request_payload = self._read_typescript_model_json()
        except OverflowError as exc:
            return self._json(413, {"error": str(exc)})
        except ValueError as exc:
            return self._json(400, {"error": str(exc)})

        updated_state = request_payload["state"]
        serialized = json.dumps(updated_state, ensure_ascii=False, separators=(",", ":"))
        current_time = datetime.now(timezone.utc).isoformat()
        try:
            with db_session() as connection:
                connection.execute("BEGIN IMMEDIATE")
                row = connection.execute("SELECT revision, payload_json FROM typescript_model_state WHERE id = 1").fetchone()
                current_revision = int(row["revision"]) if row else 0
                if current_revision != request_payload["expectedRevision"]:
                    connection.rollback()
                    return self._json(409, {"error": "Los datos del modelo cambiaron en otra pestaña.", **typescript_model_state_row()})
                previous_state = json.loads(row["payload_json"]) if row else {
                    "schemaVersion": TYPESCRIPT_MODEL_SCHEMA_VERSION,
                    "company": None,
                    "contacts": [], "products": [], "recipes": [], "sales": [], "purchases": [],
                    "productionOrders": [], "environmentalRecords": [], "resourceReadings": [],
                    "emissionFactors": [], "indicatorTargets": [], "environmentalActions": [],
                    "receiptImports": [], "inventoryMovements": [], "financialAccounts": [],
                    "cashMovements": [], "environmentalConfig": updated_state.get("environmentalConfig"),
                    "taxConfiguration": updated_state.get("taxConfiguration"),
                    "electronicDocuments": [], "supplierInvoices": [],
                    "importExtras": [],
                }
                if not restore_requested and int(previous_state.get("schemaVersion", 0) or 0) < TYPESCRIPT_MODEL_SCHEMA_VERSION and actor["role"] != "admin":
                    connection.rollback()
                    return self._json(403, {"error": "Un administrador debe actualizar la base de datos antes de que los operadores puedan continuar."})
                if not restore_requested:
                    ledger_error = ledger_change_error(previous_state, updated_state)
                    if ledger_error:
                        connection.rollback()
                        return self._json(400, {"error": ledger_error})
                if actor["role"] == "operator":
                    role_error = operator_change_error(previous_state, updated_state)
                    if role_error:
                        connection.rollback()
                        return self._json(403, {"error": role_error})
                next_revision = current_revision + 1
                connection.execute(
                    """INSERT INTO typescript_model_state (id, schema_version, revision, payload_json, updated_at)
                       VALUES (1, ?, ?, ?, ?)
                       ON CONFLICT(id) DO UPDATE SET schema_version=excluded.schema_version,
                         revision=excluded.revision, payload_json=excluded.payload_json, updated_at=excluded.updated_at""",
                    (TYPESCRIPT_MODEL_SCHEMA_VERSION, next_revision, serialized, current_time),
                )
                for entity_type, entity_id, action, fields in state_changes(previous_state, updated_state):
                    write_audit(connection, actor, action, entity_type, entity_id, {"fields": fields})
                if restore_requested:
                    write_audit(connection, actor, "restored", "application_data", "backup", {"schemaVersion": updated_state.get("schemaVersion")})
                sync_config = connection.execute(
                    "SELECT device_id FROM sync_configuration WHERE id=1"
                ).fetchone()
                if sync_config:
                    enqueue_state_change(
                        connection,
                        previous_state,
                        updated_state,
                        actor["id"],
                        sync_config["device_id"],
                    )
                connection.commit()
        except sqlite3.Error as exc:
            return self._json(500, {"error": "SQLite no pudo guardar los datos del modelo. Revisa el espacio y los permisos del computador.", "detail": str(exc)})
        try:
            create_daily_backup(force=True)
        except (OSError, sqlite3.Error) as exc:
            print(f"Aviso: no se pudo actualizar la copia diaria del modelo TypeScript: {exc}")
        with db_session() as connection:
            pending_count = int(connection.execute("SELECT COUNT(*) FROM sync_outbox WHERE status='pending'").fetchone()[0])
        self._json(200, {"revision": next_revision, "schemaVersion": TYPESCRIPT_MODEL_SCHEMA_VERSION, "updatedAt": current_time, "pendingSyncBatches": pending_count, "savedLocally": True})

    def _sync_token(self, actor: dict, workspace_id: str) -> str:
        with db_session() as connection:
            link = connection.execute(
                """SELECT remote_user_id, workspace_id, role FROM sync_user_links
                   WHERE local_user_id=?""",
                (actor["id"],),
            ).fetchone()
        if not link or link["workspace_id"] != workspace_id:
            raise RuntimeError("Vincula la cuenta central de este usuario local antes de sincronizar.")
        if link["role"] != actor["role"]:
            raise RuntimeError("El rol local cambió; alinea los roles central y local y vuelve a vincular la cuenta.")
        token = sync_keyring().get_password(
            APP_NAME, sync_keyring_username(workspace_id, actor["id"])
        )
        if not token:
            raise RuntimeError("Vincula primero esta cuenta local con el espacio de trabajo en la nube.")
        return token

    def _sync_store_conflict(
        self,
        connection: sqlite3.Connection,
        batch_id: str,
        local_change: dict,
        remote_change: dict,
        conflict_id: str | None = None,
    ) -> None:
        local_conflict_id = conflict_id or f"{batch_id}:{local_change.get('entityType')}:{local_change.get('entityId')}"
        connection.execute(
            """INSERT OR IGNORE INTO sync_conflicts
               (conflict_id, batch_id, entity_type, entity_id, local_change_json,
                remote_change_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                local_conflict_id,
                batch_id,
                str(local_change.get("entityType", "")),
                str(local_change.get("entityId", "")),
                json.dumps(local_change, ensure_ascii=False, separators=(",", ":")),
                json.dumps(remote_change, ensure_ascii=False, separators=(",", ":")),
                datetime.now(timezone.utc).isoformat(),
            ),
        )

    def _sync_apply_cloud_changes(
        self,
        connection: sqlite3.Connection,
        actor: dict,
        changes: list[dict],
    ) -> int:
        if not changes:
            return 0
        row = connection.execute(
            "SELECT revision, payload_json FROM typescript_model_state WHERE id=1"
        ).fetchone()
        original = json.loads(row["payload_json"]) if row else {
            "schemaVersion": TYPESCRIPT_MODEL_SCHEMA_VERSION,
            "company": None,
            **{section: [] for section in SYNCED_SECTIONS},
            **{section: None for section in SINGLETONS},
            "taxConfiguration": {
                "countryCode": "CO", "currency": "COP", "legalAddress": "", "invoiceEmail": "",
                "taxRegime": "", "taxResponsibilities": [], "providerId": "", "environment": "test",
                "resolutionNumber": "", "prefix": "", "rangeFrom": None, "rangeTo": None,
                "validFrom": "", "validTo": "", "contingencyPrefix": "",
                "contingencyRangeFrom": None, "contingencyRangeTo": None,
            },
            "environmentalConfig": {
                "providerId": "local-receipt", "providerName": "Enel Colombia", "accountNumber": "",
                "businessUnit": "", "geography": "Colombia SIN",
                "benchmarking": {"countryCode": "CO", "region": "Antioquia", "sectorCode": "1104",
                                  "outputUnit": "L", "assumedMonthlyOutput": 100000,
                                  "preferredSources": ["dane-eai", "xm", "unsd", "eia-mecs", "company-public"]},
            },
        }
        current_state = json.loads(json.dumps(original))
        groups: dict[str, list[dict]] = {}
        for change in changes:
            groups.setdefault(str(change.get("batchId", "")), []).append(change)
        applied_count = 0
        for batch_id, batch_changes in groups.items():
            dirty_entities: set[tuple[str, str]] = set()
            for pending in connection.execute(
                "SELECT payload_json FROM sync_outbox WHERE status IN ('pending', 'conflict')"
            ).fetchall():
                local_batch = json.loads(pending["payload_json"])
                dirty_entities.update(
                    (str(item.get("entityType")), str(item.get("entityId")))
                    for item in local_batch.get("changes", [])
                )
            if any(
                (str(change.get("entityType")), str(change.get("entityId"))) in dirty_entities
                for change in batch_changes
            ):
                for change in batch_changes:
                    connection.execute(
                        """INSERT INTO sync_entity_versions (entity_type, entity_id, remote_version)
                           VALUES (?, ?, ?) ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                           remote_version=MAX(remote_version, excluded.remote_version)""",
                        (str(change.get("entityType")), str(change.get("entityId")), int(change.get("version", 0))),
                    )
                continue
            candidate = json.loads(json.dumps(current_state))
            for change in batch_changes:
                entity_type = str(change.get("entityType", ""))
                entity_id = str(change.get("entityId", ""))
                action = str(change.get("action", ""))
                payload = change.get("payload")
                if entity_type in SYNCED_SECTIONS:
                    records = candidate.setdefault(entity_type, [])
                    if not isinstance(records, list):
                        raise ValueError(f"La sección sincronizada {entity_type} no es una lista.")
                    records[:] = [
                        item for item in records
                        if not isinstance(item, dict) or str(item.get("id")) != entity_id
                    ]
                    if action != "delete" and isinstance(payload, dict):
                        records.append(payload)
                elif entity_type in SINGLETONS and entity_id == "settings":
                    candidate[entity_type] = payload if action != "delete" else None
                else:
                    raise ValueError("La API central devolvió una sección desconocida.")
            issue = ledger_change_error(current_state, candidate)
            if issue:
                raise ValueError(f"La API central devolvió un lote que no supera la validación local: {issue}")
            current_state = candidate
            applied_count += len(batch_changes)
            for change in batch_changes:
                connection.execute(
                    """INSERT INTO sync_entity_versions (entity_type, entity_id, remote_version)
                       VALUES (?, ?, ?) ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                       remote_version=MAX(remote_version, excluded.remote_version)""",
                    (str(change.get("entityType")), str(change.get("entityId")), int(change.get("version", 0))),
                )
        if current_state != original:
            updated_at = datetime.now(timezone.utc).isoformat()
            next_revision = (int(row["revision"]) if row else 0) + 1
            connection.execute(
                """INSERT INTO typescript_model_state (id, schema_version, revision, payload_json, updated_at)
                   VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET schema_version=excluded.schema_version,
                   revision=excluded.revision, payload_json=excluded.payload_json, updated_at=excluded.updated_at""",
                (TYPESCRIPT_MODEL_SCHEMA_VERSION, next_revision, json.dumps(current_state, ensure_ascii=False, separators=(",", ":")), updated_at),
            )
            write_audit(connection, actor, "synchronized", "workspace", "cloud", {"records": applied_count})
        return applied_count

    def _handle_sync_post(self, path: str) -> bool:
        if not self._is_typescript_model_request():
            self._json(403, {"error": "Esta API solo acepta solicitudes locales de Pyme360."})
            return True
        actor = self._session_user()
        if not actor:
            self._json(401, {"error": "Inicia sesión para usar la sincronización."})
            return True
        try:
            payload = self._read_auth_json()
        except (ValueError, OverflowError) as exc:
            self._json(400, {"error": str(exc)})
            return True

        if path == "/api/v1/sync/register":
            if actor["role"] != "admin":
                self._json(403, {"error": "Solo un administrador puede crear el espacio de la empresa."})
                return True
            try:
                api_url = sync_api_url(payload.get("apiUrl"))
            except ValueError as exc:
                self._json(400, {"error": str(exc)})
                return True
            registration = {
                "email": str(payload.get("email", "")).strip().lower(),
                "password": str(payload.get("password", "")),
                "displayName": str(payload.get("displayName", "")).strip(),
                "organizationName": str(payload.get("organizationName", "")).strip(),
            }
            if not registration["email"] or len(registration["password"]) < 8 or not registration["organizationName"]:
                self._json(400, {"error": "Indica empresa, correo y una contraseña de al menos ocho caracteres."})
                return True
            try:
                status, response = cloud_json_request(
                    api_url, "/api/v1/organizations/register", registration, method="POST"
                )
            except (OSError, TimeoutError, urllib.error.URLError) as exc:
                self._json(502, {"error": f"No se pudo contactar la API central: {exc}"})
                return True
            self._json(status, response)
            return True

        if path == "/api/v1/sync/connect":
            try:
                api_url = sync_api_url(payload.get("apiUrl"))
            except ValueError as exc:
                self._json(400, {"error": str(exc)})
                return True
            workspace_id = str(payload.get("workspaceId", "")).strip()
            email = str(payload.get("email", "")).strip().lower()
            password = str(payload.get("password", ""))
            if not workspace_id or not email or not password:
                self._json(400, {"error": "Indica el identificador del espacio, correo y contraseña."})
                return True
            try:
                status, response = cloud_json_request(
                    api_url,
                    "/api/v1/auth/login",
                    {"workspaceId": workspace_id, "email": email, "password": password},
                    method="POST",
                )
            except (OSError, TimeoutError, urllib.error.URLError) as exc:
                self._json(502, {"error": f"No se pudo contactar la API central: {exc}"})
                return True
            if status >= 400:
                self._json(status, response)
                return True
            access_token = response.get("accessToken")
            remote_role = response.get("role")
            remote_user_id = response.get("userId")
            remote_email = response.get("email")
            if (
                not isinstance(access_token, str)
                or not isinstance(remote_role, str)
                or remote_role not in {"admin", "operator", "viewer"}
                or not isinstance(remote_user_id, str)
                or not remote_user_id
                or not isinstance(remote_email, str)
                or not remote_email
            ):
                self._json(502, {"error": "La API de identidad no devolvió una sesión completa."})
                return True
            if str(response.get("workspaceId", "")) != workspace_id or remote_role != actor["role"]:
                self._json(403, {"error": "El espacio o el rol de esta cuenta no coinciden con la sesión local."})
                return True
            with db_session() as connection:
                existing_config = connection.execute("SELECT * FROM sync_configuration WHERE id=1").fetchone()
                saved_row = connection.execute("SELECT payload_json FROM typescript_model_state WHERE id=1").fetchone()
                linked_local_user = connection.execute(
                    "SELECT local_user_id FROM sync_user_links WHERE remote_user_id=?",
                    (remote_user_id,),
                ).fetchone()
            if linked_local_user and linked_local_user["local_user_id"] != actor["id"]:
                self._json(409, {"error": "Esta cuenta central ya está vinculada a otro usuario local de este equipo."})
                return True
            if existing_config and existing_config["workspace_id"] != workspace_id:
                self._json(409, {"error": "Este equipo ya está vinculado a otra empresa. Exporta y valida sus datos antes de cambiar el espacio."})
                return True
            saved_state = json.loads(saved_row["payload_json"]) if saved_row else None
            local_has_business_data = isinstance(saved_state, dict) and (
                saved_state.get("company") is not None
                or any(saved_state.get(section) for section in ("contacts", "products", "sales", "purchases", "productionOrders", "resourceReadings", "inventoryMovements", "cashMovements"))
            )
            if not existing_config and response.get("hasSyncedData") and local_has_business_data:
                self._json(409, {"error": "Esta base local ya tiene datos de otra instalación. Para evitar mezclar empresas, conecta primero una base vacía o migra mediante respaldo y validación."})
                return True
            pre_cloud_backup = None
            if not existing_config:
                try:
                    backup_path = create_pre_cloud_backup()
                    pre_cloud_backup = str(backup_path) if backup_path else None
                except (OSError, sqlite3.Error) as exc:
                    self._json(500, {"error": f"No se pudo crear la copia previa a la sincronización; no se vinculó la empresa. Detalle: {exc}"})
                    return True
            now = datetime.now(timezone.utc).isoformat()
            with db_session() as connection:
                connection.execute("BEGIN IMMEDIATE")
                linked_local_user = connection.execute(
                    "SELECT local_user_id FROM sync_user_links WHERE remote_user_id=?",
                    (remote_user_id,),
                ).fetchone()
                if linked_local_user and linked_local_user["local_user_id"] != actor["id"]:
                    self._json(409, {"error": "Esta cuenta central ya está vinculada a otro usuario local de este equipo."})
                    return True
                existing = connection.execute("SELECT * FROM sync_configuration WHERE id=1").fetchone()
                if existing:
                    connection.execute(
                        "UPDATE sync_configuration SET api_url=?, remote_user_id=?, connected_by_user_id=?, central_auth_error=NULL, updated_at=? WHERE id=1",
                        (api_url, str(response.get("userId", "")), actor["id"], now),
                    )
                else:
                    connection.execute(
                        """INSERT INTO sync_configuration
                           (id, api_url, workspace_id, remote_user_id, device_id, cursor, connected_by_user_id, updated_at)
                           VALUES (1, ?, ?, ?, ?, 0, ?, ?)""",
                        (api_url, workspace_id, str(response.get("userId", "")), secrets.token_urlsafe(24), actor["id"], now),
                    )
                connection.execute(
                    """INSERT INTO sync_user_links
                       (local_user_id, remote_user_id, workspace_id, email, role, auth_error, updated_at)
                       VALUES (?, ?, ?, ?, ?, NULL, ?)
                       ON CONFLICT(local_user_id) DO UPDATE SET
                         remote_user_id=excluded.remote_user_id,
                         workspace_id=excluded.workspace_id,
                         email=excluded.email,
                         role=excluded.role,
                         auth_error=NULL,
                         updated_at=excluded.updated_at""",
                    (actor["id"], remote_user_id, workspace_id, remote_email, remote_role, now),
                )
                if not response.get("hasSyncedData"):
                    saved_state = saved_state if isinstance(saved_state, dict) else empty_sync_state()
                    # The shared API stores only draft tax documents; transmitted
                    # statuses remain in the local ledger so the seed is accepted.
                    seed_state = {
                        **saved_state,
                        "electronicDocuments": [
                            document
                            for document in saved_state.get("electronicDocuments", [])
                            if isinstance(document, dict)
                            and document.get("status") == "draft"
                        ],
                    }
                    config = connection.execute("SELECT device_id FROM sync_configuration WHERE id=1").fetchone()
                    enqueue_snapshot(connection, seed_state, actor["id"], config["device_id"])
            try:
                sync_keyring().set_password(
                    APP_NAME, sync_keyring_username(workspace_id, actor["id"]), access_token
                )
            except Exception as exc:
                self._json(503, {"error": f"La cuenta quedó vinculada, pero no se pudo guardar la credencial de forma segura: {exc}"})
                return True
            self._json(200, {
                "workspaceId": workspace_id,
                "role": remote_role,
                "connected": True,
                "hasSyncedData": bool(response.get("hasSyncedData")),
                "preCloudBackup": pre_cloud_backup,
                "localRecordCounts": sync_record_counts(saved_state),
            })
            return True

        if path == "/api/v1/sync/invitations":
            if actor["role"] != "admin":
                self._json(403, {"error": "Solo administradores pueden invitar miembros."})
                return True
            with db_session() as connection:
                config = connection.execute("SELECT * FROM sync_configuration WHERE id=1").fetchone()
            if not config:
                self._json(409, {"error": "Vincula primero el espacio de trabajo."})
                return True
            try:
                token = self._sync_token(actor, config["workspace_id"])
                status, response = cloud_json_request(
                    config["api_url"], "/api/v1/members/invitations", payload, token, "POST"
                )
            except (RuntimeError, OSError, TimeoutError, urllib.error.URLError) as exc:
                self._json(502, {"error": str(exc)})
                return True
            self._json(status, response)
            return True

        member_match = re.fullmatch(r"/api/v1/sync/members/([A-Za-z0-9-]+)", path)
        if member_match:
            if actor["role"] != "admin":
                self._json(403, {"error": "Solo un administrador puede cambiar roles centrales."})
                return True
            next_role = payload.get("role")
            active = payload.get("active")
            if next_role is not None and next_role not in {"admin", "operator", "viewer"}:
                self._json(400, {"error": "El rol central no es válido."})
                return True
            if active is not None and not isinstance(active, bool):
                self._json(400, {"error": "El estado de la cuenta no es válido."})
                return True
            query_values = {}
            if next_role is not None:
                query_values["role"] = next_role
            if active is not None:
                query_values["active"] = "true" if active else "false"
            query = urllib.parse.urlencode(query_values)
            if not query:
                self._json(400, {"error": "Indica el rol o el estado para actualizar."})
                return True
            with db_session() as connection:
                config = connection.execute("SELECT * FROM sync_configuration WHERE id=1").fetchone()
            if not config:
                self._json(409, {"error": "Vincula primero el espacio de trabajo."})
                return True
            try:
                token = self._sync_token(actor, config["workspace_id"])
                status, response = cloud_json_request(
                    config["api_url"], f"/api/v1/members/{member_match.group(1)}?{query}", None, token, "PATCH"
                )
            except (RuntimeError, OSError, TimeoutError, urllib.error.URLError) as exc:
                self._json(502, {"error": str(exc)})
                return True
            self._json(status, response)
            return True

        revoke_match = re.fullmatch(r"/api/v1/sync/members/([A-Za-z0-9-]+)/revoke-sessions", path)
        if revoke_match:
            if actor["role"] != "admin":
                self._json(403, {"error": "Solo un administrador puede revocar sesiones centrales."})
                return True
            with db_session() as connection:
                config = connection.execute("SELECT * FROM sync_configuration WHERE id=1").fetchone()
            if not config:
                self._json(409, {"error": "Vincula primero el espacio de trabajo."})
                return True
            try:
                token = self._sync_token(actor, config["workspace_id"])
                status, response = cloud_json_request(
                    config["api_url"], f"/api/v1/members/{revoke_match.group(1)}/sessions", {}, token, "DELETE"
                )
            except (RuntimeError, OSError, TimeoutError, urllib.error.URLError) as exc:
                self._json(502, {"error": str(exc)})
                return True
            self._json(status, response)
            return True

        if path == "/api/v1/sync/run":
            with db_session() as connection:
                config = connection.execute("SELECT * FROM sync_configuration WHERE id=1").fetchone()
                batches = connection.execute(
                    """SELECT * FROM sync_outbox
                       WHERE status='pending' AND rejected_at IS NULL
                         AND NOT EXISTS (SELECT 1 FROM sync_outbox blocked
                                         WHERE blocked.status='pending' AND blocked.rejected_at IS NOT NULL)
                       ORDER BY created_at, batch_id"""
                ).fetchall() if actor["role"] in {"admin", "operator"} else []
            if not config:
                self._json(409, {"error": "Este equipo aún no está vinculado a un espacio en la nube."})
                return True
            try:
                token = self._sync_token(actor, config["workspace_id"])
            except RuntimeError as exc:
                self._json(409, {"error": str(exc)})
                return True
            pushed = 0
            central_auth_error = None
            for batch_row in batches:
                batch = json.loads(batch_row["payload_json"])
                try:
                    status, response = cloud_json_request(
                        config["api_url"], "/api/v1/sync/push", batch, token, "POST"
                    )
                except (OSError, TimeoutError, urllib.error.URLError) as exc:
                    with db_session() as connection:
                        connection.execute(
                            "UPDATE sync_outbox SET last_error=? WHERE batch_id=?",
                            (f"No se pudo contactar la API central: {exc}", batch_row["batch_id"]),
                        )
                    break
                if status == 409 and isinstance(response.get("conflicts"), list):
                    with db_session() as connection:
                        connection.execute(
                            "UPDATE sync_outbox SET status='conflict', last_error=? WHERE batch_id=?",
                            ("Hay registros modificados desde otro equipo.", batch_row["batch_id"]),
                        )
                        for conflict in response["conflicts"]:
                            if not isinstance(conflict, dict):
                                continue
                            local_change = conflict.get("localChange")
                            remote_change = conflict.get("remoteChange")
                            self._sync_store_conflict(
                                connection,
                                batch_row["batch_id"],
                                local_change if isinstance(local_change, dict) else {},
                                remote_change if isinstance(remote_change, dict) else {},
                                str(conflict.get("conflictId") or "") or None,
                            )
                    break
                if status in {401, 403}:
                    central_auth_error = "reauthenticate" if status == 401 else "role_mismatch"
                    error_text = str(response.get("error", "La API central rechazó la sesión o el permiso de este usuario."))
                    with db_session() as connection:
                        connection.execute(
                            "UPDATE sync_outbox SET last_error=? WHERE batch_id=?",
                            (error_text, batch_row["batch_id"]),
                        )
                        connection.execute(
                            "UPDATE sync_configuration SET central_auth_error=? WHERE id=1",
                            (central_auth_error,),
                        )
                        connection.execute(
                            "UPDATE sync_user_links SET auth_error=? WHERE local_user_id=?",
                            (central_auth_error, actor["id"]),
                        )
                    if status == 401:
                        try:
                            sync_keyring().delete_password(
                                APP_NAME, sync_keyring_username(config["workspace_id"], actor["id"])
                            )
                        except Exception:
                            pass
                    break
                if status >= 400:
                    rejected_at = datetime.now(timezone.utc).isoformat()
                    transient = status in {408, 425, 429} or status >= 500
                    with db_session() as connection:
                        connection.execute(
                            "UPDATE sync_outbox SET last_error=?, rejected_at=? WHERE batch_id=?",
                            (
                                str(response.get("error", "La API central rechazó el lote.")),
                                None if transient else rejected_at,
                                batch_row["batch_id"],
                            ),
                        )
                    break
                with db_session() as connection:
                    connection.execute(
                        "UPDATE sync_outbox SET status='accepted', last_error=NULL, accepted_at=? WHERE batch_id=?",
                        (datetime.now(timezone.utc).isoformat(), batch_row["batch_id"]),
                    )
                    for version in response.get("versions", []):
                        if isinstance(version, dict):
                            connection.execute(
                                """INSERT INTO sync_entity_versions (entity_type, entity_id, remote_version)
                                   VALUES (?, ?, ?) ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                                   remote_version=MAX(remote_version, excluded.remote_version)""",
                                (version.get("entityType"), version.get("entityId"), int(version.get("version", 0))),
                            )
                    # The push cursor is not the pull watermark. Advancing the latter here can
                    # skip another device's earlier events that have not been pulled yet.
                    connection.execute(
                        "UPDATE sync_configuration SET central_auth_error=NULL, updated_at=? WHERE id=1",
                        (datetime.now(timezone.utc).isoformat(),),
                    )
                    connection.execute(
                        "UPDATE sync_user_links SET auth_error=NULL WHERE local_user_id=?",
                        (actor["id"],),
                    )
                pushed += 1
            with db_session() as connection:
                latest_config = connection.execute("SELECT cursor FROM sync_configuration WHERE id=1").fetchone()
                cursor = int(latest_config["cursor"])
            sync_error = None
            pulled = 0
            try:
                query = urllib.parse.urlencode({"cursor": cursor, "limit": 5000})
                pull_status, pull_response = cloud_json_request(
                    config["api_url"], f"/api/v1/sync/pull?{query}", None, token, "GET"
                )
                if pull_status >= 400:
                    sync_error = str(pull_response.get("error", "No se pudieron descargar los cambios centrales."))
                    if pull_status in {401, 403}:
                        auth_error = "reauthenticate" if pull_status == 401 else "role_mismatch"
                        with db_session() as connection:
                            connection.execute(
                                "UPDATE sync_configuration SET central_auth_error=? WHERE id=1",
                                (auth_error,),
                            )
                            connection.execute(
                                "UPDATE sync_user_links SET auth_error=? WHERE local_user_id=?",
                                (auth_error, actor["id"]),
                            )
                        if pull_status == 401:
                            try:
                                sync_keyring().delete_password(
                                    APP_NAME, sync_keyring_username(config["workspace_id"], actor["id"])
                                )
                            except Exception:
                                pass
                elif not isinstance(pull_response.get("changes"), list):
                    sync_error = "La API central devolvió una respuesta de sincronización no válida."
                else:
                    with db_session() as connection:
                        connection.execute("BEGIN IMMEDIATE")
                        pulled = self._sync_apply_cloud_changes(connection, actor, pull_response["changes"])
                        next_cursor = max(cursor, int(pull_response.get("nextCursor", cursor)))
                        connection.execute(
                            "UPDATE sync_configuration SET cursor=?, central_auth_error=NULL, updated_at=? WHERE id=1",
                            (next_cursor, datetime.now(timezone.utc).isoformat()),
                        )
                        connection.execute(
                            "UPDATE sync_user_links SET auth_error=NULL WHERE local_user_id=?",
                            (actor["id"],),
                        )
            except (OSError, TimeoutError, urllib.error.URLError, ValueError) as exc:
                sync_error = str(exc)
            validation = None
            if not sync_error:
                try:
                    summary_status, summary = cloud_json_request(
                        config["api_url"], "/api/v1/sync/summary", None, token, "GET"
                    )
                    if summary_status >= 400 or not isinstance(summary.get("recordCounts"), dict):
                        sync_error = str(summary.get("error", "No se pudo verificar el conteo central."))
                    else:
                        with db_session() as connection:
                            state_row_value = connection.execute(
                                "SELECT payload_json FROM typescript_model_state WHERE id=1"
                            ).fetchone()
                            local_state = json.loads(state_row_value["payload_json"]) if state_row_value else None
                            local_counts = sync_record_counts(local_state)
                            central_source = summary["recordCounts"]
                            central_counts = {
                                section: int(central_source.get(section, 0))
                                for section in (*SYNCED_SECTIONS, *SINGLETONS)
                            }
                            sync_now_status = synchronization_status(connection)
                            validation = {
                                "checkedAt": summary.get("checkedAt"),
                                "matches": local_counts == central_counts and not sync_now_status["pendingBatches"] and not sync_now_status["conflicts"],
                                "localCounts": local_counts,
                                "centralCounts": central_counts,
                            }
                            connection.execute(
                                "UPDATE sync_configuration SET last_validation_json=? WHERE id=1",
                                (json.dumps(validation, ensure_ascii=False, separators=(",", ":")),),
                            )
                except (OSError, TimeoutError, urllib.error.URLError, TypeError, ValueError) as exc:
                    sync_error = str(exc)
            with db_session() as connection:
                result = synchronization_status(connection)
            try:
                current_token = sync_keyring().get_password(
                    APP_NAME, sync_keyring_username(config["workspace_id"], actor["id"])
                )
                connected_for_user = bool(current_token)
                secure_store_available = True
            except RuntimeError:
                connected_for_user = False
                secure_store_available = False
            result["connectedForCurrentUser"] = connected_for_user
            result["secureStoreAvailable"] = secure_store_available
            if sync_error:
                result["message"] = f"Los datos locales están guardados; la sincronización queda pendiente: {sync_error}"
            elif result["pendingBatches"] or result["conflicts"]:
                result["message"] = "Los cambios aún son provisionales hasta que se acepten o se resuelvan los conflictos centrales."
            self._json(200, {**result, "pushedBatches": pushed, "pulledRecords": pulled, "lastValidation": validation or result.get("lastValidation")})
            return True

        resolve_match = re.fullmatch(
            r"/api/v1/sync/conflicts/([A-Za-z0-9:_-]+)/resolve", path
        )
        if resolve_match:
            if actor["role"] != "admin":
                self._json(403, {"error": "Solo un administrador puede resolver cambios simultáneos."})
                return True
            resolution = payload.get("resolution")
            if resolution not in {"local", "remote"}:
                self._json(400, {"error": "Selecciona conservar la versión local o la central."})
                return True
            with db_session() as connection:
                config = connection.execute("SELECT * FROM sync_configuration WHERE id=1").fetchone()
                local_conflict = connection.execute(
                    "SELECT * FROM sync_conflicts WHERE conflict_id=? AND resolved_at IS NULL",
                    (resolve_match.group(1),),
                ).fetchone()
            if not config or not local_conflict:
                self._json(404, {"error": "No encontramos el conflicto pendiente."})
                return True
            try:
                token = self._sync_token(actor, config["workspace_id"])
                status, response = cloud_json_request(
                    config["api_url"],
                    f"/api/v1/sync/conflicts/{urllib.parse.quote(resolve_match.group(1), safe='')}/resolve",
                    {"resolution": resolution},
                    token,
                    "POST",
                )
            except (RuntimeError, OSError, TimeoutError, urllib.error.URLError) as exc:
                self._json(502, {"error": str(exc)})
                return True
            if status >= 400:
                self._json(status, response)
                return True
            now = datetime.now(timezone.utc).isoformat()
            with db_session() as connection:
                connection.execute("BEGIN IMMEDIATE")
                connection.execute(
                    "UPDATE sync_conflicts SET resolved_at=?, resolution=? WHERE conflict_id=?",
                    (now, resolution, resolve_match.group(1)),
                )
                awaiting = bool(response.get("awaitingResolution"))
                changes = response.get("changes", [])
                if not awaiting and isinstance(changes, list):
                    row = connection.execute(
                        "SELECT revision, payload_json FROM typescript_model_state WHERE id=1"
                    ).fetchone()
                    if row:
                        before_state = json.loads(row["payload_json"])
                        next_state = json.loads(json.dumps(before_state))
                        dirty: set[tuple[str, str]] = set()
                        for pending in connection.execute(
                            "SELECT payload_json FROM sync_outbox WHERE status='pending'"
                        ).fetchall():
                            pending_batch = json.loads(pending["payload_json"])
                            dirty.update(
                                (str(change.get("entityType")), str(change.get("entityId")))
                                for change in pending_batch.get("changes", [])
                            )
                        for change in changes:
                            key = (str(change.get("entityType")), str(change.get("entityId")))
                            if key in dirty:
                                continue
                            entity_type, entity_id = key
                            action = str(change.get("action", "upsert"))
                            if entity_type in SYNCED_SECTIONS:
                                rows = next_state.setdefault(entity_type, [])
                                rows[:] = [item for item in rows if not isinstance(item, dict) or str(item.get("id")) != entity_id]
                                if action != "delete" and isinstance(change.get("payload"), dict):
                                    rows.append(change["payload"])
                            elif entity_type in SINGLETONS and entity_id == "settings":
                                next_state[entity_type] = change.get("payload") if action != "delete" else None
                        validation_error = ledger_change_error(before_state, next_state)
                        if validation_error:
                            connection.rollback()
                            self._json(409, {"error": f"La versión resuelta no conserva los libros locales: {validation_error}"})
                            return True
                        if next_state != before_state:
                            connection.execute(
                                "UPDATE typescript_model_state SET revision=?, payload_json=?, updated_at=? WHERE id=1",
                                (int(row["revision"]) + 1, json.dumps(next_state, ensure_ascii=False, separators=(",", ":")), now),
                            )
                    for change in changes:
                        connection.execute(
                            """INSERT INTO sync_entity_versions (entity_type, entity_id, remote_version)
                               VALUES (?, ?, ?) ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                               remote_version=MAX(remote_version, excluded.remote_version)""",
                            (str(change.get("entityType")), str(change.get("entityId")), int(change.get("version", 0))),
                        )
                    connection.execute(
                        "UPDATE sync_outbox SET status='accepted', last_error=NULL, accepted_at=? WHERE batch_id=?",
                        (now, local_conflict["batch_id"]),
                    )
                    base_versions = {
                        (str(change.get("entityType")), str(change.get("entityId"))): int(change.get("version", 0))
                        for change in changes
                    }
                    pending_rows = connection.execute(
                        "SELECT batch_id, payload_json FROM sync_outbox WHERE status='pending' ORDER BY created_at, batch_id"
                    ).fetchall()
                    for pending_row in pending_rows:
                        pending_batch = json.loads(pending_row["payload_json"])
                        modified = False
                        for pending_change in pending_batch.get("changes", []):
                            key = (str(pending_change.get("entityType")), str(pending_change.get("entityId")))
                            if key in base_versions:
                                pending_change["baseVersion"] = base_versions[key]
                                base_versions[key] += 1
                                modified = True
                        if modified:
                            connection.execute(
                                "UPDATE sync_outbox SET payload_json=? WHERE batch_id=?",
                                (json.dumps(pending_batch, ensure_ascii=False, separators=(",", ":")), pending_row["batch_id"]),
                            )
                # Resolve responses contain only the selected batch, not every feed
                # event before its cursor. Keep the pull watermark unchanged so no
                # concurrent device's changes are skipped on the next sync.
                connection.execute(
                    "UPDATE sync_configuration SET updated_at=? WHERE id=1",
                    (now,),
                )
                write_audit(connection, actor, "resolved", "sync_conflict", resolve_match.group(1), {"resolution": resolution})
            self._json(200, {"resolved": True, "awaitingResolution": awaiting, "resolution": resolution})
            return True

        if path == "/api/v1/sync/retry-rejected":
            if actor["role"] not in {"admin", "operator"}:
                self._json(403, {"error": "El rol de consulta no puede reconstruir lotes rechazados."})
                return True
            try:
                with db_session() as connection:
                    connection.execute("BEGIN IMMEDIATE")
                    batch = rebuild_rejected_batch(connection)
            except ValueError as exc:
                self._json(400, {"error": str(exc)})
                return True
            if batch is None:
                self._json(404, {"error": "No hay lotes rechazados para reconstruir."})
                return True
            with db_session() as connection:
                status = synchronization_status(connection)
            self._json(200, {
                **status,
                "rebuiltBatchId": batch["batchId"],
                "rebuiltChanges": len(batch["changes"]),
            })
            return True

        self._json(404, {"error": "No encontramos esta operación de sincronización."})
        return True

    def do_POST(self) -> None:
        path = urllib.parse.urlsplit(self.path).path
        if self._handle_auth("POST", path):
            return
        if path.startswith("/api/v1/sync/"):
            return self._handle_sync_post(path)
        if path.startswith("/api/v1/e-invoicing/"):
            if not self._is_typescript_model_request():
                return self._json(403, {"error": "Esta API solo acepta solicitudes locales de Pyme360."})
            actor = self._session_user()
            if not actor:
                return self._json(401, {"error": "Inicia sesión para usar la facturación electrónica."})
            if actor["role"] not in {"admin", "operator"}:
                return self._json(403, {"error": "El rol de consulta no puede importar ni emitir documentos."})
            if path == "/api/v1/e-invoicing/supplier-invoices/preview":
                try:
                    xml_content = self._read_supplier_invoice_xml()
                    file_name = urllib.parse.unquote(self.headers.get("X-File-Name", "factura.xml"))
                    return self._json(200, parse_supplier_invoice_xml(xml_content, file_name))
                except OverflowError as exc:
                    return self._json(413, {"error": str(exc)})
                except (ValueError, InvoiceXmlError) as exc:
                    return self._json(400, {"error": str(exc)})
            match = re.fullmatch(r"/api/v1/e-invoicing/documents/([A-Za-z0-9_-]+)/submit", path)
            if match:
                row = typescript_model_state_row()
                state = row.get("state") if isinstance(row, dict) else None
                document_id = match.group(1)
                document = next(
                    (item for item in state.get("electronicDocuments", []) if isinstance(item, dict) and item.get("id") == document_id),
                    None,
                ) if isinstance(state, dict) else None
                if not document:
                    return self._json(404, {"error": "No encontramos el borrador de factura electrónica."})
                if document.get("status") not in {"draft", "rejected"}:
                    return self._json(409, {"error": "Este documento no está en un estado que permita intentar el envío."})
                issues = document.get("validationIssues", [])
                if issues:
                    return self._json(400, {"error": "Corrige los datos tributarios pendientes antes de transmitir.", "validationIssues": issues})
                tax_config = state.get("taxConfiguration", {})
                if not isinstance(tax_config, dict):
                    tax_config = {}
                try:
                    provider = get_provider(str(tax_config.get("providerId", "")))
                except ProviderNotConfiguredError as exc:
                    return self._json(503, {"error": str(exc), "transmitted": False})
                document_environment = str(document.get("environment") or provider.environment)
                if document_environment != provider.environment:
                    return self._json(409, {
                        "error": (
                            f"El borrador está marcado para {document_environment}, pero el conector "
                            f"está en {provider.environment}. Ajusta el ambiente antes de transmitir."
                        ),
                        "transmitted": False,
                    })
                try:
                    submission = build_submission_document(document, tax_config)
                except ValueError as exc:
                    return self._json(400, {"error": str(exc), "transmitted": False})
                # A retry of the same immutable draft must reuse the same key: if the
                # provider received the invoice but the response was lost, a key tied
                # to the attempt number would let it create a second document.
                fingerprint = hashlib.sha256(
                    json.dumps(
                        submission, ensure_ascii=False, sort_keys=True, separators=(",", ":")
                    ).encode("utf-8")
                ).hexdigest()[:24]
                idempotency_key = f"pyme360:{document_id}:{fingerprint}"
                try:
                    result = provider.submit_document(submission, idempotency_key)
                except ProviderRequestError as exc:
                    revision = None
                    try:
                        revision, _ = persist_connector_result(
                            document_id,
                            ProviderResult(status="transmitted", message=str(exc)),
                            actor,
                            "transmission_failed",
                            attempt_result="error",
                        )
                    except (LookupError, ValueError, sqlite3.Error):
                        revision = None
                    return self._json(502, {
                        "error": str(exc),
                        "transmitted": False,
                        **({"revision": revision} if revision is not None else {}),
                    })
                try:
                    revision, updated_document = persist_connector_result(
                        document_id, result, actor, "transmitted"
                    )
                except (LookupError, ValueError) as exc:
                    return self._json(409, {"error": str(exc), "transmitted": False})
                return self._json(200, {
                    "transmitted": True,
                    "documentId": document_id,
                    "status": updated_document.get("status"),
                    "documentNumber": updated_document.get("documentNumber"),
                    "providerReference": updated_document.get("providerReference"),
                    "cufe": updated_document.get("cufe"),
                    "message": result.message or "El proveedor tecnológico recibió el documento.",
                    "revision": revision,
                })
            return self._json(404, {"error": "No encontramos esta operación de facturación."})
        if path == "/api/v1/environment/benchmarks/refresh":
            if not self._is_typescript_model_request():
                return self._json(403, {"error": "Esta API solo acepta solicitudes locales de Pyme360."})
            actor = self._session_user()
            if not actor:
                return self._json(401, {"error": "Inicia sesión para actualizar las referencias."})
            if actor["role"] not in {"admin", "operator"}:
                return self._json(403, {"error": "Tu rol solo puede consultar las referencias guardadas."})
            try:
                return self._json(200, current_benchmark_payload(force_refresh=True))
            except (OSError, sqlite3.Error, ValueError) as exc:
                return self._json(502, {"error": f"No se pudieron actualizar las referencias ambientales: {exc}"})
        self._json(405, {"error": "Esta operación no está disponible."})

    def do_PATCH(self) -> None:
        path = urllib.parse.urlsplit(self.path).path
        if self._handle_auth("PATCH", path):
            return
        self._json(405, {"error": "Esta operación no está disponible."})

    def do_DELETE(self) -> None:
        path = urllib.parse.urlsplit(self.path).path
        if self._handle_auth("DELETE", path):
            return
        self._json(405, {"error": "Esta operación no está disponible."})

    def translate_path(self, path: str) -> str:
        # SimpleHTTPRequestHandler permite estáticos, pero nunca salir de la carpeta web.
        parsed = urllib.parse.urlsplit(path)
        parts = [part for part in urllib.parse.unquote(parsed.path).split("/") if part and part not in (".", "..")]
        if any(part.startswith(".") for part in parts) or (parts and Path(parts[-1]).suffix.lower() in {".py", ".ps1", ".bat", ".sh", ".command"}):
            return str(WEB_ROOT / "__not_found__")
        if parts and parts[0] == "typescript-model":
            root = TYPESCRIPT_MODEL_ROOT.resolve()
            parts = parts[1:]
        else:
            root = WEB_ROOT.resolve()
        candidate = root.joinpath(*parts).resolve()
        try:
            candidate.relative_to(root)
        except ValueError:
            return str(root / "__not_found__")
        return str(candidate)


class LoopbackHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    # On Windows, SO_REUSEADDR can let multiple app instances bind the same
    # port and split requests between different server versions.
    allow_reuse_address = os.name != "nt"
    address_family = socket.AF_INET


def main() -> int:
    parser = argparse.ArgumentParser(description="Servidor local de Pyme360")
    parser.add_argument("--no-browser", action="store_true", help="No abrir el navegador al iniciar")
    parser.add_argument("--app", choices=("legacy", "typescript-model"), default="typescript-model", help="Interfaz que se abre")
    arguments = parser.parse_args()
    load_env_file(Path(__file__).with_name(".env"))
    if sys.version_info < MIN_PYTHON:
        print("Pyme360 necesita Python 3.11 o superior para guardar los datos en SQLite.")
        print("Instálalo desde https://www.python.org/downloads/ y vuelve a abrir el lanzador.")
        return 1
    try:
        initialize_database()
    except (OSError, sqlite3.Error) as exc:
        print(f"No se pudo preparar la base local de Pyme360: {exc}")
        print(f"Revisa que tengas espacio y permisos en {DATA_DIR}.")
        return 1
    try:
        create_daily_backup()
    except (OSError, sqlite3.Error) as exc:
        print(f"Aviso: no se pudo actualizar la copia diaria al iniciar: {exc}")
    server = None
    for port in PORTS:
        try:
            server = LoopbackHTTPServer(("127.0.0.1", port), Pyme360Handler)
            break
        except OSError:
            continue
    if server is None:
        print("No hay un puerto disponible entre 8765 y 8790. Cierra otra ventana de Pyme360 e inténtalo de nuevo.")
        return 1
    app_path = "/typescript-model/" if arguments.app == "typescript-model" else "/index.html"
    url = f"http://127.0.0.1:{server.server_port}{app_path}"
    print(f"Pyme360 está disponible en {url}")
    print(f"Base de datos local: {DB_PATH}")
    print(f"Copias de seguridad: {BACKUP_DIR} (siete días rotativos)")
    print("Solo se aceptan conexiones desde este computador. Cierra esta ventana para detenerlo.")
    if not arguments.no_browser:
        try:
            webbrowser.open(url)
        except Exception:
            print(f"Abre esta dirección en tu navegador: {url}")
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        print("\nPyme360 se cerró. Los datos permanecen guardados en SQLite.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
