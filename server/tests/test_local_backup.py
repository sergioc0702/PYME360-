from __future__ import annotations

import json
import importlib.util
import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch


SERVER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_DIR))
SPEC = importlib.util.spec_from_file_location("serve_local", SERVER_DIR / "serve-local.py")
assert SPEC is not None and SPEC.loader is not None
serve_local = importlib.util.module_from_spec(SPEC)
sys.modules["serve_local"] = serve_local
SPEC.loader.exec_module(serve_local)


class LocalBackupTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory(dir=SERVER_DIR / "tests")
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)
        self.data_dir = self.root / "data"
        self.backup_dir = self.data_dir / "backups"
        self.database_path = self.data_dir / "pyme360.sqlite3"
        self.patches = [
            patch.object(serve_local, "DATA_DIR", self.data_dir),
            patch.object(serve_local, "BACKUP_DIR", self.backup_dir),
            patch.object(serve_local, "DB_PATH", self.database_path),
            patch.object(serve_local, "BENCHMARK_DIR", self.data_dir / "benchmarks"),
            patch.object(
                serve_local,
                "BENCHMARK_SNAPSHOT_PATH",
                self.data_dir / "benchmarks" / "official_snapshots.csv",
            ),
            patch.object(
                serve_local,
                "BENCHMARK_TEMPLATE_PATH",
                self.root / "missing-official-snapshots.template.csv",
            ),
        ]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)
        serve_local.initialize_database()

    def seed_database(self) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with serve_local.db_session() as connection:
            connection.execute(
                "INSERT INTO typescript_model_state VALUES (1, 6, 8, ?, ?)",
                (json.dumps({"products": [{"id": "product-1", "stock": 14}]}), now),
            )
            connection.execute(
                """INSERT INTO users
                   (id, username, display_name, role, active, password_salt,
                    password_hash, password_algorithm, password_iterations, created_at)
                   VALUES ('user-1', 'admin', 'Admin', 'admin', 1, 'salt', 'hash',
                           'pbkdf2_sha256', 600000, ?)""",
                (now,),
            )
            connection.execute(
                "INSERT INTO sessions VALUES ('session-hash', 'user-1', ?, ?)",
                (now, now),
            )
            connection.execute(
                """INSERT INTO audit_log
                   (actor_user_id, actor_username, action, entity_type, entity_id, occurred_at, details_json)
                   VALUES ('user-1', 'admin', 'create', 'product', 'product-1', ?, '{}')""",
                (now,),
            )

    def test_daily_backup_is_restorable_and_keeps_sqlite_tables(self) -> None:
        self.seed_database()
        serve_local.create_daily_backup(force=True)
        backups = list(self.backup_dir.glob("pyme360-*.sqlite3"))
        self.assertEqual(len(backups), 1)

        backup_path = backups[0]
        with closing(sqlite3.connect(backup_path)) as backup:
            self.assertEqual(backup.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(backup.execute("SELECT count(*) FROM users").fetchone()[0], 1)
            self.assertEqual(backup.execute("SELECT count(*) FROM sessions").fetchone()[0], 1)
            self.assertEqual(backup.execute("SELECT count(*) FROM audit_log").fetchone()[0], 1)

        restored_path = self.root / "restored.sqlite3"
        with closing(sqlite3.connect(backup_path)) as backup, closing(
            sqlite3.connect(restored_path)
        ) as restored:
            backup.backup(restored)
        with closing(sqlite3.connect(restored_path)) as restored:
            row = restored.execute(
                "SELECT revision, payload_json FROM typescript_model_state WHERE id = 1"
            ).fetchone()
            self.assertEqual(row[0], 8)
            self.assertEqual(json.loads(row[1])["products"][0]["stock"], 14)
            self.assertEqual(restored.execute("PRAGMA integrity_check").fetchone()[0], "ok")

    def test_pre_cloud_backup_is_created_only_for_existing_application_data(self) -> None:
        self.assertIsNone(serve_local.create_pre_cloud_backup())
        self.seed_database()
        backup_path = serve_local.create_pre_cloud_backup()
        self.assertIsNotNone(backup_path)
        assert backup_path is not None
        self.assertTrue(backup_path.exists())
        with closing(sqlite3.connect(backup_path)) as backup:
            state = backup.execute(
                "SELECT payload_json FROM typescript_model_state WHERE id=1"
            ).fetchone()
        self.assertEqual(json.loads(state[0])["products"][0]["id"], "product-1")


if __name__ == "__main__":
    unittest.main()
