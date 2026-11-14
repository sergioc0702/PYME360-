# Auditoría comercial y técnica de Pyme360

## Qué tiene valor hoy

### Takeaway

El producto reúne la operación de una microfábrica, una vía de entrada desde Excel y un seguimiento de energía/agua dentro del mismo flujo. La propuesta vendible por validar es ayudar a una microfábrica de Boyacá a conocer qué tiene en bodega, cuánto le cuesta un lote y qué cambió en su gasto de servicios.

### Cited Findings

- PRODUCT.md define como público a microempresas manufactureras del corredor de Duitama y Sogamoso con baja experiencia digital y Excel/cuadernos. Declara que no hay clientes, testimonios, resultados de ahorro ni demanda validada. [Público](<../../../../PRODUCT.md#L9>) · [Evidencia](<../../../../PRODUCT.md#L35>)
- Las recetas tienen versiones borrador/activa/archivada; la orden conserva ID y número de versión, materiales y rendimiento esperado. Al cerrar, registra unidades buenas y desperdicio, y calcula costo de materiales por unidad buena cuando existe el dato. [Reglas de producción](<../../../../frontend/src/domain/business.ts#L1898>) · [Pruebas](<../../../../frontend/tests/business.test.mjs#L178>)
- La venta descuenta existencias y actualiza saldo; compras pendientes esperan recepción. Existen conteos trazables, reposición sugerida y pendientes de cobro. El modo local funciona con SQLite y servidor restringido a loopback. [Flujos](<../../../../README.md#L34>) · [Escucha local](<../../../../server/serve-local.py#L3210>)
- El asistente Excel/CSV sugiere mapeos y admite revisión. El plan de importación distingue duplicados, errores, avisos y bloqueos. En importación comercial histórica, ventas y compras por sí solas no generan caja o inventario; el plan sí puede incorporar libros explícitos de movimientos cuando están en el archivo y son válidos. Antes de un piloto hay que cuadrar inventario inicial, cartera y caja por separado. [Alcance del importador](<../../../../README.md#L59>) · [Plan de importación](<../../../../frontend/src/features/spreadsheets/excel-import.ts#L3623>)
- Los recibos PDF/JPG/PNG se procesan localmente; el flujo valida el período, detecta duplicados, pide confirmación al reemplazar y guarda procedencia y calidad sin el archivo original ni la vista previa de texto. La precisión con facturas reales de distintos proveedores sigue pendiente. El reparto por unidades es estimativo y los indicadores externos son contexto, no medición de planta. [Alcance ambiental](<../../../../README.md#L49>) · [Confirmación y guardado](<../../../../frontend/src/app/App.tsx#L399>)

### Inferences

- La oportunidad es el paquete operación + costo + consumo accesible para una microfábrica. La mera presencia de OCR, operación sin conexión o indicadores no demuestra exclusividad frente a otros sistemas ni disposición a pagar.

### Gaps

- No hay evidencia observacional de tiempo de puesta en marcha, precisión del OCR, ahorro atribuible, retención, precio aceptado o satisfacción. No hubo prueba de navegador.

## Qué impide prometer una edición comercial amplia

### Takeaway

La operación local tiene salvaguardas útiles, pero el modelo de guardado, la dependencia del proveedor de facturación y la operación del servicio requieren validación concreta antes de ampliar el alcance.

### Cited Findings

- React envía el AppState completo en cada guardado con expectedRevision; la revisión es global, el servidor devuelve 409 ante cambios simultáneos y admite solicitudes de hasta 20 MiB. SQLite guarda el estado, audita y encola sincronización bajo la misma transacción. El servidor intenta respaldar después de guardar. [Cliente](<../../../../frontend/src/infrastructure/storage.ts#L447>) · [Servidor](<../../../../server/serve-local.py#L2075>) · [Límite](<../../../../server/serve-local.py#L58>)
- El lanzador de Windows depende de Python y de Node para compilar en la primera apertura. Hay copias automáticas en la misma máquina y una exportación cifrada con contraseña disponible. El respaldo en el mismo disco no cubre pérdida del equipo. [Instalación](<../../../../README.md#L5>) · [Exportación cifrada](<../../../../frontend/src/app/screens/DataScreen.tsx#L13>) · [Copias](<../../../../README.md#L93>)
- FastAPI/PostgreSQL ya gestiona empresas, roles, lotes idempotentes y conflictos. La credencial local y central son separadas; soporte multipuesto requiere HTTPS, SMTP, gestión de secretos, alertas y copias restaurables. [Operación central](<../../../../server/cloud/README.md#L38>)
- Hay borradores, importación UBL y transporte HTTP configurable. Las pruebas de transporte usan un proveedor de prueba; no demuestran habilitación o aceptación real. El README excluye contabilidad formal de partida doble. [Alcance fiscal](<../../../../README.md#L81>) · [Pruebas de transporte](<../../../../server/tests/test_electronic_invoicing_transport.py#L52>)
- En revisión local del 9 de noviembre de 2026, 82 pruebas TypeScript y 88 Python aprobaron. Se omitieron tres pruebas PostgreSQL porque requieren su base y dependencias. Lint terminó con dos avisos de hooks y cero errores. GitHub Actions está configurado para levantar PostgreSQL y verificar lint, build y tests; no se verificó un resultado remoto. [CI](<../../../../.github/workflows/tests.yml>) · [Pruebas PostgreSQL](<../../../../server/tests/test_cloud_api_integration.py#L32>)
- El registro HTTP de la API local emite un mensaje genérico; el repo tiene organización por capacidades pero ventas, producción y otras funciones siguen compartiendo AppForms.tsx y business.ts, además del guardado común en App.tsx. [Registro](<../../../../server/serve-local.py#L1129>) · [Formularios](<../../../../frontend/src/app/AppForms.tsx#L597>) · [Guardado UI](<../../../../frontend/src/app/App.tsx#L294>)

### Inferences

- El snapshot es un diseño aprovechable para pilotos pequeños. Medir tamaño y latencia con datos realistas, además de conflictos entre dos operadores, antes de decidir una migración gradual a operaciones por dominio; el código no demuestra un umbral de escala operativa.
- Probar licencia de distribución del código y de dependencias vendorizadas antes de distribuir un instalador. La búsqueda git ls-files encontró licencias del lector vendorizado y ninguna licencia general del repositorio. No es una conclusión jurídica.

### Gaps

- Sin evidencia de despliegue productivo, auditoría de seguridad, carga, piloto con datos reales, restauración fuera del equipo, una factura aceptada con proveedor real o matriz de navegadores. No se ejecutó el recorrido completo de UI en esta revisión.

## Cómo llevarlo a un piloto y una oferta sostenible

### Takeaway

Primero demostrar un resultado útil en un segmento y hacer confiable su puesta en marcha. Luego extender profundidad de manufactura, fiscal y multiusuario según demanda pagada.

### Cited Findings

- Las recetas y costos actuales permiten extender por orden con materiales reales, tiempo de trabajo, tarifas y energía. [Reglas de orden](<../../../../frontend/src/domain/business.ts#L1898>)
- Las pruebas de ventas, conteos, compras, producción y costos permiten separar por capacidades sin cambiar primero el modelo de datos. [Pruebas de negocio](<../../../../frontend/tests/business.test.mjs#L74>)

### Inferences

- Descubrimiento comercial: escoger un subsector de Boyacá con producción repetitiva y un dolor verificable, entrevistar dueños y operarios y ensayar con 2–3 empresas como tamaño propuesto, no dato. Oferta inicial de instalación/importación/capacitación con soporte mensual opcional. Cobro por empresa/instalación para validar, precio por cotizar tras medir horas de migración y soporte. Separar edición gestionada cuando haya demanda.
- Puerta de piloto local: instalador de Windows con dependencias empaquetadas, versiones y migraciones con copia previa, exportación cifrada automática fuera del equipo con restauración demostrada, empresa de ejemplo, importación con acta de conciliación, registros diagnósticos con operación/status/ID de solicitud sin PII, soporte y recuperación. Aceptación: instalar en PC limpio, importar, fabricar, vender y restaurar en otro PC. Definir permisos con datos reales solo bajo acuerdo, controles y verificación aplicable.
- Diferenciador comercial primero: costos estimados y reales por orden. Registrar movimientos reales de materia prima y tiempos; fijar tarifas al cerrar; distinguir energía medida, repartida y no disponible; calcular por unidad buena y explicar variación por material/merma/tiempo. Mantener histórico y corregir mediante ajustes, sin duplicar costos indirectos. Validar dos lotes contra planilla del dueño. En OCR usar recibos anonimizados de proveedores del piloto, medir exactitud por campo y tiempo de revisión.
- Crecimiento de operación: cotizaciones con vigencia y snapshot comercial, conversión idempotente a venta y verificación de stock al confirmar. Devoluciones parciales vinculadas a renglón, tope de cantidades, destino vendible/cuarentena y ajuste de caja/cartera con historial. Trazabilidad después si el rubro la exige: lotes y fechas en recepción/producción, relación insumo→producto→venta, bloqueo de cuarentena y prueba de retiro. Centros de trabajo, MRP y calidad avanzada solo con un proceso observado.
- Fiscal e interoperabilidad: exportación conciliada al contador primero. Si el segmento exige emisión integrada, elegir proveedor, validar credenciales y homologación en pruebas y producción según su flujo, manejar idempotencia y estados/reintentos/rechazos y probar notas y conciliación. Evitar un nuevo motor contable en el primer piloto.
- Servicio gestionado: publicar solo tras pruebas con dos equipos desconectados/reconectados, conflictos y reintentos, restauración de PostgreSQL, aislamiento de empresas, baja de accesos, SMTP y observabilidad. Aclarar qué pasa con permisos de una cuenta local mientras está desconectada. Medir soporte y costos reales por cliente antes de prometer una SLA.
- Indicadores piloto: tiempo hasta primer lote registrado, diferencias de stock y costo frente a la planilla, porcentaje de recibos que requieren corrección, tareas de soporte por empresa, continuidad de uso y disposición a renovar. Metas a pactar con cada cliente; no inventar ahorros.

### Gaps

- El orden propuesto cambia si los primeros compradores exigen lotes, facturación integrada o trabajo multipuesto como condición previa. Confirmarlo en entrevistas y no prometer todos los módulos.
