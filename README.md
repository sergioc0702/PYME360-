# Pyme360

Pyme360 es un ERP local para una pyme manufacturera colombiana. Incluye una interfaz React/TypeScript, servidor Python, base SQLite, usuarios locales, permisos y respaldos. Los datos de negocio se quedan en el computador y los libros de Excel se procesan localmente.

## Abrir Pyme360

Haz doble clic en `Abrir Pyme360.bat`. Se abre una ventana negra y después el navegador con la aplicación. Deja esa ventana abierta mientras trabajas; al cerrarla, Pyme360 se detiene.

Necesitas Python 3.11 o superior. La primera vez también necesitas Node.js 22 o superior, porque el lanzador prepara la pantalla por su cuenta; esa primera apertura tarda unos minutos. Después solo vuelve a compilar si cambió el código.

La primera apertura pide crear el administrador. La base SQLite y los respaldos se guardan fuera del programa, en `%LOCALAPPDATA%\Pyme360\`. Actualizar el código o mover la carpeta no mueve ni elimina los datos.

En macOS usa `Abrir Pyme360.command` y en Linux `Abrir-Pyme360.sh`.

Inicia siempre Pyme360 con el lanzador: la base SQLite solo está disponible a través del servidor local. La selección del recibo se hace desde el navegador; el archivo se procesa localmente y no se conserva.

La edición activa guarda los datos en SQLite en este equipo. Google Drive puede recibir copias cifradas de recuperación. No hace falta PostgreSQL para instalar ni usar Pyme360.

## Repositorio y publicación en GitHub

El código fuente se mantiene en [sergioc0702/PYME360-](https://github.com/sergioc0702/PYME360-). Para obtener una copia de desarrollo:

```sh
git clone https://github.com/sergioc0702/PYME360-.git
cd PYME360-
```

El repositorio incluye la interfaz React, el servidor local, las pruebas, y la documentación. Conserva `frontend/public/vendor/receipt-reader`: contiene las librerías locales que necesita la lectura de recibos. `.gitignore` excluye SQLite, `.env`, respaldos, dependencias, ejecutables generados y artefactos de compilación. No fuerces esos archivos con `git add -f`.

Este es un proyecto local, no un servicio web alojado. **Subirlo a GitHub no permite que varios usuarios compartan automáticamente la misma base de datos.** Google Drive conserva respaldos cifrados; no funciona como base de datos multiusuario.

No subas a GitHub datos reales de clientes, proveedores, facturas o usuarios. La edición activa conserva los datos en SQLite. El prototipo de sincronización central permanece en el repositorio como trabajo de desarrollo, pero está desactivado en la interfaz y no forma parte de esta instalación.

## Flujos disponibles

- Guía de uso paso a paso en [docs/guia-de-uso.md](docs/guia-de-uso.md).

- Inicio con actividad y resumen operativo.
- Registro de ventas de varios productos, descuentos y pagos parciales; inventario y saldo por cobrar se ajustan automáticamente.
- Eliminación de ventas con devolución de existencias y reversión de sus movimientos de dinero; una venta guardada no se edita.
- Seguimiento manual de factura por venta: **Por revisar**, **Registrada por fuera de Pyme360** o **No aplica, según revisión del usuario**, con número y fecha externos opcionales. No determina obligaciones ni transmite documentos a la DIAN.
- La interfaz React también prepara borradores de factura/notas e importa XML UBL de proveedores para revisión. Incluye un adaptador HTTP configurable para un proveedor tecnológico certificado; sin credenciales válidas no transmite y nunca sustituye la aceptación de la DIAN.
- Registro de compras con varios materiales, costos por renglón y actualización de existencias al recibir.
- Clientes de mostrador sin nombre ni datos personales; edición y eliminación de clientes y proveedores con confirmación.
- Recetas por lotes gestionadas desde Producción, con versiones borrador/activa/archivada, cantidad base, rendimiento y materiales; cada orden conserva la versión y el consumo calculado al iniciarse.
- Reposición sugerida desde inventario: propone recuperar el mínimo configurado con una compra pendiente o una orden de fabricación basada en receta activa. Las propuestas requieren revisión y confirmación del usuario.
- Conteos físicos que calculan la diferencia contra el saldo y guardan el ajuste en el libro inmutable de inventario.
- Captura mensual de energía, agua, combustibles, producción, residuos y material aprovechado.
- Lectura local de recibos PDF/JPG/PNG, con extracción de período y consumo para revisar antes de guardar; también admite registro manual.
- Recomendaciones ambientales e indicadores por unidad producida comparados con el historial de la empresa; si falta historial, el sistema indica que está creando una referencia propia.
- Ahorro frente a un mes base en pesos, consumo y CO₂, ajustado por producción cuando hay unidades registradas. Usa el valor pagado de la lectura o del recibo.
- Consumo por producto, repartido según las unidades terminadas en el mes. Es una aproximación.
- Sugerencias basadas en los datos de la empresa, que se pueden agregar al plan de acciones.
- Informe mensual en PDF. Orienta decisiones internas y no es un certificado oficial.
- Referencias públicas para agua y energía desde la API ODS de ONU y la API de XM/Sinergox; comparaciones de intensidad propias solo cuando hay 12 meses completos, producción registrada y conversión de unidades configurada. DANE/SUI/EIA usan snapshots CSV revisados manualmente. Consulta límites y pruebas en [la guía de referencias ambientales](frontend/README.md).
- Registro del origen del dato ambiental confirmado. El recibo original se descarta y no se conserva.
- Contactos y conteos físicos de inventario.
- Espacio **Datos y respaldo** para descargar un libro Excel por hojas, importar `.xlsx`/`.xls` (con plantilla en el asistente) y crear o restaurar un respaldo JSON completo.
- Reconocimiento de archivos desordenados (.xlsx, .xls y .csv): propone la sección de cada hoja y columna por sus títulos y su contenido, crea clientes, proveedores y productos a partir de hojas mezcladas, y deja que el usuario corrija antes de guardar. Las ventas entran sin pagos y las compras con su saldo por revisar.
- Importaciones locales con validación de referencias y conservación de columnas adicionales; los cambios se aplican a SQLite después de confirmar. El asistente es aditivo, omite duplicados, no importa usuarios ni contraseñas y no genera movimientos de inventario o caja a partir de operaciones comerciales importadas.
- Configuración inicial de empresa y creación de productos, materias primas e insumos.
- Tema Sistema, Claro u Oscuro, con preferencia guardada en el navegador.
- Inicio con una lista de pendientes: bajo inventario, compras por recibir, facturas con saldo, órdenes activas y consumos ambientales incompletos.

## Organización del proyecto

```text
Abrir Pyme360.bat   Lanzador de Windows (también hay uno para macOS y otro para Linux)
frontend/           La interfaz: pantallas, reglas del negocio y pruebas
server/             El servidor local: API, permisos, validación y SQLite
docs/               Guía de uso, arquitectura, análisis técnico y estudios de mercado
PRODUCT.md          Para quién es Pyme360 y qué debe lograr
DESIGN.md           Reglas visuales de la interfaz
```

El detalle de cada carpeta y el recorrido de un cambio desde la pantalla hasta SQLite están en [docs/arquitectura.md](docs/arquitectura.md). La guía para usuarios está en [docs/guia-de-uso.md](docs/guia-de-uso.md).

El servidor sirve la compilación de `frontend/dist/` y mantiene la API local y los datos SQLite externos al repositorio.

## Alcance del almacenamiento

La aplicación usa SQLite y un servidor accesible únicamente desde el mismo computador. El servidor mantiene copias diarias locales y puede enviar respaldos cifrados a Google Drive. Una instalación recuperada desde Drive requiere restaurar el archivo; no hay edición simultánea desde varios equipos.

El prototipo de API central de `server/cloud/` sigue disponible para desarrollo, pero la edición activa no lo usa. La emisión electrónica se delega a un proveedor tecnológico certificado mediante el adaptador configurable de `server/electronic_invoicing.py`; Pyme360 no firma ni valida por sí mismo ante la DIAN, y la contabilidad formal de partida doble queda fuera de esta versión. Pyme360 puede preparar borradores tributarios e importar XML de proveedores para revisión. Las referencias ambientales incluyen ONU ODS y contexto del sistema eléctrico de XM, más archivos revisados manualmente DANE/SUI/EIA; no son telemetría de la planta.

La extracción de recibos es una ayuda que puede equivocarse y requiere confirmación humana. Los datos de la opción de ejemplo son ficticios. El indicador ODS 7.3.1 muestra datos públicos anuales de intensidad energética de la economía por PIB, para el mundo y Colombia cuando estén disponibles. Es contexto agregado, no un consumo objetivo por producto o empresa. La demo permite definir metas propias de reducción de energía y agua por unidad producida, calculadas a partir de tres períodos anteriores registrados; no son mínimos universales. La precisión del OCR aún debe medirse con recibos anonimizados de distintos proveedores.

La demo tampoco se conecta en tiempo real a medidores o cuentas de energía y agua. Una integración de cuenta dependerá de que el proveedor ofrezca una API autorizada para ese servicio. La consulta de XM informa operación agregada del sistema eléctrico, no el consumo de la empresa.

La guía de las referencias externas, sus limitaciones, los archivos oficiales versionados y las pruebas locales está en [frontend/README.md](frontend/README.md) y [server/benchmark-data/README.md](server/benchmark-data/README.md).

La facturación DIAN requiere un proveedor tecnológico autorizado: Pyme360 incluye el adaptador HTTP y su configuración local, pero no sustituye la certificación, la firma ni la aceptación del proveedor.

## Datos locales y reinicio

La aplicación guarda el negocio en SQLite dentro de la carpeta de datos del usuario, fuera del repositorio. En Windows suele ser `%LOCALAPPDATA%\Pyme360\pyme360.sqlite3`; en macOS, `~/Library/Application Support/Pyme360/pyme360.sqlite3`; en Linux, `$XDG_DATA_HOME/pyme360/pyme360.sqlite3` o `~/.local/share/pyme360/pyme360.sqlite3`. La aplicación muestra **Guardando** y después **Guardado en este equipo** solo cuando SQLite confirma el cambio. Si otra pestaña ya guardó una revisión más nueva, pide recargar.

La importación Excel y la restauración del respaldo preparan el estado completo y lo guardan en una transacción. Si el servidor falla, el cambio no reemplaza la última versión guardada. En **Datos y respaldo** puedes descargar un respaldo JSON y restaurarlo con vista previa. El servidor conserva hasta siete copias diarias junto a la base; esas copias están en el mismo computador. Para iniciar de cero, cierra Pyme360, haz una copia del archivo SQLite y elimina la base y los archivos auxiliares `-wal` y `-shm` de esa carpeta; al volver a abrir se crea una base vacía. Hazlo solo si ya exportaste los datos que quieras conservar.
