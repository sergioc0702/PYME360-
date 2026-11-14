# Competencia y espacio de diferenciación

## ¿Qué funciones ya cubren los ERP y software pyme en 2026?

### Takeaway
Ni recetas, costos de producción, merma, trazabilidad, operación sin red ni huella ambiental son únicos por sí solos. La comparación debe centrarse en la experiencia específica para microfabricantes y en la evidencia detrás de cada recomendación.

### Cited Findings
- Alegra Colombia documenta un módulo complementario de producción con listas de materiales, reservas de stock, costo de insumos, costos adicionales como mano de obra, energía y empaque, mermas, sobrantes y costo real al completar la orden. Su página indica copyright 2026; la fecha exacta de lanzamiento no aparece. — [Ayuda oficial Alegra, módulo de producción](https://ayuda.alegra.com/col/modulo-produccion-alegra)
- Odoo documenta órdenes y centros de trabajo, recetas, escaneo de lotes y series, control de calidad, merma, trazabilidad de componentes y costos de materiales y operaciones. Su página de manufactura también anuncia funcionamiento sin Wi-Fi del registro en planta. — [Odoo Manufacturing Features](https://www.odoo.com/app/manufacturing-features), [Odoo Manufacturing](https://www.odoo.com/app/manufacturing)
- ERPNext documenta orden de trabajo, listas de materiales, control de calidad, planeación, reportes de costos y eficiencia; las entradas de consumo real pueden determinar costo de materiales. — [ERPNext Manufacturing](https://docs.frappe.io/erpnext/manufacturing), [ERPNext Manufacturing Settings](https://docs.frappe.io/erpnext/manufacturing-settings)
- Alegra se presenta como software administrativo en nube para Colombia con facturación, contabilidad, POS, nómina, compras, cartera, cotizaciones e inventario. — [Alegra Software Administrativo](https://www.alegra.com/colombia/software-administrativo/)

### Inferences
- No recomendar como diferenciador único «tenemos producción y cotizaciones», «registramos energía como costo» o «trabajamos sin Wi-Fi». Alegra, Odoo y ERPNext ya cubren partes importantes.
- Una interfaz de captura muy corta para microfabricantes de Boyacá podría diferenciarse de suites amplias, pero es hipótesis comercial, no conclusión probada por las páginas de los vendedores.

### Gaps
- Las fuentes oficiales no permiten comparar tiempo real de puesta en marcha, satisfacción de usuarios ni costo total de propiedad entre los productos. Son páginas de proveedores, no estudios independientes.
- No se verificó con uso directo si la promesa de funcionamiento sin Wi-Fi de Odoo cubre todas las operaciones o solo la interfaz de planta.

## ¿Qué tan saturada está la propuesta ambiental?

### Takeaway
La captura de recursos, el cálculo de CO₂ y la conexión con datos operativos ya forman parte de ERP grandes. Una propuesta diferenciada debe traducir datos medidos a decisiones verificables para un negocio pequeño, con límites de precisión visibles.

### Cited Findings
- Odoo ESG anuncia recopilación de datos empresariales ya presentes en Odoo y huella a partir de compras, desplazamientos y consumo de energía, con biblioteca de factores de emisión y reportes. — [Odoo ESG](https://www.odoo.com/app/esg)
- Microsoft anunció el 3 de noviembre de 2026 que incorporaba Sustainability Manager a la cartera Dynamics 365 ERP para vincular energía, agua, materiales y datos de producto con decisiones operativas y financieras; presenta la conexión más profunda como dirección de producto. — [Blog oficial Microsoft Dynamics, 2026-11-03](https://www.microsoft.com/en-us/dynamics-365/blog/business-leader/2026/11/03/bringing-sustainability-into-the-dynamics-365-erp-portfolio/)
- Dynamics 365 Sustainability anuncia gestión de carbono, agua, residuos y energía, además de detección de oportunidades de reducción. — [Microsoft Dynamics 365 Sustainability](https://www.microsoft.com/en-us/dynamics-365/products/sustainability)
- SAP Business One tiene documentación de integración con SAP Sustainability Footprint Management para huella de productos, datos de operaciones y benchmarking. — [SAP Help Portal](https://help.sap.com/docs/SAP_BUSINESS_ONE/8a7b426a60654b4cbedb0ac8605a5be9/960dc1b9722448b389e94a525a3edc4a.html)

### Inferences
- Espacio plausible: «decisión de ahorro para el próximo lote» que una receta, consumo real o asignado, merma, costo y precio de venta; expresa pesos y unidades físicas, la fuente de cada dato, incertidumbre y verifica si la acción produjo ahorro. Las fuentes revisadas muestran capacidades ambientales, pero no establecen que ese flujo sencillo y local esté resuelto para microfabricantes colombianos.
- Evitar afirmar «primero/único ERP ambiental». Odoo, Microsoft y SAP ya ofrecen funciones de sostenibilidad.

### Gaps
- La ausencia de una función en las páginas consultadas no prueba que los competidores no la tengan. Haría falta prueba práctica de flujos y entrevistas con usuarios para validar diferencia de experiencia.
- Las fuentes de vendedores no prueban exactitud de huella por lote ni ahorros reales.

## ¿Qué funciones podrían diferenciar a Pyme360 sin servicios de pago y con qué dificultad?

### Takeaway
El núcleo viable sería un ciclo de medir, recomendar, ejecutar y comprobar por lote o por mes, implementado con SQLite y cálculos transparentes. Conviene priorizar datos fiables y una prueba en empresas reales antes de añadir predicciones o IA.

### Cited Findings
- Alegra permite registrar energía como costo adicional de una receta, pero la documentación revisada lo describe como ítem tipo servicio por unidad y no demuestra un flujo de lectura de medidor, intensidad por lote y verificación posterior de ahorro. — [Ayuda oficial Alegra, módulo de producción](https://ayuda.alegra.com/col/modulo-produccion-alegra)
- Odoo documenta costo de materiales y operaciones por orden, trazabilidad y desperdicio; Odoo ESG documenta huella desde datos empresariales. Esas son capacidades competitivas que obligan a diseñar un flujo realmente más simple para el segmento objetivo. — [Odoo Manufacturing Features](https://www.odoo.com/app/manufacturing-features), [Odoo ESG](https://www.odoo.com/app/esg)
- Microsoft declara como objetivo pasar de entender el impacto a influir en las operaciones que lo causan; esto indica que el vínculo acción-impacto es un reto también en suites grandes. — [Blog oficial Microsoft Dynamics, 2026-11-03](https://www.microsoft.com/en-us/dynamics-365/blog/business-leader/2026/11/03/bringing-sustainability-into-the-dynamics-365-erp-portfolio/)

### Inferences
- **Prioridad alta, dificultad media:** ficha de cierre de lote: materiales y merma reales, unidades buenas, horas de trabajo, medición eléctrica/hídrica opcional y costo por unidad. Exigir distinguir «medido», «prorrateado» y «sin dato»; nunca presentar una asignación mensual como medición exacta del lote. SQLite basta.
- **Prioridad alta, dificultad media:** simulador «si bajo la merma X puntos / si produzco Y unidades / si cambio precio Z» que enseñe pesos, kWh o litros solo cuando hay base suficiente, con supuestos editables y rango de sensibilidad. Motor determinista local, sin API de IA.
- **Prioridad alta, dificultad media:** ficha de acción con responsable, línea base, fecha de implantación y comparación después de 2–3 lotes o meses; ahorro validado separado del estimado. SQLite basta.
- **Prioridad media, dificultad alta:** alertas de calidad de datos: facturas duplicadas, lecturas fuera de patrón, unidades incompatibles, meses faltantes, factor de emisión desactualizado, prorrateos inciertos; se debe validar con datos reales antes de prometer precisión.
- **Prioridad media, dificultad alta:** comparador anónimo entre negocios solo con consentimiento y metodología homogénea. No cabe en modo SQLite aislado si implica datos compartidos; alternativa gratuita inicial: comparar cada empresa con su propio historial.

### Gaps
- Ninguna fuente demuestra demanda pagadora por estas funciones en microfabricantes de Boyacá. Validar con entrevistas y un piloto de uso real.
- Para cuantificar ahorro de agua/energía por lote con rigor hacen falta mediciones dedicadas o reglas de asignación justificadas; si no existen, presentar solo estimaciones.
