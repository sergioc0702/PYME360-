"""Transport-level tests for the e-invoicing HTTP adapter.

These tests start a real HTTP server on the loopback interface, so they cover the
actual urllib path: bearer token, idempotency header, URL encoding, error parsing,
redirect refusal and response size limits.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

SERVER_PATH = Path(__file__).resolve().parents[1] / "serve-local.py"
sys.path.insert(0, str(SERVER_PATH.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import electronic_invoicing as einvoice
from provider_stub import running_stub

DOCUMENT = {
    "documentId": "doc-1",
    "kind": "invoice",
    "environment": "test",
    "lines": [{"description": "Producto", "quantity": 1, "total": 1190}],
    "totals": {"subtotal": 1000, "discount": 0, "taxAmount": 190, "total": 1190},
}


@contextmanager
def configured_provider(base_url: str, **overrides: str):
    values = {
        "PYME360_EINVOICE_PROVIDER": "http",
        "PYME360_EINVOICE_BASE_URL": base_url,
        "PYME360_EINVOICE_API_KEY": "test-key-not-a-real-secret",
        "PYME360_EINVOICE_ENVIRONMENT": "test",
        "PYME360_EINVOICE_SUBMIT_PATH": "/api/v1/documents",
        "PYME360_EINVOICE_STATUS_PATH": "/api/v1/documents/{reference}",
        "PYME360_EINVOICE_TIMEOUT_SECONDS": "5",
    }
    values.update(overrides)
    with patch.dict(os.environ, values, clear=True):
        yield


class HttpProviderTransportTests(unittest.TestCase):
    def test_submit_uses_real_http_and_maps_the_provider_answer(self):
        with running_stub() as (base_url, state), configured_provider(base_url):
            result = einvoice.get_provider("http").submit_document(DOCUMENT, "pyme360:doc-1:1")

        self.assertEqual(len(state["calls"]), 1)
        call = state["calls"][0]
        self.assertEqual(call["method"], "POST")
        self.assertEqual(call["path"], "/api/v1/documents")
        self.assertEqual(call["headers"]["Authorization"], "Bearer test-key-not-a-real-secret")
        self.assertEqual(call["headers"]["Idempotency-Key"], "pyme360:doc-1:1")
        self.assertTrue(call["headers"]["Content-Type"].startswith("application/json"))
        sent = json.loads(call["rawBody"].decode("utf-8"))
        self.assertEqual(sent["documentId"], "doc-1")
        self.assertEqual(sent["idempotencyKey"], "pyme360:doc-1:1")
        self.assertEqual(sent["totals"]["total"], 1190)
        self.assertEqual(result.status, "accepted")
        self.assertEqual(result.provider_reference, "provider-ref-1")
        self.assertEqual(result.document_number, "FV-100")
        self.assertEqual(result.cufe, "cufe-abc-123")

    def test_status_request_encodes_the_reference_in_the_path(self):
        with running_stub() as (base_url, state), configured_provider(base_url):
            result = einvoice.get_provider("http").get_status("ref/1 2")

        self.assertEqual(len(state["calls"]), 1)
        call = state["calls"][0]
        self.assertEqual(call["method"], "GET")
        self.assertEqual(call["path"], "/api/v1/documents/ref%2F1%202")
        self.assertEqual(call["rawBody"], b"")
        self.assertNotIn("Content-Type", call["headers"])
        self.assertEqual(result.status, "accepted")

    def test_provider_error_message_is_surfaced_without_leaking_the_key(self):
        with running_stub("http-error") as (base_url, _state), configured_provider(base_url):
            with self.assertRaises(einvoice.ProviderRequestError) as caught:
                einvoice.get_provider("http").submit_document(DOCUMENT, "pyme360:doc-1:1")

        message = str(caught.exception)
        self.assertIn("HTTP 422", message)
        self.assertIn("Rango de numeración agotado", message)
        self.assertNotIn("test-key-not-a-real-secret", message)

    def test_non_json_answer_is_rejected(self):
        with running_stub("html") as (base_url, _state), configured_provider(base_url):
            with self.assertRaisesRegex(einvoice.ProviderRequestError, "no es JSON"):
                einvoice.get_provider("http").submit_document(DOCUMENT, "pyme360:doc-1:1")

    def test_redirect_is_refused_instead_of_forwarding_the_token(self):
        with running_stub("redirect") as (base_url, state), configured_provider(base_url):
            with self.assertRaises(einvoice.ProviderRequestError) as caught:
                einvoice.get_provider("http").submit_document(DOCUMENT, "pyme360:doc-1:1")

        self.assertIn("302", str(caught.exception))
        self.assertEqual(len(state["calls"]), 1, "el token no debe viajar al destino de la redirección")

    def test_oversized_answer_is_rejected(self):
        with running_stub("huge") as (base_url, _state), configured_provider(base_url):
            with self.assertRaisesRegex(einvoice.ProviderRequestError, "demasiado grande"):
                einvoice.get_provider("http").submit_document(DOCUMENT, "pyme360:doc-1:1")

    def test_unreachable_provider_reports_a_connection_error(self):
        with configured_provider("http://127.0.0.1:1"):
            with self.assertRaisesRegex(einvoice.ProviderRequestError, "No se pudo conectar"):
                einvoice.get_provider("http").submit_document(DOCUMENT, "pyme360:doc-1:1")

    def test_env_file_is_loaded_without_overwriting_exported_values(self):
        with tempfile.TemporaryDirectory() as directory:
            env_path = Path(directory) / ".env"
            env_path.write_text(
                "# comentario\n"
                "PYME360_EINVOICE_PROVIDER=http\n"
                "PYME360_EINVOICE_BASE_URL='https://sandbox.example'\n"
                "PYME360_EINVOICE_API_KEY=\"clave-entre-comillas\"\n"
                "PYME360_EINVOICE_TIMEOUT_SECONDS=15\n"
                "NO_ES_VARIABLE\n"
                "9INVALIDA=x\n",
                encoding="utf-8",
            )
            with patch.dict(
                os.environ,
                {"PYME360_EINVOICE_TIMEOUT_SECONDS": "30"},
                clear=True,
            ):
                einvoice.load_env_file(env_path)
                self.assertEqual(os.environ["PYME360_EINVOICE_BASE_URL"], "https://sandbox.example")
                self.assertEqual(os.environ["PYME360_EINVOICE_API_KEY"], "clave-entre-comillas")
                self.assertEqual(os.environ["PYME360_EINVOICE_TIMEOUT_SECONDS"], "30")
                self.assertNotIn("NO_ES_VARIABLE", os.environ)
                self.assertNotIn("9INVALIDA", os.environ)
                self.assertTrue(einvoice.provider_status()["configured"])


if __name__ == "__main__":
    unittest.main()
