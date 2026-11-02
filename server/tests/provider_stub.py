"""Local stand-in for a technology provider used by the connector tests.

It is a real HTTP server bound to the loopback interface so the tests exercise the
actual urllib transport (headers, redirects, encodings, size limits) instead of
patching ``electronic_invoicing._http_json``.
"""

from __future__ import annotations

import json
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HUGE_PAYLOAD_BYTES = 1024 * 1024 + 2048

RESPONSE_OK = {
    "status": "ACCEPTED",
    "reference": "provider-ref-1",
    "number": "FV-100",
    "cufe": "cufe-abc-123",
    "message": "Recibida por el proveedor",
}


def _stub_handler(state: dict) -> type[BaseHTTPRequestHandler]:
    class StubHandler(BaseHTTPRequestHandler):
        server_version = "Pyme360Stub/1.0"

        def log_message(self, format: str, *args: object) -> None:
            del format, args

        def _record(self, method: str) -> bytes:
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else b""
            state["calls"].append(
                {
                    "method": method,
                    "path": self.path,
                    "headers": {key: value for key, value in self.headers.items()},
                    "rawBody": body,
                }
            )
            return body

        def _send(self, status: int, payload: bytes, content_type: str = "application/json") -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def _respond(self, method: str) -> None:
            self._record(method)
            mode = state["mode"]
            if mode == "redirect":
                self.send_response(302)
                self.send_header("Location", "http://127.0.0.1:1/redirected")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            if mode == "http-error":
                self._send(
                    422,
                    json.dumps({"message": "Rango de numeración agotado"}).encode("utf-8"),
                )
                return
            if mode == "html":
                self._send(200, b"<html>esto no es JSON</html>", "text/html")
                return
            if mode == "huge":
                self._send(
                    200,
                    b'{"status":"accepted","padding":"'
                    + b"a" * HUGE_PAYLOAD_BYTES
                    + b'"}',
                )
                return
            self._send(200, json.dumps(RESPONSE_OK).encode("utf-8"))

        def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler contract
            self._respond("POST")

        def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler contract
            self._respond("GET")

    return StubHandler


@contextmanager
def running_stub(mode: str = "ok"):
    """Start the stub and yield ``(base_url, state)`` where state tracks every call."""
    state: dict = {"mode": mode, "calls": []}
    server = ThreadingHTTPServer(("127.0.0.1", 0), _stub_handler(state))
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address[:2]
    try:
        yield f"http://{host}:{port}", state
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
