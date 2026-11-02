# Guía de uso de Pyme360

Esta guía corresponde a la demostración actual de Pyme360. Está escrita para empezar desde cero, sin conocimientos contables ni técnicos.

> **Antes de empezar:** abre Pyme360 con el lanzador de tu computador y deja abierta la ventana del servidor. Necesitas Python 3.11 o superior. Los datos del negocio se guardan en SQLite en este computador; no hay inicio de sesión ni sincronización con otros equipos. Pyme360 no transmite facturas a la DIAN ni reemplaza el sistema contable.

Si venías usando `web/index.html` directamente como archivo y ves tus registros en modo de solo lectura, abre **Datos y Excel → Descargar respaldo** desde esa pestaña. Luego inicia Pyme360 con el lanzador y usa **Restaurar respaldo** para pasarlos a SQLite.

## 1. Recorrido recomendado para empezar

Completa estos pasos en orden. Puedes dejar datos para después y volver cuando quieras.

1. **Configura la empresa.** Pulsa el nombre de empresa en la parte superior del menú y escribe el nombre, NIT, ciudad y actividad. El NIT y la ciudad se pueden completar más tarde.
2. **Registra tus contactos.** Abre **Contactos → Nuevo contacto**. Elige si es cliente, proveedor o ambos. Cada contacto que agregues aparecerá en las listas de tu demostración.
3. **Crea el inventario.** En **Inventario → Agregar producto**, registra primero materias primas e insumos, y luego los productos que vendes o fabricas.
4. **Prepara una receta.** Al crear un producto terminado, agrega uno o varios materiales e indica cuánto usas para fabricar una unidad.
5. **Empieza a registrar operaciones.** Usa **Ventas**, **Compras** o **Producción**. Revisa las existencias después de cada movimiento.
6. **Registra el consumo ambiental.** Abre **Impacto ambiental → Registrar datos** y sube una factura o usa el ejemplo. Revisa los valores antes de confirmarlos.

### Cambiar el tema de pantalla

Pulsa el botón de luna o sol en la barra superior para alternar entre tema claro y oscuro. La preferencia se guarda en este navegador y no cambia los datos de la empresa.

## 2. Configurar la empresa

1. Pulsa el botón con el nombre de la empresa en la barra lateral.
2. Escribe el nombre o razón social. Puedes añadir NIT, ciudad y actividad.
3. Pulsa **Guardar y continuar**.

La configuración identifica la empresa en la pantalla. En esta demostración no crea una cuenta ni configura varias sedes o bodegas.

## 3. Registrar un cliente o proveedor

1. Abre **Contactos**.
2. Pulsa **Nuevo contacto**.
3. En **Tipo de contacto**, elige **Cliente**, **Proveedor** o **Cliente y proveedor**.
4. Si el contacto es un cliente de mostrador, deja marcada **Identificar como cliente ordinario**. Puedes omitir el nombre y Pyme360 lo guardará como **Cliente de mostrador**, evitando duplicar ese contacto genérico. Para guardar NIT o cédula, correo o teléfono, escribe un nombre. Para proveedores y clientes identificados, el nombre es necesario.
5. Añade NIT o cédula, correo y teléfono si los quieres asociar al contacto.
6. Pulsa **Guardar contacto**.

El tipo siempre es necesario. El nombre es necesario para proveedores y clientes identificados. Un cliente ordinario de mostrador puede registrarse sin nombre ni datos personales. Los contactos se podrán elegir al registrar ventas o compras. La etiqueta **Cliente ordinario** es una clasificación interna: no define impuestos ni responsabilidades tributarias.

Para corregir datos, pulsa **Editar** junto al contacto. Para quitarlo de la lista, pulsa **Eliminar** y confirma. Las ventas y compras anteriores conservan el nombre con el que se registraron.

## 4. Crear productos, materiales e inventario

1. Abre **Inventario** y pulsa **Agregar producto**.
2. Escribe un nombre fácil de reconocer.
3. Elige el tipo:
   - **Materia prima:** material que se transforma o incorpora al producto.
   - **Insumo:** material auxiliar, como empaques.
   - **Producto terminado:** artículo que vendes o fabricas.
4. Selecciona la unidad y registra la existencia inicial, el mínimo que quieres vigilar y el costo.
5. Para un producto terminado, añade precio de venta y clasificación de IVA. En **Receta para fabricar 1 unidad**, elige cada material y escribe la cantidad que usas. Elige **Agregar material** para añadir más renglones; la unidad del material aparece junto a la cantidad. Puedes guardar el producto sin receta y completarla después.
6. Pulsa **Guardar producto**.

La demostración genera un código de referencia automáticamente. La tarifa de IVA es un dato configurable para esta demostración; confirma su aplicación con tu contador.

**Orden sugerido:** registra primero materias primas e insumos y sus existencias. Después crea el producto terminado y arma su receta con todos los materiales que usa. De esta forma, la orden de producción podrá revisar y descontar cada material.

En la lista puedes **Editar** nombre, costo, precio, IVA, mínimo y receta. Para conservar el historial, el código, tipo, unidad y existencia no se editan desde esa ficha. Usa **Ajustar stock** para corregir existencias. Solo se puede **Eliminar** un producto si no tiene stock ni aparece en compras, ventas, recetas u órdenes de producción.

### Ajustar una existencia

En **Inventario**, pulsa **Ajustar stock**, escribe el cambio —por ejemplo, `5` para sumar cinco o `-2` para restar dos— y selecciona un motivo. No puedes dejar una existencia negativa.

## 5. Registrar una venta

Antes de empezar, agrega un cliente y al menos un producto terminado con precio y existencia disponible.

1. Abre **Ventas** y pulsa **Registrar venta**.
2. Elige cliente y fecha. En **Productos de esta venta**, agrega uno o varios productos, sus cantidades y precios por unidad. El precio y el IVA se proponen desde la ficha del producto; puedes ajustar el precio del renglón si lo necesitas.
3. Si aplica, escribe un descuento en pesos.
4. En **Seguimiento de factura**, deja **Por revisar** o elige el estado que corresponda según tu revisión o la de tu contador. Si registraste el documento por fuera de Pyme360, puedes anotar su número y fecha.
5. Revisa el total aproximado y pulsa **Guardar venta**.
6. Consulta el estado de pago y el seguimiento de factura en la lista de ventas. Si fue a crédito, aparecerá como pendiente de pago. Desde cada fila puedes **Editar** o **Eliminar** la venta.

La demostración descuenta las unidades vendidas del inventario. El total estima el IVA con la configuración de cada producto. Puedes quitar renglones antes de guardar.

Al editar una venta, Pyme360 revisa las existencias considerando todos los productos de la versión anterior y aplica los cambios al guardar. Al eliminarla, devuelve las unidades asociadas al inventario y actualiza los saldos. Los pagos ya registrados se conservan y el nuevo total no puede quedar por debajo de lo que ya recibiste. Las ventas cargadas desde Excel no modifican las existencias, así que eliminarlas tampoco las cambia.

> **Factura electrónica:** el seguimiento es manual. Pyme360 no concluye si tienes una obligación, no emite facturas y no las transmite a la DIAN. Consulta al contador cuando tengas dudas.

## 6. Registrar una compra

Antes de empezar, agrega un proveedor y una materia prima o insumo.

1. Abre **Compras** y pulsa **Registrar compra**.
2. Elige el proveedor. En **Productos comprados**, agrega uno o varios materiales, sus cantidades y el costo total de cada renglón.
3. Selecciona **Recibida** si ya llegó o **Por recibir** si está pendiente.
4. Pulsa **Guardar compra**.

Si eliges **Recibida**, las cantidades de todos los renglones se suman al inventario. Si eliges **Por recibir**, el registro queda pendiente y las existencias no cambian.

Desde la lista o el detalle de una compra puedes **Editar** o **Eliminar**. Si la compra ya se recibió, se ajustan las existencias al corregirla o quitarla. Si el material se usó y el cambio dejaría el stock negativo, primero revisa o corrige los movimientos relacionados. Las compras importadas desde Excel no cambian el stock automáticamente.

## 7. Registrar producción

Antes de empezar, crea un producto terminado y agrega a su receta las materias primas e insumos que consume. Asegúrate de tener existencias suficientes de cada uno.

1. Abre **Producción** y pulsa **Nueva orden**.
2. Elige el producto terminado e indica cuántas unidades vas a fabricar.
3. Anota el desperdicio aproximado en kg. Si aún no lo sabes, déjalo en cero.
4. Revisa el material que la receta calcula y pulsa **Crear orden**.
5. Cuando termines de fabricar, pulsa **Terminar** en la orden o abre su detalle y elige **Marcar como terminada**.

Al crear la orden, el sistema descuenta el material estimado. Al terminarla, suma el producto terminado al inventario y registra las unidades producidas y el desperdicio. Si falta material, corrige la existencia o ajusta la cantidad de la orden.

Una orden **En proceso** se puede **Editar** para recalcular sus materiales o **Cancelar** para devolverlos al inventario. Las órdenes terminadas quedan cerradas y no se eliminan, porque ya impactaron las existencias y el resumen ambiental. Las órdenes importadas son de consulta; puedes quitar un registro importado en proceso, pero no cambia las existencias.

## 8. Registrar el impacto ambiental del mes

Puedes cargar un recibo para que Pyme360 encuentre el período y el consumo, o seguir usando la captura manual.

### Leer un recibo

1. En **Impacto ambiental**, pulsa **Registrar datos** —o **Actualizar datos** si ya hay un registro para el mes— y luego **Subir un recibo**. El navegador abrirá el explorador de archivos para elegir un archivo local; no necesitas escribir su ruta. La lectura OCR funciona desde la dirección abierta por el lanzador.
2. Elige un PDF, JPG o PNG de hasta 15 MB. En PDF se admiten hasta 8 páginas; para mejores resultados, carga la página donde aparece el consumo.
3. Pyme360 extrae el texto en este computador. Si el PDF es un escaneo o subes una foto, intenta reconocer los caracteres en español.
4. Revisa el tipo de servicio, el mes y el consumo. Corrige cualquier campo dudoso; si no se encontró, escríbelo tú.
5. Pulsa **Confirmar y guardar** solo cuando coincida con la factura. Si cierras o cancelas, no se crea un registro.

El recibo original se procesa en el navegador y se descarta; Pyme360 conserva el consumo confirmado, su período y el origen del dato en SQLite local. No se envía a un servicio externo. Si no puede leer el archivo, no se guarda ningún dato y puedes ingresarlo manualmente o volver a cargarlo.

### Probar el ejemplo o registrar manualmente

1. Abre **Impacto ambiental → Registrar datos** —o **Actualizar datos** para corregir el mes seleccionado—.
2. Elige **Probar con un ejemplo** para ver un consumo ficticio de demostración. Confirma o cancela; la pantalla lo identifica como ejemplo.
3. También puedes elegir **Ingresar datos manualmente** y anotar energía en kWh, agua en m³, combustible en litros, unidades producidas y residuos en kg.
4. Revisa el resumen, los consumos por unidad producida y las ideas del mes. Para descargar la información, pulsa **Descargar resumen**.

Pyme360 compara kWh/unidad y m³/unidad con los meses anteriores de tu empresa si hay al menos dos meses con consumo y producción registrados. Si no los hay, muestra **Sin referencia suficiente** mientras construye una referencia propia; no etiqueta un consumo como correcto o incorrecto.

### Consultar el contexto ONU y definir tus metas

1. Abre **Impacto ambiental** usando el lanzador de tu sistema para habilitar la consulta. El servidor local pide a la API pública de la ONU únicamente la serie ODS 7.3.1; no envía datos de la empresa.
2. Revisa por separado los datos anuales agregados de **Mundo** y **Colombia**, el año más reciente disponible, la unidad y la fuente. Pulsa **Actualizar** para volver a consultar. Si no hay conexión, la pantalla muestra la última respuesta guardada y su fecha; si no hay una copia, puedes reintentar.
3. Para crear objetivos de la empresa, pulsa **Definir metas** y elige un porcentaje de mejora independiente para energía y agua. Pyme360 calcula cada meta como ese porcentaje menos que el promedio de los últimos tres meses anteriores registrados con consumo y producción.

El ODS 7.3.1 mide energía primaria suministrada por unidad de PIB. Es un indicador anual de la economía, no una lectura de tu fábrica y no se compara directamente con kWh por unidad producida. Las metas son objetivos propios de mejora, no límites universales ni requisitos ambientales. Abrir `web/index.html` directamente (`file://`) mantiene el registro local, pero no consulta la referencia ONU; usa el acceso local `.bat` para esa consulta.

El selector de período permite consultar los meses guardados. El resumen calcula emisiones con un factor ilustrativo incluido en la demostración; **no es una medición certificada ni un reporte oficial**. Antes de usar emisiones para decisiones formales, deben configurarse factores vigentes y documentar su fuente con un asesor.

Cuando el mes ya tiene datos, el botón cambia a **Actualizar datos**. Puedes volver a leer un recibo o corregir los campos manualmente. El mes completo no se elimina desde esta pantalla para proteger los datos de producción que se hayan acumulado en el mismo período.

## 9. Registrar un pago y revisar finanzas

1. Abre **Finanzas** y pulsa **Registrar pago**.
2. Elige una factura con saldo, escribe cuánto recibiste e indica fecha y medio de pago.
3. Pulsa **Guardar pago**. Para un pago por partes, repite el proceso con el saldo restante.

La factura aparecerá como **Pago parcial** hasta que los abonos completen el total. En **Finanzas** puedes revisar lo vendido, lo recibido y el saldo pendiente. El detalle de cada venta muestra el historial de pagos. Este resumen es administrativo; no reemplaza libros contables ni declaraciones.

## 10. Descargar o importar un Excel

Abre **Datos y Excel**. Allí encontrarás estas acciones:

1. **Descargar Excel maestro:** descarga a demanda un solo libro con los datos actuales, divididos en hojas. No se crea un archivo nuevo cada vez que guardas un registro.
2. **Descargar plantilla vacía:** descarga las mismas hojas y encabezados, sin registros, para organizar datos nuevos.
3. **Importar Excel de la empresa:** selecciona un archivo `.xlsx` o `.xls` de hasta 10 MB y 10.000 filas. Confirma la importación para guardar los cambios en SQLite.
4. **Descargar respaldo:** crea una copia JSON completa de los datos de esta demostración, incluidos pagos y registros relacionados.
5. **Restaurar respaldo:** elige un archivo de respaldo descargado antes. Pyme360 muestra una vista previa y pide confirmación; al continuar, reemplaza los datos de este computador. Descarga una copia del estado actual si quieres conservarlo.

El libro contiene estas hojas y encabezados:

| Hoja | Columnas principales |
|---|---|
| Empresa | Nombre o razón social, NIT, Ciudad, Actividad |
| Contactos | ID, Nombre, Tipo, Cliente ordinario, Identificación, Correo, Teléfono |
| Productos | ID, SKU, Nombre, Tipo, Unidad, Existencia, Mínimo, Costo unitario COP, Precio COP, Tipo de IVA, Tarifa IVA % |
| Recetas | Producto SKU, Material SKU, Cantidad por unidad |
| Ventas | ID, Número, Cliente, Fecha, Total COP, Descuento COP, IVA %, Estado de pago, Forma de pago, Fecha de pago, Medio de pago, Seguimiento de factura, Número y fecha de documento externo |
| Detalle de ventas | Número de venta, Producto SKU, Cantidad, Precio unitario COP, IVA % |
| Compras | ID, Número, Proveedor, Fecha, Total COP, Estado, Detalle |
| Detalle de compras | Número de compra, Producto SKU, Cantidad, Costo total COP |
| Pagos recibidos | ID de pago, Número de venta, Fecha, Valor recibido COP, Medio de pago |
| Producción | ID, Número de orden, Producto SKU, Producto, Cantidad, Fecha, Estado, Desperdicio kg, Fecha de terminación |
| Consumos de producción | Número de orden, Material SKU, Cantidad consumida |
| Impacto ambiental | Período, consumos, residuos, reciclado o reutilizado, producción, origen, método y fecha de confirmación de energía y agua |
| Datos adicionales | Entidad, Clave del registro, Campo original, Valor |

Al importar, Pyme360 intenta reconocer los nombres de las hojas y encabezados. Revisa cada hoja, elige qué información contiene y corrige la fila de encabezados o las columnas si hace falta. La muestra y el resumen te permiten revisar el resultado antes de guardar.

- Las coincidencias por NIT, SKU, número de documento o nombre y tipo se presentan como duplicados. Se omiten por defecto.
- Marca **Actualizar duplicados** solo si quieres completar o actualizar datos. Las celdas vacías del archivo no borran datos guardados.
- Las filas que no encuentran un cliente, proveedor, producto o documento relacionado quedan **por revisar** y no se importan. Registra o corrige esa referencia y vuelve a importar el archivo.
- Las columnas que no asignes se conservan en **Datos adicionales**, vinculadas al registro, y vuelven a salir en el Excel maestro.
- Pulsa **Cancelar** para salir sin guardar. Si el archivo tiene errores o SQLite no puede confirmar el cambio, Pyme360 conserva la última versión guardada.

El libro se genera o lee dentro del navegador; el archivo no se envía por internet. Incluye datos principales de negocio y campos adicionales, pero no preferencias ni actividad reciente. El respaldo JSON sí conserva el estado completo y puedes restaurarlo en otro computador. Guarda las copias en un lugar seguro.

Los botones CSV existentes en Inventario, Impacto ambiental y Finanzas siguen disponibles para exportar esos resúmenes por separado.

## 11. Si no puedes registrar algo

| Lo que ves | Qué hacer |
|---|---|
| La venta pide un cliente o producto | Pulsa **Agregar cliente** o **Agregar producto** en el aviso y completa ese dato primero. |
| La compra pide proveedor o producto | Agrega un contacto de tipo proveedor y una materia prima o insumo. |
| Producción indica que falta preparar el inventario | Crea primero los materiales y el producto terminado con su receta. |
| El inventario no alcanza | Recibe una compra o registra un ajuste después de verificar la cantidad real. |
| Un registro aparece en cero | Registra el período o movimiento; la pantalla no trae valores precargados. |
| No aparece una factura aceptada por la DIAN | La demostración no está conectada a DIAN; no transmitió la venta. |
| La referencia ONU dice que no se pudo conectar | Inicia Pyme360 con el lanzador de tu sistema y deja abierta la ventana de terminal. Se abrirá una dirección local nueva; usa esa pestaña en vez de `web/index.html` abierto como archivo. Si hay un error al iniciar, la ventana se queda abierta para mostrarlo. |

## 12. Cuidado de tus datos en esta demostración

- La base está en Windows `%LOCALAPPDATA%\Pyme360\pyme360.sqlite3`, macOS `~/Library/Application Support/Pyme360/pyme360.sqlite3` o Linux `$XDG_DATA_HOME/pyme360/pyme360.sqlite3` (por defecto `~/.local/share/pyme360/pyme360.sqlite3`).
- No hay usuarios, permisos ni separación entre empresas. Protege el acceso a tu computador y no ingreses información que no quieras mantener localmente en él.
- El servidor crea copias locales diarias y conserva hasta siete. Como están en el mismo computador, descarga periódicamente un respaldo JSON y guárdalo en otro medio.
- Si ves **Guardando**, espera a que aparezca **Guardado en este equipo** antes de cerrar. Si aparece un error, el último estado confirmado permanece en SQLite.
- Los datos no aparecen automáticamente en otro computador. Usa **Datos y Excel** para exportar el libro o respaldo e importarlo/restaurarlo allá. La referencia ONU consulta solo información pública agregada.
- Para volver a empezar desde cero, cierra Pyme360 y elimina la base `pyme360.sqlite3` junto con sus archivos `-wal` y `-shm` de la carpeta local indicada. Al abrir de nuevo se creará una base vacía. Haz primero una copia de lo que quieras conservar.

## Funciones pendientes de la versión conectada

Esta versión no incluye inicio de sesión, cuentas separadas por empresa, sincronización entre equipos, varias bodegas configurables, integración con DIAN, conexión con bancos, nómina, contabilidad formal completa ni envío de reportes ambientales a autoridades. Las tarifas tributarias, requisitos de facturación y obligaciones ambientales deben revisarse con el contador y el asesor ambiental de la empresa.
