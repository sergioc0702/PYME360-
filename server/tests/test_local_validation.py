from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SERVER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_DIR))
SPEC = importlib.util.spec_from_file_location("serve_local_validation", SERVER_DIR / "serve-local.py")
server_module = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = server_module
SPEC.loader.exec_module(server_module)


class BusinessValueTests(unittest.TestCase):
    def test_new_or_edited_rows_cannot_hold_negative_amounts(self):
        previous = {"products": [{"id": "p1", "unitPrice": 100}]}
        for row in (
            {"id": "p1", "unitPrice": -1},
            {"id": "p2", "stock": -5},
            {"id": "p3", "unitCost": "gratis"},
            {"id": "p4", "unitPrice": float("inf")},
        ):
            updated = {"products": [row]}
            self.assertIsNotNone(server_module.business_value_error(previous, updated))

    def test_document_lines_are_checked(self):
        sale = {"id": "s1", "total": 10, "lines": [{"quantity": -1, "unitPrice": 10}]}
        self.assertIn("sales", server_module.business_value_error({"sales": []}, {"sales": [sale]}))

    def test_an_old_invalid_row_does_not_block_other_changes(self):
        legacy = {"id": "p1", "unitPrice": -1}
        previous = {"products": [legacy]}
        updated = {"products": [legacy, {"id": "p2", "unitPrice": 100}]}
        self.assertIsNone(server_module.business_value_error(previous, updated))


class LoginLimitTests(unittest.TestCase):
    def setUp(self):
        server_module.login_failures.clear()

    def test_locks_after_repeated_failures_and_ignores_username_case(self):
        for _ in range(server_module.LOGIN_MAX_FAILURES - 1):
            server_module.record_login_failure("Admin")
        self.assertEqual(server_module.login_lock_remaining("admin"), 0)
        server_module.record_login_failure("admin")
        self.assertGreater(server_module.login_lock_remaining("ADMIN"), 0)
        self.assertEqual(server_module.login_lock_remaining("otro"), 0)

    def test_lock_expires_and_failures_restart(self):
        for _ in range(server_module.LOGIN_MAX_FAILURES):
            server_module.record_login_failure("admin")
        later = server_module.time.monotonic() + server_module.LOGIN_LOCK_SECONDS + 1
        with patch.object(server_module.time, "monotonic", return_value=later):
            self.assertEqual(server_module.login_lock_remaining("admin"), 0)
            server_module.record_login_failure("admin")
            self.assertEqual(server_module.login_lock_remaining("admin"), 0)

    def test_successful_login_clears_failures(self):
        server_module.record_login_failure("admin")
        server_module.clear_login_failures("admin")
        self.assertNotIn("admin", server_module.login_failures)


if __name__ == "__main__":
    unittest.main()
