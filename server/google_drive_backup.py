"""Upload an encrypted Pyme360 backup with a narrowly scoped Drive grant."""

from __future__ import annotations

import hashlib
import io
import json
import secrets
from datetime import datetime, timezone

from offsite_backup import encrypt_state

DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file"
KEEP_COPIES = 30


def authorize_desktop(client_config: dict) -> str:
    """Interactive PKCE/loopback authorization; returns credentials for OS keyring."""
    from google_auth_oauthlib.flow import InstalledAppFlow

    flow = InstalledAppFlow.from_client_config(client_config, scopes=[DRIVE_SCOPE], autogenerate_code_verifier=True)
    credentials = flow.run_local_server(host="127.0.0.1", port=0, open_browser=True)
    if not credentials.refresh_token:
        raise RuntimeError("Google no entregó acceso renovable para las copias automáticas.")
    return credentials.to_json()


def upload_encrypted(service, encrypted: str) -> dict:
    """A resumable upload is verified by Google's returned size and MD5."""
    from googleapiclient.http import MediaIoBaseUpload

    content = encrypted.encode("utf-8")
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%fZ")
    name = f"pyme360-respaldo-{stamp}-{secrets.token_hex(4)}.json"
    media = MediaIoBaseUpload(io.BytesIO(content), mimetype="application/json", resumable=True)
    result = service.files().create(
        body={"name": name, "mimeType": "application/json"},
        media_body=media, fields="id,name,size,md5Checksum",
    ).execute()
    if (
        not isinstance(result, dict) or not isinstance(result.get("id"), str)
        or result.get("name") != name or int(result.get("size", -1)) != len(content)
        or result.get("md5Checksum") != hashlib.md5(content).hexdigest()
    ):
        raise RuntimeError("Google Drive no confirmó el tamaño y la huella de la copia.")
    return {"id": result["id"], "name": name, "size": len(content)}


def prune_uploads(service, keep: int = KEEP_COPIES) -> list[str]:
    """Borra las copias más antiguas. El permiso drive.file solo deja ver lo que creó Pyme360."""
    listing = service.files().list(
        q="name contains 'pyme360-respaldo-' and trashed = false",
        orderBy="createdTime desc",
        fields="files(id,name)",
        pageSize=200,
    ).execute()
    files = [item for item in listing.get("files", []) if str(item.get("name", "")).startswith("pyme360-respaldo-")]
    removed = []
    for item in files[keep:]:
        service.files().delete(fileId=item["id"]).execute()
        removed.append(item["id"])
    return removed


def upload_state(state: dict, password: str, credentials_json: str) -> tuple[dict, str]:
    import httplib2
    from google.auth.transport.requests import Request
    from google_auth_httplib2 import AuthorizedHttp
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    credentials = Credentials.from_authorized_user_info(json.loads(credentials_json), scopes=[DRIVE_SCOPE])
    if not credentials.valid:
        if not credentials.refresh_token:
            raise RuntimeError("Vuelve a conectar la cuenta de Google Drive.")
        credentials.refresh(Request())
    http = AuthorizedHttp(credentials, http=httplib2.Http(timeout=20))
    service = build("drive", "v3", http=http, cache_discovery=False)
    result = upload_encrypted(service, encrypt_state(state, password))
    try:
        prune_uploads(service)
    except Exception:  # noqa: BLE001 - una limpieza fallida no invalida la copia ya verificada
        pass
    return result, credentials.to_json()
