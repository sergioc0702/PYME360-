from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

SERVER_PATH = Path(__file__).resolve().parents[1] / "serve-local.py"
sys.path.insert(0, str(SERVER_PATH.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import electronic_invoicing as einvoice
from provider_stub import running_stub

SERVER_SPEC = importlib.util.spec_from_file_location("pyme360_server_for_einvoice_tests", SERVER_PATH)
assert SERVER_SPEC and SERVER_SPEC.loader
server_module = importlib.util.module_from_spec(SERVER_SPEC)
SERVER_SPEC.loader.exec_module(server_module)


INVOICE_XML = """<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
 xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
 xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
  <cbc:ID>PROV-2026-101</cbc:ID><cbc:IssueDate>2026-10-20</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>900111222</cbc:CompanyID><cbc:RegistrationName>Proveedor Ejemplo SAS</cbc:RegistrationName></cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>800123456</cbc:CompanyID></cac:PartyTaxScheme></cac:Party></cac:AccountingCustomerParty>
  <cac:PaymentMeans><cbc:PaymentDueDate>2026-11-20</cbc:PaymentDueDate></cac:PaymentMeans>
  <cac:TaxTotal><cbc:TaxAmount currencyID="COP">19000</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="COP">119000</cbc:PayableAmount></cac:LegalMonetaryTotal>
  <cac:InvoiceLine><cbc:InvoicedQuantity unitCode="EA">2</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="COP">100000</cbc:LineExtensionAmount><cac:Item><cbc:Description>Insumo industrial</cbc:Description></cac:Item><cac:Price><cbc:PriceAmount currencyID="COP">50000</cbc:PriceAmount></cac:Price><cac:TaxTotal><cbc:TaxAmount currencyID="COP">19000</cbc:TaxAmount></cac:TaxTotal></cac:InvoiceLine>
</Invoice>"""


@contextmanager
def provider_environment(**overrides):
    values = {
        "PYME360_EINVOICE_PROVIDER": "http",
        "PYME360_EINVOICE_BASE_URL": "https://sandbox.proveedor.example",
        "PYME360_EINVOICE_API_KEY": "test-api-key-not-a-secret",
        "PYME360_EINVOICE_ENVIRONMENT": "test",
        "PYME360_EINVOICE_SUBMIT_PATH": "/api/v1/documents",
        "PYME360_EINVOICE_STATUS_PATH": "/api/v1/documents/{reference}",
        "PYME360_EINVOICE_TIMEOUT_SECONDS": "5",
    }
    values.update(overrides)
    with patch.dict(os.environ, values, clear=True):
        yield


class ProviderConnectorTests(unittest.TestCase):
    def test_provider_is_unconfigured_without_complete_settings(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(einvoice.provider_status()["configured"])
            with self.assertRaises(einvoice.ProviderNotConfiguredError):
                einvoice.get_provider("http")

    def test_provider_status_hides_the_api_key(self):
        with provider_environment(PYME360_EINVOICE_API_KEY="super-secret-value"):
            status = einvoice.provider_status()
        self.assertTrue(status["configured"])
        self.assertEqual(status["providerId"], "http")
        self.assertNotIn("super-secret-value", json.dumps(status))

    def test_production_requires_https(self):
        with provider_environment(
            PYME360_EINVOICE_ENVIRONMENT="production",
            PYME360_EINVOICE_BASE_URL="http://sandbox.proveedor.example",
        ):
            with self.assertRaisesRegex(einvoice.ProviderNotConfiguredError, "HTTPS"):
                einvoice.get_provider("http")

    def test_submit_sends_idempotent_json_and_reads_provider_reference(self):
        captured: dict = {}

        def fake_http(method, url, headers, body, timeout):
            captured.update(
                method=method, url=url, headers=headers, body=body, timeout=timeout
            )
            return {
                "status": "ACCEPTED",
                "reference": "provider-ref-1",
                "number": "FV-1",
                "cufe": "cufe-123",
                "message": "Recibida por el proveedor",
            }

        with provider_environment(), patch.object(einvoice, "_http_json", side_effect=fake_http):
            result = einvoice.get_provider("http").submit_document(
                {"documentId": "doc-1", "lines": [{"quantity": 1}]},
                "pyme360:doc-1:1",
            )
        self.assertEqual(captured["method"], "POST")
        self.assertEqual(captured["headers"]["Idempotency-Key"], "pyme360:doc-1:1")
        self.assertEqual(captured["body"]["idempotencyKey"], "pyme360:doc-1:1")
        self.assertEqual(result.status, "accepted")
        self.assertEqual(result.provider_reference, "provider-ref-1")
        self.assertEqual(result.document_number, "FV-1")
        self.assertEqual(result.cufe, "cufe-123")

    def test_status_quotes_the_provider_reference(self):
        captured: dict = {}

        def fake_http(method, url, headers, body, timeout):
            captured.update(method=method, url=url, body=body)
            return {"status": "approved"}

        with provider_environment(), patch.object(einvoice, "_http_json", side_effect=fake_http):
            result = einvoice.get_provider("http").get_status("ref/1")
        self.assertEqual(captured["method"], "GET")
        self.assertTrue(captured["url"].endswith("/api/v1/documents/ref%2F1"))
        self.assertEqual(result.status, "accepted")

    def test_submission_document_contains_numbering_and_totals(self):
        document = {
            "id": "doc-1",
            "kind": "invoice",
            "environment": "test",
            "snapshot": {
                "currency": "COP",
                "issueDate": "2026-10-20",
                "dueDate": None,
                "seller": {"legalName": "Empresa"},
                "buyer": {"name": "Cliente"},
                "lines": [{"quantity": 1, "total": 1190}],
                "subtotal": 1000,
                "discount": 0,
                "vatAmount": 190,
                "total": 1190,
            },
        }
        payload = einvoice.build_submission_document(
            document,
            {
                "resolutionNumber": "187640001",
                "prefix": "FV",
                "rangeFrom": 1,
                "rangeTo": 1000,
                "validFrom": "2026-01-01",
                "validTo": "2027-01-01",
                "environment": "test",
            },
        )
        self.assertEqual(payload["documentId"], "doc-1")
        self.assertEqual(payload["numbering"]["prefix"], "FV")
        self.assertEqual(payload["totals"]["total"], 1190)
        self.assertEqual(payload["lines"][0]["quantity"], 1)


class SupplierInvoiceXmlTests(unittest.TestCase):
    def test_parses_invoice_metadata_and_line_items_without_retaining_xml(self):
        parsed = einvoice.parse_supplier_invoice_xml(INVOICE_XML, "proveedor.xml")
        self.assertEqual(parsed["documentNumber"], "PROV-2026-101")
        self.assertEqual(parsed["supplierTaxId"], "900111222")
        self.assertEqual(parsed["buyerTaxId"], "800123456")
        self.assertEqual(parsed["issueDate"], "2026-10-20")
        self.assertEqual(parsed["dueDate"], "2026-11-20")
        self.assertEqual(parsed["taxAmount"], 19000)
        self.assertEqual(parsed["total"], 119000)
        self.assertEqual(parsed["lines"][0]["description"], "Insumo industrial")
        self.assertNotIn("xml", parsed)
        self.assertNotIn("rawXml", parsed)

    def test_rejects_dtd_malformed_and_oversized_xml(self):
        with self.assertRaisesRegex(einvoice.InvoiceXmlError, "DTD"):
            einvoice.parse_supplier_invoice_xml("<!DOCTYPE invoice [<!ENTITY x 'x'>]>" + INVOICE_XML, "bad.xml")
        with self.assertRaisesRegex(einvoice.InvoiceXmlError, "XML válido"):
            einvoice.parse_supplier_invoice_xml("<Invoice>", "bad.xml")
        with self.assertRaisesRegex(einvoice.InvoiceXmlError, "2 MB"):
            einvoice.parse_supplier_invoice_xml(" " * (einvoice.MAX_SUPPLIER_XML_BYTES + 1), "large.xml")

    def test_provider_boundary_is_explicitly_unconfigured(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(einvoice.provider_status()["configured"])
            with self.assertRaises(einvoice.ProviderNotConfiguredError):
                einvoice.get_provider("pending-provider")


class ElectronicInvoiceRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_directory = tempfile.TemporaryDirectory(dir=SERVER_PATH.parent / "tests")
        root = Path(cls.temp_directory.name)
        server_module.DATA_DIR = root
        server_module.DB_PATH = root / "test.sqlite3"
        server_module.BACKUP_DIR = root / "backups"
        server_module.BENCHMARK_DIR = root / "benchmarks"
        server_module.BENCHMARK_SNAPSHOT_PATH = root / "benchmarks" / "official_snapshots.csv"
        server_module.BENCHMARK_TEMPLATE_PATH = SERVER_PATH.parent / "benchmark-data" / "official_snapshots.template.csv"
        server_module.initialize_database()
        cls.tokens: dict[str, str] = {}
        now = datetime.now(timezone.utc)
        with server_module.db_session() as connection:
            for role in ("admin", "operator", "viewer"):
                user_id = f"invoice-{role}"
                token = f"invoice-token-{role}"
                cls.tokens[role] = token
                connection.execute(
                    """INSERT INTO users (id, username, display_name, role, active, password_salt,
                       password_hash, password_algorithm, password_iterations, created_at)
                       VALUES (?, ?, ?, ?, 1, '', '', 'test', 0, ?)""",
                    (user_id, user_id, user_id, role, now.isoformat()),
                )
                connection.execute(
                    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                    (hashlib.sha256(token.encode()).hexdigest(), user_id, now.isoformat(), (now + timedelta(hours=1)).isoformat()),
                )
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server_module.Pyme360Handler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.httpd.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=2)
        cls.temp_directory.cleanup()

    def request(self, path: str, role: str | None, body: bytes = b"", content_type: str = "application/json"):
        headers = {"Content-Type": content_type}
        if role:
            headers["Cookie"] = f"pyme360_session={self.tokens[role]}"
        request = urllib.request.Request(self.base_url + path, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=2) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            status = error.code
            payload = json.loads(error.read())
            error.close()
            return status, payload

    def get(self, path: str, role: str | None):
        headers = {}
        if role:
            headers["Cookie"] = f"pyme360_session={self.tokens[role]}"
        request = urllib.request.Request(self.base_url + path, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=2) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            status = error.code
            payload = json.loads(error.read())
            error.close()
            return status, payload

    def put(self, path: str, role: str | None, payload: dict):
        headers = {"Content-Type": "application/json"}
        if role:
            headers["Cookie"] = f"pyme360_session={self.tokens[role]}"
        request = urllib.request.Request(
            self.base_url + path,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="PUT",
        )
        try:
            with urllib.request.urlopen(request, timeout=2) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            status = error.code
            payload = json.loads(error.read())
            error.close()
            return status, payload

    def test_model_state_api_checks_session_and_role_directly(self):
        self.assertEqual(401, self.get("/api/v1/typescript-model/state", None)[0])
        self.assertEqual(200, self.get("/api/v1/typescript-model/state", "viewer")[0])

        payload = {"expectedRevision": 0, "state": {}}
        status, _ = self.put("/api/v1/typescript-model/state", "viewer", payload)
        self.assertEqual(403, status)
        status, _ = self.put(
            "/api/v1/typescript-model/state?restore=1", "operator", payload
        )
        self.assertEqual(403, status)
        status, _ = self.put("/api/v1/typescript-model/state", None, payload)
        self.assertEqual(401, status)

    def test_invoice_xml_preview_requires_edit_role_and_does_not_persist_file(self):
        path = "/api/v1/e-invoicing/supplier-invoices/preview"
        status, _ = self.request(path, None, INVOICE_XML.encode(), "application/xml")
        self.assertEqual(status, 401)
        status, _ = self.request(path, "viewer", INVOICE_XML.encode(), "application/xml")
        self.assertEqual(status, 403)
        status, payload = self.request(path, "operator", INVOICE_XML.encode(), "application/xml")
        self.assertEqual(status, 200)
        self.assertEqual(payload["documentNumber"], "PROV-2026-101")
        self.assertNotIn("xml", payload)

    def test_provider_status_is_readable_but_emission_cannot_be_faked(self):
        # The status endpoint is GET; issue it separately with an authenticated session.
        request = urllib.request.Request(
            self.base_url + "/api/v1/e-invoicing/provider-status",
            headers={"Cookie": f"pyme360_session={self.tokens['viewer']}"},
        )
        with urllib.request.urlopen(request, timeout=2) as response:
            self.assertEqual(response.status, 200)
            self.assertFalse(json.loads(response.read())["configured"])

        base_state = {
            "electronicDocuments": [{"id": "draft-1", "status": "draft", "validationIssues": []}],
            "taxConfiguration": {"providerId": "pending-provider"},
        }
        with patch.object(server_module, "typescript_model_state_row", return_value={"state": base_state}):
            status, payload = self.request("/api/v1/e-invoicing/documents/draft-1/submit", "operator")
        self.assertEqual(status, 503)
        self.assertFalse(payload["transmitted"])

    def test_document_status_is_readable_but_explicitly_not_polled_from_provider(self):
        fixture = {
            "electronicDocuments": [
                {"id": "draft-1", "status": "draft", "environment": "test"},
            ],
        }
        with patch.object(server_module, "typescript_model_state_row", return_value={"state": fixture}):
            self.assertEqual(self.get("/api/v1/e-invoicing/documents/draft-1/status", None)[0], 401)
            status, payload = self.get("/api/v1/e-invoicing/documents/draft-1/status", "viewer")
        self.assertEqual(status, 200)
        self.assertEqual(payload["status"], "draft")
        self.assertFalse(payload["providerQueried"])
        self.assertIn("no hay un conector", payload["message"])

    def test_v5_migration_defaults_are_allowed_but_client_cannot_inject_accepted_invoice(self):
        previous_v5 = {"schemaVersion": 5}
        migrated_v6 = {
            "schemaVersion": 6,
            "electronicDocuments": [],
            "supplierInvoices": [],
            "taxConfiguration": {},
        }
        self.assertIsNone(server_module.ledger_change_error(previous_v5, migrated_v6))

        previous_v6 = {"schemaVersion": 6, "electronicDocuments": [], "supplierInvoices": []}
        forged_document = {
            "id": "forged-1",
            "status": "accepted",
            "attempts": [],
            "documentNumber": "TEST-1",
        }
        attempted_state = {**previous_v6, "electronicDocuments": [forged_document], "supplierInvoices": []}
        error = server_module.ledger_change_error(previous_v6, attempted_state)
        self.assertIsNotNone(error)
        self.assertIn("solo puede cambiar desde un conector", error)

    def test_only_unsent_drafts_can_leave_the_document_history(self):
        draft = {"id": "draft-1", "status": "draft", "attempts": []}
        kept = {"id": "draft-2", "status": "draft", "attempts": []}
        previous = {
            "schemaVersion": server_module.TYPESCRIPT_MODEL_SCHEMA_VERSION,
            "electronicDocuments": [draft, kept],
            "supplierInvoices": [],
        }
        self.assertIsNone(
            server_module.ledger_change_error(previous, {**previous, "electronicDocuments": [kept]})
        )

        for sent in (
            {"id": "sent-1", "status": "accepted", "attempts": []},
            {"id": "sent-2", "status": "draft", "attempts": [{"id": "attempt-1"}]},
            {"id": "sent-3", "status": "draft", "attempts": [], "cufe": "ABC"},
        ):
            with_sent = {**previous, "electronicDocuments": [sent]}
            error = server_module.ledger_change_error(with_sent, {**with_sent, "electronicDocuments": []})
            self.assertIn("nunca se haya enviado", error)

    def test_removing_a_draft_cannot_hide_a_forged_document_or_an_edit(self):
        draft = {"id": "draft-1", "status": "draft", "attempts": []}
        kept = {"id": "draft-2", "status": "draft", "attempts": []}
        previous = {
            "schemaVersion": server_module.TYPESCRIPT_MODEL_SCHEMA_VERSION,
            "electronicDocuments": [draft, kept],
            "supplierInvoices": [],
        }
        forged = {"id": "forged-1", "status": "accepted", "attempts": []}
        error = server_module.ledger_change_error(
            previous, {**previous, "electronicDocuments": [kept, forged]}
        )
        self.assertIn("solo puede cambiar desde un conector", error)

        edited = {**kept, "snapshot": {"total": 1}}
        error = server_module.ledger_change_error(
            previous, {**previous, "electronicDocuments": [edited]}
        )
        self.assertIn("se conservan como historial", error)

    def store_state(self, state: dict) -> None:
        with server_module.db_session() as connection:
            connection.execute(
                """INSERT OR REPLACE INTO typescript_model_state
                   (id, schema_version, revision, payload_json, updated_at)
                   VALUES (1, ?, 1, ?, ?)""",
                (
                    server_module.TYPESCRIPT_MODEL_SCHEMA_VERSION,
                    json.dumps(state, ensure_ascii=False),
                    datetime.now(timezone.utc).isoformat(),
                ),
            )

    def read_stored_state(self) -> dict:
        with server_module.db_session() as connection:
            row = connection.execute(
                "SELECT payload_json FROM typescript_model_state WHERE id=1"
            ).fetchone()
        self.assertIsNotNone(row)
        return json.loads(row["payload_json"])

    def clear_stored_state(self) -> None:
        with server_module.db_session() as connection:
            connection.execute("DELETE FROM typescript_model_state WHERE id=1")
            connection.execute("DELETE FROM sync_outbox")
            connection.execute("DELETE FROM audit_log")

    def connector_state(self, status: str = "draft", reference: str | None = None) -> dict:
        document = {
            "id": "draft-1",
            "kind": "invoice",
            "saleId": "sale-1",
            "status": status,
            "environment": "test",
            "validationIssues": [],
            "createdAt": "2026-10-20T10:00:00+00:00",
            "createdBy": "operator",
            "snapshot": {
                "seller": {
                    "legalName": "Empresa Ejemplo SAS",
                    "taxId": "800123456",
                    "city": "Medellín",
                    "address": "Calle 1 # 2-3",
                },
                "buyer": {
                    "name": "Cliente Ejemplo",
                    "taxId": "900111222",
                    "identificationType": "NIT",
                    "email": "cliente@example.com",
                },
                "currency": "COP",
                "issueDate": "2026-10-20",
                "dueDate": None,
                "lines": [
                    {
                        "productId": "product-1",
                        "sku": "SKU-1",
                        "description": "Producto",
                        "quantity": 1,
                        "unitPrice": 1000,
                        "taxCategory": "taxable",
                        "vatRate": 19,
                        "subtotal": 1000,
                        "discount": 0,
                        "taxAmount": 190,
                        "total": 1190,
                    }
                ],
                "subtotal": 1000,
                "discount": 0,
                "vatAmount": 190,
                "total": 1190,
            },
            "attempts": [],
        }
        if reference:
            document["providerReference"] = reference
        return {
            "schemaVersion": server_module.TYPESCRIPT_MODEL_SCHEMA_VERSION,
            "company": None,
            "contacts": [],
            "products": [],
            "recipes": [],
            "sales": [{"id": "sale-1", "total": 1190}],
            "purchases": [],
            "productionOrders": [],
            "environmentalRecords": [],
            "resourceReadings": [],
            "emissionFactors": [],
            "indicatorTargets": [],
            "environmentalActions": [],
            "receiptImports": [],
            "inventoryMovements": [],
            "financialAccounts": [],
            "cashMovements": [],
            "importExtras": [],
            "supplierInvoices": [],
            "taxConfiguration": {
                "countryCode": "CO",
                "currency": "COP",
                "taxResponsibilities": [],
                "providerId": "http",
                "environment": "test",
                "resolutionNumber": "187640001",
                "prefix": "FV",
                "rangeFrom": 1,
                "rangeTo": 1000,
                "validFrom": "2026-01-01",
                "validTo": "2027-01-01",
            },
            "environmentalConfig": {
                "benchmarking": {
                    "countryCode": "CO",
                    "region": "Antioquia",
                    "sectorCode": "1104",
                    "outputUnit": "L",
                    "preferredSources": [],
                    "assumedMonthlyOutput": 100000,
                }
            },
            "electronicDocuments": [document],
        }

    def test_configured_connector_transmits_and_updates_the_local_document(self):
        self.store_state(self.connector_state())
        captured: dict = {}

        def fake_http(method, url, headers, body, timeout):
            captured.update(method=method, url=url, headers=headers, body=body)
            return {
                "status": "accepted",
                "reference": "provider-ref-1",
                "number": "FV-100",
                "cufe": "cufe-1",
                "message": "Aceptada por el proveedor",
            }

        try:
            with provider_environment(), patch.object(einvoice, "_http_json", side_effect=fake_http):
                status, payload = self.request(
                    "/api/v1/e-invoicing/documents/draft-1/submit", "operator"
                )
            self.assertEqual(status, 200)
            self.assertTrue(payload["transmitted"])
            self.assertEqual(payload["status"], "accepted")
            self.assertEqual(payload["providerReference"], "provider-ref-1")
            self.assertEqual(captured["body"]["totals"]["total"], 1190)
            self.assertEqual(captured["body"]["numbering"]["prefix"], "FV")
            stored = self.read_stored_state()
            document = stored["electronicDocuments"][0]
            self.assertEqual(document["status"], "accepted")
            self.assertEqual(document["providerReference"], "provider-ref-1")
            self.assertEqual(document["documentNumber"], "FV-100")
            self.assertEqual(document["cufe"], "cufe-1")
            self.assertEqual(len(document["attempts"]), 1)
            self.assertEqual(document["attempts"][0]["result"], "accepted")
        finally:
            self.clear_stored_state()

    def test_configured_connector_polls_and_persists_status(self):
        self.store_state(self.connector_state(status="transmitted", reference="provider-ref-1"))

        def fake_http(method, url, headers, body, timeout):
            self.assertEqual(method, "GET")
            return {"status": "delivered", "message": "Entregada al adquirente"}

        try:
            with provider_environment(), patch.object(einvoice, "_http_json", side_effect=fake_http):
                status, payload = self.get(
                    "/api/v1/e-invoicing/documents/draft-1/status", "operator"
                )
            self.assertEqual(status, 200)
            self.assertTrue(payload["providerQueried"])
            self.assertEqual(payload["status"], "delivered")
            self.assertIsInstance(payload["revision"], int)
            stored = self.read_stored_state()
            self.assertEqual(stored["electronicDocuments"][0]["status"], "delivered")
            self.assertEqual(len(stored["electronicDocuments"][0]["attempts"]), 1)
        finally:
            self.clear_stored_state()

    def test_configured_connector_transmits_over_a_real_http_transport(self):
        self.store_state(self.connector_state())
        try:
            with running_stub() as (base_url, state):
                with provider_environment(PYME360_EINVOICE_BASE_URL=base_url):
                    status, payload = self.request(
                        "/api/v1/e-invoicing/documents/draft-1/submit",
                        "operator",
                        b"{}",
                        "application/json",
                    )
            self.assertEqual(status, 200)
            self.assertTrue(payload["transmitted"])
            self.assertEqual(payload["providerReference"], "provider-ref-1")
            self.assertEqual(payload["cufe"], "cufe-abc-123")
            self.assertEqual(len(state["calls"]), 1)
            self.assertEqual(state["calls"][0]["path"], "/api/v1/documents")
            self.assertTrue(
                state["calls"][0]["headers"]["Idempotency-Key"].startswith("pyme360:draft-1:")
            )
            stored = self.read_stored_state()
            document = stored["electronicDocuments"][0]
            self.assertEqual(document["status"], "accepted")
            self.assertEqual(document["documentNumber"], "FV-100")
        finally:
            self.clear_stored_state()

    def test_retry_after_a_lost_response_reuses_the_idempotency_key(self):
        self.store_state(self.connector_state())
        keys: list[str] = []

        def failing_http(method, url, headers, body, timeout):
            keys.append(headers["Idempotency-Key"])
            raise einvoice.ProviderRequestError("El proveedor tardó demasiado en responder.")

        try:
            with provider_environment(), patch.object(einvoice, "_http_json", side_effect=failing_http):
                first_status, _ = self.request(
                    "/api/v1/e-invoicing/documents/draft-1/submit", "operator"
                )
                second_status, _ = self.request(
                    "/api/v1/e-invoicing/documents/draft-1/submit", "operator"
                )
            self.assertEqual(first_status, 502)
            self.assertEqual(second_status, 502)
            self.assertEqual(len(keys), 2)
            self.assertEqual(keys[0], keys[1], "un reintento no debe generar una clave nueva")
            stored = self.read_stored_state()
            document = stored["electronicDocuments"][0]
            self.assertEqual(document["status"], "draft")
            self.assertEqual([attempt["result"] for attempt in document["attempts"]], ["error", "error"])
        finally:
            self.clear_stored_state()

    def test_viewer_can_query_provider_status_without_writing(self):
        self.store_state(self.connector_state(status="transmitted", reference="provider-ref-1"))

        def fake_http(method, url, headers, body, timeout):
            return {"status": "accepted", "message": "Aceptada"}

        try:
            with provider_environment(), patch.object(einvoice, "_http_json", side_effect=fake_http):
                status, payload = self.get(
                    "/api/v1/e-invoicing/documents/draft-1/status", "viewer"
                )
            self.assertEqual(status, 200)
            self.assertTrue(payload["providerQueried"])
            self.assertEqual(payload["status"], "accepted")
            self.assertNotIn("revision", payload)
            stored = self.read_stored_state()
            self.assertEqual(stored["electronicDocuments"][0]["status"], "transmitted")
        finally:
            self.clear_stored_state()


if __name__ == "__main__":
    unittest.main()
