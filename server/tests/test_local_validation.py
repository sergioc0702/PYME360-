from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
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
