# Pyme360

Pyme360 es un ERP local para una pyme manufacturera colombiana. Incluye una interfaz React/TypeScript, servidor Python, base SQLite, usuarios locales, permisos y respaldos. Los datos de negocio se quedan en el computador y los libros de Excel se procesan localmente.

## Ejecutar Pyme360 en Windows

Descarga `Pyme360.exe` desde **Releases** de GitHub y ábrelo. Es una aplicación portable: no instala servicios ni modifica el registro, y puede ejecutarse desde cualquier carpeta con permisos de lectura y escritura. Windows debe tener Microsoft Edge WebView2 Runtime; normalmente viene instalado con Edge. Si falta, instala el Runtime de Microsoft y vuelve a abrir la aplicación.

La primera ejecución solicita crear el administrador. La base SQLite y los respaldos se guardan fuera del programa, en `%LOCALAPPDATA%\Pyme360\`; mover o reemplazar `Pyme360.exe` no mueve ni elimina los datos. No copies una base SQLite dentro del ejecutable o de la carpeta de distribución.

### Construir el ejecutable

En Windows instala Python 3.11 o superior, Node.js 22 o superior y Microsoft Edge WebView2 Runtime. Antes de compilar por primera vez, ejecuta `npm ci` desde `typescript-model/`. Después, desde PowerShell en la carpeta del proyecto, ejecuta:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\desktop\build-executable.ps1
```

El script compila React y crea `outputs/releases/Pyme360.exe` como ejecutable portable de un solo archivo. Las dependencias de compilación quedan en `.build/desktop/`; el ejecutable incluye la interfaz y recursos necesarios, pero no la base de datos ni las credenciales del usuario.

El flujo `.github/workflows/windows-desktop.yml` compila el ejecutable al ejecutarlo manualmente o al publicar un tag `v*`. Para una versión nueva, actualiza `VERSION`, crea el tag coincidente (por ejemplo `v1.0.1`) y súbelo; el flujo publica `Pyme360.exe` en **Releases**.

## Ejecutar desde el código fuente

Los lanzadores de navegador siguen disponibles para desarrollo y macOS/Linux. Requieren Python 3.11 o superior. En Windows, ejecuta `Abrir Pyme360.bat`; en macOS, ejecuta `Abrir Pyme360.command`; en Linux, marca `Abrir-Pyme360.sh` como ejecutable y ábrelo. Para modificar la interfaz React necesitas Node.js; consulta [typescript-model/README.md](typescript-model/README.md).

Inicia siempre Pyme360 con el lanzador: la base SQLite solo está disponible a través del servidor local. La selección del recibo se hace desde el navegador; el archivo se procesa localmente y no se conserva. La interfaz React consulta referencias públicas ODS y datos operativos agregados del sistema eléctrico colombiano desde el servidor local; las lecturas de la empresa no se envían a esas fuentes.

En modo local, los datos permanecen en este equipo. La sincronización central es opcional y requiere infraestructura propia; no hace falta para instalar o usar el ERP local.

## Repositorio y publicación en GitHub

El código fuente se mantiene en [sergioc0702/PYME360-](https://github.com/sergioc0702/PYME360-). Para obtener una copia de desarrollo:

```sh
git clone https://github.com/sergioc0702/PYME360-.git
cd PYME360-
```

El repositorio incluye la interfaz React, el servidor local, las pruebas, la documentación y el código fuente de la aplicación de escritorio. Conserva `typescript-model/public/vendor/receipt-reader`: contiene las librerías locales que necesita la lectura de recibos. `.gitignore` excluye SQLite, `.env`, respaldos, dependencias, ejecutables generados y artefactos de compilación. No fuerces esos archivos con `git add -f`.

Las versiones publicadas aparecen en [GitHub Releases](https://github.com/sergioc0702/PYME360-/releases). El flujo `.github/workflows/windows-desktop.yml` construye y publica `Pyme360.exe` cuando subes un tag `v*` que coincida con `VERSION` (por ejemplo, `VERSION=1.0.1` y tag `v1.0.1`). El ejecutable generado no se versiona dentro del repositorio.

Este es un proyecto local, no un servicio web alojado. **Subirlo a GitHub no permite que varios usuarios compartan automáticamente la misma base de datos.** GitHub Pages solo publica archivos estáticos y no ejecuta `server/serve-local.py`; para cuentas y sincronización entre equipos hay que desplegar la API central, PostgreSQL, correo, HTTPS y copias de seguridad descritos en [server/cloud/README.md](server/cloud/README.md).

No subas a GitHub datos reales de clientes, proveedores, facturas o usuarios. Pyme360 conserva el modo de operación local en SQLite. La interfaz React también incorpora una API central opcional para espacios de empresa y sincronización; requiere configurar PostgreSQL, correo saliente, TLS y alojamiento antes de compartir datos entre equipos. Consulta [typescript-model/README.md](typescript-model/README.md) y [server/cloud/README.md](server/cloud/README.md) para sus límites y puesta en marcha.

## Flujos disponibles

- Guía de uso paso a paso en [docs/GUIA_DE_USO.md](docs/GUIA_DE_USO.md).

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
- Referencias públicas para agua y energía desde la API ODS de ONU y la API de XM/Sinergox; comparaciones de intensidad propias solo cuando hay 12 meses completos, producción registrada y conversión de unidades configurada. DANE/SUI/EIA usan snapshots CSV revisados manualmente. Consulta límites y pruebas en [la guía de referencias ambientales](typescript-model/README.md).
- Registro del origen del dato ambiental confirmado. El recibo original se descarta y no se conserva.
- Contactos y conteos físicos de inventario.
- Espacio **Datos y respaldo** para descargar un libro Excel por hojas, importar `.xlsx`/`.xls` (con plantilla en el asistente) y crear o restaurar un respaldo JSON completo.
- Importaciones locales con validación de referencias y conservación de columnas adicionales; los cambios se aplican a SQLite después de confirmar. El asistente es aditivo, omite duplicados, no importa usuarios ni contraseñas y no genera movimientos de inventario o caja a partir de operaciones comerciales importadas.
- Configuración inicial de empresa y creación de productos, materias primas e insumos.
- Tema Sistema, Claro u Oscuro, con preferencia guardada en el navegador.
- Inicio con una lista de pendientes: bajo inventario, compras por recibir, facturas con saldo, órdenes activas y consumos ambientales incompletos.

## Organización del proyecto

- `typescript-model/` contiene la interfaz React/TypeScript y, en `public/vendor/`, las librerías locales de Excel y lectura de recibos; su lanzador de Windows la compila y abre bajo `/typescript-model/`.
- `server/` contiene el servidor Python local y su lanzador PowerShell.
- `docs/GUIA_DE_USO.md` contiene la guía paso a paso.
- `docs/analysis/ERP_ANALYSIS_SUMMARY.md` contiene el análisis técnico y funcional del proyecto.
- `desktop/` contiene el punto de entrada de la aplicación de escritorio, las dependencias de empaquetado y el script para construir el ejecutable portable.
- Los lanzadores de Windows, macOS y Linux permanecen en la raíz para que sea fácil abrir Pyme360.

El servidor sirve la compilación de `typescript-model/dist/` y mantiene la API local y los datos SQLite externos al repositorio.

## Alcance y sincronización

El modo local usa SQLite y un servidor accesible únicamente desde el mismo computador. El servidor mantiene copias diarias locales; al vincular por primera vez la interfaz React con una empresa central, crea además una copia SQLite previa a la nube.

El proyecto incluye un servicio central opcional en `server/cloud/`, implementado con FastAPI y PostgreSQL. Puede probarse localmente con Docker Compose; ese entorno no constituye un despliegue compartido seguro. Para sincronizar computadores a través de Internet se requiere una instancia PostgreSQL protegida, un dominio HTTPS, un servicio de correo SMTP verificado y copias centrales comprobables. Pyme360 no incluye alojamiento ni crea esos recursos automáticamente.

La cuenta central de nube y el inicio de sesión local son credenciales separadas en esta transición. El administrador se registra y verifica el correo en **Administración → Nube y sincronización**, y luego invita al equipo allí. Para permitir que una persona trabaje sin Internet, el administrador también crea su cuenta local en **Usuarios** con el mismo rol; cada usuario se conecta con su cuenta central en el equipo que vaya a sincronizar. No reutilices contraseñas en ambos registros. Las invitaciones y roles centrales regulan la sincronización; los roles locales continúan regulando el uso offline. El panel muestra la validación de los datos locales y centrales, lotes pendientes y conflictos.

La sincronización está integrada en la interfaz React/TypeScript. La emisión electrónica se delega a un proveedor tecnológico certificado mediante el adaptador configurable de `server/electronic_invoicing.py`; Pyme360 no firma ni valida por sí mismo ante la DIAN, y la contabilidad formal de partida doble queda fuera de esta versión. Pyme360 puede preparar borradores tributarios e importar XML de proveedores para revisión. Las referencias ambientales incluyen ONU ODS y contexto del sistema eléctrico de XM, más archivos revisados manualmente DANE/SUI/EIA; no son telemetría de la planta.

La extracción de recibos es una ayuda que puede equivocarse y requiere confirmación humana. Los datos de la opción de ejemplo son ficticios. El indicador ODS 7.3.1 muestra datos públicos anuales de intensidad energética de la economía por PIB, para el mundo y Colombia cuando estén disponibles. Es contexto agregado, no un consumo objetivo por producto o empresa. La demo permite definir metas propias de reducción de energía y agua por unidad producida, calculadas a partir de tres períodos anteriores registrados; no son mínimos universales. La precisión del OCR aún debe medirse con recibos anonimizados de distintos proveedores.

La demo tampoco se conecta en tiempo real a medidores o cuentas de energía y agua. Una integración de cuenta dependerá de que el proveedor ofrezca una API autorizada para ese servicio. La consulta de XM informa operación agregada del sistema eléctrico, no el consumo de la empresa.

La guía de las referencias externas, sus limitaciones, los archivos oficiales versionados y las pruebas locales está en [typescript-model/README.md](typescript-model/README.md) y [server/benchmark-data/README.md](server/benchmark-data/README.md).

La API central actual se ejecuta con FastAPI y PostgreSQL, detrás de un proxy HTTPS configurado por quien despliegue el servicio. El proveedor de infraestructura puede elegirse sin cambiar las reglas de negocio. La facturación DIAN requiere un proveedor tecnológico autorizado: Pyme360 incluye el adaptador HTTP y su configuración local, pero no sustituye la certificación, la firma ni la aceptación del proveedor.

## Datos locales y reinicio

La aplicación guarda el negocio en SQLite dentro de la carpeta de datos del usuario, fuera del repositorio. En Windows suele ser `%LOCALAPPDATA%\Pyme360\pyme360.sqlite3`; en macOS, `~/Library/Application Support/Pyme360/pyme360.sqlite3`; en Linux, `$XDG_DATA_HOME/pyme360/pyme360.sqlite3` o `~/.local/share/pyme360/pyme360.sqlite3`. La aplicación muestra **Guardando** y después **Guardado en este equipo** solo cuando SQLite confirma el cambio. Si otra pestaña ya guardó una revisión más nueva, pide recargar.

La importación Excel y la restauración del respaldo preparan el estado completo y lo guardan en una transacción. Si el servidor falla, el cambio no reemplaza la última versión guardada. En **Datos y respaldo** puedes descargar un respaldo JSON y restaurarlo con vista previa. El servidor conserva hasta siete copias diarias junto a la base; esas copias están en el mismo computador. Para iniciar de cero, cierra Pyme360, haz una copia del archivo SQLite y elimina la base y los archivos auxiliares `-wal` y `-shm` de esa carpeta; al volver a abrir se crea una base vacía. Hazlo solo si ya exportaste los datos que quieras conservar.
