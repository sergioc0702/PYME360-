import type { Product, RecipeVersion } from "./types";

export interface RecipeMaterialRequirement {
  productId: string;
  quantity: number;
}

/** Scales a recipe's standard batch to the gross quantity planned for an order. */
export function calculateRecipeRequirements(
  version: RecipeVersion,
  grossOutputQuantity: number,
): RecipeMaterialRequirement[] {
  if (!Number.isFinite(grossOutputQuantity) || grossOutputQuantity <= 0 || version.baseQuantity <= 0)
    return [];
  return version.components.map((component) => ({
    productId: component.productId,
    quantity: Number(((component.quantity * grossOutputQuantity) / version.baseQuantity).toFixed(4)),
  }));
}

export interface MaterialCostLine {
  productId: string;
  quantity: number;
  unitCost: number | null;
  lineCost: number | null;
}

export interface MaterialCostEstimate {
  totalCost: number | null;
  costPerOutputUnit: number | null;
  lines: MaterialCostLine[];
  missingCostProducts: string[];
}

/**
 * Estimates direct material cost from the product catalog. This deliberately
 * excludes labor, energy, overhead, and any other conversion costs.
 */
export function estimateMaterialCost(
  products: Product[],
  materialQuantities: Array<{ productId: string; quantity: number }>,
  goodOutputQuantity?: number,
): MaterialCostEstimate {
  if (materialQuantities.length === 0) {
    return { totalCost: null, costPerOutputUnit: null, lines: [], missingCostProducts: [] };
  }
  const lines = materialQuantities.map(({ productId, quantity }) => {
    const product = products.find((item) => item.id === productId);
    const unitCost = product && product.unitCost > 0 ? product.unitCost : null;
    return {
      productId,
      quantity,
      unitCost,
      lineCost: unitCost === null ? null : Math.round(quantity * unitCost),
    };
  });
  const missingCostProducts = lines
    .filter((line) => line.unitCost === null)
    .map((line) => products.find((product) => product.id === line.productId)?.name ?? line.productId);
  const totalCost = lines.some((line) => line.lineCost === null)
    ? null
    : lines.reduce((sum, line) => sum + (line.lineCost ?? 0), 0);
  const costPerOutputUnit =
    totalCost === null || goodOutputQuantity === undefined || goodOutputQuantity <= 0
      ? null
      : Math.round(totalCost / goodOutputQuantity);

  return { totalCost, costPerOutputUnit, lines, missingCostProducts };
}
