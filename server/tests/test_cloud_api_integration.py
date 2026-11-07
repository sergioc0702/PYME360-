"""PostgreSQL-backed cloud API tests; enabled only for an explicit disposable test DB."""

from __future__ import annotations

import os
import sys
import unittest
import urllib.parse
from pathlib import Path

TEST_DATABASE_URL = os.environ.get("CLOUD_TEST_DATABASE_URL", "").strip()
SERVER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_DIR / "cloud"))

HAS_TEST_DEPENDENCIES = False
if TEST_DATABASE_URL:
    try:
        import psycopg  # noqa: F401
        from fastapi.testclient import TestClient

        os.environ["DATABASE_URL"] = TEST_DATABASE_URL
        os.environ["APP_ENV"] = "development"
        os.environ["PUBLIC_BASE_URL"] = "http://localhost"
        os.environ["SMTP_HOST"] = ""
        from app import app

        HAS_TEST_DEPENDENCIES = True
    except ImportError:
        HAS_TEST_DEPENDENCIES = False


@unittest.skipUnless(TEST_DATABASE_URL and HAS_TEST_DEPENDENCIES, "Requiere PostgreSQL y server/cloud/requirements-test.txt")
class CloudApiPostgresIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client_context = TestClient(app)
        cls.client = cls.client_context.__enter__()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client_context.__exit__(None, None, None)

    def setUp(self) -> None:
        with psycopg.connect(TEST_DATABASE_URL) as connection:
            connection.execute("TRUNCATE TABLE workspaces, auth_rate_limits RESTART IDENTITY CASCADE")

    def create_workspace(self, email: str, name: str) -> tuple[str, str]:
        response = self.client.post("/api/v1/organizations/register", json={
            "email": email,
            "password": "Pyme360-test-password",
            "displayName": name,
            "organizationName": f"Empresa {name}",
        })
        self.assertEqual(202, response.status_code, response.text)
        registration = response.json()
        verification_url = urllib.parse.urlsplit(registration["verificationUrl"])
        token = urllib.parse.parse_qs(verification_url.fragment).get("token", [None])[0]
        self.assertTrue(token)
        page = self.client.get(verification_url.path)
        self.assertEqual(200, page.status_code)
        self.assertIn("location.hash", page.text)
        verification = self.client.post("/api/v1/auth/verify-email/confirm", json={"token": token})
        self.assertEqual(200, verification.status_code, verification.text)
        self.assertTrue(verification.json()["verified"])
        return registration["workspaceId"], email

    def login(self, workspace_id: str, email: str) -> tuple[dict, dict[str, str]]:
        response = self.client.post("/api/v1/auth/login", json={
            "workspaceId": workspace_id,
            "email": email,
            "password": "Pyme360-test-password",
        })
        self.assertEqual(200, response.status_code, response.text)
        data = response.json()
        return data, {"Authorization": f"Bearer {data['accessToken']}"}

    @staticmethod
    def product_batch(batch_id: str, stock: int = 4, base_version: int = 0, movement_id: str = "opening-1") -> dict:
        product = {
            "id": "product-1", "name": "Producto", "type": "finished", "stock": stock,
            "minimumStock": 1, "unitCost": 10, "unitPrice": 100, "vatRate": 19, "recipe": [],
        }
        movement = {
            "id": movement_id, "productId": "product-1", "quantity": stock,
            "balanceAfter": stock, "movementType": "opening_balance", "reason": "Inicial",
        }
        return {
            "batchId": batch_id,
            "deviceId": "integration-device",
            "changes": [
                {"entityType": "products", "entityId": "product-1", "baseVersion": base_version, "action": "upsert", "payload": product},
                {"entityType": "inventoryMovements", "entityId": movement_id, "baseVersion": 0, "action": "upsert", "payload": movement},
            ],
        }

    def test_registration_verification_workspace_isolation_and_idempotent_sync(self) -> None:
        workspace_a, email_a = self.create_workspace("admin-a@example.test", "Admin A")
        _, headers_a = self.login(workspace_a, email_a)

        accepted = self.client.post("/api/v1/sync/push", headers=headers_a, json=self.product_batch("batch-1"))
        self.assertEqual(200, accepted.status_code, accepted.text)
        self.assertTrue(accepted.json()["accepted"])
        repeated = self.client.post("/api/v1/sync/push", headers=headers_a, json=self.product_batch("batch-1"))
        self.assertEqual(200, repeated.status_code, repeated.text)
        self.assertEqual(accepted.json(), repeated.json())

        workspace_b, email_b = self.create_workspace("admin-b@example.test", "Admin B")
        _, headers_b = self.login(workspace_b, email_b)
        summary = self.client.get("/api/v1/sync/summary", headers=headers_b)
        self.assertEqual(200, summary.status_code, summary.text)
        self.assertEqual({}, summary.json()["recordCounts"])
        pull = self.client.get("/api/v1/sync/pull", headers=headers_b)
        self.assertEqual([], pull.json()["changes"])

    def test_stale_version_conflicts_and_viewer_cannot_push(self) -> None:
        workspace, email = self.create_workspace("owner@example.test", "Owner")
        _, admin_headers = self.login(workspace, email)
        first = self.client.post("/api/v1/sync/push", headers=admin_headers, json=self.product_batch("batch-first"))
        self.assertEqual(200, first.status_code, first.text)

        # Otro equipo cambia el producto con un movimiento nuevo: los movimientos nunca se reescriben.
        stale = self.product_batch("batch-stale", stock=3, movement_id="adjustment-1")
        conflict = self.client.post("/api/v1/sync/push", headers=admin_headers, json=stale)
        self.assertEqual(409, conflict.status_code, conflict.text)
        self.assertTrue(conflict.json()["conflicts"])

        rewrite = self.client.post("/api/v1/sync/push", headers=admin_headers, json=self.product_batch("batch-rewrite", stock=3, base_version=1))
        self.assertEqual(400, rewrite.status_code, rewrite.text)
        self.assertIn("inmutable", rewrite.text)

        invitation = self.client.post("/api/v1/members/invitations", headers=admin_headers, json={
            "email": "viewer@example.test", "role": "viewer",
        })
        self.assertEqual(201, invitation.status_code, invitation.text)
        invite_url = urllib.parse.urlsplit(invitation.json()["developmentInvitationUrl"])
        invite_token = urllib.parse.parse_qs(invite_url.fragment).get("token", [None])[0]
        self.assertTrue(invite_token)
        invited = self.client.post("/api/v1/members/invitations/accept", json={
            "token": invite_token, "displayName": "Viewer", "password": "Pyme360-viewer-password",
        })
        self.assertEqual(201, invited.status_code, invited.text)
        viewer_login = self.client.post("/api/v1/auth/login", json={
            "workspaceId": workspace, "email": "viewer@example.test", "password": "Pyme360-viewer-password",
        })
        self.assertEqual(200, viewer_login.status_code, viewer_login.text)
        viewer_headers = {"Authorization": f"Bearer {viewer_login.json()['accessToken']}"}
        denied = self.client.post("/api/v1/sync/push", headers=viewer_headers, json=self.product_batch("viewer-write"))
        self.assertEqual(403, denied.status_code)

    def test_business_validation_rejects_the_entire_batch_without_persisting_any_record(self) -> None:
        workspace, email = self.create_workspace("validation@example.test", "Validation")
        _, headers = self.login(workspace, email)
        invalid = self.product_batch("batch-invalid", stock=5)
        invalid["changes"][1]["payload"]["quantity"] = 4
        invalid["changes"][1]["payload"]["balanceAfter"] = 4
        rejected = self.client.post("/api/v1/sync/push", headers=headers, json=invalid)
        self.assertEqual(400, rejected.status_code, rejected.text)
        self.assertEqual({}, self.client.get("/api/v1/sync/summary", headers=headers).json()["recordCounts"])

        corrected = self.product_batch("batch-invalid", stock=5)
        accepted = self.client.post("/api/v1/sync/push", headers=headers, json=corrected)
        self.assertEqual(200, accepted.status_code, accepted.text)


if __name__ == "__main__":
    unittest.main()
