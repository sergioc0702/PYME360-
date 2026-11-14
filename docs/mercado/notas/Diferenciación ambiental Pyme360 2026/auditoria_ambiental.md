# Auditoría ambiental de Pyme360

## ¿Qué está implementado y qué tan sólido es?

### Takeaway

El módulo es un prototipo interno sustancial: captura lecturas con fechas, fuente y calidad, convierte unidades, calcula intensidades mensuales, separa alcances de emisiones, incorpora metas y acciones, y muestra referencias externas con reglas de comparabilidad. No debe describirse todavía como medición certificada ni como huella completa de producto.

### Cited Findings

- `ResourceReading` guarda recurso, actividad, cantidad, unidad, inicio y fin, sede, fuente, calidad y referencia; `EmissionFactor` guarda ámbito, geografía, año, versión, fuente y método. — [types.ts:461](<../../../../frontend/src/domain/types.ts#L461>)
- `saveResourceReading` valida fechas reales, orden cronológico, cantidades no negativas y actividad compatible; evita que residuos recuperados excedan los generados. — [business.ts:145](<../../../../frontend/src/domain/business.ts#L145>)
- Métricas mensuales calculan electricidad, extracción/descarga/consumo de agua, material, contenido reciclado, residuos y alcances 1–3 con `null` cuando faltan datos o factores. — [environmental.ts:432](<../../../../frontend/src/domain/environmental.ts#L432>)
- El factor predeterminado de electricidad es 0,22 kg CO₂e/kWh para SIN 2024; coincide numéricamente con el factor de inventarios 0,220 tCO₂e/MWh, distinto de los factores de proyectos de eficiencia de 0,607/0,554. — [environmental.ts:13](<../../../../frontend/src/domain/environmental.ts#L13>); [UPME, soporte 2024 p. 3](https://docs.upme.gov.co/Normatividad/Soporte_calculo_Factor_de_Emision_2024.pdf)
- El benchmark anual exige 12 lecturas mensuales únicas medidas/confirmadas, producción completa y conversiones a litros; las referencias ONU/XM se presentan como contextuales. El CSV oficial DANE/SUI/EIA incluido contiene solo encabezados. — [environment_benchmarks.py:462](<../../../../server/environment_benchmarks.py#L462>); [official_snapshots.template.csv](<../../../../server/benchmark-data/official_snapshots.template.csv>)
- Hay pruebas para ahorro ajustado por producción, pesos, CO₂ y reparto por producto, además de casos de benchmark anual incompleto. — [insights.test.mjs:74](<../../../../frontend/tests/insights.test.mjs#L74>); [test_environment_benchmarks.py:201](<../../../../server/tests/test_environment_benchmarks.py#L201>)
- Corrección para el equipo: la versión actual SÍ permite registrar mano de obra, energía asignada en COP y gastos indirectos por orden y calcula costo completo solo si se aportan todos esos datos. La respuesta anterior que decía que solo calcula materiales ya quedó desactualizada. — [production-cost.ts:11](<../../../../frontend/src/domain/production-cost.ts#L11>); [AppForms.tsx:2361](<../../../../frontend/src/app/AppForms.tsx#L2361>)

### Inferences

- La arquitectura de `null` para datos insuficientes y factores versionados es una buena base para decisiones internas; el paso siguiente debe mejorar la correspondencia temporal, los límites de cálculo y la trazabilidad antes de publicitar comparaciones ambientales.

### Gaps

- No hay evidencia de una validación con recibos y medidores reales de varias empresas ni de revisión metodológica externa. Las pruebas actuales son datos sintéticos.

## ¿Dónde hay riesgo de cifras engañosas o incorrectas?

### Takeaway

Hay dos defectos de alta prioridad en la agregación temporal y la presentación de resultados incompletos, más límites relevantes en intensidad, ahorro y huella por producto.

### Cited Findings

- `periodForReading` usa únicamente el mes de `periodEnd`; `sumReadings`, el precio unitario y el informe mensual asignan al mes final la cantidad y el costo completos. El formulario, en cambio, acepta periodos arbitrarios y pide escribir las fechas exactas si el recibo no cubre el mes entero. Un recibo del 15 de enero al 14 de febrero queda todo en febrero. — [environmental.ts:131](<../../../../frontend/src/domain/environmental.ts#L131>); [insights.ts:18](<../../../../frontend/src/domain/insights.ts#L18>); [AppForms.tsx:1401](<../../../../frontend/src/app/AppForms.tsx#L1401>)
- `saveResourceReading` no comprueba solapamiento de periodos o duplicación de facturas para electricidad/agua; dos lecturas del mismo medidor y periodo se suman. Sí aplica una regla de balance solo a residuos. — [business.ts:145](<../../../../frontend/src/domain/business.ts#L145>); [environmental.ts:174](<../../../../frontend/src/domain/environmental.ts#L174>)
- `dataCoveragePercent` cuenta las cinco categorías presentes aunque una lectura tenga unidad incompatible o calidad estimada; no equivale a porcentaje de datos completos/medidos. — [environmental.ts:516](<../../../../frontend/src/domain/environmental.ts#L516>)
- `calculateSavings` compara el mes actual con uno base, ajusta por unidades producidas solo si ambos meses tienen producción y multiplica diferencia por tarifa promedio actual. Un cambio de mezcla de productos o de días cubiertos puede parecer ahorro; al faltar producción cae a comparación de totales. — [insights.ts:64](<../../../../frontend/src/domain/insights.ts#L64>); [insights.ts:96](<../../../../frontend/src/domain/insights.ts#L96>)
- El PDF llama `Huella de carbono` a la suma disponible de alcances 1 y 2 aun si uno de ellos es `null`, y `CO2e evitado` a la electricidad comparada frente al mes base, sin detalle de límites/factores en el informe. La propia nota admite que no es certificado oficial. — [report.ts:46](<../../../../frontend/src/features/environment/report.ts#L46>); [report.ts:120](<../../../../frontend/src/features/environment/report.ts#L120>)
- `calculateProductFootprint` reparte toda la electricidad, agua y alcances 1+2 entre productos según cantidad de unidades buenas; admite que supone igual consumo por unidad sin importar producto. Por ello una bebida de 250 ml y una de 2 L recibirían la misma carga por unidad. — [insights.ts:183](<../../../../frontend/src/domain/insights.ts#L183>)
- El Scope 3 de compras obtiene la actividad en la unidad ambiental de la línea (por ejemplo kg), pero `factorFor` admite factores de cualquier unidad convertible y luego multiplica directamente `activityQuantity` sin convertirla a `factor.activityUnit`; un factor por tonelada aplicado a kg puede errar por 1000. Además el catálogo declara `transport` pero el cálculo actual solo incluye compras de materiales y residuos. — [environmental.ts:240](<../../../../frontend/src/domain/environmental.ts#L240>); [environmental.ts:341](<../../../../frontend/src/domain/environmental.ts#L341>); [types.ts:482](<../../../../frontend/src/domain/types.ts#L482>)
- Agua neta se calcula como extracción menos descarga si ambas existen. Es una estimación permitida por GRI 303 cuando no se mide directamente, pero el estándar también trata almacenamiento y calidad/localización del agua, que Pyme360 no captura. — [environmental.ts:454](<../../../../frontend/src/domain/environmental.ts#L454>); [GRI 303](https://www.globalreporting.org/publications/documents/english/gri-303-water-and-effluents-2018/)
- La referencia Coca-Cola 2024 se marca `comparability: direct` y permite un porcentaje de brecha si coinciden L/L y año; el dato proviene del sistema global Coca-Cola (1,78 L/L, con exclusiones y extrapolaciones), por lo que igualdad de unidad no garantiza igual producto, proceso, límites ni escala con una microempresa de Boyacá. El propio código dice que no es objetivo normativo. — [environment_benchmarks.py:425](<../../../../server/environment_benchmarks.py#L425>); [environment_benchmarks.py:545](<../../../../server/environment_benchmarks.py#L545>); [Coca-Cola Environmental Update 2024 pp. 5 y 9](https://www.coca-colacompany.com/content/dam/company/us/en/reports/2024-environmental-update/2024-environmental-update.pdf)

### Inferences

- La cifra de huella de producto debe presentarse como reparto ilustrativo, nunca como huella verificada de un SKU; el ahorro frente a un mes tampoco prueba causalidad de una acción. Para comparar de forma honesta deben fijarse límites, periodo, mezcla y calidad del dato.
- El factor UPME de inventario está bien seleccionado para Scope 2 basado en ubicación; para estimaciones de impacto de medidas conviene etiquetar la diferencia como ilustrativa y separar la metodología de proyectos de eficiencia (UPME publica factores distintos para ese uso).

### Gaps

- No encontré prueba específica para recibos que cruzan meses, periodos duplicados, factor Scope 3 en t frente a actividad en kg, ni PDF con solo un alcance disponible.
- No se demostró que la referencia Coca-Cola tenga un límite operativo comparable al de una microempresa concreta; por defecto debería ser contexto.

## ¿Qué corregir primero y qué función podría diferenciar el producto?

### Takeaway

Primero hay que hacer confiables los datos de entrada y la semántica de los indicadores. Luego puede diferenciarse con decisiones por orden de producción, ligadas a mediciones y al resultado real, sin prometer huellas certificadas.

### Cited Findings

- El propio GHG Protocol diferencia factores promedio de red para Scope 2, datos contractuales de mercado y factores de fuentes; los resultados deben dejar explícito el método y límite. — [GHG Protocol Scope 2 Guidance](https://ghgprotocol.org/sites/default/files/GHG%20Protocol%20Scope%202%20Guidance.pdf)
- GHG Protocol advierte que datos Scope 3 más específicos del proveedor no necesariamente son más exactos: la fiabilidad depende de granularidad, fuentes y asignación. — [GHG Protocol Scope 3 Calculation Guidance, categoría 1](https://ghgprotocol.org/sites/default/files/standards/Scope3_Calculation_Guidance_0.pdf)
- La interfaz ya tiene calidad y fuente por lectura, metas aprobadas, plan de acciones y costo real por orden cuando se registran todos los importes; son puntos de partida para cerrar el ciclo entre medición, recomendación y verificación. — [types.ts:461](<../../../../frontend/src/domain/types.ts#L461>); [insights.ts:305](<../../../../frontend/src/domain/insights.ts#L305>); [production-cost.ts:11](<../../../../frontend/src/domain/production-cost.ts#L11>)

### Inferences

- Prioridad 1: detectar facturas/lecturas solapadas y normalizar periodos; repartir consumo entre meses solo con regla explícita (idealmente lecturas de medidor por día; si se prorratea, marcar estimado), o exigir periodos mensuales cerrados para las métricas.
- Prioridad 2: renombrar `Cobertura de datos` a categorías registradas o calcular cobertura por días, calidad, unidad y fuente; en PDF distinguir alcance parcial y cambiar `CO2e evitado` por `diferencia estimada frente a línea base`.
- Prioridad 3: convertir unidad en Scope 3 antes de multiplicar, y volver contextual la referencia Coca-Cola por defecto. Mantener DANE/SUI/EIA sin brecha mientras no haya valores oficiales revisados.
- Diferenciación plausible: por orden/lote, registrar horas, kg de merma, energía/agua medidos por submedidor o asignados con regla visible; mostrar COP/unidad buena y recursos/unidad; crear una acción concreta y verificar el resultado con un periodo equivalente. Los cálculos incompletos deben quedar como desconocidos, no ceros.

### Gaps

- La oportunidad comercial debe validarse con empresas usuarias; el código y las normas solo prueban viabilidad técnica y límites metodológicos.
