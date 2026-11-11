from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import threading
import unittest
from copy import deepcopy
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
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


def sale_state(**overrides):
    sale = {
        "id": "s1", "number": "FV-1", "date": "2026-11-01", "customerId": "c1", "customerName": "Ana",
        "subtotal": 100, "discount": 0, "vatAmount": 0, "total": 100, "payments": [],
        "lines": [{"productId": "p1", "quantity": 1, "unitPrice": 100, "total": 100}],
        **overrides,
    }
    return {"schemaVersion": server_module.TYPESCRIPT_MODEL_SCHEMA_VERSION, "sales": [sale], "cashMovements": []}


def with_payment(state, amount, movement=True):
    updated = {**state, "sales": [dict(state["sales"][0])], "cashMovements": list(state["cashMovements"])}
    payment = {"id": f"pay-{len(updated['sales'][0]['payments'])}", "amount": amount}
    if movement:
        payment["cashMovementId"] = f"cash-{payment['id']}"
        updated["cashMovements"].append({"id": payment["cashMovementId"], "direction": "in", "amount": amount})
    updated["sales"][0]["payments"] = [*updated["sales"][0]["payments"], payment]
    return updated


class PaymentIntegrityTests(unittest.TestCase):
    def check(self, previous, updated, role="operator"):
        return server_module.payment_integrity_error(previous, updated, role)

    def test_a_normal_payment_with_its_cash_movement_is_accepted(self):
        previous = sale_state()
        self.assertIsNone(self.check(previous, with_payment(previous, 40)))

    def test_a_sale_total_cannot_be_rewritten(self):
        previous = sale_state()
        for role in ("operator", "admin"):
            self.assertIn("no se puede modificar", self.check(previous, sale_state(total=1), role))

    def test_follow_up_fields_can_still_change(self):
        previous = sale_state(invoiceFollowUpStatus="to_review")
        self.assertIsNone(self.check(previous, sale_state(invoiceFollowUpStatus="not_applicable")))

    def test_operator_payment_needs_a_cash_movement(self):
        previous = sale_state()
        self.assertIn("entrada o salida", self.check(previous, with_payment(previous, 40, movement=False)))

    def test_admin_can_import_history_without_cash_but_not_above_the_total(self):
        previous = sale_state()
        self.assertIsNone(self.check(previous, with_payment(previous, 40, movement=False), "admin"))
        self.assertIn("superan", self.check(previous, with_payment(previous, 400, movement=False), "admin"))

    def test_a_payment_cannot_exceed_the_balance(self):
        previous = sale_state()
        self.assertIn("superan", self.check(previous, with_payment(previous, 101)))

    def test_an_accepted_debit_note_raises_the_limit(self):
        previous = sale_state()
        updated = with_payment(previous, 120)
        updated["electronicDocuments"] = [
            {"id": "n1", "saleId": "s1", "kind": "debit_note", "status": "accepted", "adjustmentAmount": 20}
        ]
        self.assertIsNone(self.check(previous, updated))

    def test_a_movement_with_another_amount_does_not_count(self):
        previous = sale_state()
        updated = with_payment(previous, 40)
        updated["cashMovements"][0]["amount"] = 1
        self.assertIn("no coincide", self.check(previous, updated))

    def test_one_movement_cannot_back_two_payments(self):
        first = with_payment(sale_state(), 40)
        second = with_payment(first, 40)
        second["sales"][0]["payments"][1]["cashMovementId"] = "cash-pay-0"
        self.assertIn("no coincide", self.check(first, second))

    def test_recorded_payments_cannot_be_removed(self):
        previous = with_payment(sale_state(), 40)
        self.assertIn("no se cambian", self.check(previous, sale_state()))

    def test_a_new_sale_must_add_up(self):
        previous = {**sale_state(), "sales": []}
        self.assertIn("no coincide", self.check(previous, sale_state(total=1)))

    def test_purchase_payments_follow_the_same_rules(self):
        purchase = {"id": "c1", "number": "C-1", "status": "received", "total": 50, "payments": [],
                    "payableReviewStatus": "confirmed"}
        base = {"schemaVersion": server_module.TYPESCRIPT_MODEL_SCHEMA_VERSION, "purchases": [purchase], "cashMovements": []}
        paid = {**purchase, "payments": [{"id": "x", "amount": 50, "cashMovementId": "m"}]}
        good = {**base, "purchases": [paid], "cashMovements": [{"id": "m", "direction": "out", "amount": 50}]}
        self.assertIsNone(self.check(base, good))
        wrong = {**good, "cashMovements": [{"id": "m", "direction": "in", "amount": 50}]}
        self.assertIn("no coincide", self.check(base, wrong))

    def test_older_saved_data_is_not_blocked_while_it_migrates(self):
        previous = {**sale_state(), "schemaVersion": 1}
        self.assertIsNone(self.check(previous, sale_state(total=1)))


class LocalStateSaveTests(unittest.TestCase):
    state_path = "/api/v1/typescript-model/state"

    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        data_dir = Path(temporary_directory.name)
        paths = {
            "DATA_DIR": data_dir,
            "DB_PATH": data_dir / "test.sqlite3",
            "BACKUP_DIR": data_dir / "backups",
            "OFFSITE_CONFIG": data_dir / "offsite-backup.json",
            "OFFSITE_STATUS": data_dir / "offsite-backup-status.json",
            "BENCHMARK_DIR": data_dir / "benchmarks",
            "BENCHMARK_SNAPSHOT_PATH": data_dir / "benchmarks" / "official_snapshots.csv",
        }
        for name, value in paths.items():
            setting = patch.object(server_module, name, value)
            setting.start()
            self.addCleanup(setting.stop)
        server_module.initialize_database()

        httpd = ThreadingHTTPServer(("127.0.0.1", 0), server_module.Pyme360Handler)
        self.port = httpd.server_port
        thread = threading.Thread(target=httpd.serve_forever, kwargs={"poll_interval": 0.01})
        thread.start()
        self.addCleanup(httpd.server_close)
        self.addCleanup(thread.join)
        self.addCleanup(httpd.shutdown)

        password = "test-password"
        status, body, cookie = self.request(
            "POST", "/api/v1/auth/bootstrap", {"username": "admin", "password": password}
        )
        self.assertEqual(status, 200, body)
        self.admin_cookie = cookie.split(";", 1)[0]
        self.cookies = {}
        for role in ("operator", "viewer"):
            credentials = {"username": role, "password": password}
            status, body, _ = self.request(
                "POST", "/api/v1/auth/users", {**credentials, "role": role}, self.admin_cookie
            )
            self.assertEqual(status, 201, body)
            status, body, cookie = self.request("POST", "/api/v1/auth/login", credentials)
            self.assertEqual(status, 200, body)
            self.cookies[role] = cookie.split(";", 1)[0]

        self.initial = server_module.empty_sync_state()
        self.initial["products"] = [{"id": "p1", "stock": 10}]
        self.initial["inventoryMovements"] = [
            {"id": "opening", "productId": "p1", "quantity": 10, "balanceAfter": 10}
        ]
        self.initial["contacts"] = [{"id": "c1", "name": "Cliente de prueba"}]
        self.initial["financialAccounts"] = [{"id": "register", "openingBalance": 0, "active": True}]
        status, body = self.put(self.initial, revision=0, cookie=self.admin_cookie)
        self.assertEqual(status, 200, body)
        self.revision = body["revision"]
        with server_module.db_session() as connection:
            connection.execute(
                """INSERT INTO sync_configuration
                   (id, api_url, workspace_id, device_id, connected_by_user_id, updated_at)
                   SELECT 1, 'https://example.invalid', 'workspace', 'device', id, created_at
                   FROM users WHERE username = 'admin'"""
            )

    def request(self, method, path, payload, cookie=None):
        connection = HTTPConnection("127.0.0.1", self.port, timeout=5)
        headers = {"Content-Type": "application/json"}
        if cookie:
            headers["Cookie"] = cookie
        try:
            connection.request(method, path, json.dumps(payload), headers)
            response = connection.getresponse()
            return response.status, json.loads(response.read()), response.getheader("Set-Cookie")
        finally:
            connection.close()

    def put(self, state, revision, cookie=None, restore=False):
        path = self.state_path + ("?restore=1" if restore else "")
        payload = {"state": state, "expectedRevision": revision}
        status, body, _ = self.request("PUT", path, payload, cookie)
        return status, body

    def snapshot(self):
        with server_module.db_session() as connection:
            return (
                [tuple(row) for row in connection.execute("SELECT * FROM typescript_model_state")],
                [tuple(row) for row in connection.execute("SELECT * FROM audit_log ORDER BY id")],
                [tuple(row) for row in connection.execute("SELECT * FROM sync_outbox ORDER BY batch_id")],
            )

    def sale_with_payment(self, movement=True):
        sale = with_payment(sale_state(), 40, movement=movement)
        for cash_movement in sale["cashMovements"]:
            cash_movement.update(accountId="register", sourceType="sale", sourceId="s1")
        return {
            **self.initial,
            **sale,
            "products": [{"id": "p1", "stock": 9}],
            "inventoryMovements": [
                *self.initial["inventoryMovements"],
                {"id": "sold", "productId": "p1", "quantity": -1, "balanceAfter": 9,
                 "sourceType": "sale", "sourceId": "s1"},
            ],
        }

    def test_session_and_roles_are_enforced(self):
        before = self.snapshot()
        for cookie, restore, expected in (
            (None, False, 401),
            (self.cookies["viewer"], False, 403),
            (self.cookies["operator"], True, 403),
        ):
            with self.subTest(restore=restore, expected=expected):
                status, body = self.put(self.sale_with_payment(), self.revision, cookie, restore)
                self.assertEqual(status, expected, body)
                self.assertEqual(self.snapshot(), before)

    def test_offsite_status_requires_session(self):
        server_module.OFFSITE_CONFIG.write_text('{"provider":"google_drive"}', encoding="utf-8")
        server_module.record_offsite_status("google_drive", name="respaldo-cifrado.json")
        status, _, _ = self.request("GET", "/api/v1/backups/offsite-status", {}, None)
        self.assertEqual(status, 401)
        status, body, _ = self.request("GET", "/api/v1/backups/offsite-status", {}, self.admin_cookie)
        self.assertEqual(status, 200)
        self.assertTrue(body["configured"])
        self.assertEqual(body["provider"], "google_drive")
        self.assertEqual(body["lastFileName"], "respaldo-cifrado.json")

    def test_drive_failure_does_not_undo_local_save(self):
        server_module.OFFSITE_CONFIG.write_text('{"provider":"google_drive"}', encoding="utf-8")
        with patch.object(server_module, "create_offsite_backup", side_effect=RuntimeError("sin red")):
            status, body = self.put(self.sale_with_payment(), self.revision, self.admin_cookie)
        self.assertEqual(status, 200, body)
        self.assertTrue(body["savedLocally"])
        self.assertEqual(server_module.typescript_model_state_row()["revision"], self.revision + 1)
        self.assertTrue(json.loads(server_module.OFFSITE_STATUS.read_text(encoding="utf-8"))["failed"])

    def test_stale_revision_returns_current_state_without_changes(self):
        before = self.snapshot()
        status, body = self.put(self.sale_with_payment(), self.revision - 1, self.cookies["operator"])
        self.assertEqual(status, 409, body)
        self.assertEqual(body["state"], self.initial)
        self.assertEqual(body["revision"], self.revision)
        self.assertEqual(self.snapshot(), before)

    def test_payment_without_cash_movement_is_rejected_without_changes(self):
        before = self.snapshot()
        status, body = self.put(self.sale_with_payment(movement=False), self.revision, self.cookies["operator"])
        self.assertEqual(status, 400, body)
        self.assertIn("entrada o salida", body["error"])
        self.assertEqual(self.snapshot(), before)

    def test_sale_with_payment_saves_state_audit_and_sync_batch(self):
        _, before_audit, _ = self.snapshot()
        updated = self.sale_with_payment()
        status, body = self.put(updated, self.revision, self.cookies["operator"])
        self.assertEqual(status, 200, body)
        self.assertEqual(body["revision"], self.revision + 1)
        self.assertEqual(body["pendingSyncBatches"], 1)
        stored = server_module.typescript_model_state_row()
        self.assertEqual(stored["revision"], body["revision"])
        self.assertEqual(stored["state"], updated)
        sale = stored["state"]["sales"][0]
        self.assertEqual(sale["total"] - sum(payment["amount"] for payment in sale["payments"]), 60)
        with server_module.db_session() as connection:
            audit = connection.execute(
                "SELECT actor_username, entity_type, entity_id FROM audit_log ORDER BY id"
            ).fetchall()
            self.assertIn(("operator", "sales", "s1"), [tuple(row) for row in audit[len(before_audit):]])
            rows = connection.execute("SELECT status, payload_json FROM sync_outbox").fetchall()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["status"], "pending")
            changes = json.loads(rows[0]["payload_json"])["changes"]
            self.assertEqual(
                {(change["entityType"], change["entityId"]) for change in changes},
                {("sales", "s1"), ("products", "p1"), ("inventoryMovements", "sold"), ("cashMovements", "cash-pay-0")},
            )

    def test_local_return_requires_a_matching_refund_and_saves_the_ledger_once(self):
        with server_module.db_session() as connection:
            connection.execute("DELETE FROM sync_configuration")
        sale = self.sale_with_payment()
        operator = self.cookies["operator"]
        status, body = self.put(sale, self.revision, operator)
        self.assertEqual(200, status, body)
        revision = body["revision"]
        before = self.snapshot()
        returned = deepcopy(sale)
        returned["sales"][0]["returns"] = [{
            "id": "return-one", "date": "2026-11-01", "reason": "Cambio", "paymentCount": 1,
            "total": 100, "refund": 40, "cashMovementId": "refund-one",
            "lines": [{"lineIndex": 0, "quantity": 1, "amount": 100, "restock": True,
                       "inventoryMovementId": "stock-one"}],
        }]
        returned["products"][0]["stock"] = 10
        returned["inventoryMovements"].append({
            "id": "stock-one", "productId": "p1", "quantity": 1, "balanceAfter": 10,
            "movementType": "adjustment", "sourceType": "sale", "sourceId": "s1",
        })
        status, body = self.put(returned, revision, operator)
        self.assertEqual(400, status, body)
        self.assertEqual(before, self.snapshot())
        returned["cashMovements"].append({
            "id": "refund-one", "accountId": "register", "date": "2026-11-01", "direction": "out",
            "amount": 40, "category": "Devolución de venta", "sourceType": "sale", "sourceId": "s1",
        })
        status, body = self.put(returned, revision, self.cookies["viewer"])
        self.assertEqual(403, status, body)
        self.assertEqual(before, self.snapshot())
        status, body = self.put(returned, revision, operator)
        self.assertEqual(200, status, body)
        self.assertEqual(returned, server_module.typescript_model_state_row()["state"])
        after = self.snapshot()
        self.assertEqual(len(before[1]) + 4, len(after[1]))
        status, body = self.put(returned, revision, operator)
        self.assertEqual(409, status, body)
        self.assertEqual(after, self.snapshot())

    def test_sqlite_error_at_enqueue_rolls_back_and_redacts_detail(self):
        with server_module.db_session() as connection:
            connection.execute(
                """CREATE TRIGGER fail_enqueue AFTER INSERT ON sync_outbox
                   BEGIN SELECT RAISE(ABORT, 'private SQLite diagnostic'); END"""
            )
        before = self.snapshot()
        with self.assertLogs("pyme360.local", level="ERROR") as logs:
            status, body = self.put(self.sale_with_payment(), self.revision, self.cookies["operator"])
        self.assertEqual(status, 500, body)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(
            body["error"],
            "No se guardaron los cambios. Revisa si hay espacio disponible y vuelve a intentarlo.",
        )
        self.assertEqual(set(body), {"error", "incidentId"})
        self.assertTrue(body["incidentId"])
        log = "\n".join(logs.output)
        self.assertIn(body["incidentId"], log)
        self.assertIn("save_local_state", log)
        self.assertIn("IntegrityError", log)
        self.assertNotIn("private SQLite diagnostic", log)


class CloudRedirectTests(unittest.TestCase):
    def test_a_token_does_not_follow_a_redirect(self):
        received = {}

        class Target(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                received["authorization"] = self.headers.get("Authorization")
                self.send_response(200)
                self.send_header("Content-Length", "2")
                self.end_headers()
                self.wfile.write(b"{}")

        class Redirect(Target):
            def do_GET(self):
                self.send_response(302)
                self.send_header("Location", f"http://127.0.0.1:{target.server_port}/robar")
                self.send_header("Content-Length", "0")
                self.end_headers()

        target = HTTPServer(("127.0.0.1", 0), Target)
        origin = HTTPServer(("127.0.0.1", 0), Redirect)
        for server in (target, origin):
            threading.Thread(target=server.serve_forever, daemon=True).start()
            self.addCleanup(server.server_close)
            self.addCleanup(server.shutdown)
        status, _ = server_module.cloud_json_request(
            f"http://127.0.0.1:{origin.server_port}", "/api/v1/members", None, "token", "GET"
        )
        self.assertEqual(status, 302)
        self.assertEqual(received, {})


class FrontendBuildTests(unittest.TestCase):
    def frontend(self, folder):
        root = Path(folder)
        (root / "src").mkdir()
        (root / "src" / "main.tsx").write_text("x", encoding="utf-8")
        return root

    def build(self, root):
        (root / "dist").mkdir(exist_ok=True)
        (root / "dist" / "index.html").write_text("x", encoding="utf-8")
        os.utime(root / "dist" / "index.html", (2_000_000_000, 2_000_000_000))

    def test_a_new_copy_without_build_needs_one(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertTrue(server_module.frontend_is_outdated(self.frontend(folder)))

    def test_a_current_build_is_reused(self):
        with tempfile.TemporaryDirectory() as folder:
            root = self.frontend(folder)
            self.build(root)
            self.assertFalse(server_module.frontend_is_outdated(root))

    def test_a_changed_source_needs_a_new_build(self):
        with tempfile.TemporaryDirectory() as folder:
            root = self.frontend(folder)
            self.build(root)
            os.utime(root / "src" / "main.tsx", (2_000_000_100, 2_000_000_100))
            self.assertTrue(server_module.frontend_is_outdated(root))

    def test_without_node_a_new_copy_explains_what_to_install(self):
        with tempfile.TemporaryDirectory() as folder:
            root = self.frontend(folder)
            with patch.object(server_module, "FRONTEND_ROOT", root), patch.object(
                server_module, "TYPESCRIPT_MODEL_ROOT", root / "dist"
            ), patch.object(server_module.shutil, "which", return_value=None):
                with patch("builtins.print") as printed:
                    self.assertFalse(self.run_prepare(root))
                self.assertIn("Node.js", str(printed.call_args_list))

    def run_prepare(self, root):
        with patch.object(server_module, "frontend_is_outdated", return_value=True):
            return server_module.prepare_frontend()


class OffsiteScheduleTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        root = Path(folder.name)
        for name, value in {"OFFSITE_CONFIG": root / "offsite.json", "OFFSITE_STATUS": root / "status.json"}.items():
            setting = patch.object(server_module, name, value)
            setting.start()
            self.addCleanup(setting.stop)
        self.root = root

    def status(self, minutes_ago, failed=False):
        from datetime import datetime, timedelta, timezone

        moment = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
        (self.root / "status.json").write_text(
            json.dumps({"lastSuccessAt": moment.isoformat(), "failed": failed}), encoding="utf-8"
        )

    def test_nothing_runs_when_it_is_not_configured(self):
        self.assertFalse(server_module.offsite_backup_due())

    def test_a_recent_copy_waits_for_the_next_hour(self):
        (self.root / "offsite.json").write_text("{}", encoding="utf-8")
        self.status(10)
        self.assertFalse(server_module.offsite_backup_due())
        self.status(61)
        self.assertTrue(server_module.offsite_backup_due())

    def test_a_failed_copy_is_retried_without_waiting(self):
        (self.root / "offsite.json").write_text("{}", encoding="utf-8")
        self.status(5, failed=True)
        self.assertTrue(server_module.offsite_backup_due())

    def test_the_save_does_not_wait_for_the_copy(self):
        (self.root / "offsite.json").write_text("{}", encoding="utf-8")
        started = threading.Event()
        release = threading.Event()

        def slow_copy(state=None):
            started.set()
            release.wait(5)

        with patch.object(server_module, "create_offsite_backup", slow_copy):
            self.assertTrue(server_module.schedule_offsite_backup())
            self.assertTrue(started.wait(2))
            self.assertFalse(server_module.schedule_offsite_backup())
            release.set()
        for _ in range(100):
            if server_module.offsite_lock.acquire(blocking=False):
                server_module.offsite_lock.release()
                break
            server_module.time.sleep(0.02)
        else:
            self.fail("La copia en segundo plano no liberó el turno.")


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
