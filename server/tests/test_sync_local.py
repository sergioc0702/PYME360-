from __future__ import annotations

import json
import sqlite3
import sys
import unittest
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_DIR))

from sync_local import (
    enqueue_state_change,
    enqueue_snapshot,
    initialize_sync_tables,
    rebuild_rejected_batch,
    synchronization_status,
)


class LocalSyncOutboxTests(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = sqlite3.connect(":memory:")
        self.connection.row_factory = sqlite3.Row
        initialize_sync_tables(self.connection)

    def tearDown(self) -> None:
        self.connection.close()

    @staticmethod
    def state(stock: float, sale: bool = False) -> dict:
        result = {
            "schemaVersion": 6,
            "company": None,
            "contacts": [],
            "products": [{"id": "product-1", "name": "Producto", "stock": stock}],
            "sales": [],
            "inventoryMovements": [],
            "cashMovements": [],
            "environmentalConfig": {"providerId": "local"},
            "taxConfiguration": {"currency": "COP"},
        }
        if sale:
            result["sales"] = [{"id": "sale-1", "number": "V-1", "total": 30}]
        return result

    def test_atomic_changes_are_enqueued_in_one_idempotent_batch(self) -> None:
        previous = {"schemaVersion": 6, "products": [], "sales": []}
        updated = {
            "schemaVersion": 6,
            "products": [{"id": "p1", "stock": 4}],
            "sales": [{"id": "s1", "total": 20}],
        }
        batch = enqueue_state_change(self.connection, previous, updated, "local-user", "device")
        self.assertIsNotNone(batch)
        self.assertEqual({("products", "p1"), ("sales", "s1")}, {
            (item["entityType"], item["entityId"]) for item in batch["changes"]
        })
        row = self.connection.execute("SELECT status, payload_json FROM sync_outbox").fetchone()
        self.assertEqual("pending", row["status"])
        self.assertEqual(batch["batchId"], json.loads(row["payload_json"])["batchId"])

    def test_second_offline_edit_is_based_on_the_first_pending_version(self) -> None:
        first = enqueue_state_change(
            self.connection,
            self.state(0),
            self.state(3),
            "user",
            "device",
        )
        second = enqueue_state_change(
            self.connection,
            self.state(3),
            self.state(5),
            "user",
            "device",
        )
        self.assertEqual(0, first["changes"][0]["baseVersion"])
        self.assertEqual(1, second["changes"][0]["baseVersion"])

    def test_accepted_remote_version_is_used_as_the_next_base(self) -> None:
        first = enqueue_state_change(self.connection, self.state(0), self.state(1), "user", "device")
        self.connection.execute(
            "UPDATE sync_outbox SET status='accepted' WHERE batch_id=?", (first["batchId"],)
        )
        self.connection.execute(
            "INSERT INTO sync_entity_versions (entity_type, entity_id, remote_version) VALUES ('products','product-1',7)"
        )
        next_batch = enqueue_state_change(
            self.connection,
            self.state(1),
            self.state(2),
            "user",
            "device",
        )
        self.assertEqual(7, next_batch["changes"][0]["baseVersion"])

    def test_initial_snapshot_seeds_settings_and_records(self) -> None:
        state = self.state(12, sale=True)
        state["taxConfiguration"] = {"currency": "COP"}
        state["environmentalConfig"] = {"providerId": "local"}
        batch = enqueue_snapshot(self.connection, state, "admin", "device")
        types = {(item["entityType"], item["entityId"]) for item in batch["changes"]}
        self.assertIn(("products", "product-1"), types)
        self.assertIn(("sales", "sale-1"), types)
        self.assertIn(("taxConfiguration", "settings"), types)
        self.assertIn(("environmentalConfig", "settings"), types)

    def test_no_change_does_not_create_an_empty_outbox_batch(self) -> None:
        self.assertIsNone(
            enqueue_state_change(
                self.connection,
                self.state(4),
                self.state(4),
                "user",
                "device",
            )
        )
        count = self.connection.execute("SELECT COUNT(*) FROM sync_outbox").fetchone()[0]
        self.assertEqual(0, count)

    def test_rejected_batch_is_visible_and_does_not_inflate_pending_count(self) -> None:
        batch = enqueue_state_change(self.connection, {"products": []}, self.state(2), "user", "device")
        self.connection.execute(
            "UPDATE sync_outbox SET rejected_at=?, last_error=? WHERE batch_id=?",
            ("2026-10-30T12:00:00+00:00", "Existencia inválida", batch["batchId"]),
        )
        status = synchronization_status(self.connection)
        self.assertEqual(0, status["pendingBatches"])
        self.assertEqual(1, status["rejectedBatches"])
        self.assertEqual("Existencia inválida", status["rejectedRecords"][0]["error"])

    def test_retry_rebuilds_failed_and_later_changes_preserving_the_oldest_base(self) -> None:
        first = enqueue_state_change(
            self.connection,
            {"products": []},
            {"products": [{"id": "p1", "stock": 1}]},
            "user",
            "device",
        )
        self.connection.execute(
            "UPDATE sync_outbox SET rejected_at=?, last_error=? WHERE batch_id=?",
            ("2026-10-30T12:00:00+00:00", "Revisar valor", first["batchId"]),
        )
        self.connection.execute(
            "INSERT INTO sync_entity_versions (entity_type, entity_id, remote_version) VALUES ('products','p1',7),('resourceReadings','r1',3)"
        )
        later = enqueue_state_change(
            self.connection,
            {"products": [{"id": "p1", "stock": 1}]},
            {"products": [{"id": "p1", "stock": 2}], "resourceReadings": [{"id": "r1", "quantity": 4}]},
            "user",
            "device",
        )
        rebuilt = rebuild_rejected_batch(self.connection)
        self.assertEqual(first["batchId"], rebuilt["batchId"])
        payload_by_key = {
            (change["entityType"], change["entityId"]): change
            for change in rebuilt["changes"]
        }
        self.assertEqual(2, payload_by_key[("products", "p1")]["payload"]["stock"])
        self.assertEqual(0, payload_by_key[("products", "p1")]["baseVersion"])
        self.assertEqual(3, payload_by_key[("resourceReadings", "r1")]["baseVersion"])
        self.assertEqual(1, self.connection.execute("SELECT COUNT(*) FROM sync_outbox WHERE status='pending'").fetchone()[0])
        row = self.connection.execute("SELECT rejected_at, last_error FROM sync_outbox WHERE batch_id=?", (first["batchId"],)).fetchone()
        self.assertIsNone(row["rejected_at"])
        self.assertIsNone(row["last_error"])
        self.assertNotEqual(first["batchId"], later["batchId"])

    def test_migrates_legacy_sync_identity_to_the_local_user_link(self) -> None:
        connection = sqlite3.connect(":memory:")
        connection.row_factory = sqlite3.Row
        connection.execute(
            "CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL, role TEXT NOT NULL)"
        )
        connection.execute(
            "INSERT INTO users (id, username, role) VALUES ('local-1', 'ana@example.test', 'admin')"
        )
        connection.execute(
            """CREATE TABLE sync_configuration (
                id INTEGER PRIMARY KEY,
                api_url TEXT NOT NULL,
                workspace_id TEXT NOT NULL,
                device_id TEXT NOT NULL,
                cursor INTEGER NOT NULL DEFAULT 0,
                connected_by_user_id TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"""
        )
        connection.execute(
            """INSERT INTO sync_configuration
               (id, api_url, workspace_id, device_id, cursor, connected_by_user_id, updated_at)
               VALUES (1, 'https://cloud.example.test', 'workspace-1', 'device-1', 8, 'local-1', '2026-01-01T00:00:00+00:00')"""
        )
        # The former singleton central identity is added by the normal schema migration.
        connection.execute("ALTER TABLE sync_configuration ADD COLUMN remote_user_id TEXT")
        connection.execute("UPDATE sync_configuration SET remote_user_id='remote-1' WHERE id=1")
        connection.execute(
            """CREATE TABLE sync_user_links (
                local_user_id TEXT PRIMARY KEY,
                remote_user_id TEXT NOT NULL UNIQUE,
                workspace_id TEXT NOT NULL,
                email TEXT NOT NULL,
                role TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"""
        )

        initialize_sync_tables(connection)

        link = connection.execute(
            "SELECT * FROM sync_user_links WHERE local_user_id='local-1'"
        ).fetchone()
        self.assertEqual("remote-1", link["remote_user_id"])
        self.assertEqual("workspace-1", link["workspace_id"])
        self.assertEqual("ana@example.test", link["email"])
        self.assertEqual("admin", link["role"])
        self.assertIsNone(link["auth_error"])
        connection.close()


if __name__ == "__main__":
    unittest.main()
