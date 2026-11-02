import type {
  AppState,
  EmissionFactor,
  EnvironmentalRecord,
  IndicatorId,
  IndicatorTarget,
  ResourceKind,
  ResourceReading,
} from "./types";

export const DEFAULT_SITE_ID = "site-main";

export const DEFAULT_EMISSION_FACTORS: EmissionFactor[] = [
  {
    id: "factor-upme-sin-2024",
    scope: 2,
    activity: "electricity",
    kgCo2ePerUnit: 0.22,
    activityUnit: "kWh",
    geography: "Colombia SIN",
    year: 2024,
    version: "Factor de inventario GEI SIN 2024 · Resolución UPME 0085 de 2026",
    source:
      "UPME, soporte de cálculo del factor de emisión 2024: https://docs.upme.gov.co/Normatividad/Soporte_calculo_Factor_de_Emision_2024.pdf",
    method: "Inventario GEI, basado en ubicación",
  },
];

export interface IndicatorDefinition {
  id: IndicatorId;
  label: string;
  unit: string;
  cadence: string;
  formula: string;
}

export const INDICATOR_CATALOG: IndicatorDefinition[] = [
  {
    id: "energy-intensity",
    label: "Intensidad de energía",
    unit: "kWh/unidad",
    cadence: "Diaria si hay medidor; conciliación mensual",
    formula: "Electricidad medida (kWh) ÷ producción buena",
  },
  {
    id: "water-intensity",
    label: "Intensidad de agua",
    unit: "m³/unidad",
    cadence: "Diaria o por turno; conciliación mensual",
    formula: "Agua retirada (m³) ÷ producción buena; consumo neto requiere medir descarga",
  },
  {
    id: "material-intensity",
    label: "Material por unidad",
    unit: "kg/unidad",
    cadence: "Por orden de producción; resumen mensual",
    formula: "Material consumido convertido a kg ÷ producción buena",
  },
  {
    id: "recycled-material-share",
    label: "Material reciclado",
    unit: "%",
    cadence: "Por compra recibida; resumen mensual",
    formula: "kg comprados con contenido reciclado ÷ kg comprados × 100",
  },
  {
    id: "waste-recovery",
    label: "Recuperación de residuos",
    unit: "%",
    cadence: "Por pesaje/recolección; conciliación mensual",
    formula: "kg recuperados ÷ kg generados × 100",
  },
  {
    id: "scope-1",
    label: "Emisiones Alcance 1",
    unit: "kg CO₂e",
    cadence: "Mensual con factores documentados",
    formula: "Actividad de combustibles × factor compatible",
  },
  {
    id: "scope-2",
    label: "Emisiones Alcance 2",
    unit: "kg CO₂e",
    cadence: "Mensual con factor eléctrico del año y ubicación",
    formula: "Electricidad comprada (kWh) × factor de red versionado",
  },
  {
    id: "scope-3",
    label: "Emisiones Alcance 3 disponible",
    unit: "kg CO₂e",
    cadence: "Mensual; revisión anual",
    formula: "Compras, transporte y residuos con actividad y factores documentados",
  },
  {
    id: "data-coverage",
    label: "Cobertura de datos",
    unit: "%",
    cadence: "Semanal o mensual",
    formula: "Categorías ambientales con lecturas ÷ 5 categorías seguidas × 100",
  },
];

export interface MonthlyEnvironmentalMetrics {
  period: string;
  electricityKwh: number | null;
  energyPerUnit: number | null;
  waterWithdrawalM3: number | null;
  waterDischargeM3: number | null;
  waterConsumptionM3: number | null;
  waterPerUnit: number | null;
  materialConsumedKg: number | null;
  materialPerUnit: number | null;
  recycledMaterialPercent: number | null;
  wasteGeneratedKg: number | null;
  wasteRecoveredKg: number | null;
  wasteRecoveryPercent: number | null;
  scope1KgCo2e: number | null;
  scope2KgCo2e: number | null;
  scope3KgCo2e: number | null;
  scope1FactorIds: string[];
  scope2FactorIds: string[];
  scope3FactorIds: string[];
  scope3Categories: string[];
  dataCoveragePercent: number;
  readingCount: number;
  latestReadingAt: string | null;
  estimatedReadingCount: number;
}

function periodForReading(reading: ResourceReading): string {
  return reading.periodEnd.slice(0, 7);
}

function periodForDate(value: string): string {
  return value.slice(0, 7);
}

export function convertUnit(quantity: number, fromUnit: string, toUnit: string): number | null {
  const normalize = (unit: string) =>
    unit.trim().toLowerCase().replaceAll("³", "3").replaceAll(" ", "");
  const from = normalize(fromUnit);
  const to = normalize(toUnit);
  const aliases: Record<
    string,
    { family: "energy" | "water" | "mass" | "volume"; toBase: number }
  > = {
    wh: { family: "energy", toBase: 0.001 },
    kwh: { family: "energy", toBase: 1 },
    mwh: { family: "energy", toBase: 1000 },
    m3: { family: "water", toBase: 1 },
    litro: { family: "water", toBase: 0.001 },
    litros: { family: "water", toBase: 0.001 },
    l: { family: "water", toBase: 0.001 },
    ml: { family: "water", toBase: 0.000001 },
    kg: { family: "mass", toBase: 1 },
    kilogramo: { family: "mass", toBase: 1 },
    kilogramos: { family: "mass", toBase: 1 },
    g: { family: "mass", toBase: 0.001 },
    gramo: { family: "mass", toBase: 0.001 },
    gramos: { family: "mass", toBase: 0.001 },
    t: { family: "mass", toBase: 1000 },
    tonelada: { family: "mass", toBase: 1000 },
    toneladas: { family: "mass", toBase: 1000 },
    lb: { family: "mass", toBase: 0.45359237 },
  };
  if (from === to) return quantity;
  const source = aliases[from];
  const target = aliases[to];
  if (!source || !target || source.family !== target.family) return null;
  return (quantity * source.toBase) / target.toBase;
}

function sumReadings(
  readings: ResourceReading[],
  resource: ResourceKind,
  activity: ResourceReading["activity"],
  period: string,
  unit?: string,
): number | null {
  const selected = readings.filter(
    (reading) =>
      reading.resource === resource &&
      reading.activity === activity &&
      periodForReading(reading) === period,
  );
  if (!selected.length) return null;
  const converted = selected.map((reading) =>
    unit ? convertUnit(reading.quantity, reading.unit, unit) : reading.quantity,
  );
  return converted.some((quantity) => quantity === null)
    ? null
    : (converted as number[]).reduce((sum, quantity) => sum + quantity, 0);
}

function productionForPeriod(
  state: AppState,
  period: string,
): { units: number | null; materialKg: number | null } {
  const orders = state.productionOrders.filter(
    (order) =>
      order.status === "completed" && periodForDate(order.completedAt || order.date) === period,
  );
  const productUnits = orders.reduce(
    (sum, order) => sum + Math.max(0, order.quantity - order.wasteQuantity),
    0,
  );
  let unsupportedMaterialUnit = false;
  const materialKg = orders.reduce(
    (sum, order) =>
      sum +
      order.consumedMaterials.reduce((materialSum, item) => {
        if (
          item.environmentalUnit?.toLowerCase() !== "kg" ||
          !item.environmentalConversionFactor ||
          item.environmentalConversionFactor <= 0
        ) {
          unsupportedMaterialUnit = true;
          return materialSum;
        }
        return materialSum + item.quantity * item.environmentalConversionFactor;
      }, 0),
    0,
  );
  if (orders.length)
    return {
      units: productUnits || null,
      materialKg: unsupportedMaterialUnit || materialKg === 0 ? null : materialKg,
    };

  const legacyRows = state.environmentalRecords.filter(
    (record) => record.period === period && record.productionUnits > 0,
  );
  const legacyUnits = legacyRows.reduce((sum, record) => sum + record.productionUnits, 0);
  return { units: legacyUnits || null, materialKg: null };
}

function factorFor(
  state: AppState,
  scope: EmissionFactor["scope"],
  activity: EmissionFactor["activity"],
  unit: string,
  period: string,
): EmissionFactor | null {
  const year = Number(period.slice(0, 4));
  const geography = state.environmentalConfig?.geography ?? "Colombia SIN";
  const candidates = state.emissionFactors.filter(
    (factor) =>
      factor.scope === scope &&
      factor.activity === activity &&
      factor.year === year &&
      (factor.geography === geography ||
        factor.geography === "Colombia" ||
        factor.geography === "Global") &&
      convertUnit(1, unit, factor.activityUnit) !== null,
  );
  if (!candidates.length) return null;
  const exact = candidates.filter((factor) => factor.geography === geography);
  const preferred = exact.length ? exact : candidates;
  return preferred.length === 1 ? preferred[0] : null;
}

function emissionsForPeriod(
  state: AppState,
  readings: ResourceReading[],
  period: string,
): {
  scope1: number | null;
  scope2: number | null;
  scope3: number | null;
  scope1FactorIds: string[];
  scope2FactorIds: string[];
  scope3FactorIds: string[];
  scope3Categories: string[];
} {
  const fuelReadings = readings.filter(
    (reading) =>
      reading.resource === "fuel" &&
      reading.activity === "consumption" &&
      periodForReading(reading) === period,
  );
  const electricity = readings.filter(
    (reading) =>
      reading.resource === "electricity" &&
      reading.activity === "consumption" &&
      periodForReading(reading) === period,
  );
  const waste = readings.filter(
    (reading) =>
      reading.resource === "waste" &&
      reading.activity === "generated" &&
      periodForReading(reading) === period,
  );

  let scope1: number | null = fuelReadings.length ? 0 : null;
  const scope1FactorIds: string[] = [];
  let missingScope1Factor = false;
  for (const reading of fuelReadings) {
    const factor = factorFor(state, 1, "fuel", reading.unit, period);
    if (factor) {
      scope1 =
        (scope1 ?? 0) +
        (convertUnit(reading.quantity, reading.unit, factor.activityUnit) ?? 0) *
          factor.kgCo2ePerUnit;
      scope1FactorIds.push(factor.id);
    } else missingScope1Factor = true;
  }
  if (missingScope1Factor) scope1 = null;

  let scope2: number | null = electricity.length ? 0 : null;
  const scope2FactorIds: string[] = [];
  let missingScope2Factor = false;
  for (const reading of electricity) {
    const factor = factorFor(state, 2, "electricity", reading.unit, period);
    if (factor) {
      scope2 =
        (scope2 ?? 0) +
        (convertUnit(reading.quantity, reading.unit, factor.activityUnit) ?? 0) *
          factor.kgCo2ePerUnit;
      scope2FactorIds.push(factor.id);
    } else missingScope2Factor = true;
  }
  if (missingScope2Factor) scope2 = null;

  const scope3Categories: string[] = [];
  let scope3 = 0;
  let hasScope3 = false;
  let missingScope3Factor = false;
  const scope3FactorIds: string[] = [];
  const purchases = state.purchases.filter(
    (purchase) => purchase.status === "received" && periodForDate(purchase.date) === period,
  );
  for (const purchase of purchases) {
    for (const line of purchase.lines) {
      const product = state.products.find((item) => item.id === line.productId);
      if (!product || product.type === "finished") continue;
      const factor = factorFor(state, 3, "material_purchase", line.environmentalUnit || "", period);
      if (
        !factor ||
        !line.environmentalConversionFactor ||
        line.environmentalConversionFactor <= 0
      ) {
        missingScope3Factor = true;
        continue;
      }
      const activityQuantity = line.quantity * line.environmentalConversionFactor;
      scope3 += activityQuantity * factor.kgCo2ePerUnit;
      hasScope3 = true;
      scope3FactorIds.push(factor.id);
      if (!scope3Categories.includes("Compras de materiales"))
        scope3Categories.push("Compras de materiales");
    }
  }
  for (const reading of waste) {
    const factor = factorFor(state, 3, "waste", reading.unit, period);
    if (!factor) {
      missingScope3Factor = true;
      continue;
    }
    scope3 +=
      (convertUnit(reading.quantity, reading.unit, factor.activityUnit) ?? 0) *
      factor.kgCo2ePerUnit;
    hasScope3 = true;
    scope3FactorIds.push(factor.id);
    if (!scope3Categories.includes("Residuos")) scope3Categories.push("Residuos");
  }
  return {
    scope1,
    scope2,
    scope3: hasScope3 && !missingScope3Factor ? scope3 : null,
    scope1FactorIds: scope1 === null ? [] : scope1FactorIds,
    scope2FactorIds: scope2 === null ? [] : scope2FactorIds,
    scope3FactorIds: hasScope3 && !missingScope3Factor ? scope3FactorIds : [],
    scope3Categories,
  };
}

function legacyReadings(records: EnvironmentalRecord[]): ResourceReading[] {
  const readings: ResourceReading[] = [];
  for (const record of records) {
    const periodStart = `${record.period}-01`;
    const periodEnd = new Date(
      Date.UTC(Number(record.period.slice(0, 4)), Number(record.period.slice(5, 7)), 0),
    )
      .toISOString()
      .slice(0, 10);
    const base = {
      siteId: DEFAULT_SITE_ID,
      periodStart,
      periodEnd,
      source: record.source ?? ("legacy" as const),
      quality: "confirmed" as const,
      capturedAt: record.lastUpdatedAt ?? new Date(`${periodEnd}T12:00:00Z`).toISOString(),
      legacyRecordId: record.id,
    };
    const add = (
      resource: ResourceKind,
      activity: ResourceReading["activity"],
      quantity: number,
      unit: string,
    ) => {
      if (quantity <= 0) return;
      readings.push({
        id: `legacy-${record.id}-${resource}-${activity}`,
        resource,
        activity,
        quantity,
        unit,
        ...base,
        sourceLabel: `Migrado: ${record.sourceLabel ?? "registro ambiental mensual"}`,
        receiptImportId: record.receiptImportId,
      });
    };
    add("electricity", "consumption", record.electricityKwh, "kWh");
    add("water", "withdrawal", record.waterM3, "m³");
    add("fuel", "consumption", record.fuelLiters, "L");
    add("waste", "generated", record.wasteKg, "kg");
    add("waste", "recovered", record.recoveredKg, "kg");
  }
  return readings;
}

export function migrateLegacyReadings(records: EnvironmentalRecord[]): ResourceReading[] {
  return legacyReadings(records);
}

export function calculateMonthlyEnvironmentalMetrics(
  state: AppState,
): MonthlyEnvironmentalMetrics[] {
  const periods = new Set<string>();
  for (const reading of state.resourceReadings) periods.add(periodForReading(reading));
  for (const record of state.environmentalRecords) periods.add(record.period);
  for (const order of state.productionOrders)
    if (order.status !== "cancelled")
      periods.add(
        periodForDate(
          order.status === "completed" && order.completedAt ? order.completedAt : order.date,
        ),
      );
  for (const purchase of state.purchases)
    if (purchase.status === "received") periods.add(periodForDate(purchase.date));

  return [...periods].sort().map((period) => {
    const readings = state.resourceReadings.filter(
      (reading) => periodForReading(reading) === period,
    );
    const production = productionForPeriod(state, period);
    const electricityKwh = sumReadings(readings, "electricity", "consumption", period, "kWh");
    const withdrawal = sumReadings(readings, "water", "withdrawal", period, "m³");
    const discharge = sumReadings(readings, "water", "discharge", period, "m³");
    const waterConsumptionM3 =
      withdrawal !== null && discharge !== null && discharge <= withdrawal
        ? withdrawal - discharge
        : null;
    const materialConsumedKg =
      production.materialKg ?? sumReadings(readings, "material", "consumption", period, "kg");
    const materialPurchaseLines = state.purchases
      .filter(
        (purchase) => purchase.status === "received" && periodForDate(purchase.date) === period,
      )
      .flatMap((purchase) => purchase.lines)
      .filter((line) =>
        state.products.some(
          (product) => product.id === line.productId && product.type !== "finished",
        ),
      );
    const purchasedKg = materialPurchaseLines.reduce(
      (sum, line) =>
        line.environmentalUnit?.toLowerCase() === "kg" &&
        line.environmentalConversionFactor &&
        line.environmentalConversionFactor > 0
          ? sum + line.quantity * line.environmentalConversionFactor
          : sum,
      0,
    );
    const recycledSummary = state.purchases
      .filter(
        (purchase) => purchase.status === "received" && periodForDate(purchase.date) === period,
      )
      .flatMap((purchase) => purchase.lines)
      .reduce(
        (summary, line) => {
          const product = state.products.find((item) => item.id === line.productId);
          if (
            !product ||
            product.type === "finished" ||
            line.environmentalUnit?.toLowerCase() !== "kg" ||
            !line.environmentalConversionFactor ||
            line.environmentalConversionFactor <= 0
          )
            return summary;
          const massKg = line.quantity * line.environmentalConversionFactor;
          if (line.recycledContentPercent === undefined)
            return { ...summary, totalKg: summary.totalKg + massKg };
          return {
            totalKg: summary.totalKg + massKg,
            knownKg: summary.knownKg + massKg,
            recycledKg: summary.recycledKg + (massKg * line.recycledContentPercent) / 100,
          };
        },
        { totalKg: 0, knownKg: 0, recycledKg: 0 },
      );
    const hasUnconvertedPurchaseMaterial = materialPurchaseLines.some(
      (line) =>
        line.environmentalUnit?.toLowerCase() !== "kg" ||
        !line.environmentalConversionFactor ||
        line.environmentalConversionFactor <= 0,
    );
    const wasteGeneratedKg = sumReadings(readings, "waste", "generated", period, "kg");
    const wasteRecoveredKg = sumReadings(readings, "waste", "recovered", period, "kg");
    const emissions = emissionsForPeriod(state, state.resourceReadings, period);
    const categoriesPresent = new Set<ResourceKind>();
    for (const reading of readings) categoriesPresent.add(reading.resource);
    const hasMaterialActivity =
      materialPurchaseLines.length > 0 ||
      state.productionOrders.some(
        (order) =>
          order.status === "completed" &&
          periodForDate(order.completedAt || order.date) === period &&
          order.consumedMaterials.length > 0,
      );
    if (hasMaterialActivity || production.materialKg !== null || purchasedKg > 0)
      categoriesPresent.add("material");
    const coverage = (categoriesPresent.size / 5) * 100;
    const legacy = state.environmentalRecords.find((record) => record.period === period);
    const units = production.units ?? (legacy?.productionUnits ? legacy.productionUnits : null);
    const periodReadings = readings.filter((reading) => reading.periodEnd.slice(0, 7) === period);
    const latest =
      periodReadings
        .map((reading) => reading.capturedAt)
        .sort()
        .at(-1) ?? null;
    return {
      period,
      electricityKwh,
      energyPerUnit: electricityKwh !== null && units ? electricityKwh / units : null,
      waterWithdrawalM3: withdrawal,
      waterDischargeM3: discharge,
      waterConsumptionM3,
      waterPerUnit: waterConsumptionM3 !== null && units ? waterConsumptionM3 / units : null,
      materialConsumedKg,
      materialPerUnit: materialConsumedKg !== null && units ? materialConsumedKg / units : null,
      recycledMaterialPercent:
        !hasUnconvertedPurchaseMaterial &&
        recycledSummary.totalKg > 0 &&
        recycledSummary.knownKg >= recycledSummary.totalKg - 1e-9
          ? (recycledSummary.recycledKg / recycledSummary.totalKg) * 100
          : null,
      wasteGeneratedKg,
      wasteRecoveredKg,
      wasteRecoveryPercent:
        wasteGeneratedKg !== null && wasteGeneratedKg > 0 && wasteRecoveredKg !== null
          ? (wasteRecoveredKg / wasteGeneratedKg) * 100
          : null,
      scope1KgCo2e: emissions.scope1,
      scope2KgCo2e: emissions.scope2,
      scope3KgCo2e: emissions.scope3,
      scope1FactorIds: emissions.scope1FactorIds,
      scope2FactorIds: emissions.scope2FactorIds,
      scope3FactorIds: emissions.scope3FactorIds,
      scope3Categories: emissions.scope3Categories,
      dataCoveragePercent: coverage,
      readingCount: readings.length,
      latestReadingAt: latest,
      estimatedReadingCount: readings.filter((reading) => reading.quality === "estimated").length,
    };
  });
}

export function targetProgress(
  target: IndicatorTarget,
  currentValue: number | null,
): number | null {
  if (
    !target.approvedAt ||
    currentValue === null ||
    (target.direction === "decrease" && target.baselineValue <= 0)
  )
    return null;
  const percentagePointIndicator = [
    "recycled-material-share",
    "waste-recovery",
    "data-coverage",
  ].includes(target.indicatorId);
  const targetValue =
    target.direction === "decrease"
      ? target.baselineValue * (1 - target.reductionPercent / 100)
      : percentagePointIndicator
        ? target.baselineValue + target.reductionPercent
        : target.baselineValue * (1 + target.reductionPercent / 100);
  if (target.direction === "decrease" ? currentValue <= targetValue : currentValue >= targetValue)
    return 100;
  const span = targetValue - target.baselineValue;
  return span === 0
    ? 100
    : Math.max(0, Math.min(100, ((currentValue - target.baselineValue) / span) * 100));
}
