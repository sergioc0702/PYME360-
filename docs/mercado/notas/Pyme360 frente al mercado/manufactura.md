# Odoo y ERPNext en manufactura

## Qué profundidad industrial documentan

### Takeaway

Los dos son referentes claros para producción por lotes, costos de operación y planificación. Odoo documenta una localización colombiana con rutas de facturación electrónica. ERPNext documenta un plan contable colombiano y modalidades de alojamiento gestionado o propio.

### Cited Findings

- **Odoo 19** documenta listas de materiales, listas multinivel, órdenes y centros de trabajo, planificación, mermas, lotes y números de serie, subcontratación y operación en planta. Sus centros registran costos, capacidad y eficiencia. Para productos configurados con rastreo, se asigna lote o número de serie antes de completar la fabricación. [Manufactura](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/manufacturing.html) · [Centros de trabajo](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/manufacturing/advanced_configuration/using_work_centers.html) · [Lotes y series](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/manufacturing/workflows/manufacture_lots_serials.html)
- **Odoo** distingue costo estimado y real por orden. Considera materiales y operaciones, incluyendo tiempos y tarifas de centro y personal según la configuración. Su planificación maestra propone reposición según pronóstico y objetivos de existencias, con decisión humana para crear compras u órdenes. La aplicación de Calidad genera controles por operación y producto. [Costo de una orden](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/manufacturing/basic_setup/mo_costs.html) · [Plan maestro](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/manufacturing/workflows/use_mps.html) · [Puntos de control](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/quality/quality_management/quality_control_points.html)
- **ERPNext** planifica materiales y fabricación a partir de pedidos de venta o solicitudes internas. Las órdenes vinculan lista de materiales, estaciones, almacenes y tareas de operación. Distingue costo de operación previsto, real (de las tarjetas de trabajo) y adicional. Puede programar operaciones según la disponibilidad de cada estación. [Plan de producción](https://docs.frappe.io/erpnext/production-plan) · [Órdenes de trabajo](https://docs.frappe.io/erpnext/work-order#33-operation-cost)
- **ERPNext** registra lotes en inventario y puede crearlos al aprobar órdenes; permite inspecciones en recepción, salida y proceso, ligadas a documentos o tarjetas de trabajo, con criterios numéricos u otros. [Lotes](https://docs.frappe.io/erpnext/batch) · [Configuración de manufactura](https://docs.frappe.io/erpnext/manufacturing-settings) · [Inspecciones](https://docs.frappe.io/erpnext/quality-inspection)

### Inferences

- Pyme360 puede aprovechar su receta versionada, el consumo fijado por orden y su libro de inventario para llegar a un flujo comercial concreto. La unidad de valor sería rastrear un insumo recibido hasta producto y cliente, explicar mermas y reconstruir el costo de una orden. Sus indicadores de intensidad ambiental se pueden incorporar como capa opcional que indique si el consumo fue medido o estimado. El plan maestro y la capacidad finita tienen sentido cuando el cliente ya registra órdenes, materiales y rendimientos de forma fiable. [Alcance actual de Pyme360](<../../../../README.md#L37>)

### Gaps

- Comparación documental. Quedan por medir esfuerzo de implantación, facilidad de uso, tiempos reales de trabajo, soporte, precio total y disponibilidad de funciones por edición/configuración. No se verificó la cobertura ambiental de estos competidores.

## Qué implican despliegue y localización

### Takeaway

Odoo ofrece un punto de comparación en manufactura y fiscalidad colombiana. ERPNext sirve como referencia funcional y de alojamiento. Instalar un ERP en servidor propio y ejecutar una estación de Pyme360 sin Internet son capacidades distintas.

### Cited Findings

- **Odoo** publica Odoo Online, Odoo.sh y alojamiento en instalaciones propias en su oferta Custom. Su documentación 19.0 describe módulos de plan de cuentas, impuestos, retenciones y facturación electrónica por módulos para integración con DIAN como software propio o mediante Carvajal. La configuración incluye un entorno de certificación. [Planes de Odoo](https://www.odoo.com/pricing) · [Localización Colombia](https://www.odoo.com/documentation/19.0/es_419/applications/finance/fiscal_localizations/colombia.html)
- **ERPNext** permite alojamiento propio y Frappe Cloud, con implementación separada. Frappe documenta la GPL-3.0 y ofrece servicios de hosting y soporte. Su documentación lista un plan de cuentas preconfigurado para Colombia. El plan de cuentas por sí solo acredita solo esa capacidad de localización. [Alojamiento e implementación](https://frappe.io/erpnext/pricing) · [Planes contables regionales](https://docs.frappe.io/erpnext/regional-chart-of-accounts)
- **Pyme360** documenta ejecución local con SQLite en un equipo, sincronización central opcional y adaptador a proveedor externo de facturación. La contabilidad formal de partida doble queda fuera del alcance actual. [Arquitectura y límites de Pyme360](<../../../../README.md#L75>)

### Inferences

- Para probar la propuesta conviene ofrecer instalación y migración acompañadas, documentar el flujo desconectado y comparar el costo completo de operación. Odoo y ERPNext pueden alojarse localmente, por lo que la instalación en sí es un argumento insuficiente. Tiene más valor demostrar cuánto tarda el cliente en arrancar y cómo puede recuperar su operación ante un corte o daño de un equipo.

### Gaps

- No se confirmó facturación DIAN oficial de ERPNext en la documentación revisada. Pueden existir aplicaciones o integraciones de terceros. No se compararon tarifas efectivas por cliente ni condiciones de edición y soporte de cada instalación.
