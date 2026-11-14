# Cómo está organizado Pyme360

Pyme360 tiene dos partes que trabajan juntas en el mismo computador:

- **La interfaz** (`frontend/`): las pantallas que ve el usuario. Está hecha con React y TypeScript y se abre en el navegador.
- **El servidor local** (`server/`): un programa en Python que guarda los datos en SQLite, revisa permisos y valida cada cambio antes de guardarlo. Solo acepta conexiones del mismo computador.

El lanzador (`Abrir Pyme360.bat`) inicia el servidor. El servidor compila la interfaz si hace falta y abre el navegador.

## Mapa de carpetas

```text
PYME360-/
├── Abrir Pyme360.bat          Lanzador de Windows (el que usa la gente)
├── Abrir Pyme360.command      Lanzador de macOS
├── Abrir-Pyme360.sh           Lanzador de Linux
├── README.md                  Qué es Pyme360 y cómo abrirlo
├── PRODUCT.md                 Para quién es el producto y qué debe lograr
├── DESIGN.md                  Colores, letra y reglas visuales de la interfaz
│
├── frontend/                  La interfaz
│   ├── src/
│   │   ├── main.tsx           Punto de entrada
│   │   ├── tailwind.css       Estilos de toda la interfaz
│   │   ├── app/               Pantallas y formularios
│   │   │   ├── App.tsx        Menú, sesión y navegación entre pantallas
│   │   │   ├── AppForms.tsx   Formularios (ventas, compras, productos…)
│   │   │   ├── AppViews.tsx   Piezas compartidas, inicio de sesión y usuarios
│   │   │   └── screens/       Una pantalla por archivo (Inicio, Vender, Dinero…)
│   │   ├── domain/            Reglas del negocio, sin pantallas
│   │   │   ├── business.ts    Ventas, compras, inventario, producción y dinero
│   │   │   ├── types.ts       Forma de todos los datos guardados
│   │   │   ├── environmental.ts, insights.ts   Consumo, CO₂ y ahorro
│   │   │   ├── costing.ts, production-cost.ts  Costos de recetas y lotes
│   │   │   └── today.ts       Lista de pendientes de Inicio
│   │   ├── features/          Funciones grandes, cada una en su carpeta
│   │   │   ├── environment/   Lector de recibos, informe PDF y referencias
│   │   │   ├── invoicing/     Facturación electrónica
│   │   │   ├── sales/         PDF de cotizaciones
│   │   │   ├── spreadsheets/  Importar y exportar Excel y CSV
│   │   │   └── synchronization/  Nube (prototipo apagado, ver abajo)
│   │   ├── infrastructure/    Conexión con el servidor: datos, sesión y respaldos cifrados
│   │   └── shared/            Formatos de fecha y dinero, y el logo
│   ├── public/                Logos, lector de recibos y librerías que funcionan sin Internet
│   └── tests/                 Pruebas de las reglas del negocio
│
├── server/                    El servidor local
│   ├── serve-local.py         Programa principal: API, sesiones, permisos y guardado
│   ├── state_validation.py    Revisa cada cambio antes de guardarlo
│   ├── electronic_invoicing.py  Conexión con un proveedor de facturación electrónica
│   ├── environment_benchmarks.py  Referencias públicas de energía y agua
│   ├── offsite_backup.py      Copias cifradas en una carpeta sincronizada
│   ├── google_drive_backup.py Copias cifradas en Google Drive
│   ├── sync_local.py          Cola de cambios para la nube (prototipo apagado)
│   ├── benchmark-data/        Archivos oficiales de referencia revisados a mano
│   ├── cloud/                 API central con PostgreSQL (prototipo apagado)
│   └── tests/                 Pruebas del servidor
│
├── docs/
│   ├── guia-de-uso.md         Guía paso a paso para el usuario
│   ├── arquitectura.md        Este documento
│   ├── analisis-tecnico.md    Análisis técnico y funcional
│   └── mercado/               Estudios de mercado y sus notas
│
└── .github/workflows/tests.yml  Pruebas automáticas al subir cambios a GitHub
```

## Por dónde pasa un cambio

1. El usuario registra algo en una pantalla de `frontend/src/app/screens/`.
2. La regla correspondiente de `frontend/src/domain/business.ts` calcula el nuevo estado, por ejemplo cuánto inventario queda.
3. `frontend/src/infrastructure/storage.ts` envía ese estado al servidor.
4. `server/serve-local.py` revisa la sesión y el rol, y `server/state_validation.py` comprueba que el cambio sea válido (por ejemplo, que un pago tenga su movimiento de caja).
5. Si todo está bien, el servidor lo guarda en SQLite, deja el registro en el Historial y actualiza la copia diaria.

## Dónde quedan los datos

Los datos no están en esta carpeta. En Windows se guardan en `%LOCALAPPDATA%\Pyme360\`, junto con siete copias diarias. Por eso se puede actualizar o mover el código sin perder información.

## Partes apagadas

La sincronización en la nube (`frontend/src/features/synchronization/`, `server/sync_local.py` y `server/cloud/`) está desactivada en la interfaz con `CLOUD_SYNC_ENABLED = false`, en `frontend/src/app/App.tsx`. Se conserva para una futura versión con varios equipos. Las cotizaciones y devoluciones usan dos validaciones de `server/cloud/` también en la versión local.

## Pruebas

- Interfaz: desde `frontend/`, ejecuta `npm test`.
- Servidor: desde la raíz, ejecuta `python -m unittest discover -s server/tests`.

GitHub corre las dos cada vez que se suben cambios.
