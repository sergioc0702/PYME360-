# Pyme360 · Modelo React y TypeScript

Interfaz React/TypeScript local para Pyme360. En Windows puede ejecutarse desde el navegador durante el desarrollo o como aplicación de escritorio portable. La base SQLite queda fuera de la carpeta del programa, en los datos del usuario; el servidor local solo acepta conexiones del computador.

## Uso de escritorio en Windows

Descarga `Pyme360.exe` desde GitHub **Releases** y ejecútalo. Es portable, no requiere instalación, Node.js ni una terminal para el uso diario, y abre en una ventana propia. Windows debe tener Microsoft Edge WebView2 Runtime. La primera ejecución solicita crear el administrador.

La base SQLite se crea en `%LOCALAPPDATA%\Pyme360\pyme360.sqlite3`, separada del ejecutable. Puedes mover o reemplazar `Pyme360.exe` sin mover los datos; no copies una base de datos dentro de la distribución. Los respaldos JSON se descargan desde **Datos y respaldo**.

Para construir el ejecutable desde Windows, instala Python 3.11+, Node.js 22+ y WebView2 Runtime. Desde la raíz del repositorio ejecuta:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\desktop\build-executable.ps1
```

El resultado es `outputs/releases/Pyme360.exe`. PyInstaller y pywebview se instalan en un entorno aislado bajo `.build/desktop/`; el ejecutable contiene la interfaz, el servidor y los recursos estáticos, pero no la base SQLite ni secretos. La guía general está en el [README raíz](../README.md).

## Desarrollo en navegador

- Python 3.11 o superior para ejecutar el servidor local y SQLite.
- Node.js 22 o superior y npm para instalar dependencias y compilar la interfaz.
- Un navegador moderno.

## Preparar y ejecutar en Windows

Desde esta carpeta, instala las dependencias una vez:

```sh
npm install
```

Después, haz doble clic en `Iniciar Pyme360.vbs`. El lanzador compila la interfaz y abre el modelo en el navegador sin mostrar una terminal. Requiere Node.js en `C:\Program Files\nodejs` y `py` o `python` disponible en Windows.

Para compilar manualmente:

```sh
npm run build
```

La interfaz compilada queda en `dist/`; el servidor local la entrega en `/typescript-model/`. El lanzador vuelve a compilar antes de abrirla.

## Desarrollo de la interfaz

La interfaz usa Tailwind CSS v4 con el plugin oficial de Vite. Sus utilidades se generan durante la compilación y no agregan código de estilos en tiempo de ejecución. No se necesita `tailwind.config.js`: `src/tailwind.css` contiene el `@import`, los tokens de marca y tema y los estilos base.

La navegación agrupa módulos en una barra lateral contraíble de 272/72 px en escritorio, con el botón **Expandir menú**. En móvil se abre como menú y añade accesos inferiores a Inicio, Ventas e Inventario, con el resto bajo **Más**. Los listados operativos y financieros cambian de tablas a tarjetas para que las acciones y los datos principales se lean sin desplazamiento horizontal. El apartado ambiental conserva tablas anchas donde hacen falta comparaciones detalladas. Ventas y documentos tributarios se consultan en secciones separadas para evitar una pantalla excesivamente larga.

El tema oscuro usa superficies grises y reserva el verde pino para acentos; el tema claro mantiene la identidad natural. La interfaz respeta la preferencia del sistema, permite elegir Sistema/Claro/Oscuro y anima los cambios de forma breve. Los tokens semánticos de ambos temas viven en `:root` y `:root[data-theme="dark"]` de `src/tailwind.css`. La escala prioriza texto base de 17 px, datos tabulares de 15 px, etiquetas y metadatos de 13 px, y encabezados de 20 a 36 px. En pantallas pequeñas, las acciones principales y controles de formulario disponen de áreas táctiles de 44 px como objetivo de usabilidad; WCAG 2.1 AA exige reflujo a 320 px y contraste de 4.5:1 para texto normal (3:1 para texto grande), mientras que la guía de tamaño táctil de 44 px corresponde al criterio AAA. La preferencia de contracción de navegación se conserva en el navegador.

Los logos completos para cada tema están en `public/pyme360-logo-light.png` y `public/pyme360-logo-dark.png`; las versiones compactas para la barra lateral y el favicon usan `public/pyme360-mark-light.png` y `public/pyme360-mark-dark.png`. `src/shared/BrandLogo.tsx` selecciona la variante visible según el tema activo.

Para cambiar colores de marca y superficies, edita los tokens de `:root` y `:root[data-theme="dark"]` en `src/tailwind.css`. Para un estilo puntual de componente, usa utilidades directamente en JSX; conserva CSS propio solo cuando una regla global, una interacción compleja o un valor dinámico resulte más claro allí.

### Mapa del código

- `src/main.tsx` inicia React y aplica el tema; `src/app/` compone el espacio de trabajo, las pantallas, los formularios y la navegación.
- `src/domain/` contiene entidades, tipos y reglas de negocio compartidas (`business.ts`, `costing.ts`, `environmental.ts`).
- `src/features/` agrupa cada capacidad por dominio: ambiente, facturación electrónica, hojas de cálculo y sincronización.
- `src/infrastructure/` contiene adaptadores a la API local, autenticación, persistencia SQLite y carga de recursos locales.
- `src/shared/` contiene formato y componentes visuales reutilizados, como `BrandLogo`.
- `tests/` valida reglas de negocio, migraciones de datos e importación/exportación.
- `index.html` declara los recursos estáticos. Sus rutas usan la base configurada en Vite para que funcionen tanto en desarrollo como bajo `/typescript-model/`.

En una terminal, inicia primero el servidor desde la carpeta principal:

```sh
py -3 server/serve-local.py --no-browser
```

En otra terminal, inicia Vite desde `typescript-model/`:

```sh
npm run dev
```

Ejecuta `npm run format` para formatear el código mantenido y `npm run format:check` para comprobar el formato sin modificar archivos.

Vite reenvía la API local —incluida la sincronización— a `127.0.0.1:8765`. Si el servidor Python informa otro puerto, configúralo antes de iniciar Vite; por ejemplo, en PowerShell:

```powershell
$env:PYME360_API_PORT = "8766"
npm run dev
```

## Conector de facturación electrónica

El adaptador HTTP es opcional y no viene con credenciales. Para habilitarlo, copia `server/.env.example` a `server/.env`, completa `PYME360_EINVOICE_PROVIDER`, `BASE_URL` y `API_KEY` con los datos que entregue el proveedor tecnológico certificado, y reinicia el servidor local. El identificador debe coincidir con **Ventas → Configuración tributaria → ID del proveedor tecnológico**. Empieza con `PYME360_EINVOICE_ENVIRONMENT=test`; producción exige HTTPS. Sin un `.env` válido, la aplicación solo prepara borradores y no transmite.

## Almacenamiento y respaldos

- Los cambios se guardan en `pyme360.sqlite3`, en la carpeta local de datos del usuario. En Windows suele ser `%LOCALAPPDATA%\Pyme360\pyme360.sqlite3`.
- El modelo guarda su estado en la tabla `typescript_model_state`.
- Cada guardado aumenta una revisión. Si otra pestaña ya guardó una versión más reciente, la aplicación la carga y avisa antes de permitir seguir con la versión desactualizada.
- El servidor crea copias diarias de SQLite y conserva las siete más recientes. Estas copias están en el mismo computador.
- **Datos y respaldo** permite descargar y restaurar un JSON. Guarda una copia en otro medio para cubrir la pérdida del computador.
- Desde **Datos y respaldo** también se descarga un libro Excel `.xlsx`, con hojas separadas por módulo, incluida la configuración tributaria, borradores/notas y facturas de proveedores importadas. El respaldo JSON sigue siendo la copia completa de restauración.
- La primera vez se crea una cuenta `admin`. Desde **Usuarios**, un administrador puede crear cuentas `admin`, `operator` (trabajo corriente) o `viewer` (solo consulta), cambiar roles y revocarlas. Las cuentas, sesiones y permisos se validan en el servidor local y se guardan en SQLite.
- En **Impacto ambiental** puedes abrir el portal de Enel Colombia, descargar un recibo y seleccionarlo desde el navegador. El PDF/JPG/PNG se procesa localmente con extracción de texto/OCR, muestra una vista previa y solo guarda los valores confirmados, nunca el archivo original.
- **Referencias externas ambientales:** la pantalla permite actualizar indicadores ODS de la ONU y datos operativos agregados del SIN consultados en XM/Sinergox. Se guardan en una caché SQLite separada del estado comercial, válida durante 24 horas; si falla una actualización se conserva y marca la última respuesta. La primera carga solo lee la caché; pulsa **Actualizar datos** para consultar las fuentes. Usuarios `admin` y `operator` pueden actualizar; `viewer` puede consultar.
- En **Ventas**, un operador puede preparar un borrador electrónico desde una venta. El borrador guarda una instantánea de cliente, productos, valores e impuestos; no reserva numeración ni se considera emitido. El botón **Solicitar emisión** permanece deshabilitado hasta configurar el conector y corregir las alertas tributarias. Las notas crédito/débito pueden prepararse a partir de una factura aceptada o entregada cuando exista ese estado.
- Un administrador configura en Ventas los datos tributarios, numeración, ambiente e identificador del proveedor. La aplicación no guarda certificados ni credenciales en SQLite: el conector se configura en `server/.env` (copia `server/.env.example`). El adaptador es neutro y envía el borrador como JSON al endpoint documentado de un proveedor tecnológico certificado; ese proveedor sigue siendo responsable del XML UBL, la firma DIAN y la numeración. Sin credenciales válidas la transmisión se rechaza y la API lo indica. Usa HTTPS y `PYME360_EINVOICE_ENVIRONMENT=production` solo con un proveedor real. Los estados y referencias devueltos se guardan en SQLite local; la API central sigue almacenando solo borradores y no recibe estados DIAN.
- La API local expone `GET /api/v1/e-invoicing/provider-status`, `GET /api/v1/e-invoicing/documents/{id}/status`, `POST /api/v1/e-invoicing/documents/{id}/submit` y `POST /api/v1/e-invoicing/supplier-invoices/preview`. Requieren sesión; vista previa/envío requieren `admin` u `operator`. El envío usa una clave de idempotencia estable derivada del documento y de su contenido, así que reintentar el mismo borrador no crea una segunda factura en el proveedor; además guarda el intento y la respuesta, y rechaza ambientes que no coincidan. `viewer` puede consultar el estado, pero no guarda cambios.
- **Recetas de producción:** abre **Producción → Recetas** para crear fórmulas por lote para un producto terminado. Cada versión define cantidad base, rendimiento esperado y materiales en las unidades de inventario; se guarda primero como borrador y luego puede activarse. Al crear una orden, Pyme360 muestra materiales requeridos, existencias, faltantes, costo directo estimado y salida esperada. La orden fija la versión y el consumo usados; después se registra la merma real al completarla. Administradores y operadores gestionan las recetas; consulta puede verlas. Inventario ofrece un acceso directo a la receta del producto.
- El XML UBL de factura de proveedor puede revisarse desde **Ventas → Importar XML proveedor**. Se admiten `Invoice` y `AttachedDocument` con la factura UBL incluida, hasta 2 MB. El servidor local extrae datos y líneas para previsualizar y descarta el XML. Al confirmar, se puede dejar pendiente o vincular a una compra del mismo proveedor, solo en COP y si coincide el NIT del adquirente. No crea pagos, asientos ni movimientos de inventario.
- La migración de estado v1–v6 a v7 conserva los registros y las órdenes históricas. Las recetas antiguas guardadas dentro de un producto se convierten en la versión 1 activa, con lote base de una unidad y rendimiento del 100 %; los productos sin receta siguen sin receta. Los productos históricos quedan “Por clasificar” tributariamente en vez de inferir si están gravados, exentos o excluidos; revisa sus datos con el RUT y asesoría contable antes de una futura emisión.
- La integración nacional DANE/EAI, SUI y la internacional EIA/MECS acepta snapshots revisados manualmente en CSV UTF-8. No se descargan ni reinterpretan automáticamente los archivos publicados: el usuario debe registrar unidades, periodo, denominador y fuente en `official_snapshots.csv`, ubicado en `%LOCALAPPDATA%\\Pyme360\\benchmarks\\` en Windows. La plantilla y reglas están en `server/benchmark-data/README.md`.
- El perfil inicial se configura en **Impacto ambiental → Configurar**: Colombia, Antioquia, CIIU 1104 y producción supuesta de 100.000 L/mes. Ese volumen se muestra solo como supuesto. Para comparar una intensidad propia anual por litro debes definir en cada producto terminado cuántos litros representa una unidad de inventario, registrar exactamente una lectura mensual completa de agua/energía durante los 12 meses y tener producción completada en ese año. Si falta una parte, el valor se muestra como no disponible.
- Las brechas se calculan como `(intensidad de la empresa / referencia − 1) × 100` únicamente para observaciones anuales con unidad y denominador compatibles y marcadas como directas. ODS y XM aparecen como contexto agregado; no son consumos de una planta. El mejor dato público empresarial mostrado es la relación de agua de Coca-Cola de 2024 (1,78 L/L), con los límites de alcance indicados en pantalla; no se presenta como mínimo universal ni meta normativa.

### Actualizar y mantener referencias ambientales

No se instala ninguna dependencia adicional para el servidor: las llamadas HTTP y la caché usan la biblioteca estándar de Python. Desde la pantalla ambiental usa **Actualizar datos**. También están disponibles, con una sesión iniciada, `GET /api/v1/environment/benchmarks` (consulta) y `POST /api/v1/environment/benchmarks/refresh` (actualización; requiere `admin` u `operator`). La primera consulta lee la caché sin hacer esperar al usuario; las peticiones externas se ejecutan al pulsar actualizar. La caché vence en 24 horas y cada fuente tiene un intervalo mínimo de actualización manual de 5 minutos. Las conexiones externas solo se hacen desde el servidor local. No se guardan credenciales externas ni se envían lecturas internas a los proveedores.

Para validar adaptadores sin depender de la red ejecuta desde la carpeta principal:

```sh
python -m unittest discover -s server/tests -v
```

Los valores DANE/SUI/EIA deben actualizarse solo después de verificar la publicación primaria, su versión, unidad, sector, geografía, periodo y denominador. Si una fuente cambia de esquema, el adaptador muestra el error y conserva el dato cacheado; no convierte datos faltantes en cero. Las consultas de XM/ODS tampoco son telemetría de la instalación.

- Si la tabla del modelo está vacía y existe el formato anterior en el mismo origen del navegador, el lanzador intenta migrarlo sin borrar la copia del navegador. Los puertos distintos tienen almacenamientos de navegador distintos; si venías usando la versión Vite, descarga su respaldo JSON y restáuralo en el modelo abierto con el lanzador.

Fuentes revisadas el 23 de octubre de 2026:

- [UNSD SDG API](https://unstats.un.org/SDGAPI/swagger/): indicadores ODS 6.4.1, 6.4.2 y 7.3.1; son estadísticas macro de eficiencia/estrés hídrico e intensidad energética por PIB, no intensidad de una fábrica. La API documenta observaciones por país, año y dimensiones.
- [XM/Sinergox API oficial y repositorio de uso](https://github.com/EquipoAnaliticaXM/API_XM): consulta contextual de demanda del Sistema Interconectado Nacional. La API usa HTTPS y no requiere cuenta; su dato agregado no representa el consumo eléctrico de Pyme360.
- [DANE · EAI](https://www.dane.gov.co/index.php?id=1048%3Ade&option=com_content&view=article): estadística anual de establecimientos manufactureros. La publicación vigente consultada contiene resultados 2024; es una estadística agregada, no una API específica de intensidad CIIU 1104.
- [Superservicios · SUI Energía](https://sui.superservicios.gov.co/Reportes-del-sector/Energia): información de consumo y facturación agregada por prestador, región y municipio. No equivale a consumo por litro de bebida.
- [EIA · MECS 2022](https://www.eia.gov/consumption/manufacturing/data/2022/): encuesta cuatrienal de energía manufacturera de Estados Unidos; los cuadros finales del ciclo 2022 se publicaron en 2026. Sirve de referencia internacional contextual, no sustituye una intensidad comparable de Colombia.
- [Coca-Cola · Environmental Update 2024](https://www.coca-colacompany.com/content/dam/company/us/en/reports/2024-environmental-update/2024-environmental-update.pdf): el cociente del sistema reportado fue 1,79 L/L en 2022 y 1,78 L/L tanto en 2023 como en 2024. Pyme360 muestra 1,78 como el menor valor de esa serie trienal publicada; el alcance del sistema Coca-Cola incluye embotelladores y socios según los límites del informe, por lo que no es un mínimo universal.

## Organización

El código está agrupado por responsabilidad. Para seguir un flujo, comienza en la interfaz correspondiente y continúa en las reglas de negocio o el servicio que utiliza:

- **Interfaz:** `src/app/` compone la sesión, navegación, vistas, formularios y pantallas de dominio.
- **Modelo y reglas:** `src/domain/` define tipos, operaciones, costos y cálculos ambientales.
- **Persistencia y acceso:** `src/infrastructure/` gestiona SQLite mediante la API local, revisiones, migraciones, respaldos JSON y autenticación.
- **Hojas y recibos:** `src/features/spreadsheets/` normaliza importaciones y genera libros; `src/features/environment/consumption.ts` interpreta la extracción local de recibos.
- **Facturación:** `src/app/screens/ElectronicInvoicing.tsx` contiene la interfaz; `src/features/invoicing/electronic-invoicing.ts` llama a la API local; `server/electronic_invoicing.py` define el contrato, parser UBL y adaptador configurable.
- **Sincronización:** `src/features/synchronization/` contiene el cliente local de la API central; su pantalla está en `src/app/screens/CloudSyncPanel.tsx`.
- **Arranque y recursos:** `src/main.tsx` monta React; `src/tailwind.css`, `index.html` y `vite.config.ts` configuran la entrada web; `Iniciar Pyme360.vbs` es solo un lanzador de desarrollo.
- **Recursos de terceros:** los lectores y licencias incluidos están en `public/vendor/`; se conservan separados de la lógica de la aplicación. `xlsx.full.min.js` es SheetJS Community Edition 0.20.3, descargada de `https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js`.

## Flujos incluidos

- Empresa y contactos de clientes y proveedores.
- Productos, materias primas, insumos, recetas y ajustes de existencias.
- **Inventario → Reposición sugerida** propone la cantidad necesaria para recuperar el mínimo configurado. Los materiales abren una compra pendiente prellenada; los productos terminados abren una orden si tienen receta activa. El usuario revisa y confirma; no se crean órdenes automáticamente.
- El botón **Conteo** compara la cantidad física con el saldo y registra la diferencia como un movimiento de ajuste trazable. Si las cantidades coinciden, no crea un movimiento.
- Ventas con varios productos, descuentos, IVA configurable y abonos.
- Compras recibidas o pendientes.
- Órdenes de producción con consumo de materiales, registro de desperdicio y un estimado trazable del costo directo de materiales. El importe usa los costos unitarios de catálogo capturados al iniciar la orden; no incluye mano de obra, energía ni costos indirectos y queda como no disponible si falta algún costo.
- Captura ambiental mensual e indicadores por unidad producida.
- Respaldo JSON descargable y restaurable.
- Importación aditiva de Excel desde **Datos y respaldo → Importar archivo Excel**. Permite elegir hoja, encabezados y módulo, revisar filas válidas, errores, referencias pendientes y duplicados antes de confirmar.
- **Descargar plantilla** genera un libro vacío con los encabezados esperados.
- **Catálogo de muestra adaptado** descarga 12 referencias basadas en UCI Online Retail para practicar el mapeo de columnas. Los valores COP, existencias e IVA son ilustrativos; la procedencia y las notas se conservan como campos adicionales. La fuente y licencia CC BY 4.0 se documentan junto al archivo en `public/sample-data/`.
- Tema **Sistema** (predeterminado, sigue la preferencia del sistema operativo), **Claro** u **Oscuro**. La selección manual queda guardada en el navegador; al volver a **Sistema**, se retoma la preferencia del dispositivo.

En la barra superior, abre el selector **Tema** y elige **Sistema**, **Claro** u **Oscuro**. Para verificar el modo automático, selecciona **Sistema** y cambia la apariencia del sistema operativo o la emulación `prefers-color-scheme` del navegador. Claro y oscuro se aplican también a la pantalla de inicio de sesión.

Las cantidades de dinero se expresan en pesos colombianos enteros. El cálculo de IVA actual sigue siendo configurable; preparar un borrador no emite una factura ni conecta con la DIAN. La transmisión podrá habilitarse cuando se seleccione un proveedor tecnológico y se implemente su adaptador con la API documentada.

## Abrir y administrar la base SQLite

En Windows, la base se encuentra normalmente en:

```text
%LOCALAPPDATA%\\Pyme360\\pyme360.sqlite3
```

Las copias automáticas están en `%LOCALAPPDATA%\\Pyme360\\backups\\`. Puedes abrir la base con [DB Browser for SQLite](https://sqlitebrowser.org/). Cierra Pyme360 antes de editarla manualmente; para cambios normales usa la interfaz o restaura un respaldo JSON desde **Datos y respaldo**.

Si aparece “no se pudo validar la sesión”, comprueba que el servidor local siga abierto y recarga la página desde el lanzador.

## Importación recomendada de Excel

1. Inicia Pyme360 con `Iniciar Pyme360.vbs`.
2. Entra con un usuario `admin` u `operator`.
3. Abre **Datos y respaldo → Importar archivo Excel**.
4. Selecciona un `.xlsx` o `.xls` de hasta 10 MB y 10.000 filas.
5. Revisa el mapeo, las referencias pendientes y los duplicados.
6. Confirma el lote; las filas válidas se agregan y las demás se informan.

La lectura ocurre dentro del navegador. El archivo no se sube ni se conserva. Las columnas desconocidas se guardan como **Datos adicionales**.

## Cuenta de empresa y sincronización opcional

El trabajo habitual sigue funcionando localmente. En **Administración → Nube y sincronización**, el primer administrador puede crear el espacio de empresa, verificar su correo y vincular una base local. Al vincular una base con datos, Pyme360 crea primero una copia `pyme360-before-cloud-<fecha>.sqlite3`. La cola local guarda los cambios como provisionales hasta que el servidor los confirme. El servidor agrupa cambios relacionados en lotes idempotentes; si detecta que otro usuario cambió el mismo registro, conserva el conflicto para resolverlo. Cada vínculo de cuenta central se asocia a un usuario local y a su rol, y sus errores de sesión se muestran por usuario. Al volver la red, la aplicación sincroniza automáticamente o puedes usar **Sincronizar ahora**.

Si la API central rechaza un lote por datos incompatibles, el panel muestra el motivo y mantiene los cambios en SQLite. Corrige el registro desde su módulo y usa **Reconstruir y reintentar lote**; la aplicación combina las correcciones posteriores en un único lote idempotente. No se envían cambios nuevos hasta resolver el lote bloqueado.

La cuenta de nube y la cuenta local son credenciales distintas en esta transición. Una invitación crea la membresía central; para operar sin conexión, el administrador también debe crear en **Usuarios** una cuenta local con el mismo correo/identificador y rol. Los roles deben coincidir para que se acepten cambios. El token central se guarda opcionalmente en el almacén seguro del sistema operativo (`keyring`); sin ese paquete, instala la dependencia opcional indicada abajo. No guardes tokens en respaldos ni en archivos del proyecto.

El cliente local solo acepta URLs HTTPS, excepto en `localhost`. No configures una instancia de producción sin TLS. Este repositorio incluye una API FastAPI y PostgreSQL desplegable, pero Pyme360 no aprovisiona alojamiento, dominio ni servicio de correo. Consulta [server/cloud/README.md](../server/cloud/README.md) antes de conectar datos reales a una instancia pública.

### Iniciar la API central en desarrollo

Requiere Docker Desktop con Compose. Desde `server/cloud/`:

```sh
docker compose up --build
```

Esto inicia PostgreSQL y la API en `http://127.0.0.1:8000`. En desarrollo, el registro devuelve una URL de verificación de correo; esa comodidad está deshabilitada en producción. Para conectar el cliente en el mismo computador, usa esa URL en el panel. El entorno de desarrollo no reemplaza SMTP ni HTTPS.

Para añadir soporte al almacén seguro de credenciales del sistema, desde la carpeta principal ejecuta:

```sh
python -m pip install -r server/requirements-sync.txt
```

`keyring` es opcional para trabajar solo en modo local.

### Revisiones automatizadas

Desde la carpeta principal:

```sh
python -m unittest discover -s server/tests -v
python -m py_compile server/serve-local.py server/sync_local.py server/cloud/app.py
```

Desde `typescript-model/`:

```sh
npm test
npm run lint
npx tsc --noEmit
npm run build
```

La prueba del catálogo abre el archivo Excel publicado por Vite, transforma sus encabezados no estándar en productos Pyme360, verifica los campos adicionales y comprueba que una segunda importación detecte los 12 productos como duplicados.

Las pruebas de TypeScript cubren las reglas principales de ventas, compras y producción. Las pruebas Python incluyen la creación, integridad y restauración de respaldos SQLite aislados de los datos reales de la aplicación.
