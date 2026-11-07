# Guía de uso de Pyme360

Esta guía corresponde a la interfaz actual de Pyme360 (React/TypeScript). Está escrita para empezar desde cero, sin conocimientos contables ni técnicos.

> **Antes de empezar:** abre `Abrir Pyme360.bat` y deja abierta su ventana. Los datos del negocio se guardan en SQLite en este computador. Pyme360 no reemplaza el sistema contable y, sin un proveedor tecnológico configurado, no transmite facturas.

## 1. Recorrido recomendado para empezar

Completa estos pasos en orden. Puedes dejar datos para después y volver cuando quieras.

1. **Crea el administrador.** La primera vez, Pyme360 pide crear una cuenta. Pulsa **Crear cuenta administradora** y, en adelante, entra con ese usuario.
2. **Configura la empresa.** En **Resumen**, pulsa **Configurar** en el aviso de datos de la empresa, o abre tu perfil y elige **Configurar empresa**.
3. **Registra tus contactos.** Abre **Contactos → Nuevo contacto**. Elige si es cliente, proveedor o ambos.
4. **Crea el inventario.** En **Inventario → Agregar producto**, registra primero materias primas e insumos, y luego los productos que vendes o fabricas.
5. **Prepara una receta.** En **Producción → Recetas**, crea la fórmula de cada producto terminado y actívala.
6. **Empieza a registrar operaciones.** Usa **Ventas**, **Compras** o **Producción**. Revisa las existencias después de cada movimiento.
7. **Registra el consumo ambiental.** Abre **Impacto ambiental → Registrar lectura** o importa un recibo. Revisa los valores antes de confirmarlos.

El menú lateral agrupa los módulos en **Inicio**, **Operación**, **Gestión**, **Sostenibilidad** y **Administración**. En escritorio aparece como iconos; pulsa **Expandir menú**, abajo a la izquierda, para ver los nombres. La preferencia se guarda en este navegador. En el celular se abre con el botón de menú y tiene accesos inferiores a Inicio, Ventas e Inventario; el resto está en **Más**.

### Cambiar el tema de pantalla

En la barra superior, abre el selector **Tema** y elige **Sistema**, **Claro** u **Oscuro**. La preferencia se guarda en este navegador y no cambia los datos de la empresa.

## 2. Usuarios y permisos

Un administrador crea las cuentas desde su perfil, en **Usuarios**. Hay tres roles:

| Rol | Qué puede hacer |
|---|---|
| **Administrador** | Configuración, usuarios, eliminaciones y respaldos. |
| **Operador** | Registrar operaciones. |
| **Consulta** | Ver y exportar. |

Solo un administrador ve **Auditoría**, donde queda el registro local de cambios. Para salir, abre tu perfil y pulsa **Cerrar sesión**.

## 3. Configurar la empresa

1. Abre tu perfil y elige **Configurar empresa**.
2. Escribe el nombre o razón social. Puedes añadir NIT, ciudad y actividad.
3. Pulsa **Guardar empresa**.

Esta versión está pensada para una empresa en un solo computador.

## 4. Registrar un cliente o proveedor

1. Abre **Contactos**.
2. Pulsa **Nuevo contacto**.
3. En **Tipo de contacto**, elige **Cliente**, **Proveedor** o **Cliente y proveedor**.
4. Si es un cliente de mostrador, marca **Cliente de mostrador sin datos personales**. Para proveedores y clientes identificados, el nombre es necesario.
5. Añade NIT o cédula, tipo de identificación, correo y teléfono si los quieres asociar al contacto.
6. Pulsa **Guardar contacto**.

Los contactos se podrán elegir al registrar ventas o compras. Pyme360 no admite dos contactos con la misma identificación: si un proveedor también es cliente, usa **Cliente y proveedor**. Para corregir datos, pulsa **Editar**. Un administrador puede eliminar un contacto, salvo que ya esté asociado a ventas o compras.

## 5. Crear productos, materiales e inventario

1. Abre **Inventario** y pulsa **Agregar producto**.
2. Escribe un nombre fácil de reconocer.
3. Elige el tipo:
   - **Materia prima:** material que se transforma o incorpora al producto.
   - **Insumo:** material auxiliar, como empaques.
   - **Producto terminado:** artículo que vendes o fabricas.
4. Indica la unidad y registra la existencia inicial, el inventario mínimo que quieres vigilar y el costo unitario.
5. Para un producto terminado, añade precio de venta, IVA estimado y clasificación tributaria. Si no la conoces, déjalo en **Por clasificar**: podrás registrar ventas, pero no emitir documentos electrónicos. Confirma estos datos con tu contador.
6. Pulsa **Guardar producto**.

**Orden sugerido:** registra primero materias primas e insumos y sus existencias. Después crea el producto terminado y su receta.

Un administrador puede eliminar un producto solo si su existencia es cero y no aparece en ventas, compras, órdenes ni recetas.

### Contar una existencia

En **Inventario**, pulsa **Conteo**, escribe la cantidad física contada y un motivo o referencia, y pulsa **Conciliar existencia**. Pyme360 calcula la diferencia contra el saldo y la registra como un movimiento trazable en el **Libro de movimientos**. Si las cantidades coinciden, no crea un movimiento.

### Reposición sugerida

**Inventario → Reposición sugerida** calcula lo necesario para recuperar el mínimo configurado. Según el producto, ofrece **Preparar compra pendiente** o **Preparar orden de producción**; si un producto terminado no tiene receta, ofrece **Configurar receta**. Nada se crea hasta que revises y confirmes.

## 6. Registrar una venta

Antes de empezar, agrega un cliente y al menos un producto terminado con precio y existencia disponible.

1. Abre **Ventas** y pulsa **Registrar venta**.
2. Elige fecha, cliente y, si queda saldo, el **Vencimiento de saldo**.
3. Agrega los productos con **＋ Producto** e indica cantidades y precios por unidad.
4. Si aplica, escribe el **Descuento COP**.
5. Si recibiste dinero, escribe el **Abono inicial COP**, el medio y la cuenta de caja o banco.
6. En **Seguimiento de factura**, deja **Por revisar** o elige el estado que corresponda. Si registraste el documento por fuera de Pyme360, puedes anotar su número y fecha.
7. Revisa el total y pulsa **Guardar venta**.

La venta descuenta las unidades del inventario y no se guarda si la existencia no alcanza.

**Una venta guardada no se edita.** Para corregirla, un administrador la elimina y se registra de nuevo. Al eliminarla se devuelven los productos al inventario y se revierten sus movimientos de dinero. Si la venta tiene un borrador de factura sin enviar, un administrador debe eliminarlo primero en **Facturación y documentos** con **Eliminar borrador**. Los documentos ya enviados al proveedor no se eliminan, y en un equipo vinculado a la nube tampoco los borradores.

### Facturación y documentos

La pestaña **Ventas → Facturación y documentos** prepara información tributaria:

- **Preparar factura**, en una venta, crea un borrador con una copia de los datos del cliente, los productos y los impuestos. No reserva numeración ni se considera emitido.
- **Configuración tributaria** define los datos tributarios, la numeración, el ambiente y el proveedor tecnológico. La maneja un administrador.
- **Solicitar emisión** se habilita solo con el conector configurado y sin alertas tributarias.
- **Crear nota** prepara una nota crédito o débito a partir de una factura aceptada o entregada.
- **Importar XML proveedor** revisa una factura de proveedor en XML UBL de hasta 2 MB. Al confirmar, puedes dejarla pendiente o vincularla a una compra. No crea pagos ni movimientos de inventario.

> **Factura electrónica:** Pyme360 no decide si tienes una obligación, ni firma ante la DIAN. La emisión depende de un proveedor tecnológico certificado. Consulta al contador cuando tengas dudas.

## 7. Registrar una compra

Antes de empezar, agrega un proveedor y una materia prima o insumo. Las compras no admiten productos terminados.

1. Abre **Compras** y pulsa **Registrar compra**.
2. Elige proveedor, fecha y, si aplica, el vencimiento del pago.
3. Agrega los materiales con **＋ Material**, con sus cantidades y el costo total de cada renglón.
4. Selecciona **Recibida** si ya llegó o **Por recibir** si está pendiente.
5. Pulsa **Guardar compra**.

Si eliges **Recibida**, las cantidades se suman al inventario, se genera un saldo por pagar y el costo unitario del material se recalcula con promedio ponderado. Si eliges **Por recibir**, el registro queda pendiente y las existencias no cambian.

Puedes pulsar **Editar** en una compra; un administrador también puede eliminarla. Si ya se recibió, las existencias se ajustan. El nuevo total no puede quedar por debajo de los pagos aplicados. No se puede eliminar una compra vinculada a una factura de proveedor importada.

## 8. Registrar producción

### Crear una receta

1. Abre **Producción → Recetas** y pulsa **Nueva receta**, o **Crear receta** junto al producto.
2. Indica la cantidad base del lote y el rendimiento esperado.
3. Agrega los materiales con **＋ Material** y la cantidad que usa cada lote.
4. Pulsa **Guardar borrador**.
5. Revisa el borrador y pulsa **Activar**. Solo una versión activa sirve para crear órdenes.

Para cambiar una fórmula, pulsa **Nueva versión**. Las órdenes anteriores conservan la versión con la que se crearon.

### Crear y completar una orden

Antes de empezar, asegúrate de tener existencias suficientes de cada material.

1. Abre **Producción → Órdenes** y pulsa **Crear orden**.
2. Elige el producto terminado, la fecha y la cantidad.
3. Revisa los materiales requeridos, los faltantes, la salida buena esperada y el estimado directo de materiales.
4. Pulsa **Crear orden**.
5. Al terminar de fabricar, pulsa **Completar**, indica las **Unidades de desperdicio** y la fecha de finalización, y pulsa **Completar y sumar al inventario**.

Al crear la orden se descuentan los materiales. Al completarla se suman al inventario las unidades producidas menos el desperdicio, y el costo unitario del producto se recalcula con promedio ponderado usando el costo de materiales. Si falta material, la orden no se crea. Una orden activa se puede **Cancelar** para devolver los materiales; una orden completada queda cerrada.

El estimado usa los costos de catálogo; no incluye mano de obra, energía ni costos indirectos.

## 9. Registrar el impacto ambiental

### Registrar una lectura manual

1. En **Impacto ambiental**, pulsa **Registrar lectura**.
2. Elige el **Recurso**: energía eléctrica, agua, combustible, material o residuo.
3. Elige la actividad cuando aplique; por ejemplo, retirada o descarga de agua, o residuo generado o recuperado.
4. Escribe cantidad, unidad y el período con **Desde** y **Hasta**.
5. Indica la calidad del dato y su fuente, y pulsa **Guardar lectura**.

Cada lectura queda separada por recurso y período. Para corregirlas, abre el detalle de lecturas, donde están **Editar** y **Eliminar**.

### Leer un recibo

1. Descarga el recibo desde el portal de tu proveedor. Pyme360 no entra a ese portal por ti.
2. En **Fuente de consumo**, abre **Capturar desde un recibo** y pulsa **Importar recibo PDF/JPG/PNG**.
3. Elige un archivo de hasta 15 MB. En PDF se admiten hasta 8 páginas; para mejores resultados, carga la página donde aparece el consumo.
4. En **Revisar recibo ambiental**, comprueba período, proveedor, recurso, consumo, unidad, valor y número de factura. Corrige lo que esté mal.
5. Pulsa **Confirmar y guardar** solo cuando coincida con la factura.

El recibo se procesa en este dispositivo y se descarta; solo se guardan los valores confirmados. La lectura automática puede equivocarse. Si ya existe un recibo igual, Pyme360 te avisa antes de guardar.

### Revisar indicadores y alertas

La pantalla muestra la cobertura de datos, las **Alertas ambientales**, los indicadores del último período, las **Tendencias mensuales** y las **Emisiones**. En **Explorar historial e indicadores** está el detalle por mes.

Las alertas avisan, por ejemplo, si faltan lecturas recientes, si la descarga de agua supera la retirada o si la intensidad subió más de 10 % frente al mes anterior. Los indicadores por unidad necesitan lecturas y producción del mismo período.

### Metas, acciones y factores

- **Metas graduales:** un administrador pulsa **＋ Nueva meta**, elige indicador, horizonte, línea base y cambio objetivo. El avance solo se calcula cuando la línea base está aprobada.
- **Acciones de mejora:** pulsa **＋ Registrar acción** para asignar una intervención a un responsable con fecha límite.
- **Factores de emisión:** un administrador los agrega con **Agregar factor**, indicando su fuente. Solo se aplican si coinciden año, actividad, unidad y ubicación; si no hay uno compatible, la emisión aparece como no disponible.

Las emisiones calculadas **no son una medición certificada ni un reporte oficial**. Las metas son objetivos propios de mejora, no límites universales ni requisitos ambientales.

### Referencias externas

En **Referencias externas**, pulsa **Actualizar datos** para consultar los indicadores ODS de la ONU y los datos agregados del sistema eléctrico de XM. Solo administradores y operadores pueden actualizar. Si una fuente falla, se conserva la última respuesta guardada. No se envían datos de tu empresa a esas fuentes.

Son estadísticas agregadas, no lecturas de tu fábrica. Para comparar tu intensidad anual por litro necesitas 12 meses completos de lecturas, producción completada en ese año y los litros por unidad de cada producto terminado. Un administrador ajusta el perfil en **Fuente de consumo → Configurar**.

## 10. Registrar pagos y revisar finanzas

**Finanzas** muestra lo que está por cobrar, por pagar, el saldo de caja y bancos y el flujo del mes. Es un control interno en COP: no es contabilidad de partida doble ni conciliación bancaria.

- **Cobrar una venta:** en **Ventas** pulsa **Abonar**, o en **Finanzas → Cuentas por cobrar** pulsa **Registrar abono**. Escribe el valor y pulsa **Guardar abono**. Para un pago por partes, repite el proceso.
- **Pagar una compra:** en **Finanzas → Cuentas por pagar** pulsa **Registrar pago** y luego **Guardar pago**. Las compras antiguas pueden requerir **Confirmar saldo** por parte de un administrador.
- **Crear una cuenta:** un administrador pulsa **＋ Nueva cuenta** en **Cuentas de caja y banco**.
- **Otros movimientos:** pulsa **Registrar ingreso o egreso**.

Si un pago o egreso va a dejar una cuenta en negativo, Pyme360 te avisa y pide confirmación. No lo bloquea, porque un sobregiro real debe poder registrarse.

## 11. Respaldos y Excel

Abre **Datos y respaldo**. Allí encontrarás estas acciones:

1. **Descargar respaldo JSON:** crea una copia completa del estado del negocio.
2. **Restaurar un respaldo:** un administrador elige un archivo JSON y confirma. Reemplaza los datos actuales; las cuentas de usuario y la auditoría se conservan. Descarga antes una copia si quieres guardar el estado actual.
3. **Descargar archivo Excel (.xlsx):** genera a demanda un libro con hojas separadas por módulo.
4. **Descargar catálogo de muestra adaptado:** descarga 12 referencias de ejemplo para practicar. Sus valores son ilustrativos.
5. **Importar archivo Excel (.xlsx o .xls):** abre el asistente de importación. Está disponible para administradores y operadores.

El libro incluye estas hojas:

| Grupo | Hojas |
|---|---|
| Empresa y contactos | Empresa, Contactos |
| Inventario y producción | Inventario, Recetas, Movimientos inventario, Producción, Consumo producción |
| Ventas y compras | Ventas, Detalle ventas, Abonos, Compras, Detalle compras, Pagos de compras |
| Dinero | Cuentas, Caja y bancos, Cuentas por cobrar, Cuentas por pagar |
| Impuestos y documentos | Configuración tributaria, Documentos electrónicos, Facturas proveedores XML |
| Ambiente | Impacto ambiental, Recibos ambientales, Configuración ambiental, Indicadores ambientales, Lecturas ambientales, Factores GEI, Metas ambientales, Acciones ambientales |
| Otros | Datos adicionales |

### Importar un Excel

1. Pulsa **Importar archivo Excel (.xlsx o .xls)**. Si necesitas un formato de partida, pulsa **Descargar plantilla**.
2. Selecciona un libro de hasta 10 MB y 10.000 filas.
3. Elige la hoja, el módulo de Pyme360 y la fila de encabezados. Si es un libro exportado por Pyme360, usa **Reconocer hojas del libro maestro**.
4. Relaciona las columnas. La detección es una sugerencia; confírmala.
5. Revisa la vista previa: filas listas, duplicadas, con error, bloqueadas y advertencias.
6. Confirma con **Importar**. Solo se agregan las filas válidas.

La importación es aditiva: omite duplicados y no reemplaza registros existentes. Las columnas que no asignes se conservan en **Datos adicionales**. No importa usuarios ni contraseñas, y las operaciones importadas no generan movimientos de inventario ni de caja. Pulsa **Cancelar** para salir sin guardar.

El libro se lee o genera dentro del navegador; el archivo no se envía por internet. Para una copia que puedas restaurar, usa el respaldo JSON. Guarda las copias en un lugar seguro.

## 12. Sincronización opcional

Pyme360 funciona sin internet. Para compartir datos entre computadores hace falta una API central propia, con PostgreSQL, HTTPS y correo; Pyme360 no incluye ese alojamiento.

Si ya existe, abre tu perfil y elige **Sincronización**. Desde allí puedes **Crear empresa** o **Conectar cuenta**, invitar al equipo, usar **Sincronizar ahora** y resolver conflictos con **Conservar local** o **Conservar central**. Las cuentas centrales y las locales son independientes. Consulta [typescript-model/README.md](../typescript-model/README.md) y [server/cloud/README.md](../server/cloud/README.md).

## 13. Si no puedes registrar algo

| Lo que ves | Qué hacer |
|---|---|
| El inicio de sesión dice que hubo demasiados intentos | Tras 5 intentos fallidos, ese usuario queda bloqueado 60 segundos. Espera y vuelve a intentarlo. |
| No puedes crear, editar ni eliminar | Revisa tu rol. **Consulta** solo ve y exporta, y las eliminaciones son del administrador. |
| La venta dice que no hay inventario suficiente | Recibe una compra, completa una orden o haz un **Conteo** después de verificar la cantidad real. |
| Quieres corregir una venta | Las ventas no se editan: elimínala como administrador y regístrala de nuevo. Si tiene un borrador de factura, elimínalo antes. |
| La compra pide proveedor o producto | Agrega un contacto de tipo proveedor y una materia prima o insumo. |
| La orden dice que no hay receta | Crea la receta en **Producción → Recetas** y pulsa **Activar**. |
| La orden no se crea por falta de material | Recibe una compra o ajusta la cantidad de la orden. |
| **Solicitar emisión** está deshabilitado | Configura el conector y corrige las alertas tributarias. Sin ese conector, Pyme360 solo prepara borradores. |
| Una emisión aparece como no disponible | Agrega un factor de emisión compatible con el año, la actividad, la unidad y la ubicación. |
| Aparece “no se pudo validar la sesión” o no se conecta una referencia externa | Comprueba que la ventana de Pyme360 siga abierta y recarga la página. Usa la dirección que abrió el lanzador, no un archivo local. |

## 14. Cuidado de tus datos

- La base está en Windows `%LOCALAPPDATA%\Pyme360\pyme360.sqlite3`, macOS `~/Library/Application Support/Pyme360/pyme360.sqlite3` o Linux `$XDG_DATA_HOME/pyme360/pyme360.sqlite3` (por defecto `~/.local/share/pyme360/pyme360.sqlite3`).
- Usa una contraseña propia para cada usuario y protege el acceso a tu computador.
- El servidor crea copias locales diarias y conserva hasta siete. Como están en el mismo computador, descarga periódicamente un respaldo JSON y guárdalo en otro medio.
- Si ves **Guardando en SQLite…**, espera a que aparezca **Guardado en este equipo** antes de cerrar. Si aparece un error, el último estado confirmado permanece en SQLite.
- Sin sincronización, los datos no aparecen en otro computador. Usa el respaldo JSON para pasarlos a otro equipo.
- Para volver a empezar desde cero, cierra Pyme360 y elimina la base `pyme360.sqlite3` junto con sus archivos `-wal` y `-shm` de la carpeta local indicada. Al abrir de nuevo se creará una base vacía. Haz primero una copia de lo que quieras conservar.

## Límites de esta versión

Esta versión no incluye varias empresas en una misma instalación, conexión con bancos, nómina, contabilidad formal de partida doble ni envío de reportes ambientales a autoridades. Tampoco se conecta en tiempo real a medidores ni a cuentas de servicios públicos. Las tarifas tributarias, los requisitos de facturación y las obligaciones ambientales deben revisarse con el contador y el asesor ambiental de la empresa.

## Si olvidas una contraseña

Cada persona cambia la suya en su perfil, con **Cambiar mi contraseña**. Un administrador también puede cambiar la de otro usuario en **Usuarios**.

Si el único administrador la olvidó, cierra Pyme360 y ejecuta este comando desde la carpeta del programa, en el mismo computador y la misma cuenta de Windows:

```bash
python server/serve-local.py --reset-password USUARIO
```

## Protección de los archivos

Los respaldos que descargas quedan protegidos con la contraseña que elijas. Si la olvidas, ese respaldo no se puede abrir.

La base de datos y las copias diarias que quedan en el computador no están cifradas. Usa una cuenta de Windows propia con contraseña y activa el cifrado del dispositivo.
