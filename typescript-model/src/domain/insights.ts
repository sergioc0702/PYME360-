import {
  calculateMonthlyEnvironmentalMetrics,
  convertUnit,
  type MonthlyEnvironmentalMetrics,
} from "./environmental";
import type { AppState, IndicatorId, ResourceReading } from "./types";

/** Valor pagado por una lectura: el digitado o, si no existe, el del recibo vinculado. */
export function readingCost(state: AppState, reading: ResourceReading): number | null {
  if (reading.billedAmount !== undefined)
    return reading.billedAmount > 0 ? reading.billedAmount : null;
  if (!reading.receiptImportId) return null;
  const receipt = state.receiptImports.find((item) => item.id === reading.receiptImportId);
  return receipt && receipt.extraction.billedAmount > 0 ? receipt.extraction.billedAmount : null;
}

/** Precio promedio por unidad en el mes, calculado solo con lecturas que traen valor pagado. */
export function averageUnitPrice(
  state: AppState,
  period: string,
  resource: "electricity" | "water",
): number | null {
  const unit = resource === "electricity" ? "kWh" : "m³";
  const activity = resource === "electricity" ? "consumption" : "withdrawal";
  let paid = 0;
  let quantity = 0;
  for (const reading of state.resourceReadings) {
    if (
      reading.resource !== resource ||
      reading.activity !== activity ||
      reading.periodEnd.slice(0, 7) !== period
    )
      continue;
    const cost = readingCost(state, reading);
    const converted = convertUnit(reading.quantity, reading.unit, unit);
    if (cost === null || converted === null || converted <= 0) continue;
    paid += cost;
    quantity += converted;
  }
  return quantity > 0 ? paid / quantity : null;
}

export interface ResourceSavings {
  resource: "electricity" | "water";
  unit: string;
  baseQuantity: number;
  currentQuantity: number;
  /** "per-unit" ajusta por la producción de cada mes; "total" compara los consumos tal cual. */
  basis: "per-unit" | "total";
  /** Positivo si se consumió menos de lo esperado; negativo si se consumió más. */
  savedQuantity: number;
  savedPercent: number | null;
  savedPesos: number | null;
  savedKgCo2e: number | null;
}

export interface SavingsSummary {
  basePeriod: string;
  period: string;
  electricity: ResourceSavings | null;
  water: ResourceSavings | null;
  totalPesos: number | null;
  totalKgCo2e: number | null;
}

function compareResource(
  resource: "electricity" | "water",
  unit: string,
  base: MonthlyEnvironmentalMetrics,
  current: MonthlyEnvironmentalMetrics,
  baseQuantity: number | null,
  currentQuantity: number | null,
  unitPrice: number | null,
  kgPerUnit: number | null,
): ResourceSavings | null {
  if (baseQuantity === null || currentQuantity === null) return null;
  const perUnit = Boolean(base.productionUnits && current.productionUnits);
  const expected = perUnit
    ? (baseQuantity / base.productionUnits!) * current.productionUnits!
    : baseQuantity;
  const savedQuantity = expected - currentQuantity;
  return {
    resource,
    unit,
    baseQuantity,
    currentQuantity,
    basis: perUnit ? "per-unit" : "total",
    savedQuantity,
    savedPercent: expected > 0 ? (savedQuantity / expected) * 100 : null,
    savedPesos: unitPrice === null ? null : savedQuantity * unitPrice,
    savedKgCo2e: kgPerUnit === null ? null : savedQuantity * kgPerUnit,
  };
}

/** Compara un mes con el mes base en cantidad, pesos y CO₂ equivalente. */
export function calculateSavings(
  state: AppState,
  basePeriod: string,
  period: string,
  metrics = calculateMonthlyEnvironmentalMetrics(state),
): SavingsSummary | null {
  const base = metrics.find((item) => item.period === basePeriod);
  const current = metrics.find((item) => item.period === period);
  if (!base || !current || basePeriod >= period) return null;
  const kgPerKwh =
    current.scope2KgCo2e !== null && current.electricityKwh
      ? current.scope2KgCo2e / current.electricityKwh
      : null;
  const electricity = compareResource(
    "electricity",
    "kWh",
    base,
    current,
    base.electricityKwh,
    current.electricityKwh,
    averageUnitPrice(state, period, "electricity"),
    kgPerKwh,
  );
  const water = compareResource(
    "water",
    "m³",
    base,
    current,
    base.waterWithdrawalM3,
    current.waterWithdrawalM3,
    averageUnitPrice(state, period, "water"),
    null,
  );
  const pesos = [electricity?.savedPesos, water?.savedPesos].filter(
    (value): value is number => typeof value === "number",
  );
  return {
    basePeriod,
    period,
    electricity,
    water,
    totalPesos: pesos.length ? pesos.reduce((sum, value) => sum + value, 0) : null,
    totalKgCo2e: electricity?.savedKgCo2e ?? null,
  };
}

/** Mes base: el de la meta de energía aprobada o, si no hay, el primero con electricidad. */
export function defaultBasePeriod(
  state: AppState,
  metrics = calculateMonthlyEnvironmentalMetrics(state),
): string | null {
  const approved = state.indicatorTargets
    .filter((target) => target.indicatorId === "energy-intensity" && target.approvedAt)
    .map((target) => target.baselinePeriod)
    .sort()[0];
  if (approved && metrics.some((item) => item.period === approved)) return approved;
  return metrics.find((item) => item.electricityKwh !== null)?.period ?? null;
}

export interface ProductFootprint {
  productId: string;
  productName: string;
  goodUnits: number;
  wasteUnits: number;
  /** Parte de las unidades buenas del mes, de 0 a 100. */
  sharePercent: number;
  electricityKwh: number | null;
  waterM3: number | null;
  kgCo2e: number | null;
  energyCost: number | null;
  kwhPerUnit: number | null;
}

/**
 * Reparte el consumo del mes entre los productos según las unidades buenas terminadas.
 * Es una aproximación: supone que cada unidad gasta lo mismo, sin importar el producto.
 */
export function calculateProductFootprint(
  state: AppState,
  period: string,
  metrics = calculateMonthlyEnvironmentalMetrics(state),
): ProductFootprint[] {
  const month = metrics.find((item) => item.period === period);
  const totals = new Map<string, { name: string; good: number; waste: number }>();
  for (const order of state.productionOrders) {
    if (order.status !== "completed" || (order.completedAt || order.date).slice(0, 7) !== period)
      continue;
    const row = totals.get(order.productId) ?? { name: order.productName, good: 0, waste: 0 };
    row.good += Math.max(0, order.quantity - order.wasteQuantity);
    row.waste += order.wasteQuantity;
    totals.set(order.productId, row);
  }
  const allUnits = [...totals.values()].reduce((sum, row) => sum + row.good, 0);
  if (!month || allUnits <= 0) return [];
  const price = averageUnitPrice(state, period, "electricity");
  const carbon =
    month.scope1KgCo2e === null && month.scope2KgCo2e === null
      ? null
      : (month.scope1KgCo2e ?? 0) + (month.scope2KgCo2e ?? 0);
  const part = (value: number | null, share: number) => (value === null ? null : value * share);
  return [...totals.entries()]
    .map(([productId, row]) => {
      const share = row.good / allUnits;
      const electricityKwh = part(month.electricityKwh, share);
      return {
        productId,
        productName: row.name,
        goodUnits: row.good,
        wasteUnits: row.waste,
        sharePercent: share * 100,
        electricityKwh,
        waterM3: part(month.waterWithdrawalM3, share),
        kgCo2e: part(carbon, share),
        energyCost: electricityKwh === null || price === null ? null : electricityKwh * price,
        kwhPerUnit: electricityKwh === null || row.good <= 0 ? null : electricityKwh / row.good,
      };
    })
    .sort((left, right) => right.goodUnits - left.goodUnits);
}

export interface ConsumptionParcel {
  label: string;
  value: number;
  unit: "COP" | "kWh";
}

const MAX_PARCELS = 5;

/** En qué se va el consumo del mes: en pesos si hay valor pagado, si no en kWh. */
export function calculateConsumptionParcels(
  state: AppState,
  period: string,
  metrics = calculateMonthlyEnvironmentalMetrics(state),
): ConsumptionParcel[] {
  const month = metrics.find((item) => item.period === period);
  if (!month) return [];
  const energyPrice = averageUnitPrice(state, period, "electricity");
  const waterPrice = averageUnitPrice(state, period, "water");
  const inPesos = energyPrice !== null;
  const unit = inPesos ? "COP" : "kWh";
  const rows = calculateProductFootprint(state, period, metrics);
  const parcels: ConsumptionParcel[] = rows.length
    ? rows.map((row) => ({
        label: row.productName,
        value: (inPesos ? row.energyCost : row.electricityKwh) ?? 0,
        unit,
      }))
    : [
        {
          label: "Energía",
          value: (inPesos ? (month.electricityKwh ?? 0) * energyPrice : month.electricityKwh) ?? 0,
          unit,
        },
      ];
  if (inPesos && waterPrice !== null && month.waterWithdrawalM3)
    parcels.push({ label: "Agua", value: month.waterWithdrawalM3 * waterPrice, unit });
  const sorted = parcels
    .filter((parcel) => parcel.value > 0)
    .sort((left, right) => right.value - left.value);
  if (sorted.length <= MAX_PARCELS) return sorted;
  const rest = sorted.slice(MAX_PARCELS - 1).reduce((sum, parcel) => sum + parcel.value, 0);
  return [...sorted.slice(0, MAX_PARCELS - 1), { label: "Otros", value: rest, unit }];
}

export interface PlacedParcel extends ConsumptionParcel {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Reparte un rectángulo de 100 x 100 en parcelas proporcionales a su valor. */
export function layoutParcels(
  parcels: ConsumptionParcel[],
  x = 0,
  y = 0,
  width = 100,
  height = 100,
): PlacedParcel[] {
  if (!parcels.length) return [];
  if (parcels.length === 1) return [{ ...parcels[0], x, y, width, height }];
  const total = parcels.reduce((sum, parcel) => sum + parcel.value, 0);
  let split = 1;
  let running = parcels[0].value;
  while (split < parcels.length - 1 && running < total / 2) {
    running += parcels[split].value;
    split += 1;
  }
  const share = running / total;
  const first = parcels.slice(0, split);
  const second = parcels.slice(split);
  return width >= height
    ? [
        ...layoutParcels(first, x, y, width * share, height),
        ...layoutParcels(second, x + width * share, y, width * (1 - share), height),
      ]
    : [
        ...layoutParcels(first, x, y, width, height * share),
        ...layoutParcels(second, x, y + height * share, width, height * (1 - share)),
      ];
}

export interface SavingsSuggestion {
  id: string;
  indicatorId: IndicatorId;
  title: string;
  reason: string;
}

const number = (value: number, digits = 0) =>
  new Intl.NumberFormat("es-CO", { maximumFractionDigits: digits }).format(value);

/** Margen para no sugerir cambios por diferencias pequeñas entre un mes y otro. */
const INCREASE_MARGIN_PERCENT = 5;

/** Sugerencias basadas solo en los datos de la empresa. No prometen un ahorro. */
export function buildSavingsSuggestions(
  state: AppState,
  period: string,
  basePeriod: string | null,
  metrics = calculateMonthlyEnvironmentalMetrics(state),
): SavingsSuggestion[] {
  const month = metrics.find((item) => item.period === period);
  if (!month) return [];
  const suggestions: SavingsSuggestion[] = [];
  const savings = basePeriod ? calculateSavings(state, basePeriod, period, metrics) : null;

  const electricity = savings?.electricity;
  if (electricity?.savedPercent != null && electricity.savedPercent < -INCREASE_MARGIN_PERCENT)
    suggestions.push({
      id: "energy-increase",
      indicatorId: "energy-intensity",
      title: "Revisar qué equipos quedan encendidos fuera de producción",
      reason: `Se usaron ${number(-electricity.savedQuantity)} kWh más de lo esperado frente al mes base.`,
    });

  const water = savings?.water;
  if (water?.savedPercent != null && water.savedPercent < -INCREASE_MARGIN_PERCENT)
    suggestions.push({
      id: "water-increase",
      indicatorId: "water-intensity",
      title: "Revisar fugas y lavados en la planta",
      reason: `Se usaron ${number(-water.savedQuantity, 1)} m³ más de lo esperado frente al mes base.`,
    });

  if (month.wasteGeneratedKg !== null && month.wasteGeneratedKg > 0) {
    const lost = month.wasteGeneratedKg - (month.wasteRecoveredKg ?? 0);
    if (lost > 0)
      suggestions.push({
        id: "waste-recovery",
        indicatorId: "waste-recovery",
        title: "Buscar cómo aprovechar los residuos",
        reason: `Este mes quedaron ${number(lost, 1)} kg de residuos sin aprovechar.`,
      });
  }

  const footprint = calculateProductFootprint(state, period, metrics);
  const worstWaste = footprint
    .filter((row) => row.wasteUnits > 0)
    .map((row) => ({ ...row, rate: (row.wasteUnits / (row.goodUnits + row.wasteUnits)) * 100 }))
    .sort((left, right) => right.rate - left.rate)[0];
  if (worstWaste)
    suggestions.push({
      id: `product-waste-${worstWaste.productId}`,
      indicatorId: "material-intensity",
      title: `Revisar por qué se pierde producto en ${worstWaste.productName}`,
      reason: `Se perdió el ${number(worstWaste.rate, 1)} % de lo fabricado este mes.`,
    });

  if (month.productionUnits === null)
    suggestions.push({
      id: "missing-production",
      indicatorId: "data-coverage",
      title: "Registrar la producción del mes",
      reason: "Sin producción no se puede saber cuánto gasta cada unidad.",
    });
  if (month.electricityKwh !== null && averageUnitPrice(state, period, "electricity") === null)
    suggestions.push({
      id: "missing-price",
      indicatorId: "data-coverage",
      title: "Agregar el valor pagado en el recibo de energía",
      reason: "Sin ese valor no se puede mostrar el ahorro en pesos.",
    });

  const planned = new Set(
    state.environmentalActions
      .filter((action) => action.status === "open")
      .map((action) => action.title),
  );
  return suggestions.filter((item) => !planned.has(item.title));
}
