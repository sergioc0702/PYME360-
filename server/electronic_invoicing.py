"""Neutral contracts, safe local parsing and an optional HTTP adapter for e-invoicing.

The adapter is deliberately vendor-neutral. It sends a documented JSON payload to an
endpoint supplied by a certified technology provider; Pyme360 never stores DIAN
certificates or provider secrets in the application database. When no provider is
configured, the local server refuses to transmit and the UI states that explicitly.
"""

from __future__ import annotations

import base64
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Protocol


MAX_SUPPLIER_XML_BYTES = 2 * 1024 * 1024
MAX_INVOICE_LINES = 5000
MAX_PROVIDER_RESPONSE_BYTES = 1024 * 1024
ENV_PREFIX = "PYME360_EINVOICE_"
DEFAULT_SUBMIT_PATH = "/api/v1/documents"
DEFAULT_STATUS_PATH = "/api/v1/documents/{reference}"
DEFAULT_TIMEOUT_SECONDS = 20.0
ALLOWED_DOCUMENT_STATUSES = {
    "draft",
    "queued",
    "transmitted",
    "accepted",
    "rejected",
    "delivered",
    "contingency_pending",
}


class InvoiceXmlError(ValueError):
    """The uploaded XML is not a supported or complete supplier invoice."""


class ProviderNotConfiguredError(RuntimeError):
    """No authorized electronic-invoicing provider has been configured."""


class ProviderRequestError(RuntimeError):
    """The configured provider could not be reached or returned an invalid response."""


@dataclass(frozen=True)
class ProviderResult:
    status: str
    provider_reference: str | None = None
    document_number: str | None = None
    cufe: str | None = None
    message: str = ""


@dataclass(frozen=True)
class ProviderConfiguration:
    provider_id: str
    base_url: str
    api_key: str = field(repr=False)
    environment: str = "test"
    submit_path: str = DEFAULT_SUBMIT_PATH
    status_path: str = DEFAULT_STATUS_PATH
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS


class ElectronicInvoicingProvider(Protocol):
    """Provider boundary. Implementations must be idempotent for a supplied key."""

    provider_id: str
    environment: str

    def submit_document(self, document: dict, idempotency_key: str) -> ProviderResult: ...

    def get_status(self, provider_reference: str) -> ProviderResult: ...


_STATUS_ALIASES = {
    "draft": "draft",
    "borrador": "draft",
    "queued": "queued",
    "pending": "queued",
    "en_cola": "queued",
    "processing": "queued",
    "procesando": "queued",
    "transmitted": "transmitted",
    "sent": "transmitted",
    "transmitida": "transmitted",
    "enviada": "transmitted",
    "accepted": "accepted",
    "approved": "accepted",
    "aceptada": "accepted",
    "aprobada": "accepted",
    "rejected": "rejected",
    "declined": "rejected",
    "rechazada": "rejected",
    "delivered": "delivered",
    "entregada": "delivered",
    "contingency_pending": "contingency_pending",
    "contingency": "contingency_pending",
    "contingencia": "contingency_pending",
}


def normalize_provider_status(value: object, default: str = "transmitted") -> str:
    """Map vendor status names to the statuses stored by Pyme360."""
    key = re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")
    status = _STATUS_ALIASES.get(key, default)
    return status if status in ALLOWED_DOCUMENT_STATUSES else default


def _env(name: str, default: str = "") -> str:
    return os.environ.get(f"{ENV_PREFIX}{name}", default).strip()


def configuration_from_env() -> ProviderConfiguration:
    """Read the connector configuration, rejecting unsafe or incomplete settings."""
    provider_id = _env("PROVIDER")
    base_url = _env("BASE_URL").rstrip("/")
    api_key = _env("API_KEY")
    environment = _env("ENVIRONMENT", "test").lower()
    missing = [
        name
        for name, value in (
            (f"{ENV_PREFIX}PROVIDER", provider_id),
            (f"{ENV_PREFIX}BASE_URL", base_url),
            (f"{ENV_PREFIX}API_KEY", api_key),
        )
        if not value
    ]
    if missing:
        raise ProviderNotConfiguredError(
            "No hay un conector de proveedor tecnológico configurado. Faltan: "
            + ", ".join(missing)
            + "."
        )
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,60}", provider_id):
        raise ProviderNotConfiguredError(
            f"{ENV_PREFIX}PROVIDER solo admite letras, números, punto, guion y guion bajo."
        )
    if environment not in {"test", "production"}:
        raise ProviderNotConfiguredError(
            f"{ENV_PREFIX}ENVIRONMENT debe ser 'test' o 'production'."
        )
    parsed = urllib.parse.urlsplit(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ProviderNotConfiguredError(
            f"{ENV_PREFIX}BASE_URL debe ser una dirección http(s) válida."
        )
    if parsed.username or parsed.password:
        raise ProviderNotConfiguredError(
            f"No incluyas credenciales en {ENV_PREFIX}BASE_URL; usa {ENV_PREFIX}API_KEY."
        )
    if environment == "production" and parsed.scheme != "https":
        raise ProviderNotConfiguredError(
            "Un conector en producción debe usar HTTPS. Cambia la URL o usa el ambiente de pruebas."
        )
    submit_path = _env("SUBMIT_PATH", DEFAULT_SUBMIT_PATH)
    status_path = _env("STATUS_PATH", DEFAULT_STATUS_PATH)
    for variable, path in (("SUBMIT_PATH", submit_path), ("STATUS_PATH", status_path)):
        if not path.startswith("/"):
            raise ProviderNotConfiguredError(
                f"{ENV_PREFIX}{variable} debe comenzar por '/'."
            )
    try:
        timeout_seconds = float(_env("TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS)))
    except ValueError as exc:
        raise ProviderNotConfiguredError(
            f"{ENV_PREFIX}TIMEOUT_SECONDS debe ser un número entre 1 y 120."
        ) from exc
    if not 1 <= timeout_seconds <= 120:
        raise ProviderNotConfiguredError(
            f"{ENV_PREFIX}TIMEOUT_SECONDS debe estar entre 1 y 120 segundos."
        )
    return ProviderConfiguration(
        provider_id=provider_id,
        base_url=base_url,
        api_key=api_key,
        environment=environment,
        submit_path=submit_path,
        status_path=status_path,
        timeout_seconds=timeout_seconds,
    )


def get_provider(provider_id: str) -> ElectronicInvoicingProvider:
    """Resolve the configured HTTP adapter for the provider saved in the company profile."""
    configuration = configuration_from_env()
    requested = (provider_id or "").strip()
    if requested and requested.lower() != configuration.provider_id.lower():
        raise ProviderNotConfiguredError(
            f"El conector del servidor está registrado como '{configuration.provider_id}', "
            f"pero la empresa configuró '{requested}'. Usa el mismo identificador en "
            "Configuración tributaria o ajusta las variables de entorno."
        )
    return HttpElectronicInvoicingProvider(configuration)


def provider_status() -> dict:
    """Safe status for the UI; never returns credentials or certificate details."""
    try:
        configuration = configuration_from_env()
    except ProviderNotConfiguredError as exc:
        environment = _env("ENVIRONMENT").lower()
        return {
            "configured": False,
            "providerId": _env("PROVIDER") or None,
            "environment": environment if environment in {"test", "production"} else None,
            "message": str(exc),
        }
    return {
        "configured": True,
        "providerId": configuration.provider_id,
        "environment": configuration.environment,
        "message": (
            "Conector HTTP configurado. Pyme360 enviará el documento al proveedor "
            "tecnológico y guardará la respuesta; la aceptación depende del proveedor y de la DIAN."
        ),
    }


def build_submission_document(document: dict, tax_configuration: dict | None = None) -> dict:
    """Build the neutral JSON payload sent to the technology provider.

    The provider remains responsible for the UBL XML, DIAN signature and numbering.
    Pyme360 only sends the immutable draft snapshot plus the configured numbering data.
    """
    if not isinstance(document, dict):
        raise ValueError("El documento electrónico no tiene un formato válido.")
    snapshot = document.get("snapshot")
    if not isinstance(snapshot, dict):
        raise ValueError("El borrador no contiene la instantánea tributaria necesaria.")
    lines = snapshot.get("lines")
    if not isinstance(lines, list) or not lines:
        raise ValueError("El borrador no contiene líneas para transmitir.")
    tax = tax_configuration if isinstance(tax_configuration, dict) else {}
    return {
        "documentId": document.get("id"),
        "kind": document.get("kind"),
        "environment": document.get("environment") or tax.get("environment"),
        "currency": snapshot.get("currency", "COP"),
        "issueDate": snapshot.get("issueDate"),
        "dueDate": snapshot.get("dueDate"),
        "seller": snapshot.get("seller") or {},
        "buyer": snapshot.get("buyer") or {},
        "numbering": {
            "resolutionNumber": tax.get("resolutionNumber") or "",
            "prefix": tax.get("prefix") or "",
            "rangeFrom": tax.get("rangeFrom"),
            "rangeTo": tax.get("rangeTo"),
            "validFrom": tax.get("validFrom") or "",
            "validTo": tax.get("validTo") or "",
            "contingencyPrefix": tax.get("contingencyPrefix") or "",
            "contingencyRangeFrom": tax.get("contingencyRangeFrom"),
            "contingencyRangeTo": tax.get("contingencyRangeTo"),
        },
        "lines": lines,
        "totals": {
            "subtotal": snapshot.get("subtotal", 0),
            "discount": snapshot.get("discount", 0),
            "taxAmount": snapshot.get("vatAmount", 0),
            "total": snapshot.get("total", 0),
        },
    }


def load_env_file(path: str | Path) -> None:
    """Load a simple KEY=VALUE file without overwriting variables already exported."""
    try:
        content = Path(path).read_text(encoding="utf-8")
    except OSError:
        return
    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


class _RejectRedirects(urllib.request.HTTPRedirectHandler):
    """Avoid forwarding the bearer token to an unexpected redirect target."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(
            req.full_url,
            code,
            "El proveedor intentó redirigir la solicitud.",
            headers,
            fp,
        )


_PROVIDER_OPENER = urllib.request.build_opener(_RejectRedirects)


def _http_json(
    method: str,
    url: str,
    headers: dict[str, str],
    body: dict | None,
    timeout: float,
) -> dict:
    encoded = None
    request_headers = dict(headers)
    if body is not None:
        encoded = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        request_headers["Content-Type"] = "application/json; charset=utf-8"
    request = urllib.request.Request(url, data=encoded, headers=request_headers, method=method)
    try:
        with _PROVIDER_OPENER.open(request, timeout=timeout) as response:
            raw = response.read(MAX_PROVIDER_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as exc:
        detail = _error_detail(exc)
        exc.close()
        raise ProviderRequestError(
            f"El proveedor rechazó la solicitud (HTTP {exc.code}).{detail}"
        ) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        reason = getattr(exc, "reason", None) or exc
        raise ProviderRequestError(f"No se pudo conectar con el proveedor: {reason}") from exc
    if len(raw) > MAX_PROVIDER_RESPONSE_BYTES:
        raise ProviderRequestError("El proveedor devolvió una respuesta demasiado grande.")
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ProviderRequestError("El proveedor devolvió una respuesta que no es JSON.") from exc
    if not isinstance(payload, dict):
        raise ProviderRequestError("El proveedor devolvió una respuesta inesperada.")
    return payload


def _error_detail(error: urllib.error.HTTPError) -> str:
    try:
        raw = error.read(4096)
        payload = json.loads(raw.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return ""
    if not isinstance(payload, dict):
        return ""
    for key in ("message", "mensaje", "error", "detail"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return " " + value.strip()[:300]
    return ""


def _text_field(payload: dict, *keys: str) -> str | None:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, (str, int)) and str(value).strip():
            return str(value).strip()
    return None


def _provider_result(payload: dict, default_status: str) -> ProviderResult:
    status_value: object = payload.get("status")
    if isinstance(status_value, dict):
        status_value = (
            status_value.get("name")
            or status_value.get("code")
            or status_value.get("value")
        )
    status = normalize_provider_status(status_value, default=default_status)
    message = _text_field(payload, "message", "mensaje", "detail", "description") or ""
    return ProviderResult(
        status=status,
        provider_reference=_text_field(
            payload, "providerReference", "provider_reference", "reference", "id"
        ),
        document_number=_text_field(
            payload, "documentNumber", "document_number", "number", "invoiceNumber"
        ),
        cufe=_text_field(payload, "cufe", "CUFE", "uuid"),
        message=message[:500],
    )


class HttpElectronicInvoicingProvider:
    """Vendor-neutral JSON adapter for a certified provider's documented API."""

    def __init__(self, configuration: ProviderConfiguration):
        self.configuration = configuration
        self.provider_id = configuration.provider_id
        self.environment = configuration.environment

    def _url(self, path: str) -> str:
        return self.configuration.base_url.rstrip("/") + path

    def _headers(self) -> dict[str, str]:
        return {
            "Accept": "application/json",
            "Authorization": f"Bearer {self.configuration.api_key}",
            "User-Agent": "Pyme360/1.0",
        }

    def submit_document(self, document: dict, idempotency_key: str) -> ProviderResult:
        payload = dict(document)
        payload.setdefault("idempotencyKey", idempotency_key)
        headers = {**self._headers(), "Idempotency-Key": idempotency_key}
        response = _http_json(
            "POST",
            self._url(self.configuration.submit_path),
            headers=headers,
            body=payload,
            timeout=self.configuration.timeout_seconds,
        )
        return _provider_result(response, default_status="transmitted")

    def get_status(self, provider_reference: str) -> ProviderResult:
        path = self.configuration.status_path
        if "{reference}" in path:
            path = path.replace(
                "{reference}", urllib.parse.quote(provider_reference, safe="")
            )
        else:
            path = path.rstrip("/") + "/" + urllib.parse.quote(provider_reference, safe="")
        response = _http_json(
            "GET",
            self._url(path),
            headers=self._headers(),
            body=None,
            timeout=self.configuration.timeout_seconds,
        )
        return _provider_result(response, default_status="transmitted")


def _local_name(element: ET.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def _children(element: ET.Element | None, name: str) -> list[ET.Element]:
    if element is None:
        return []
    return [child for child in list(element) if _local_name(child) == name]


def _first(element: ET.Element | None, name: str) -> ET.Element | None:
    rows = _children(element, name)
    return rows[0] if rows else None


def _descendant(element: ET.Element | None, name: str) -> ET.Element | None:
    if element is None:
        return None
    return next((child for child in element.iter() if child is not element and _local_name(child) == name), None)


def _text(element: ET.Element | None) -> str:
    return (element.text or "").strip() if element is not None else ""


def _required_text(element: ET.Element | None, field: str) -> str:
    value = _text(element)
    if not value:
        raise InvoiceXmlError(f"El XML no contiene el campo requerido: {field}.")
    return value


def _number(value: str, field: str) -> float:
    try:
        number = Decimal(value.strip())
    except (InvalidOperation, AttributeError) as exc:
        raise InvoiceXmlError(f"El campo {field} no contiene un valor numérico válido.") from exc
    if not number.is_finite() or number < 0:
        raise InvoiceXmlError(f"El campo {field} debe ser un número no negativo.")
    return float(number)


def _valid_date(value: str, field: str) -> str:
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError as exc:
        raise InvoiceXmlError(f"El campo {field} no contiene una fecha válida.") from exc


def _read_root(xml_content: str) -> ET.Element:
    if not isinstance(xml_content, str):
        raise InvoiceXmlError("Selecciona un archivo XML de factura.")
    encoded = xml_content.encode("utf-8")
    if len(encoded) > MAX_SUPPLIER_XML_BYTES:
        raise InvoiceXmlError("El XML supera el límite local de 2 MB.")
    if not xml_content.strip():
        raise InvoiceXmlError("Selecciona un archivo XML de factura.")
    if re.search(r"<!\s*(DOCTYPE|ENTITY)", xml_content, flags=re.IGNORECASE):
        raise InvoiceXmlError("El XML contiene declaraciones DTD o entidades no permitidas.")
    try:
        root = ET.fromstring(encoded)
    except ET.ParseError as exc:
        raise InvoiceXmlError("El archivo no contiene un XML válido.") from exc
    if _local_name(root) == "Invoice":
        return root
    if _local_name(root) == "AttachedDocument":
        descriptions = [
            node for node in root.iter()
            if _local_name(node) == "Description" and (node.text or "").strip()
        ]
        for description in descriptions:
            candidate = (description.text or "").strip()
            if not candidate.startswith("<"):
                try:
                    candidate = base64.b64decode(candidate, validate=True).decode("utf-8")
                except (ValueError, UnicodeDecodeError):
                    continue
            if re.search(r"<!\s*(DOCTYPE|ENTITY)", candidate, flags=re.IGNORECASE):
                continue
            try:
                embedded = ET.fromstring(candidate.encode("utf-8"))
            except ET.ParseError:
                continue
            if _local_name(embedded) == "Invoice":
                return embedded
        raise InvoiceXmlError("El AttachedDocument no contiene una factura UBL legible en su descripción.")
    raise InvoiceXmlError("El archivo debe ser una factura UBL Invoice o un AttachedDocument con la factura incluida.")


def parse_supplier_invoice_xml(xml_content: str, file_name: str) -> dict:
    """Extract reviewable UBL invoice fields and discard the XML after returning."""
    root = _read_root(xml_content)
    document_number = _required_text(_first(root, "ID"), "ID de factura")
    issue_date = _valid_date(_required_text(_first(root, "IssueDate"), "IssueDate"), "IssueDate")
    currency_node = _first(root, "DocumentCurrencyCode")
    currency = _required_text(currency_node, "DocumentCurrencyCode").upper()

    supplier_party = _descendant(_first(root, "AccountingSupplierParty"), "Party")
    supplier_identification = _descendant(supplier_party, "CompanyID")
    supplier_tax_id = _required_text(supplier_identification, "identificación del proveedor")
    supplier_name_node = _descendant(supplier_party, "RegistrationName")
    if supplier_name_node is None:
        supplier_name_node = _descendant(supplier_party, "Name")
    supplier_name = _required_text(supplier_name_node, "razón social del proveedor")

    customer_party = _descendant(_first(root, "AccountingCustomerParty"), "Party")
    buyer_tax_id = _required_text(_descendant(customer_party, "CompanyID"), "identificación del adquirente")

    total_node = _descendant(_first(root, "LegalMonetaryTotal"), "PayableAmount")
    total = _number(_required_text(total_node, "PayableAmount"), "PayableAmount")
    tax_total_node = _first(root, "TaxTotal")
    tax_amount_node = _first(tax_total_node, "TaxAmount")
    tax_amount = _number(_text(tax_amount_node) or "0", "TaxAmount")

    due_node = _first(root, "DueDate")
    if due_node is None:
        due_node = _descendant(_first(root, "PaymentMeans"), "PaymentDueDate")
    if due_node is None:
        due_node = _descendant(_first(root, "PaymentTerms"), "PaymentDueDate")
    due_date = _valid_date(_text(due_node), "PaymentDueDate") if _text(due_node) else None
    line_nodes = _children(root, "InvoiceLine")
    if not line_nodes:
        raise InvoiceXmlError("La factura no contiene líneas de detalle.")
    if len(line_nodes) > MAX_INVOICE_LINES:
        raise InvoiceXmlError("La factura supera el máximo permitido de 5.000 líneas.")

    lines: list[dict] = []
    for index, line in enumerate(line_nodes, start=1):
        quantity_node = _first(line, "InvoicedQuantity")
        quantity = _number(_required_text(quantity_node, f"cantidad de línea {index}"), f"cantidad de línea {index}")
        unit_code = quantity_node.attrib.get("unitCode", "") if quantity_node is not None else ""
        item = _first(line, "Item")
        description = _text(_first(item, "Description")) or _text(_first(item, "Name")) or f"Línea {index}"
        unit_price = _number(_required_text(_descendant(_first(line, "Price"), "PriceAmount"), f"precio de línea {index}"), f"precio de línea {index}")
        line_total_node = _first(line, "LineExtensionAmount")
        line_total = _number(_required_text(line_total_node, f"total de línea {index}"), f"total de línea {index}")
        line_tax = _number(_text(_descendant(_first(line, "TaxTotal"), "TaxAmount")) or "0", f"impuesto de línea {index}")
        lines.append({
            "description": description,
            "quantity": quantity,
            "unitCode": unit_code,
            "unitPrice": unit_price,
            "taxAmount": line_tax,
            "total": line_total + line_tax,
        })

    return {
        "fileName": (file_name or "factura.xml")[:255],
        "documentNumber": document_number,
        "issueDate": issue_date,
        "dueDate": due_date,
        "currency": currency,
        "supplierTaxId": supplier_tax_id,
        "supplierName": supplier_name,
        "buyerTaxId": buyer_tax_id,
        "taxAmount": tax_amount,
        "total": total,
        "lines": lines,
    }
