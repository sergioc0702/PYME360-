"""Encrypted business-state copies for a user-selected synced folder."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path

ITERATIONS = 600_000
KEEP_COPIES = 30


def encrypt_state(state: dict, password: str) -> str:
    """Use the same envelope that the browser's restore flow understands."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    salt, iv = secrets.token_bytes(16), secrets.token_bytes(12)
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, ITERATIONS, dklen=32)
    content = json.dumps({
        "format": "pyme360-typescript-model",
        "schemaVersion": 7,
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "state": state,
    }, ensure_ascii=False).encode("utf-8")
    ciphertext = AESGCM(key).encrypt(iv, content, None)
    encoded = lambda data: base64.b64encode(data).decode("ascii")
    return json.dumps({
        "format": "pyme360-encrypted-backup",
        "version": 1,
        "iterations": ITERATIONS,
        "salt": encoded(salt),
        "iv": encoded(iv),
        "data": encoded(ciphertext),
    })


def write_backup(state: dict, password: str, destination: Path) -> Path:
    if not destination.is_dir():
        raise OSError("La carpeta sincronizada no está disponible.")
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%fZ")
    target = destination / f"pyme360-automatico-{stamp}-{secrets.token_hex(4)}.json"
    temporary = destination / f".{target.name}.tmp"
    try:
        with temporary.open("x", encoding="utf-8") as output:
            output.write(encrypt_state(state, password))
            output.flush()
            os.fsync(output.fileno())
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    prune_backups(destination)
    return target


def prune_backups(destination: Path, keep: int = KEEP_COPIES) -> list[Path]:
    """Conserva las copias automáticas más recientes; las manuales del usuario no se tocan."""
    copies = sorted(destination.glob("pyme360-automatico-*.json"), key=lambda item: item.name, reverse=True)
    removed = []
    for old in copies[keep:]:
        old.unlink(missing_ok=True)
        removed.append(old)
    return removed
