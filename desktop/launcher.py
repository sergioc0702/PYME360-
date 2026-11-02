#!/usr/bin/env python3
"""Ventana de escritorio Pyme360 para el paquete de Windows."""

from __future__ import annotations

import importlib.util
import logging
import sys
import threading
import traceback
from pathlib import Path
from types import ModuleType

def application_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS")).resolve()
    return Path(__file__).resolve().parent.parent


PROJECT_ROOT = application_root()
SERVER_ROOT = PROJECT_ROOT / "server"
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

# Estos imports explícitos permiten que PyInstaller incluya los módulos que
# carga dinámicamente el servidor local.
import electronic_invoicing  # noqa: E402,F401
import environment_benchmarks  # noqa: E402,F401
import sync_local  # noqa: E402,F401


def load_local_server() -> ModuleType:
    server_script = SERVER_ROOT / "serve-local.py"
    specification = importlib.util.spec_from_file_location("pyme360_local_server", server_script)
    if specification is None or specification.loader is None:
        raise RuntimeError("No se encontró el servidor local incluido con Pyme360.")

    module = importlib.util.module_from_spec(specification)
    sys.modules[specification.name] = module
    specification.loader.exec_module(module)
    return module


def show_startup_error(message: str) -> None:
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(None, message, "Pyme360", 0x10)
    except Exception:
        pass


def create_database_backup(server_module: ModuleType, destination_path: Path) -> int:
    """Create and validate a coherent SQLite copy without starting the UI."""
    if not server_module.DB_PATH.exists():
        return 0

    destination_path.parent.mkdir(parents=True, exist_ok=True)
    if destination_path.exists():
        raise FileExistsError("La copia de seguridad de actualización ya existe.")

    source = server_module.connect_db()
    destination = server_module.sqlite3.connect(destination_path)
    try:
        source.backup(destination)
        result = destination.execute("PRAGMA integrity_check").fetchone()
        if not result or result[0] != "ok":
            raise RuntimeError("La copia SQLite no superó la validación de integridad.")
    except Exception:
        destination.close()
        source.close()
        destination_path.unlink(missing_ok=True)
        raise
    else:
        destination.close()
        source.close()
    return 0


def main() -> int:
    server_module = None
    local_server = None
    logger: logging.Logger | None = None
    try:
        server_module = load_local_server()
        if len(sys.argv) == 3 and sys.argv[1] == "--backup-database":
            return create_database_backup(server_module, Path(sys.argv[2]))

        log_directory = server_module.DATA_DIR / "logs"
        log_directory.mkdir(parents=True, exist_ok=True)
        log_path = log_directory / "desktop.log"
        logging.basicConfig(
            filename=log_path,
            level=logging.INFO,
            format="%(asctime)s %(levelname)s %(message)s",
            encoding="utf-8",
        )
        logger = logging.getLogger("pyme360.desktop")

        import webview

        server_module.load_env_file(server_module.DATA_DIR / ".env")
        server_module.initialize_database()
        try:
            server_module.create_daily_backup()
        except (OSError, server_module.sqlite3.Error):
            logger.exception("No se pudo actualizar la copia diaria al iniciar")

        for port in server_module.PORTS:
            try:
                local_server = server_module.LoopbackHTTPServer(
                    ("127.0.0.1", port), server_module.Pyme360Handler
                )
                break
            except OSError:
                continue

        if local_server is None:
            raise OSError(
                "No hay un puerto local disponible entre 8765 y 8790. "
                "Cierra otra ventana de Pyme360 e inténtalo de nuevo."
            )

        url = f"http://127.0.0.1:{local_server.server_port}/typescript-model/"
        threading.Thread(
            target=local_server.serve_forever,
            kwargs={"poll_interval": 0.5},
            name="Pyme360-local-server",
            daemon=True,
        ).start()

        webview.create_window(
            "Pyme360",
            url,
            width=1440,
            height=960,
            min_size=(960, 640),
            background_color="#141719",
            text_select=True,
            zoomable=True,
        )
        webview.start(
            gui="edgechromium",
            private_mode=False,
            storage_path=str(server_module.DATA_DIR / "webview"),
        )
        return 0
    except Exception as error:
        if logger:
            logger.exception("No se pudo iniciar Pyme360 Desktop")
        else:
            try:
                fallback_log = Path.home() / "AppData" / "Local" / "Pyme360" / "logs"
                fallback_log.mkdir(parents=True, exist_ok=True)
                (fallback_log / "desktop.log").write_text(
                    traceback.format_exc(), encoding="utf-8"
                )
            except OSError:
                pass

        if "edgechromium" in str(error).lower() or "webview2" in str(error).lower():
            message = (
                "Pyme360 no pudo iniciar el componente WebView2 de Microsoft Edge.\n\n"
                "Actualiza Microsoft Edge o instala el Runtime de WebView2 y vuelve a abrir la app.\n\n"
                f"Detalle: {error}"
            )
        else:
            message = f"Pyme360 no pudo iniciar.\n\nDetalle: {error}"
        show_startup_error(message)
        return 1
    finally:
        if local_server is not None:
            local_server.shutdown()
            local_server.server_close()


if __name__ == "__main__":
    raise SystemExit(main())
