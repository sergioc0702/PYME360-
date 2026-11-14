# Competidores colombianos e integración fiscal

## ¿Qué hacen mejor Siigo, Alegra y Loggro?

### Takeaway

En Colombia, varias opciones ya unen contabilidad, facturación e inventario, y Alegra y Siigo documentan módulos complementarios de producción. Pyme360 tendría que demostrar valor en un flujo de fabricación concreto, con adopción asistida y uso local, para un taller que ya tiene solución fiscal.

### Cited Findings

- **Siigo Nube.** Sus planes publican facturación electrónica y opciones comerciales, incluida cotización con aprobación y paso a facturación, según plan. Su API documenta productos, terceros, facturas de venta y compra, notas crédito, recibos, cotizaciones, comprobantes, balances de prueba y documento soporte. [Planes Siigo](https://www.siigo.com/precios-siigo?cta=FunCobranzaVerPlanes) · [Siigo API](https://developers.siigo.com/docs/siigoapi/)
- **Siigo Pyme, producto separado de Nube.** El centro de ayuda describe un complemento para presupuestar y ejecutar órdenes; fórmulas de materiales y actividades, operaciones de máquina/operario, costos directos e indirectos, seguimiento, contabilización y cierre. La ayuda confirma capacidades documentadas, sin confirmar disponibilidad contractual a nuevos compradores. [Parámetros de producción](https://siigopyme.portaldeclientes.siigo.com/basedeconocimiento/parametros-generales-modulo-produccion/) · [Procesos de producción](https://siigopyme2.portaldeclientes.siigo.com/procesos-modulo-produccion/)
- **Alegra Contabilidad Colombia.** Documenta factura electrónica, cotizaciones, remisiones, notas, recepción/importación de XML, órdenes de compra, inventario y conciliación bancaria. Sus planes publican acceso para contador, y límites de bodegas, usuarios e ingresos que cambian por plan. La tabla consultada mostraba Emprendedor a COP 74.900 al mes, o COP 674.100 al año bajo el descuento mostrado; usar solo como ancla comercial, no equipararlo a un paquete de manufactura y verificar de nuevo antes de cotizar. [Manual](https://docs.alegra.com/manuales/alegra-contabilidad/index.html) · [Planes Alegra Colombia](https://alegra.com/colombia/contabilidad/precios/)
- **Alegra Producción.** Módulo complementario documentado para Colombia con listas de materiales, subproductos, órdenes Kanban, reserva por bodega, ajuste de cantidades por orden, mermas/sobrantes, historial de costos y servicios de mano de obra, energía, flete o empaque. Su ayuda indica que la versión descrita opera en una misma bodega de origen/destino. Un blog antiguo que dice que Alegra carece de producción está superado por la documentación específica. [Ayuda de Producción de Alegra](https://ayuda.alegra.com/col/modulo-produccion-alegra)
- **Loggro PyME vs. Enterprise.** PyME comercializa compras/ventas, facturación electrónica, cotizaciones, tesorería, inventario y opciones de bodegas e implantación según el plan. Su ayuda para PyME documenta fabricación mediante salidas/entradas y cálculo manual del costo; la página comercial también menciona recetas, que no prueban por sí mismas órdenes de manufactura. Enterprise sí promociona ingeniería, recursos, planeación de órdenes, calidad y costos. [Planes Loggro PyME](https://loggro.com/pymes/) · [Ayuda producción PyME](https://universidad.loggro.com/loggro-pymes/c%C3%B3mo-es-el-manejo-del-proceso-de-producci%C3%B3n-en-loggro-pymes) · [Producción Loggro Enterprise](https://loggro.com/enterprise/sistema-de-produccion/)

### Inferences

- Cotizaciones, bodegas, reservas, mermas y costos directos/indirectos son funcionalidades que ya ofrece al menos un competidor colombiano. Conviene vender un resultado del flujo diario, como cuadrar materiales y costo por unidad buena de forma sencilla y operar localmente durante cortes de conexión.
- La combinación de versión de receta, carga guiada de Excel, operación local y seguimiento de energía por unidad es una hipótesis de diferenciación, que requiere contrastar con clientes y el rendimiento real.

### Gaps

- No se hicieron demos comparativas, pruebas de ergonomía, confirmaciones de precio de complementos ni mediciones de adopción. El alcance por plan, modalidad offline e integraciones puede variar por producto y contrato. La falta de una función en las páginas revisadas no prueba su ausencia.

## ¿Cómo aprovechar el ecosistema fiscal colombiano?

### Takeaway

El primer piloto puede convivir con la contabilidad y facturación actuales. Integrar solo el sistema del primer cliente permite eliminar doble digitación con un alcance comprobable.

### Cited Findings

- La DIAN distingue el servicio gratuito, el software propio y el de un proveedor tecnológico habilitado. Su guía describe registro, configuración del modo y pruebas de habilitación para operar. Evitar cantidades de documentos de prueba, porque las dos páginas oficiales revisadas muestran repartos distintos. [Requisitos DIAN](https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/requerimientos-para-ser-facturador-electronico/) · [Registro y habilitación DIAN](https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/proceso-de-registro-y-habilitacion-como-facturador-electronico/)
- Siigo y Alegra documentan API para interoperar con aplicaciones externas, pero son contratos diferentes. Alegra publica estados de emisión pendiente, aceptación, rechazo y aceptación con observaciones. Que una operación técnica responda correctamente no equivale a aceptación fiscal; la documentación lo explicita para los eventos de comprobantes recibidos. [Siigo API](https://developers.siigo.com/docs/siigoapi/) · [Alegra API](https://developer.alegra.com/) · [Estados Alegra Colombia](https://developer.alegra.com/reference/colombia) · [Eventos en Alegra](https://developer.alegra.com/reference/post_stamp-documents-received-id-response)

### Inferences

- Proponer primero un cierre/exportación con IDs estables, catálogo mapeado e importes comparables, acordado con el contador. Escoger un solo adaptador Siigo/Alegra o un proveedor confirmado por el cliente después de validar contrato, permisos y ambiente de pruebas. Definir dueño de inventario, impuestos y recaudos por sistema. Guardar vínculo a factura externa, idempotencia, bandeja de errores, reconciliación tras respuesta perdida, credenciales protegidas y estados separados de la venta. Validar rechazo, reenvío, nota crédito y conciliación antes de prometer emisión integrada. Un registro operativo de venta y una factura fiscal son objetos distintos.

### Gaps

- Sin prueba con credenciales reales, convenio comercial o habilitación del cliente. No atribuir cumplimiento fiscal a Pyme360 a partir de su adaptador genérico.
