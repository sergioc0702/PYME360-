# Pyme360 ERP — Análisis y Resumen Estructurado

## 1. Tipo de ERP y Procesos de Negocio

**ERP Pyme360** — Aplicación para PYMEs (PYME = Small/Medium Enterprise en español), orientada a empresas colombianas. Cubre el espectro completo de gestión operativa de una pyme:

### Módulos Principales:
- **Empresa y Contactos** — Datos corporativos, clientes, proveedores (roles: customer, supplier, both)
- **Productos e Inventario** — Materias primas, insumos, productos terminados; control de existencias con movimientos trazables (apertura, venta, compra, producción, ajuste, reversión)
- **Ventas** — Ventas multirenglón, descuentos, IVA configurable, abonos, seguimiento de factura (estado: to_review, registered_externally, not_applicable)
- **Compras** — Órdenes a proveedores, estado received/pending, pagos, conciliación de cuenta por pagar, revisión de saldos históricos
- **Producción** — Órdenes de producción con consumo de materiales, registro de desperdicio, salida de producto terminado al inventario
- **Finanzas** — Cuentas de caja/banco, movimientos de dinero, saldos por cobrar/por pagar, flujo de caja mensual, conciliación de saldos heredados
- **Impacto Ambiental** — Consumo de energía/agua/combustible, producción buena, residuos, cálculo de intensidades por unidad, factores de emisión (Alcance 1/2/3), indicadores ODS, metas ambientales, acciones correctivas
- **Facturación Electrónica** — Preparación de borradores UBL, importación de XML de proveedor, parsing y validación (descarta el XML después de extraer datos), estado DIAN (borrador/queued/transmitted/accepted/rejected/contingency_pending), notas crédito/débito
- **Datos y Respaldo** — Import/export JSON y Excel, migración de respaldos, gestión de conflictos de sincronización
- **Sincronización en la Nube** — Espacios de empresa centralizados, miembros (admin/operator/viewer), cola de cambios provisionales, resolución de conflictos, respaldos antes de conexión a la nube

### Flujo de Negocio Representativo:
1. Configurar empresa y datos tributarios (regimen, resolución, rango numérico)
2. Dar de alta productos con su clasificación tributaria y recetas (para productos terminados)
3. Registrar clientes y proveedores
4. Registrar ventas (descontando inventario) y compras (afectando inventario al recibirlas)
5. Crear órdenes de producción (descontando materias primas, registrando desperdicio)
6. Capturar lecturas ambientales mensuales
7. Preparar borradores de factura electrónica (validando tributariamente)
8. Importar XML de facturas de proveedores (vinculando a compras)
9. Consultar indicadores ambientales y metas
10. Respaldo y exportación de datos

## 2. Arquitectura

### Lenguajes y Frameworks:
- **Frontend**: TypeScript + React 19 + Vite
- **Estilado**: Tailwind CSS v4 (plugin oficial de Vite; tokens y estilos base en `src/tailwind.css`)
- **Backend local**: Python 3.11+ y SQLite; la API central opcional usa FastAPI y PostgreSQL.
- **Apertura**: `Abrir Pyme360.bat` inicia el servidor local, que compila la interfaz si hace falta y abre el navegador.

### Estructura de Carpetas (`frontend/`):
```
src/
  app/                 — Composición de la aplicación, páginas y formularios
  domain/              — Tipos, reglas operativas, costos y cálculos ambientales
  features/
    environment/       — Referencias públicas y extracción de datos de consumo
    invoicing/         — Cliente local de facturación electrónica
    spreadsheets/      — Importación y exportación Excel
    synchronization/  — Lógica de sincronización local y cloud
  infrastructure/      — Persistencia, autenticación y recursos locales
  shared/              — Formato y componentes UI compartidos
  main.tsx             — Punto de entrada React
  tailwind.css         — Tailwind v4 y tokens de tema
```

### Organización de Módulos:
- **Interfaz**: `src/app/` coordina sesión, navegación, formularios y páginas.
- **Modelo y reglas**: `src/domain/` mantiene tipos, operaciones y cálculos independientes de la interfaz.
- **Capacidades**: `src/features/` separa ambiente, facturación, hojas de cálculo y sincronización.
- **Persistencia y acceso**: `src/infrastructure/` conecta SQLite, API local y autenticación.
- **API central**: `server/cloud/` contiene FastAPI, validación de lotes y esquema PostgreSQL.

### Interacción entre Capas:
1. Interfaz de usuario → `frontend/src/app/App.tsx` → valida permisos de rol (admin/operator/viewer) → llama a funciones de `frontend/src/domain/business.ts`
2. `business.ts` actualiza `AppState` inmutable, ejecuta validaciones, calcula derivados (saldos, movimientos de inventario, emisiones)
3. `frontend/src/infrastructure/storage.ts` persiste cambios en SQLite vía API `/api/v1/typescript-model/state`
4. Cambios locales aparecen en cola de sincronización; opcionalmente se envían a API central FastAPI/PostgreSQL
5. API central valida consistencia, aplica lotes idempotentes, gestiona conflictos y mantiene historial versionado

## 3. Modelo de Datos

### Entidades Principales (definidas en `frontend/src/domain/types.ts`):

| Entidad | Campos Clave | Relaciones |
|---------|-------------|------------|
| **Company** | name, taxId, city, activity | 1 - N Contacts |
| **Contact** | id, name, role, taxId, email, phone | N - N (sales as customer, purchases as supplier) |
| **Product** | id, sku, name, type, unit, stock, minStock, unitCost, unitPrice, vatRate, taxCategory, recipe | N - InventoryMovements, 1 - N ProductionOrders (as productId), N - SaleLines, N - PurchaseLines |
| **Sale** | id, number, date, customerId, lines, payments, invoiceFollowUpStatus, externalInvoiceNumber | N - Payment, 1 - N ElectronicDocument (invoice kind), N - OutstandingBalance |
| **Purchase** | id, number, date, supplierId, status, lines, payments, payableReviewStatus | N - Payment, 1 - N ElectronicDocument (supplier invoice), N - PayableBalance |
| **InventoryMovement** | id, productId, quantity, movementType, reason, occurredAt, balanceAfter | N - Product, sourceType/sourceId links to Sale/Purchase/Production |
| **FinancialAccount** | id, name, type (cash/bank), openingBalance, active | N - CashMovement |
| **CashMovement** | id, accountId, direction (in/out), amount, method, category, description | N - FinancialAccount, sourceType/sourceId links to Sale/Purchase |
| **ProductionOrder** | id, number, date, productId, quantity, wasteQuantity, status, consumedMaterials | N - Product (as productId), N - ConsumedMaterial (links to Product.id) |
| **EnvironmentalRecord** | id, period, electricityKwh, waterM3, fuelLiters, productionUnits, wasteKg, recoveredKg | N - ResourceReading (migrated) |
| **ResourceReading** | id, resource (electricity/water/fuel/material/waste), activity, quantity, unit, periodStart/End, siteId, source, quality | N - EnvironmentalRecord (legacy), linked to ReceiptImport |
| **EmissionFactor** | id, scope (1/2/3), activity, kgCo2ePerUnit, activityUnit, geography, year, version, source, method | Used by environmental calculations per period |
| **IndicatorTarget** | id, indicatorId, direction (decrease/increase), horizonMonths, baselinePeriod, baselineValue, reductionPercent | Calculates targetProgress (%) |
| **EnvironmentalAction** | id, indicatorId, title, owner, dueDate, status (open/completed), notes | Open/completed tracking |
| **ReceiptImport** | id, fileName, fileHash, importedAt, status, source, provider, accountNumber, extraction | Linked to ResourceReading via receiptImportId |
| **TaxConfiguration** | countryCode, currency, legalAddress, invoiceEmail, taxRegime, taxResponsibilities, providerId, environment, resolutionNumber, prefix, rangeFrom/To, validFrom/To, contingencyPrefix/Range | Configuración tributaria DIAN |
| **ElectronicDocument** | id, kind (invoice/credit_note/debit_note), saleId, status, snapshot, attempts | N - Attempt, linked to Sale, validationIssues |
| **SupplierInvoiceDocument** | id, documentNumber, issueDate, supplierTaxId, supplierName, buyerTaxId, lines, status | Linked to Purchase (purchaseId), contact (supplierContactId) |

### Donde se Definen:
- **Esquemas y Migraciones**: `frontend/src/infrastructure/storage.ts` — función `migrateAppState()` transforma versiones anteriores y mantiene compatibilidad de datos
- **ORM**: No usa ORM; acceso directo a SQLite mediante consultas raw y JSON serialization
- **Validaciones**: `frontend/src/domain/business.ts` — validaciones explícitas en cada operación (requireValue, requireText, requireNonNegative, validaciones específicas por módulo)

## 4. Base de Datos e Integraciones Externas

### Base de Datos:
- **Local**: SQLite `pyme360.sqlite3` — ubicación `%LOCALAPPDATA%\Pyme360\pyme360.sqlite3` en Windows
- **Cloud (opcional)**: PostgreSQL vía FastAPI — deploy con Docker Compose desde `server/cloud/`
- **Mismo origen**: La app TypeScript lee y escribe SQLite directamente; la API central FastAPI usa PostgreSQL para sincronización

### Integraciones Externas:
| Integración | Propósito | Estado |
|-------------|-----------|--------|
| **Enel Colombia portal** | Descargar recibos eléctricos/agua, OCR local | Implementado (`frontend/src/features/environment/consumption.ts` extrae datos) |
| **DANE/EAI** | Estadísticas manufactureras anuales (referencia) | Datos cacheados, actualización manual |
| **SUI Energía** | Consumo y facturación agregada por prestador | Datos cacheados |
| **EIA/MECS** | Encuesta manufacturera EE.UU. (referencia internacional) | Datos cacheados |
| **UNSD SDG API** | Indicadores ODS 6.4.1, 6.4.2, 7.3.1 (contexto) | Datos cacheados, actualización manual |
| **XM/Sinergox API** | Demanda del SIN (contexto eléctrico) | Datos cacheados |
| **Proveedor e-invoicing** | Transmisión DIAN (UBL XML) | **Adaptador HTTP configurable implementado** — requiere credenciales de un proveedor tecnológico certificado en `server/.env`; sin ellas no transmite |
| **Servicio de correo (SMTP)** | Envío de verificación, invitaciones, recuperación | Requiere configuración `.env` (SMTP_HOST, SMTP_FROM, etc.) |
| **Keyring (Windows)** | Almacenamiento seguro de tokens | Opcional, `pip install -r server/requirements-sync.txt` |

### API Local (puerto 8765 por defecto):
- `GET /api/v1/e-invoicing/provider-status` — Estado del conector configurado
- `GET /api/v1/e-invoicing/documents/{id}/status` — Estado de documento
- `POST /api/v1/e-invoicing/documents/{id}/submit` — Solicitud de transmisión (requiere proveedor configurado)
- `POST /api/v1/e-invoicing/supplier-invoices/preview` — Parseo de XML UBL (máx. 2 MB)
- `GET /api/v1/auth/status` / `/api/v1/auth/users` / `/api/v1/auth/login` / `/logout` — Autenticación
- `GET /api/v1/sync/status` / `/api/v1/sync/pull` / `/api/v1/sync/push` — Sincronización central
- `GET /api/v1/environment/benchmarks` / `/refresh` — Datos ambientales externos

## 5. Estado Apparente del Proyecto

### ✅ Completo:
- Lógica de negocio completa (`frontend/src/domain/business.ts` — operaciones + validaciones)
- Definiciones de tipos completas (`frontend/src/domain/types.ts` — esquema v7 con todas las entidades)
- Interfaz de React completamente implementada (todas las páginas, formularios, componentes)
- Almacenamiento SQLite y migraciones hasta v7 (`frontend/src/infrastructure/storage.ts`)
- Autenticación y gestión de usuarios (`frontend/src/infrastructure/auth.ts`)
- Cálculos ambientales y de emisiones (`frontend/src/domain/environmental.ts`)
- Parser UBL y validación de XML (`server/electronic_invoicing.py`)
- Test suite (`server/tests/` — tests de e-invoicing y benchmarks)
- Tailwind CSS v4 con tema completo (`src/tailwind.css`)
- Import/export Excel y JSON (`frontend/src/features/spreadsheets/`, serialización de respaldos en `frontend/src/infrastructure/storage.ts`)
- Panel de sincronización en la nube (`frontend/src/features/synchronization/sync.ts`, `frontend/src/app/screens/CloudSyncPanel.tsx`)

### ⚠️ En Desarrollo / a Medias:
- **Conector e-invoicing DIAN**: El adaptador HTTP ya existe y transmite cuando `server/.env` tiene un proveedor, URL y clave válidos. Sin esa configuración, el sistema solo prepara borradores y responde "No hay un conector de proveedor tecnológico configurado". La aceptación depende de la respuesta del proveedor y de la DIAN.
- **Despliegue cloud**: Requiere Docker Desktop + `docker compose up --build` desde `server/cloud/`. No hay instancia corriendo en el repositorio.
- **Datos de benchmark**: Requiere archivo `official_snapshots.csv` en `%LOCALAPPDATA%\Pyme360\benchmarks\` (o `server/benchmark-data/`). La plantilla existe pero datos deben cargarse manualmente.
- **Integración keyring**: Dependencia opcional `py -m pip install -r server/requirements-sync.txt` para almacenamiento seguro de credenciales en Windows.

### ❌ Faltantes / Pendientes de Configurar:
- **Variables de entorno `.env`** en `server/cloud/` — falta `DATABASE_URL`, `PUBLIC_BASE_URL`, `SMTP_HOST/USER/PASSWORD`, `SMTP_FROM` (necesarios solo para modo producción con cuentas reales)
- **Credenciales del proveedor e-invoicing** — el adaptador está implementado, pero no hay credenciales ni endpoint de un proveedor certificado configurados en `server/.env`; por eso la app no transmite por defecto.
- **Dominio y HTTPS** — para producción: "No configures una instancia de producción sin TLS"
- **Soporte multiempresa** — actualmente una sola empresa por instalación local

## 6. Convenciones de Código, Pruebas y Despliegue

### Convenciones de Código:
- **Tailwind CSS v4**: Configuración totalmente en `src/tailwind.css` mediante `@import "tailwindcss"` y bloque `@theme inline` — no se necesita `tailwind.config.js`. Tokens de marca en `:root` (verde pino `#176443`) y tema oscuro `:root[data-theme="dark"]`.
- **Temas**: Sistema → Light → Dark; preferencia guardada en `localStorage` con clave `pyme360.theme`; al volver a "Sistema" se retoma preferencia del dispositivo.
- **Manejo de dinero**: Todos los valores monetarios en pesos colombianos enteros (`Math.round()`), formato `Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })`.
- **Fechas**: Formato ISO (`YYYY-MM-DD` en código, `DD/MM/YYYY` en pantalla con `Intl.DateTimeFormat("es-CO")`).
- **UUIDs**: Generados con `crypto.randomUUID()`; identificadores de entidad en la API central siguen patrón UUID.
- **Manejo de errores**: Clase personalizada `BusinessError` en `frontend/src/domain/business.ts`; las operaciones lanzan este error cuando falla una validación.
- **Estado inmutable**: `structuredClone(state)` + patrón de mutación en `frontend/src/domain/business.ts`; `frontend/src/infrastructure/storage.ts` usa `migrateAppState()` para migraciones.
- **Convenciones de nomenclatura**:
  - Variables: camelCase
  - Componentes React: PascalCase (AppForm, ProductForm)
  - Constantes: UPPER_SNAKE_CASE (DEFAULT_EMISSION_FACTORS, MAX_SUPPLIER_XML_BYTES)
  - Tipos/Interfaces: PascalCase (AppState, Product, Sale)
  - Funciones auxiliares: camelCase (formatMoney, formatNumber, today)

### Pruebas Existentes:
- **Ubicación**: `server/tests/` directory
- **Cobertura**:
  - `test_electronic_invoicing.py` — Parsing de XML UBL, validación de metadatos, rechazo DTD/oversized, configuración del conector, payload idempotente, transmisión simulada, transmisión HTTP real contra un proveedor de prueba, actualización de estado, reintentos con la misma clave y permisos por rol
  - `test_electronic_invoicing_transport.py` — Transporte HTTP real: encabezado Bearer, `Idempotency-Key`, codificación de la referencia, mensajes de error del proveedor, rechazo de redirecciones, respuesta no JSON, respuesta sobredimensionada y carga de `server/.env`
  - `provider_stub.py` — Servidor HTTP local de prueba (no es un proveedor real) usado por las pruebas de transporte
  - `test_environment_benchmarks.py` — Cálculo de métricas ambientales, indicadores, metas, factores de emisión
  - `test_sync_local.py` — Sincronización local, migraciones, conflictos
- **Comandos**: `python -m unittest discover -s server/tests -v`
- **Las pruebas no llaman a un proveedor real**: la transmisión simulada usa un stub HTTP local en `127.0.0.1` y verifica encabezados, transmisión, persistencia y permisos; no se envía nada a Internet

### Herramientas de Despliegue:
- **Desarrollo local**:
  ```sh
  # Servidor local Python (SQLite)
  py -3 server/serve-local.py --no-browser

  # Vite frontend
  npm run dev  (desde frontend/)

  # Formato
  npm run format / npm run format:check
  ```
- **API Central (cloud)**:
  ```sh
  docker compose up --build  (desde server/cloud/)
  # API en http://127.0.0.1:8000
  # Health check: http://127.0.0.1:8000/health
  ```
- **Producción**: Requiere HTTPS reverse proxy, SMTP configurado, `PUBLIC_BASE_URL` con TLS, secretos en gestor de secretos del entorno
- **Backups**: Copias diarias SQLite (7 últimas), respaldos JSON descargables, exportación Excel por módulo

## 7. Archivos/Pasos Clave para Continuar Trabajo

### Si se va a continuar desarrollo:
1. **Configurar el proveedor e-invoicing**: copiar `server/.env.example` a `server/.env`, definir `PYME360_EINVOICE_PROVIDER`, `BASE_URL`, `API_KEY` y ambiente según la API documentada del proveedor certificado. El identificador debe coincidir con el guardado en Configuración tributaria. Probar primero en ambiente `test`.
2. **Revisar migraciones pendientes**: Las migraciones hasta v7 en `frontend/src/infrastructure/storage.ts` conservan ventas existentes pero dejan productos históricos como "Por clasificar" tributariamente — revisar con RUT y asesoría contable
3. **Cargar datos de benchmark**: Colocar `official_snapshots.csv` en la carpeta correcta y configurar `environmentalConfig.benchmarking.preferredSources`
4. **Probar sincronización cloud**: Levantar `docker compose up --build` y conectar la instancia local en el panel de sincronización
5. **Validar pruebas**: Ejecutar `python -m unittest discover -s server/tests -v` para asegurar que los cambios no rompan funcionalidades existentes

### Advertencias Explicitas (no suposiciones):
- **La app no guarda certificados ni credenciales DIAN** — el adaptador lee la configuración de `server/.env`; el identificador debe coincidir con el perfil tributario. Sin un proveedor certificado configurado, la app no transmite.
- **El adaptador es genérico, no un conector certificado específico** — espera un endpoint JSON documentado por el proveedor. Si el proveedor exige XML UBL firmado o un esquema propio, hay que adaptar el payload en `server/electronic_invoicing.py`.
- **El XML UBL se descarta después de extraer datos** — solo se conservan los metadatos parseados en `SupplierInvoiceDocument`
- **Las cantidades monetarias son enteros en COP** — no hay manejo de decimales; el IVA es configurable por el usuario
- **La sincronización central no sustituye SQLite** — si Internet falla, la interfaz local guarda en el computador y marca cambios como pendientes
- **Las cuentas central y local son credenciales distintas** — una invitación crea la membresía central; para operar sin conexión, el administrador debe crear también una cuenta local con el mismo correo/identificador y rol
- **No es contabilidad de partida doble** — el control financiero es interno en COP; no realiza conciliación banciera formal ni asientos contables

---
*Análisis basado en la exploración de este repositorio.*