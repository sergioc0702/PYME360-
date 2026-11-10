#!/usr/bin/env python3
"""Run the existing central API and PostgreSQL on loopback, with no cloud account."""

from __future__ import annotations

import argparse
import os
import secrets
import shutil
import socket
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def main() -> int:
    parser = argparse.ArgumentParser(description="API y PostgreSQL locales para ensayos de Pyme360")
    parser.add_argument("--postgres-bin", type=Path, help="Carpeta que contiene initdb y pg_ctl")
    parser.add_argument("--data-dir", type=Path, default=Path(__file__).resolve().parents[2] / "outputs" / "postgres-local")
    parser.add_argument("--api-port", type=int, default=8000)
    arguments = parser.parse_args()
    if not 0 < arguments.api_port < 65536:
        parser.error("El puerto de la API debe estar entre 1 y 65535.")

    binary_dir = arguments.postgres_bin
    initdb = (binary_dir / "initdb.exe" if os.name == "nt" else binary_dir / "initdb") if binary_dir else shutil.which("initdb")
    pg_ctl = (binary_dir / "pg_ctl.exe" if os.name == "nt" else binary_dir / "pg_ctl") if binary_dir else shutil.which("pg_ctl")
    if not initdb or not pg_ctl or not Path(initdb).is_file() or not Path(pg_ctl).is_file():
        parser.error("Instala PostgreSQL local o indica --postgres-bin con sus ejecutables.")

    root = arguments.data_dir.resolve()
    root.mkdir(parents=True, exist_ok=True)
    cluster = root / "data"
    password_file = root / "database-password"
    if not cluster.exists():
        password_file.write_text(secrets.token_urlsafe(32), encoding="utf-8")
        if os.name != "nt":
            password_file.chmod(0o600)
        subprocess.run([
            str(initdb), "-D", str(cluster), "-U", "pyme360_dev",
            "-A", "scram-sha-256", f"--pwfile={password_file}",
            "--encoding=UTF8", "--locale=C",
        ], check=True, stdout=subprocess.DEVNULL)
    if not password_file.exists():
        raise RuntimeError("Falta la contraseña de la base de ensayo; no se iniciará el clúster.")
    db_port = free_port()
    log_file = root / "postgres.log"
    subprocess.run([
        str(pg_ctl), "start", "-D", str(cluster), "-l", str(log_file),
        "-o", f"-h 127.0.0.1 -p {db_port}", "-w",
    ], check=True, stdout=subprocess.DEVNULL)
    try:
        password = password_file.read_text(encoding="utf-8").strip()
        environment = {
            **os.environ,
            "APP_ENV": "development",
            "DATABASE_URL": f"postgresql://pyme360_dev:{quote(password, safe='')}@127.0.0.1:{db_port}/postgres",
            "PUBLIC_BASE_URL": f"http://127.0.0.1:{arguments.api_port}",
            "SMTP_HOST": "",
        }
        print(f"API de ensayo: http://127.0.0.1:{arguments.api_port}", flush=True)
        print("PostgreSQL: solo 127.0.0.1. No se ha conectado ningún servicio de pago.", flush=True)
        return subprocess.call([
            sys.executable, "-m", "uvicorn", "app:app", "--host", "127.0.0.1",
            "--port", str(arguments.api_port),
        ], cwd=Path(__file__).resolve().parent, env=environment)
    finally:
        subprocess.run([str(pg_ctl), "stop", "-D", str(cluster), "-m", "fast", "-w"], check=False)


if __name__ == "__main__":
    raise SystemExit(main())
