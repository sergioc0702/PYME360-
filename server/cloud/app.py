"""Provider-neutral PostgreSQL API for shared Pyme360 workspaces.

Run behind an HTTPS reverse proxy. Authentication uses opaque revocable tokens;
SQLite remains the durable offline store on each desktop installation.
"""

from __future__ import annotations

import hashlib
import hmac
import html
import json
import logging
import os
import re
import secrets
import smtplib
import ssl
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlsplit

import psycopg
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from psycopg.rows import dict_row
from validation import BusinessValidationError, validate_business_records
from quotation_validation import (
    colombian_date,
    quotation_error,
    quotation_state_error,
    quoted_quantities,
    valid_quotation_id,
)
from sale_returns import return_additions, return_batch_error, sale_returns_error, valid_return_id

APP_ROOT = Path(__file__).resolve().parent
SCHEMA_PATH = APP_ROOT / "schema.sql"
PASSWORD_ITERATIONS = 600_000
SESSION_HOURS = 12
TOKEN_HOURS = 24
MAX_BATCH_CHANGES = 5_000
MAX_SYNC_CURSOR = 2**63 - 1
ROLES = {"admin", "operator", "viewer"}
SYNC_ENTITY_TYPES = {
    "contacts", "products", "recipes", "sales", "quotations", "purchases", "productionOrders",
    "environmentalRecords", "resourceReadings", "emissionFactors", "indicatorTargets",
    "environmentalActions", "receiptImports", "inventoryMovements", "financialAccounts",
    "cashMovements", "importExtras", "electronicDocuments", "supplierInvoices",
    "company", "environmentalConfig", "taxConfiguration",
}
SINGLETON_ENTITY_TYPES = {"company", "environmentalConfig", "taxConfiguration"}
IMMUTABLE_ENTITY_TYPES = {"inventoryMovements", "cashMovements", "electronicDocuments", "supplierInvoices"}
logger = logging.getLogger("pyme360.cloud")


def development_mode() -> bool:
    """Los enlaces de prueba solo se muestran en un equipo local y si se pidió expresamente."""
    if os.environ.get("APP_ENV", "production").strip().lower() != "development":
        return False
    host = urlsplit(os.environ.get("PUBLIC_BASE_URL", "").strip()).hostname
    return host in {"localhost", "127.0.0.1"}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@contextmanager
def database():
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        raise RuntimeError("Falta DATABASE_URL para PostgreSQL.")
    connection = psycopg.connect(url, row_factory=dict_row, connect_timeout=10)
    try:
        with connection.transaction():
            yield connection
    finally:
        connection.close()


def initialize_schema() -> None:
    with database() as connection:
        connection.execute(SCHEMA_PATH.read_text(encoding="utf-8"), prepare=False)


def normalize_email(value: str) -> str:
    email = value.strip().lower()
    if len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise HTTPException(400, "Escribe una dirección de correo válida.")
    return email


def password_credentials(password: str) -> tuple[bytes, bytes, int]:
    if len(password) < 8 or len(password) > 256:
        raise HTTPException(400, "La contraseña debe tener entre 8 y 256 caracteres.")
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS)
    return salt, digest, PASSWORD_ITERATIONS


def verify_password(password: str, salt: bytes, expected_hash: bytes, iterations: int) -> bool:
    candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(candidate, expected_hash)


def token_hash(token: str) -> bytes:
    return hashlib.sha256(token.encode("utf-8")).digest()


def public_url(path: str, token: str) -> str:
    base = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
    if not base:
        raise RuntimeError("Falta PUBLIC_BASE_URL para generar enlaces de correo.")
    return f"{base}{path}#token={token}"


def send_email(recipient: str, subject: str, text_body: str, html_body: str) -> str | None:
    host = os.environ.get("SMTP_HOST", "").strip()
    if not host:
        if development_mode():
            logger.warning("Correo de desarrollo para %s: %s", recipient, text_body)
            for line in text_body.splitlines():
                if line.startswith("http"):
                    return line
            return None
        raise RuntimeError("El envío de correo debe configurarse antes de registrar usuarios.")
    message = EmailMessage()
    message["From"] = os.environ.get("SMTP_FROM", "Pyme360 <no-reply@example.invalid>")
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(text_body)
    message.add_alternative(html_body, subtype="html")
    port = int(os.environ.get("SMTP_PORT", "587"))
    with smtplib.SMTP(host, port, timeout=15) as smtp:
        smtp.ehlo()
        if os.environ.get("SMTP_STARTTLS", "true").lower() == "true":
            smtp.starttls(context=ssl.create_default_context())
            smtp.ehlo()
        username = os.environ.get("SMTP_USERNAME", "")
        password = os.environ.get("SMTP_PASSWORD", "")
        if username:
            smtp.login(username, password)
        smtp.send_message(message)
    return None


def rate_limit(connection: Any, request: Request, identity: str, limit: int = 8) -> None:
    client_ip = request.client.host if request.client else "unknown"
    key = hashlib.sha256(f"{identity}:{client_ip}".encode("utf-8")).hexdigest()
    row = connection.execute(
        "SELECT window_started_at, attempt_count FROM auth_rate_limits WHERE bucket_key=%s FOR UPDATE",
        (key,),
    ).fetchone()
    now = utc_now()
    if row is None or row["window_started_at"] < now - timedelta(minutes=15):
        connection.execute(
            """INSERT INTO auth_rate_limits (bucket_key, window_started_at, attempt_count)
               VALUES (%s, %s, 1) ON CONFLICT(bucket_key) DO UPDATE SET
               window_started_at=EXCLUDED.window_started_at, attempt_count=1""",
            (key, now),
        )
        return
    if row["attempt_count"] >= limit:
        raise HTTPException(429, "Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.")
    connection.execute(
        "UPDATE auth_rate_limits SET attempt_count=attempt_count+1 WHERE bucket_key=%s", (key,)
    )


def audit(connection: Any, actor: dict | None, workspace_id: str | None, action: str, entity_type: str, entity_id: str | None = None, details: dict | None = None) -> None:
    connection.execute(
        """INSERT INTO audit_events
           (workspace_id, actor_user_id, actor_email, action, entity_type, entity_id, details_json)
           VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)""",
        (
            workspace_id,
            actor.get("id") if actor else None,
            actor.get("email") if actor else None,
            action,
            entity_type,
            entity_id,
            json.dumps(details or {}, ensure_ascii=False),
        ),
    )


def require_role(actor: dict, *roles: str) -> None:
    if actor["role"] not in roles:
        raise HTTPException(403, "Tu rol no tiene permiso para esta operación.")


class ApiInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class RegisterWorkspace(ApiInput):
    email: str
    password: str
    displayName: str = Field(min_length=1, max_length=140)
    organizationName: str = Field(min_length=2, max_length=180)


class LoginInput(ApiInput):
    workspaceId: str
    email: str
    password: str


class InvitationInput(ApiInput):
    email: str
    role: Literal["admin", "operator", "viewer"] = "operator"


class InvitationAccept(ApiInput):
    token: str = Field(min_length=20, max_length=256, pattern=r"^[A-Za-z0-9_-]+$")
    displayName: str = Field(min_length=1, max_length=140)
    password: str


class PasswordResetRequest(ApiInput):
    workspaceId: str
    email: str


class VerificationResend(ApiInput):
    workspaceId: str
    email: str


class PasswordReset(ApiInput):
    token: str = Field(min_length=20, max_length=256, pattern=r"^[A-Za-z0-9_-]+$")
    password: str


class TokenInput(ApiInput):
    token: str = Field(min_length=20, max_length=256, pattern=r"^[A-Za-z0-9_-]+$")


class SyncChange(ApiInput):
    entityType: str
    entityId: str = Field(min_length=1, max_length=180)
    baseVersion: int = Field(ge=0)
    action: Literal["upsert", "delete"]
    payload: dict[str, Any] | None = None


class SyncBatch(ApiInput):
    batchId: str = Field(min_length=1, max_length=180)
    deviceId: str = Field(min_length=1, max_length=180)
    createdAt: str | None = None
    changes: list[SyncChange] = Field(min_length=1, max_length=MAX_BATCH_CHANGES)


class ResolveConflict(ApiInput):
    resolution: Literal["local", "remote"]


def check_batch_shape(batch: SyncBatch, role: str) -> None:
    seen: set[tuple[str, str]] = set()
    for change in batch.changes:
        if change.entityType not in SYNC_ENTITY_TYPES:
            raise HTTPException(400, f"Tipo de registro no sincronizable: {change.entityType}.")
        key = (change.entityType, change.entityId)
        if key in seen:
            raise HTTPException(400, "El lote repite una entidad; divide o corrige la operación antes de sincronizar.")
        seen.add(key)
        if change.entityType in SINGLETON_ENTITY_TYPES and change.entityId != "settings":
            raise HTTPException(400, "El identificador de configuración no es válido.")
        if change.action == "upsert":
            if not isinstance(change.payload, dict):
                raise HTTPException(400, "Cada registro sincronizado debe contener un objeto de datos.")
            if change.entityType not in SINGLETON_ENTITY_TYPES and str(change.payload.get("id", "")) != change.entityId:
                raise HTTPException(400, "El identificador del registro no coincide con sus datos.")
            if contains_sensitive_key(change.payload):
                raise HTTPException(400, "No se permiten credenciales dentro de los datos del negocio.")
        elif change.payload is not None:
            raise HTTPException(400, "Un borrado no debe incluir una versión de datos.")
        if change.entityType in IMMUTABLE_ENTITY_TYPES and change.action == "delete":
            raise HTTPException(400, "Los libros y documentos históricos no se eliminan; registra una corrección trazable.")
        if role == "operator" and (change.action == "delete" or change.entityType in SINGLETON_ENTITY_TYPES or change.entityType == "financialAccounts"):
            raise HTTPException(403, "El rol operador no puede borrar datos ni modificar configuraciones administrativas.")


def contains_sensitive_key(value: Any) -> bool:
    if isinstance(value, dict):
        return any(
            re.search(r"password|access.?token|secret|private.?key|credential", str(key), re.I)
            or contains_sensitive_key(item)
            for key, item in value.items()
        )
    if isinstance(value, list):
        return any(contains_sensitive_key(item) for item in value)
    return False


def validated_workspace_snapshot(
    connection: Any, workspace_id: str, changes: list[dict], *,
    quotation_conversion: bool = False, seed_quotations: bool = False, return_id: str | None = None,
) -> dict[tuple[str, str], dict]:
    stored = connection.execute(
        "SELECT entity_type, entity_id, action, payload_json FROM entity_records WHERE workspace_id=%s",
        (workspace_id,),
    ).fetchall()
    snapshot: dict[tuple[str, str], dict] = {
        (row["entity_type"], row["entity_id"]): {
            "action": row["action"], "payload": row["payload_json"]
        }
        for row in stored
    }
    old_quotes = {
        entity_id: value["payload"] for (kind, entity_id), value in snapshot.items()
        if kind == "quotations" and value["action"] == "upsert"
    }
    old_sales = {entity_id: value["payload"] for (kind, entity_id), value in snapshot.items()
                 if kind == "sales" and value["action"] == "upsert"}
    old_products = {entity_id: value["payload"] for (kind, entity_id), value in snapshot.items()
                    if kind == "products" and value["action"] == "upsert"} if return_id else {}
    initial_seed = seed_quotations and not snapshot
    for change in changes:
        key = (str(change["entityType"]), str(change["entityId"]))
        snapshot[key] = {"action": change["action"], "payload": change.get("payload")}
    records: dict[str, dict[str, dict]] = {}
    for (entity_type, entity_id), value in snapshot.items():
        if value["action"] == "delete":
            continue
        payload = value["payload"]
        if entity_type in SINGLETON_ENTITY_TYPES:
            if not isinstance(payload, dict):
                raise HTTPException(400, f"La configuración {entity_type} debe ser un objeto.")
        elif not isinstance(payload, dict) or str(payload.get("id")) != entity_id:
            raise HTTPException(400, "Un registro central no conserva su identificador.")
        records.setdefault(entity_type, {})[entity_id] = payload

    products = records.get("products", {})
    contacts = records.get("contacts", {})
    quotes = records.get("quotations", {})
    sales = records.get("sales", {})
    returns_issue = sale_returns_error(
        old_sales, sales, records.get("inventoryMovements", {}), records.get("cashMovements", {}),
        {item.get("saleId") for item in records.get("electronicDocuments", {}).values()
         if isinstance(item.get("saleId"), str)},
    )
    if returns_issue:
        raise HTTPException(400, returns_issue)
    if return_id:
        returns_issue = return_batch_error(
            old_sales, sales, old_products, records.get("financialAccounts", {}), changes, return_id,
        )
        if returns_issue:
            raise HTTPException(400, returns_issue)
    elif not initial_seed and return_additions(old_sales, sales):
        raise HTTPException(400, "Confirma la devolución con la central antes de registrarla en este puesto.")
    quotation_issue = quotation_state_error(
        old_quotes, quotes, sales, conversion_allowed=quotation_conversion, restoring=initial_seed,
    )
    if quotation_issue:
        raise HTTPException(400, quotation_issue)
    if not (quotation_conversion or initial_seed) and any(
        sale.get("quotationId") and sale_id not in old_sales
        for sale_id, sale in sales.items()
    ):
        raise HTTPException(400, "Confirma la venta desde la acción de convertir cotización.")
    for product_id, product in products.items():
        try:
            stock = float(product.get("stock", 0))
        except (TypeError, ValueError):
            raise HTTPException(400, "Un producto contiene existencias no numéricas.")
        if not (stock >= 0 and stock < float("inf")):
            raise HTTPException(400, "Las existencias deben ser finitas y no negativas.")

    movement_totals: dict[str, float] = {}
    for movement in records.get("inventoryMovements", {}).values():
        product_id = str(movement.get("productId", ""))
        if product_id not in products:
            raise HTTPException(400, "Un movimiento de inventario refiere a un producto inexistente.")
        try:
            quantity = float(movement.get("quantity", 0))
            balance_after = float(movement.get("balanceAfter", 0))
        except (TypeError, ValueError):
            raise HTTPException(400, "Un movimiento de inventario contiene cantidades no válidas.")
        if not (quantity == quantity and balance_after == balance_after and abs(quantity) < 1e15 and 0 <= balance_after < 1e15):
            raise HTTPException(400, "Un movimiento de inventario contiene cantidades fuera de rango.")
        movement_totals[product_id] = movement_totals.get(product_id, 0.0) + quantity
    for product_id, total in movement_totals.items():
        stock = float(products[product_id].get("stock", 0))
        if abs(stock - total) > 0.0001:
            raise HTTPException(400, "Las existencias no coinciden con el libro de movimientos de inventario.")

    for sale in records.get("sales", {}).values():
        customer_id = str(sale.get("customerId", ""))
        if customer_id and customer_id not in contacts:
            raise HTTPException(400, "Una venta refiere a un cliente inexistente.")
        lines = sale.get("lines", [])
        if not isinstance(lines, list) or not lines:
            raise HTTPException(400, "Una venta debe incluir por lo menos un producto.")
        line_total = 0.0
        for line in lines:
            if not isinstance(line, dict) or str(line.get("productId", "")) not in products:
                raise HTTPException(400, "Una línea de venta refiere a un producto inexistente.")
            try:
                quantity = float(line.get("quantity", 0))
                total = float(line.get("total", 0))
            except (TypeError, ValueError):
                raise HTTPException(400, "Una línea de venta contiene cantidades no válidas.")
            if not (quantity > 0 and total >= 0 and total < 1e15):
                raise HTTPException(400, "Una línea de venta contiene valores fuera de rango.")
            line_total += total
        try:
            sale_total = float(sale.get("total", 0))
            paid_total = sum(float(payment.get("amount", 0)) for payment in sale.get("payments", []) if isinstance(payment, dict))
        except (TypeError, ValueError):
            raise HTTPException(400, "Una venta contiene un valor o pago no numérico.")
        if sale_total < 0 or paid_total < 0 or paid_total > sale_total + 0.0001 or abs(line_total - sale_total) > 0.02:
            raise HTTPException(400, "El total o los pagos de una venta no cuadran con su detalle.")

    for purchase in records.get("purchases", {}).values():
        supplier_id = str(purchase.get("supplierId", ""))
        if supplier_id and supplier_id not in contacts:
            raise HTTPException(400, "Una compra refiere a un proveedor inexistente.")
        for line in purchase.get("lines", []):
            if not isinstance(line, dict) or str(line.get("productId", "")) not in products:
                raise HTTPException(400, "Una línea de compra refiere a un producto inexistente.")
    for order in records.get("productionOrders", {}).values():
        if str(order.get("productId", "")) not in products:
            raise HTTPException(400, "Una orden de producción refiere a un producto inexistente.")
        for material in order.get("consumedMaterials", []):
            if not isinstance(material, dict) or str(material.get("productId", "")) not in products:
                raise HTTPException(400, "Una orden de producción refiere a un material inexistente.")
    for document in records.get("electronicDocuments", {}).values():
        if document.get("status") != "draft" or document.get("documentNumber") or document.get("cufe"):
            raise HTTPException(400, "La API compartida de Pyme360 no acepta estados de facturación DIAN transmitidos.")
        if str(document.get("saleId", "")) not in records.get("sales", {}):
            raise HTTPException(400, "Un borrador tributario refiere a una venta inexistente.")
    for extra in records.get("importExtras", {}).values():
        entity_type = str(extra.get("entityType", ""))
        entity_id = str(extra.get("entityId", ""))
        if entity_type not in records or entity_id not in records[entity_type]:
            raise HTTPException(400, "Un campo importado adicional no pertenece a un registro existente.")
    try:
        validate_business_records(records)
    except BusinessValidationError as exc:
        raise HTTPException(400, str(exc)) from exc
    return snapshot


def get_current_actor(request: Request) -> dict:
    authorization = request.headers.get("Authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(401, "Inicia sesión con tu cuenta de empresa.")
    with database() as connection:
        row = connection.execute(
            """SELECT u.id, u.workspace_id, u.email, u.display_name, u.role, u.active,
                      w.status AS workspace_status, s.token_hash
               FROM user_sessions s JOIN workspace_users u ON u.id=s.user_id
               JOIN workspaces w ON w.id=u.workspace_id
               WHERE s.token_hash=%s AND s.revoked_at IS NULL AND s.expires_at > now()""",
            (token_hash(token),),
        ).fetchone()
    if not row or not row["active"] or row["workspace_status"] != "active":
        raise HTTPException(401, "La sesión venció o fue revocada. Vuelve a iniciar sesión.")
    return row


def create_session(connection: Any, user: dict) -> tuple[str, datetime]:
    token = secrets.token_urlsafe(48)
    expires_at = utc_now() + timedelta(hours=SESSION_HOURS)
    connection.execute(
        "INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES (%s, %s, %s)",
        (token_hash(token), user["id"], expires_at),
    )
    return token, expires_at


def entity_row(connection: Any, workspace_id: str, entity_type: str, entity_id: str) -> dict | None:
    return connection.execute(
        """SELECT version, action, payload_json FROM entity_records
           WHERE workspace_id=%s AND entity_type=%s AND entity_id=%s""",
        (workspace_id, entity_type, entity_id),
    ).fetchone()


def append_change(connection: Any, workspace_id: str, batch_id: str, change: dict, version: int) -> int:
    connection.execute(
        """INSERT INTO entity_records
           (workspace_id, entity_type, entity_id, version, action, payload_json, updated_at)
           VALUES (%s, %s, %s, %s, %s, %s::jsonb, now())
           ON CONFLICT(workspace_id, entity_type, entity_id) DO UPDATE SET
             version=EXCLUDED.version, action=EXCLUDED.action, payload_json=EXCLUDED.payload_json,
             updated_at=now()""",
        (
            workspace_id,
            change["entityType"],
            change["entityId"],
            version,
            change["action"],
            json.dumps(change.get("payload"), ensure_ascii=False) if change.get("payload") is not None else None,
        ),
    )
    cursor = connection.execute(
        """INSERT INTO workspace_changes
           (workspace_id, batch_id, entity_type, entity_id, version, action, payload_json)
           VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb) RETURNING cursor""",
        (
            workspace_id,
            batch_id,
            change["entityType"],
            change["entityId"],
            version,
            change["action"],
            json.dumps(change.get("payload"), ensure_ascii=False) if change.get("payload") is not None else None,
        ),
    )
    return int(cursor.fetchone()["cursor"])


app = FastAPI(title="Pyme360 Cloud API", version="1.0.0")


@app.on_event("startup")
def startup() -> None:
    initialize_schema()
    if not development_mode():
        required = ("PUBLIC_BASE_URL", "SMTP_HOST", "SMTP_FROM")
        if any(not os.environ.get(name) for name in required):
            raise RuntimeError("Configura PUBLIC_BASE_URL, SMTP_HOST y SMTP_FROM en producción.")
        public_base_url = os.environ["PUBLIC_BASE_URL"].strip().lower()
        if not public_base_url.startswith("https://"):
            raise RuntimeError("PUBLIC_BASE_URL debe usar HTTPS en producción.")
        if os.environ.get("SMTP_STARTTLS", "true").lower() != "true":
            raise RuntimeError("SMTP_STARTTLS debe estar activado para el correo de producción.")


@app.get("/health")
def health() -> dict:
    with database() as connection:
        connection.execute("SELECT 1").fetchone()
    return {"status": "ok", "database": "postgresql"}


@app.post("/api/v1/organizations/register", status_code=202)
def register_workspace(data: RegisterWorkspace, request: Request) -> dict:
    email = normalize_email(data.email)
    organization_name = data.organizationName.strip()
    display_name = data.displayName.strip()
    if not organization_name or not display_name:
        raise HTTPException(400, "Escribe el nombre de la empresa y el nombre del administrador.")
    salt, password_hash_value, iterations = password_credentials(data.password)
    workspace_id = str(uuid.uuid4())
    verify_token = secrets.token_urlsafe(40)
    try:
        with database() as connection:
            rate_limit(connection, request, f"register:{email}", 4)
            workspace = connection.execute(
                "INSERT INTO workspaces (id, name) VALUES (%s, %s) RETURNING id",
                (workspace_id, organization_name),
            ).fetchone()
            user = connection.execute(
                """INSERT INTO workspace_users
                   (workspace_id, email, display_name, role, password_salt, password_hash, password_iterations)
                   VALUES (%s, %s, %s, 'admin', %s, %s, %s) RETURNING id""",
                (workspace_id, email, display_name, salt, password_hash_value, iterations),
            ).fetchone()
            connection.execute(
                "INSERT INTO email_tokens (token_hash, user_id, token_type, expires_at) VALUES (%s, %s, 'verify', %s)",
                (token_hash(verify_token), user["id"], utc_now() + timedelta(hours=TOKEN_HOURS)),
            )
            audit(connection, {"id": user["id"], "email": email}, workspace_id, "registered", "workspace", workspace_id)
    except psycopg.errors.UniqueViolation as exc:
        raise HTTPException(409, "Ya existe una empresa o cuenta con esos datos.") from exc
    url = public_url("/api/v1/auth/verify-email", verify_token)
    safe_organization_name = html.escape(organization_name)
    safe_verification_url = html.escape(url, quote=True)
    preview = send_email(
        email,
        "Verifica tu empresa Pyme360",
        f"Confirma el correo para activar el espacio de {organization_name}:\n{url}",
        f"<p>Confirma el correo para activar el espacio de <strong>{safe_organization_name}</strong>.</p><p><a href=\"{safe_verification_url}\">Verificar correo</a></p>",
    )
    result = {"workspaceId": workspace_id, "verificationRequired": True, "message": "Revisa el correo del administrador y confirma la dirección antes de iniciar sesión."}
    if preview:
        result["verificationUrl"] = preview
    return result


@app.get("/api/v1/auth/verify-email", response_class=HTMLResponse)
def verify_email_page() -> HTMLResponse:
    page = """<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verificar correo · Pyme360</title><body style="font:16px system-ui;background:#f3f6f2;color:#17251d;margin:0"><main style="max-width:36rem;margin:4rem auto;padding:1rem"><h1>Verificar correo</h1><p id="message" role="status">Validando el enlace…</p></main><script>const token=new URLSearchParams(window.location.hash.slice(1)).get('token')||'';history.replaceState(null,'',window.location.pathname);const message=document.querySelector('#message');if(!token){message.textContent='El enlace no contiene un token válido. Solicita uno nuevo.';}else{fetch('/api/v1/auth/verify-email/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})}).then(async response=>{const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.detail||'No se pudo verificar el correo.');message.textContent='Correo verificado. El espacio Pyme360 está activo. Vuelve a la aplicación local e inicia sesión para conectarlo.';}).catch(error=>{message.textContent=error instanceof Error?error.message:'No se pudo verificar el correo.';});}</script></body></html>"""
    return HTMLResponse(page)


@app.post("/api/v1/auth/verify-email/confirm")
def verify_email(data: TokenInput) -> dict:
    with database() as connection:
        row = connection.execute(
            """SELECT t.user_id, u.workspace_id FROM email_tokens t
               JOIN workspace_users u ON u.id=t.user_id
               WHERE t.token_hash=%s AND t.token_type='verify' AND t.used_at IS NULL AND t.expires_at > now()
               FOR UPDATE OF t""",
            (token_hash(data.token),),
        ).fetchone()
        if not row:
            raise HTTPException(400, "El enlace venció o ya fue utilizado. Solicita uno nuevo al administrador.")
        connection.execute("UPDATE email_tokens SET used_at=now() WHERE token_hash=%s", (token_hash(data.token),))
        connection.execute("UPDATE workspace_users SET email_verified_at=now() WHERE id=%s", (row["user_id"],))
        connection.execute("UPDATE workspaces SET status='active' WHERE id=%s", (row["workspace_id"],))
        audit(connection, None, str(row["workspace_id"]), "verified", "workspace", str(row["workspace_id"]))
    return {"verified": True}


@app.post("/api/v1/auth/verification/resend", status_code=202)
def resend_verification(data: VerificationResend, request: Request) -> dict:
    email = normalize_email(data.email)
    token = secrets.token_urlsafe(40)
    user_id = None
    with database() as connection:
        rate_limit(connection, request, f"verify:{data.workspaceId}:{email}", 4)
        user = connection.execute(
            """SELECT id FROM workspace_users WHERE workspace_id=%s AND email=%s
               AND email_verified_at IS NULL AND active=TRUE""",
            (data.workspaceId, email),
        ).fetchone()
        if user:
            user_id = user["id"]
            connection.execute(
                "INSERT INTO email_tokens (token_hash, user_id, token_type, expires_at) VALUES (%s, %s, 'verify', %s)",
                (token_hash(token), user_id, utc_now() + timedelta(hours=TOKEN_HOURS)),
            )
    if user_id:
        url = public_url("/api/v1/auth/verify-email", token)
        preview = send_email(email, "Verifica tu correo Pyme360", f"Verifica tu correo para activar Pyme360:\n{url}", f"<p>Confirma tu dirección para activar Pyme360.</p><p><a href=\"{url}\">Verificar correo</a></p>")
        if preview:
            return {"message": "Se generó un nuevo enlace de verificación.", "verificationUrl": preview}
    return {"message": "Si hay una cuenta pendiente, recibirás un nuevo enlace de verificación."}


@app.post("/api/v1/auth/login")
def login(data: LoginInput, request: Request) -> dict:
    email = normalize_email(data.email)
    failure: tuple[int, str] | None = None
    user = None
    token = ""
    expires_at = utc_now()
    has_synced_data = False
    with database() as connection:
        rate_limit(connection, request, f"login:{data.workspaceId}:{email}")
        user = connection.execute(
            """SELECT u.*, w.status AS workspace_status FROM workspace_users u
               JOIN workspaces w ON w.id=u.workspace_id
               WHERE u.workspace_id=%s AND u.email=%s""",
            (data.workspaceId, email),
        ).fetchone()
        if not user or not verify_password(data.password, user["password_salt"], user["password_hash"], user["password_iterations"]):
            failure = (401, "Correo o contraseña incorrectos.")
        elif not user["active"] or user["workspace_status"] != "active":
            failure = (403, "La empresa o cuenta se encuentra bloqueada.")
        elif not user["email_verified_at"]:
            failure = (403, "Verifica el correo antes de iniciar sesión.")
        else:
            token, expires_at = create_session(connection, user)
            has_synced_data = bool(connection.execute(
                "SELECT EXISTS(SELECT 1 FROM entity_records WHERE workspace_id=%s) AS present",
                (user["workspace_id"],),
            ).fetchone()["present"])
            audit(connection, user, str(user["workspace_id"]), "login", "session", str(user["id"]))
    if failure:
        raise HTTPException(failure[0], failure[1])
    assert user is not None
    return {
        "accessToken": token,
        "tokenType": "Bearer",
        "expiresAt": expires_at.isoformat(),
        "workspaceId": str(user["workspace_id"]),
        "userId": str(user["id"]),
        "email": user["email"],
        "displayName": user["display_name"],
        "role": user["role"],
        "hasSyncedData": has_synced_data,
    }


@app.post("/api/v1/auth/logout")
def logout(request: Request) -> dict:
    actor = get_current_actor(request)
    token = request.headers["Authorization"].partition(" ")[2]
    with database() as connection:
        connection.execute("UPDATE user_sessions SET revoked_at=now() WHERE token_hash=%s", (token_hash(token),))
        audit(connection, actor, str(actor["workspace_id"]), "logout", "session", str(actor["id"]))
    return {"revoked": True}


@app.post("/api/v1/auth/password-reset/request", status_code=202)
def request_password_reset(data: PasswordResetRequest, request: Request) -> dict:
    email = normalize_email(data.email)
    token = secrets.token_urlsafe(40)
    reset_url: str | None = None
    with database() as connection:
        rate_limit(connection, request, f"reset:{data.workspaceId}:{email}", 4)
        user = connection.execute(
            "SELECT id FROM workspace_users WHERE workspace_id=%s AND email=%s AND active=TRUE",
            (data.workspaceId, email),
        ).fetchone()
        if user:
            connection.execute(
                "INSERT INTO email_tokens (token_hash, user_id, token_type, expires_at) VALUES (%s, %s, 'reset', %s)",
                (token_hash(token), user["id"], utc_now() + timedelta(hours=1)),
            )
    if user:
        reset_url = public_url("/api/v1/auth/password-reset/confirm", token)
        preview = send_email(email, "Restablece tu contraseña Pyme360", f"Restablece tu contraseña con este enlace de un solo uso (vence en una hora):\n{reset_url}", f"<p>Usa el enlace de un solo uso para restablecer tu contraseña.</p><p><a href=\"{reset_url}\">Restablecer contraseña</a></p>")
        if preview:
            reset_url = preview
    result = {"message": "Si la cuenta existe, recibirás un enlace de restablecimiento."}
    if reset_url and development_mode():
        result["developmentResetUrl"] = reset_url
    return result


@app.get("/api/v1/auth/password-reset/request", response_class=HTMLResponse)
def password_reset_request_page() -> HTMLResponse:
    page = """<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recuperar cuenta · Pyme360</title><body style="font:16px system-ui;background:#f3f6f2;color:#17251d;margin:0"><main style="max-width:28rem;margin:8vh auto;padding:2rem;background:white;border:1px solid #d9e2da;border-radius:20px"><h1>Recuperar cuenta</h1><form id="request" style="display:grid;gap:1rem"><label>Identificador del espacio<input name="workspaceId" required style="display:block;width:100%;padding:.8rem;margin-top:.4rem"></label><label>Correo electrónico<input name="email" type="email" required style="display:block;width:100%;padding:.8rem;margin-top:.4rem"></label><button style="padding:.8rem;background:#176443;color:white;border:0;border-radius:10px">Enviar enlace</button></form><p id="message" role="status"></p></main><script>document.querySelector('#request').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const r=await fetch('/api/v1/auth/password-reset/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspaceId:f.get('workspaceId'),email:f.get('email')})});const d=await r.json();document.querySelector('#message').textContent=d.developmentResetUrl?'Enlace de desarrollo: '+d.developmentResetUrl:(d.message||'Solicitud recibida.');});</script></body></html>"""
    return HTMLResponse(page)


@app.post("/api/v1/auth/password-reset/confirm")
def reset_password(data: PasswordReset) -> dict:
    salt, digest, iterations = password_credentials(data.password)
    with database() as connection:
        row = connection.execute(
            """SELECT user_id FROM email_tokens WHERE token_hash=%s AND token_type='reset'
               AND used_at IS NULL AND expires_at > now() FOR UPDATE""",
            (token_hash(data.token),),
        ).fetchone()
        if not row:
            raise HTTPException(400, "El enlace venció o ya fue utilizado.")
        connection.execute("UPDATE email_tokens SET used_at=now() WHERE token_hash=%s", (token_hash(data.token),))
        connection.execute(
            "UPDATE workspace_users SET password_salt=%s, password_hash=%s, password_iterations=%s WHERE id=%s",
            (salt, digest, iterations, row["user_id"]),
        )
        connection.execute("UPDATE user_sessions SET revoked_at=now() WHERE user_id=%s AND revoked_at IS NULL", (row["user_id"],))
    return {"changed": True, "sessionsRevoked": True}


@app.get("/api/v1/auth/password-reset/confirm", response_class=HTMLResponse)
def password_reset_page() -> HTMLResponse:
    safe_token = "(()=>{const token=new URLSearchParams(window.location.hash.slice(1)).get('token');history.replaceState(null,'',window.location.pathname);return token;})()"
    page = f"""<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Restablecer contraseña · Pyme360</title><body style="font:16px system-ui;background:#f3f6f2;color:#17251d;margin:0"><main style="max-width:28rem;margin:8vh auto;padding:2rem;background:white;border:1px solid #d9e2da;border-radius:20px"><h1>Restablecer contraseña</h1><p>Elige una contraseña nueva. Las otras sesiones se cerrarán.</p><form id="reset" style="display:grid;gap:1rem"><label>Nueva contraseña (mínimo 8 caracteres)<input name="password" type="password" minlength="8" required style="display:block;width:100%;padding:.8rem;margin-top:.4rem"></label><button style="padding:.8rem;background:#176443;color:white;border:0;border-radius:10px">Guardar contraseña</button></form><p id="message" role="status"></p></main><script>const token={safe_token};document.querySelector('#reset').addEventListener('submit',async e=>{{e.preventDefault();const password=new FormData(e.currentTarget).get('password');const r=await fetch('/api/v1/auth/password-reset/confirm',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{token,password}})}});const d=await r.json();document.querySelector('#message').textContent=d.changed?'Contraseña actualizada. Vuelve a Pyme360 para iniciar sesión.':(d.detail||'No se pudo actualizar la contraseña.');}});</script></body></html>"""
    return HTMLResponse(page)


@app.post("/api/v1/members/invitations", status_code=201)
def invite_member(data: InvitationInput, request: Request) -> dict:
    actor = get_current_actor(request)
    require_role(actor, "admin")
    email = normalize_email(data.email)
    token = secrets.token_urlsafe(40)
    invitation_id = str(uuid.uuid4())
    try:
        with database() as connection:
            rate_limit(connection, request, f"invite:{actor['workspace_id']}:{email}", 8)
            existing_member = connection.execute(
                "SELECT 1 FROM workspace_users WHERE workspace_id=%s AND email=%s",
                (actor["workspace_id"], email),
            ).fetchone()
            pending_invitation = connection.execute(
                """SELECT 1 FROM workspace_invitations
                   WHERE workspace_id=%s AND email=%s AND accepted_at IS NULL AND expires_at > now()""",
                (actor["workspace_id"], email),
            ).fetchone()
            if existing_member:
                raise HTTPException(409, "Ese correo ya pertenece a la empresa.")
            if pending_invitation:
                raise HTTPException(409, "Ya hay una invitación pendiente para ese correo.")
            connection.execute(
                """INSERT INTO workspace_invitations
                   (id, workspace_id, invited_by, email, role, token_hash, expires_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                (invitation_id, actor["workspace_id"], actor["id"], email, data.role, token_hash(token), utc_now() + timedelta(days=7)),
            )
            audit(connection, actor, str(actor["workspace_id"]), "invited", "user", email, {"role": data.role})
    except psycopg.errors.UniqueViolation as exc:
        raise HTTPException(409, "Ya existe una cuenta o invitación activa para ese correo.") from exc
    accept_url = public_url("/api/v1/members/invitations/accept", token)
    safe_accept_url = html.escape(accept_url, quote=True)
    preview = send_email(email, "Invitación a Pyme360", f"Te invitaron a una empresa Pyme360 con el rol {data.role}. Acepta la invitación aquí:\n{accept_url}", f"<p>Te invitaron a una empresa Pyme360 con el rol <strong>{data.role}</strong>.</p><p><a href=\"{safe_accept_url}\">Aceptar invitación</a></p>")
    response = {"invitationId": invitation_id, "message": f"Invitación enviada a {email}.", "expiresInDays": 7}
    if preview:
        response["developmentInvitationUrl"] = preview
    return response


@app.post("/api/v1/members/invitations/accept", status_code=201)
def accept_invitation(data: InvitationAccept) -> dict:
    email_salt, password_hash_value, iterations = password_credentials(data.password)
    with database() as connection:
        invitation = connection.execute(
            """SELECT * FROM workspace_invitations WHERE token_hash=%s
               AND accepted_at IS NULL AND expires_at > now() FOR UPDATE""",
            (token_hash(data.token),),
        ).fetchone()
        if not invitation:
            raise HTTPException(400, "La invitación venció o ya fue aceptada.")
        workspace = connection.execute("SELECT status FROM workspaces WHERE id=%s", (invitation["workspace_id"],)).fetchone()
        if not workspace or workspace["status"] != "active":
            raise HTTPException(403, "El espacio de empresa aún no está activo.")
        user = connection.execute(
            """INSERT INTO workspace_users
               (workspace_id, email, display_name, role, email_verified_at, password_salt, password_hash, password_iterations)
               VALUES (%s, %s, %s, %s, now(), %s, %s, %s) RETURNING id""",
            (invitation["workspace_id"], invitation["email"], data.displayName.strip(), invitation["role"], email_salt, password_hash_value, iterations),
        ).fetchone()
        connection.execute("UPDATE workspace_invitations SET accepted_at=now() WHERE id=%s", (invitation["id"],))
        audit(connection, {"id": user["id"], "email": invitation["email"]}, str(invitation["workspace_id"]), "joined", "user", str(user["id"]), {"role": invitation["role"]})
    return {"created": True, "workspaceId": str(invitation["workspace_id"]), "role": invitation["role"], "email": invitation["email"]}


@app.get("/api/v1/members/invitations/accept", response_class=HTMLResponse)
def invitation_accept_page() -> HTMLResponse:
    safe_token = "(()=>{const token=new URLSearchParams(window.location.hash.slice(1)).get('token');history.replaceState(null,'',window.location.pathname);return token;})()"
    page = f"""<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aceptar invitación · Pyme360</title><body style="font:16px system-ui;background:#f3f6f2;color:#17251d;margin:0"><main style="max-width:28rem;margin:8vh auto;padding:2rem;background:white;border:1px solid #d9e2da;border-radius:20px"><h1>Únete a Pyme360</h1><p>Completa tus datos para aceptar la invitación.</p><form id="accept" style="display:grid;gap:1rem"><label>Nombre visible<input name="displayName" required style="display:block;width:100%;padding:.8rem;margin-top:.4rem"></label><label>Contraseña (mínimo 8 caracteres)<input name="password" type="password" minlength="8" required style="display:block;width:100%;padding:.8rem;margin-top:.4rem"></label><button style="padding:.8rem;background:#176443;color:white;border:0;border-radius:10px">Crear cuenta</button></form><p id="message" role="status"></p></main><script>const token={safe_token};document.querySelector('#accept').addEventListener('submit',async e=>{{e.preventDefault();const form=new FormData(e.currentTarget);const r=await fetch('/api/v1/members/invitations/accept',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{token,displayName:form.get('displayName'),password:form.get('password')}})}});const d=await r.json();document.querySelector('#message').textContent=d.created?'Cuenta creada. Pide al administrador que habilite tu usuario local para operación sin conexión.':(d.detail||'No se pudo aceptar la invitación.');}});</script></body></html>"""
    return HTMLResponse(page)


@app.get("/api/v1/members")
def list_members(request: Request) -> dict:
    actor = get_current_actor(request)
    require_role(actor, "admin")
    with database() as connection:
        rows = connection.execute(
            """SELECT id, email, display_name, role, active, email_verified_at, created_at
               FROM workspace_users WHERE workspace_id=%s ORDER BY created_at""",
            (actor["workspace_id"],),
        ).fetchall()
    return {"members": [{**row, "id": str(row["id"]), "emailVerified": row["email_verified_at"] is not None} for row in rows]}


@app.patch("/api/v1/members/{member_id}")
def update_member(member_id: str, request: Request, role: Literal["admin", "operator", "viewer"] | None = None, active: bool | None = None) -> dict:
    actor = get_current_actor(request)
    require_role(actor, "admin")
    if role is None and active is None:
        raise HTTPException(400, "Indica un rol o estado para actualizar.")
    with database() as connection:
        # Serializar los cambios de rol de este espacio impide que dos cambios
        # concurrentes dejen a la empresa sin ningún administrador activo.
        connection.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
            (str(actor["workspace_id"]),),
        )
        member = connection.execute(
            "SELECT id, role, active FROM workspace_users WHERE workspace_id=%s AND id=%s FOR UPDATE",
            (actor["workspace_id"], member_id),
        ).fetchone()
        if not member:
            raise HTTPException(404, "No se encontró la cuenta en esta empresa.")
        next_role = role or member["role"]
        next_active = member["active"] if active is None else active
        if str(member["id"]) == str(actor["id"]) and (next_role != "admin" or not next_active):
            raise HTTPException(409, "No puedes quitarte el rol de administrador ni bloquear la cuenta que estás usando.")
        if member["role"] == "admin" and (next_role != "admin" or not next_active):
            admins = connection.execute(
                "SELECT COUNT(*) AS total FROM workspace_users WHERE workspace_id=%s AND role='admin' AND active=TRUE",
                (actor["workspace_id"],),
            ).fetchone()["total"]
            if admins <= 1:
                raise HTTPException(409, "No se puede quitar o bloquear al último administrador activo.")
        connection.execute("UPDATE workspace_users SET role=%s, active=%s WHERE id=%s", (next_role, next_active, member_id))
        if not next_active:
            connection.execute("UPDATE user_sessions SET revoked_at=now() WHERE user_id=%s AND revoked_at IS NULL", (member_id,))
        audit(connection, actor, str(actor["workspace_id"]), "updated", "user", member_id, {"role": next_role, "active": next_active})
    return {"updated": True, "role": next_role, "active": next_active}


@app.delete("/api/v1/members/{member_id}/sessions")
def revoke_member_sessions(member_id: str, request: Request) -> dict:
    actor = get_current_actor(request)
    require_role(actor, "admin")
    with database() as connection:
        member = connection.execute("SELECT id FROM workspace_users WHERE workspace_id=%s AND id=%s", (actor["workspace_id"], member_id)).fetchone()
        if not member:
            raise HTTPException(404, "No se encontró la cuenta en esta empresa.")
        cursor = connection.execute("UPDATE user_sessions SET revoked_at=now() WHERE user_id=%s AND revoked_at IS NULL", (member_id,))
        audit(connection, actor, str(actor["workspace_id"]), "revoked_sessions", "user", member_id, {"count": cursor.rowcount})
    return {"revoked": cursor.rowcount}


@app.post("/api/v1/sync/push")
def sync_push(batch: SyncBatch, request: Request) -> dict:
    if valid_return_id(batch.batchId):
        raise HTTPException(400, "Usa la confirmación de devoluciones para este lote.")
    return _push_batch(batch, request)


@app.post("/api/v1/sync/confirm-return")
def confirm_sale_return(batch: SyncBatch, request: Request) -> dict:
    if not valid_return_id(batch.batchId):
        raise HTTPException(400, "El identificador de la devolución no es válido.")
    return _push_batch(batch, request, return_id=batch.batchId)


def _push_batch(batch: SyncBatch, request: Request, *, return_id: str | None = None) -> dict:
    actor = get_current_actor(request)
    require_role(actor, "admin", "operator")
    check_batch_shape(batch, actor["role"])
    workspace_id = str(actor["workspace_id"])
    with database() as connection:
        connection.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (workspace_id,))
        previous = connection.execute(
            "SELECT status, response_json FROM sync_batches WHERE workspace_id=%s AND batch_id=%s",
            (workspace_id, batch.batchId),
        ).fetchone()
        if previous:
            response = previous["response_json"]
            if previous["status"] == "conflict":
                raise HTTPException(409, detail=response)
            return response
        current_versions: dict[tuple[str, str], int] = {}
        conflicts: list[dict] = []
        for change in batch.changes:
            current = entity_row(connection, workspace_id, change.entityType, change.entityId)
            version = int(current["version"]) if current else 0
            current_versions[(change.entityType, change.entityId)] = version
            if change.baseVersion != version:
                if return_id:
                    raise HTTPException(409, "La venta o el inventario cambiaron. Sincroniza y revisa la devolución.")
                conflict_id = str(uuid.uuid4())
                remote_change = {
                    "entityType": change.entityType,
                    "entityId": change.entityId,
                    "version": version,
                    "action": current["action"] if current else "delete",
                    "payload": current["payload_json"] if current and current["payload_json"] is not None else None,
                }
                cursor = connection.execute(
                    """INSERT INTO sync_conflicts
                       (id, workspace_id, batch_id, entity_type, entity_id, base_version,
                        remote_version, local_action, local_payload_json, remote_action, remote_payload_json)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s::jsonb)""",
                    (
                        conflict_id,
                        workspace_id,
                        batch.batchId,
                        change.entityType,
                        change.entityId,
                        change.baseVersion,
                        version,
                        change.action,
                        json.dumps(change.payload, ensure_ascii=False) if change.payload is not None else None,
                        remote_change["action"],
                        json.dumps(remote_change["payload"], ensure_ascii=False) if remote_change["payload"] is not None else None,
                    ),
                )
                conflicts.append({
                    "conflictId": conflict_id,
                    "entityType": change.entityType,
                    "entityId": change.entityId,
                    "localChange": change.model_dump(),
                    "remoteChange": remote_change,
                })
            if change.entityType in IMMUTABLE_ENTITY_TYPES and current and change.action == "upsert":
                raise HTTPException(400, "El registro inmutable ya existe; corrige el historial con un movimiento nuevo.")
        if conflicts:
            response = {"error": "Uno o más registros cambiaron en otro equipo.", "conflicts": conflicts}
            connection.execute(
                """INSERT INTO sync_batches
                   (workspace_id, batch_id, device_id, actor_user_id, status, response_json, batch_payload_json)
                   VALUES (%s, %s, %s, %s, 'conflict', %s::jsonb, %s::jsonb)""",
                (workspace_id, batch.batchId, batch.deviceId, actor["id"], json.dumps(response, ensure_ascii=False), batch.model_dump_json()),
            )
            audit(connection, actor, workspace_id, "sync_conflict", "batch", batch.batchId, {"conflicts": len(conflicts)})
            return JSONResponse(status_code=409, content=response)
        validated_workspace_snapshot(
            connection,
            workspace_id,
            [change.model_dump() for change in batch.changes],
            seed_quotations=actor["role"] == "admin",
            return_id=return_id,
        )
        versions: list[dict] = []
        cursor_value = 0
        for change in batch.changes:
            version = current_versions[(change.entityType, change.entityId)] + 1
            change_dict = change.model_dump()
            cursor_value = append_change(connection, workspace_id, batch.batchId, change_dict, version)
            versions.append({"entityType": change.entityType, "entityId": change.entityId, "version": version})
        response = {"accepted": True, "batchId": batch.batchId, "versions": versions, "cursor": cursor_value}
        connection.execute(
            """INSERT INTO sync_batches
               (workspace_id, batch_id, device_id, actor_user_id, status, response_json, batch_payload_json)
               VALUES (%s, %s, %s, %s, 'accepted', %s::jsonb, %s::jsonb)""",
            (workspace_id, batch.batchId, batch.deviceId, actor["id"], json.dumps(response), batch.model_dump_json()),
        )
        audit(connection, actor, workspace_id, "sync_accepted", "batch", batch.batchId, {"records": len(batch.changes), "deviceId": batch.deviceId})
    return response


@app.post("/api/v1/quotations/{quotation_id}/convert")
def convert_quotation(quotation_id: str, request: Request) -> dict:
    actor = get_current_actor(request)
    require_role(actor, "admin", "operator")
    if not valid_quotation_id(quotation_id):
        raise HTTPException(404, "No se encontró la cotización.")
    workspace_id = str(actor["workspace_id"])
    with database() as connection:
        connection.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (workspace_id,))
        record = entity_row(connection, workspace_id, "quotations", quotation_id)
        if not record or record["action"] != "upsert":
            raise HTTPException(404, "Sincroniza la cotización antes de convertirla.")
        quote = record["payload_json"]
        issue = quotation_error(quote)
        if issue:
            raise HTTPException(400, issue)
        if quote.get("saleId"):
            return {"saleId": quote["saleId"]}
        today = colombian_date()
        if not quote["date"] <= today <= quote["validUntil"]:
            raise HTTPException(409, "La cotización está fuera de vigencia. Duplica la oferta para renovarla.")
        contact = entity_row(connection, workspace_id, "contacts", quote["customerId"])
        if not contact or contact["action"] != "upsert" or contact["payload_json"].get("role") == "supplier":
            raise HTTPException(409, f"El cliente {quote['customerName']} ya no está disponible para ventas.")
        sale_id = f"sale-{quotation_id}"
        if entity_row(connection, workspace_id, "sales", sale_id):
            raise HTTPException(409, "Ya existe un registro de venta para esta cotización.")

        def change(kind: str, payload: dict, version: int = 1) -> tuple[dict, int]:
            return {"entityType": kind, "entityId": payload["id"], "action": "upsert", "payload": payload}, version

        changes = []
        for product_id, quantity in quoted_quantities(quote).items():
            product_row = entity_row(connection, workspace_id, "products", product_id)
            line = next(item for item in quote["lines"] if item["productId"] == product_id)
            if not product_row or product_row["action"] != "upsert" or product_row["payload_json"].get("type") != "finished":
                raise HTTPException(409, f"El producto {line['productName']} ya no está disponible para ventas.")
            product = product_row["payload_json"]
            stock = float(product["stock"])
            if stock < quantity:
                raise HTTPException(409, f"No hay suficientes existencias de {product['name']}.")
            balance = round(stock - quantity, 4)
            changes.append(change("products", {**product, "stock": balance}, product_row["version"] + 1))
            changes.append(change("inventoryMovements", {
                "id": f"movement-{uuid.uuid4()}", "productId": product_id,
                "productName": product["name"], "sku": product.get("sku", ""), "unit": product.get("unit", ""),
                "quantity": -quantity, "balanceAfter": balance, "movementType": "sale",
                "reason": "Salida por venta", "sourceType": "sale", "sourceId": sale_id,
                "occurredAt": f"{today}T12:00:00.000Z", "createdAt": utc_now().isoformat(),
            }))
        numbers = [
            row["number"] for row in connection.execute(
                """SELECT payload_json->>'number' AS number FROM entity_records
                   WHERE workspace_id=%s AND entity_type='sales' AND action='upsert'""",
                (workspace_id,),
            )
        ]
        next_number = max([len(numbers), *(int(n[2:]) for n in numbers if n and re.fullmatch(r"V-[0-9]{1,15}", n))]) + 1
        sale = {
            **{key: quote[key] for key in ("customerId", "customerName", "lines", "subtotal", "discount", "vatAmount", "total")},
            "id": sale_id, "quotationId": quotation_id, "number": f"V-{next_number:04d}", "date": today,
            "payments": [], "invoiceFollowUpStatus": "to_review", "externalInvoiceNumber": "", "externalInvoiceDate": "",
        }
        changes.extend((
            change("sales", sale),
            change("quotations", {**quote, "saleId": sale_id}, record["version"] + 1),
        ))
        validated_workspace_snapshot(
            connection, workspace_id, [item for item, _ in changes], quotation_conversion=True,
        )
        batch_id = f"quote-conversion-{uuid.uuid4()}"
        for item, version in changes:
            append_change(connection, workspace_id, batch_id, item, version)
        audit(connection, actor, workspace_id, "quotation_converted", "quotations", quotation_id, {"saleId": sale_id})
    return {"saleId": sale_id}


@app.get("/api/v1/sync/pull")
def sync_pull(request: Request, cursor: int = 0, limit: int = 500) -> dict:
    actor = get_current_actor(request)
    if cursor < 0 or cursor > MAX_SYNC_CURSOR or limit < 1 or limit > 5000:
        raise HTTPException(400, "El cursor o tamaño de página no es válido.")
    with database() as connection:
        rows = connection.execute(
            """SELECT cursor, batch_id, entity_type, entity_id, version, action, payload_json, created_at
               FROM workspace_changes WHERE workspace_id=%s AND cursor>%s ORDER BY cursor LIMIT %s""",
            (actor["workspace_id"], cursor, limit + MAX_BATCH_CHANGES),
        ).fetchall()
        if len(rows) > limit:
            boundary_batch_id = rows[limit - 1]["batch_id"]
            end = limit
            while end < len(rows) and rows[end]["batch_id"] == boundary_batch_id:
                end += 1
            rows = rows[:end]
        changes = [
            {
                "cursor": int(row["cursor"]),
                "batchId": row["batch_id"],
                "entityType": row["entity_type"],
                "entityId": row["entity_id"],
                "version": int(row["version"]),
                "action": row["action"],
                "payload": row["payload_json"],
                "createdAt": row["created_at"].isoformat(),
            }
            for row in rows
        ]
    return {"changes": changes, "nextCursor": changes[-1]["cursor"] if changes else cursor}


@app.get("/api/v1/sync/summary")
def sync_summary(request: Request) -> dict:
    actor = get_current_actor(request)
    with database() as connection:
        rows = connection.execute(
            """SELECT entity_type, COUNT(*) AS count FROM entity_records
               WHERE workspace_id=%s AND action='upsert' GROUP BY entity_type""",
            (actor["workspace_id"],),
        ).fetchall()
        latest = connection.execute(
            "SELECT COALESCE(MAX(cursor), 0) AS cursor FROM workspace_changes WHERE workspace_id=%s",
            (actor["workspace_id"],),
        ).fetchone()
    return {
        "workspaceId": str(actor["workspace_id"]),
        "recordCounts": {row["entity_type"]: int(row["count"]) for row in rows},
        "cursor": int(latest["cursor"]),
        "checkedAt": utc_now().isoformat(),
    }


@app.get("/api/v1/sync/conflicts")
def sync_conflict_list(request: Request) -> dict:
    actor = get_current_actor(request)
    with database() as connection:
        rows = connection.execute(
            """SELECT id, batch_id, entity_type, entity_id, base_version, remote_version,
                      local_action, local_payload_json, remote_action, remote_payload_json, created_at
               FROM sync_conflicts WHERE workspace_id=%s AND status='open' ORDER BY created_at""",
            (actor["workspace_id"],),
        ).fetchall()
    return {"conflicts": [
        {"conflictId": str(row["id"]), "batchId": row["batch_id"], "entityType": row["entity_type"],
         "entityId": row["entity_id"], "baseVersion": row["base_version"], "remoteVersion": row["remote_version"],
         "localChange": {"action": row["local_action"], "payload": row["local_payload_json"]},
         "remoteChange": {"action": row["remote_action"], "payload": row["remote_payload_json"]},
         "createdAt": row["created_at"].isoformat()}
        for row in rows
    ]}


@app.post("/api/v1/sync/conflicts/{conflict_id}/resolve")
def resolve_sync_conflict(conflict_id: str, data: ResolveConflict, request: Request) -> dict:
    actor = get_current_actor(request)
    require_role(actor, "admin")
    workspace_id = str(actor["workspace_id"])
    try:
        conflict_uuid = str(uuid.UUID(conflict_id))
    except ValueError as exc:
        raise HTTPException(404, "No se encontró el conflicto.") from exc
    with database() as connection:
        connection.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (workspace_id,))
        conflict = connection.execute(
            "SELECT * FROM sync_conflicts WHERE workspace_id=%s AND id=%s AND status='open' FOR UPDATE",
            (workspace_id, conflict_uuid),
        ).fetchone()
        if not conflict:
            raise HTTPException(404, "No se encontró el conflicto pendiente.")
        connection.execute(
            "UPDATE sync_conflicts SET status='resolved', resolution=%s, resolved_by=%s, resolved_at=now() WHERE id=%s",
            (data.resolution, actor["id"], conflict_uuid),
        )
        open_count = connection.execute(
            "SELECT COUNT(*) AS count FROM sync_conflicts WHERE workspace_id=%s AND batch_id=%s AND status='open'",
            (workspace_id, conflict["batch_id"]),
        ).fetchone()["count"]
        if open_count:
            chosen_payload = conflict["remote_payload_json"] if data.resolution == "remote" else conflict["local_payload_json"]
            chosen_action = conflict["remote_action"] if data.resolution == "remote" else conflict["local_action"]
            pending_change = {"entityType": conflict["entity_type"], "entityId": conflict["entity_id"],
                              "version": conflict["remote_version"], "action": chosen_action, "payload": chosen_payload}
            return {"resolved": True, "awaitingResolution": True, "change": pending_change, "changes": []}

        batch_row = connection.execute(
            "SELECT * FROM sync_batches WHERE workspace_id=%s AND batch_id=%s FOR UPDATE",
            (workspace_id, conflict["batch_id"]),
        ).fetchone()
        try:
            original = json.loads(batch_row["batch_payload_json"])
        except (TypeError, json.JSONDecodeError):
            raise HTTPException(500, "No se pudo reconstruir el lote en conflicto.")
        original_changes = original.get("changes", [])
        batch_conflicts = connection.execute(
            "SELECT * FROM sync_conflicts WHERE workspace_id=%s AND batch_id=%s",
            (workspace_id, conflict["batch_id"]),
        ).fetchall()
        decisions = {(row["entity_type"], row["entity_id"]): row for row in batch_conflicts}
        effective: list[dict] = []
        for item in original_changes:
            decision = decisions.get((item["entityType"], item["entityId"]))
            current = entity_row(connection, workspace_id, item["entityType"], item["entityId"])
            current_version = int(current["version"]) if current else 0
            if decision and decision["resolution"] == "remote":
                continue
            if not decision and current_version != int(item["baseVersion"]):
                raise HTTPException(409, "El registro volvió a cambiar mientras se resolvía el conflicto. Sincroniza otra vez para revisar la nueva versión.")
            effective.append({**item, "baseVersion": current_version})
        validated_workspace_snapshot(connection, workspace_id, effective)
        versions: list[dict] = []
        resolved_changes: list[dict] = []
        cursor_value = 0
        for item in effective:
            next_version = int(item["baseVersion"]) + 1
            cursor_value = append_change(connection, workspace_id, conflict["batch_id"], item, next_version)
            version_info = {"entityType": item["entityType"], "entityId": item["entityId"], "version": next_version}
            versions.append(version_info)
            resolved_changes.append({**item, "version": next_version})
        for decision in batch_conflicts:
            if decision["resolution"] == "remote":
                current = entity_row(connection, workspace_id, decision["entity_type"], decision["entity_id"])
                resolved_changes.append({
                    "entityType": decision["entity_type"], "entityId": decision["entity_id"],
                    "version": int(current["version"]) if current else 0,
                    "action": current["action"] if current else "delete",
                    "payload": current["payload_json"] if current else None,
                })
        response = {"accepted": True, "batchId": conflict["batch_id"], "versions": versions, "cursor": cursor_value}
        connection.execute(
            "UPDATE sync_batches SET status='resolved', response_json=%s::jsonb WHERE workspace_id=%s AND batch_id=%s",
            (json.dumps(response), workspace_id, conflict["batch_id"]),
        )
        audit(connection, actor, workspace_id, "sync_resolved", "batch", conflict["batch_id"], {"resolution": data.resolution})
        return {"resolved": True, "awaitingResolution": False, "change": resolved_changes[0] if resolved_changes else None,
                "changes": resolved_changes, "versions": versions, "cursor": cursor_value}
