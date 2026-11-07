#!/bin/sh

SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
PYTHON=""

for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1; then
        if "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1; then
            PYTHON="$candidate"
            break
        fi
    fi
done

if [ -z "$PYTHON" ] && command -v py >/dev/null 2>&1; then
    if py -3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1; then
        PYTHON="py -3"
    fi
fi

if [ -z "$PYTHON" ]; then
    printf '%s\n' "Pyme360 necesita Python 3.11 o superior para guardar los datos en SQLite."
    printf '%s\n' "Instálalo desde https://www.python.org/downloads/ y vuelve a abrir el lanzador."
    printf '\n%s' "Presiona Enter para cerrar..."
    read -r _
    exit 1
fi

if [ "$PYTHON" = "py -3" ]; then
    py -3 "$SCRIPT_DIR/server/serve-local.py"
else
    "$PYTHON" "$SCRIPT_DIR/server/serve-local.py"
fi
STATUS=$?

if [ "$STATUS" -ne 0 ]; then
    printf '\n%s\n' "Pyme360 no pudo iniciar. Revisa el mensaje anterior."
    printf '%s' "Presiona Enter para cerrar..."
    read -r _
fi

exit "$STATUS"
