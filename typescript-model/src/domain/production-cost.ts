import type { ProductionOrder } from "./types";

export interface ProductionClosingCosts {
  actualQuantities: number[];
  laborHours?: number;
  laborHourlyRate?: number;
  energyCost?: number;
  overheadCost?: number;
}

export function productionCostSummary(order: ProductionOrder) {
  const actualMaterialCost = order.consumedMaterials.length > 0 && order.consumedMaterials.every(
    (item) => item.actualQuantity != null &&
      (item.actualQuantity === 0 || item.unitCostSnapshot != null),
  )
    ? order.consumedMaterials.reduce(
        (total, item) => total + Math.round((item.actualQuantity ?? 0) * (item.unitCostSnapshot ?? 0)),
        0,
      )
    : null;
  const laborCost =
    order.laborHours != null && order.laborHourlyRate != null
      ? Math.round(order.laborHours * order.laborHourlyRate)
      : null;
  const total =
    actualMaterialCost !== null &&
    laborCost !== null &&
    order.energyCost != null &&
    order.overheadCost != null
      ? actualMaterialCost + laborCost + order.energyCost + order.overheadCost
      : null;
  const goodUnits = order.quantity - order.wasteQuantity;
  return {
    actualMaterialCost,
    laborCost,
    total,
    unitCost: total !== null && goodUnits > 0 ? Math.round(total / goodUnits) : null,
  };
}
