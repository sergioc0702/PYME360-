import { createEmptyState } from "../domain/business";
import { DEFAULT_EMISSION_FACTORS, migrateLegacyReadings } from "../domain/environmental";
import type { AppState, Product, Recipe, ReceiptImport, ResourceReading } from "../domain/types";

const API_PATH = "/api/v1/typescript-model/state";
const LEGACY_STORAGE_KEY = "pyme360.typescript-model.v1";

export interface LoadedState {
  state: AppState;
  revision: number;
  legacyReadOnly: boolean;
  warning?: string;
  migrated?: boolean;
}

export class StateConflictError extends Error {
  constructor(
    message: string,
    readonly latestState: LoadedState | null,
  ) {
    super(message);
    this.name = "StateConflictError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasObjectRows(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isRecord);
}

function hasCoreState(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || ![1, 2, 3, 4, 5, 6, 7].includes(Number(value.schemaVersion))) return false;
  if (value.company !== null && !isRecord(value.company)) return false;
  if (value.receiptImports !== undefined && !hasObjectRows(value.receiptImports)) return false;
  const coreValid = [
    value.contacts,
    value.products,
    value.sales,
    value.purchases,
    value.productionOrders,
    value.environmentalRecords,
  ].every(hasObjectRows);
  if (!coreValid) return false;
  if (value.schemaVersion === 2) {
    return [
      value.resourceReadings,
      value.emissionFactors,
      value.indicatorTargets,
      value.environmentalActions,
    ].every(hasObjectRows);
  }
  if (Number(value.schemaVersion) >= 3) {
    const existingSectionsValid = [
      value.resourceReadings,
      value.emissionFactors,
      value.indicatorTargets,
      value.environmentalActions,
      value.inventoryMovements,
      value.financialAccounts,
      value.cashMovements,
    ].every(hasObjectRows);
    if (
      !existingSectionsValid ||
      (Number(value.schemaVersion) >= 4 && !hasObjectRows(value.importExtras))
    )
      return false;
    if (Number(value.schemaVersion) >= 6) {
      const v6Valid =
        hasObjectRows(value.electronicDocuments) &&
        hasObjectRows(value.supplierInvoices) &&
        isRecord(value.taxConfiguration);
      return v6Valid && (Number(value.schemaVersion) < 7 || hasObjectRows(value.recipes));
    }
    return true;
  }
  return true;
}

export function isAppState(value: unknown): value is AppState {
  return hasCoreState(value) && value.schemaVersion === 7;
}

function normalizeReceipt(receipt: Record<string, unknown>): ReceiptImport {
  const oldExtraction = isRecord(receipt.extraction) ? receipt.extraction : {};
  const water = Number(oldExtraction.waterM3) || 0;
  const electricity = Number(oldExtraction.electricityKwh) || 0;
  const fuel = Number(oldExtraction.fuelLiters) || 0;
  const resource =
    oldExtraction.resource === "electricity" ||
    oldExtraction.resource === "water" ||
    oldExtraction.resource === "fuel"
      ? oldExtraction.resource
      : water > 0
        ? "water"
        : electricity > 0
          ? "electricity"
          : fuel > 0
            ? "fuel"
            : undefined;
  const quantity =
    typeof oldExtraction.quantity === "number"
      ? oldExtraction.quantity
      : resource === "water"
        ? water
        : resource === "electricity"
          ? electricity
          : resource === "fuel"
            ? fuel
            : undefined;
  const unit =
    typeof oldExtraction.unit === "string"
      ? oldExtraction.unit
      : resource === "water"
        ? "m³"
        : resource === "electricity"
          ? "kWh"
          : resource === "fuel"
            ? "L"
            : undefined;
  const {
    textPreview: _discardedText,
    electricityKwh: _legacyElectricity,
    waterM3: _legacyWater,
    fuelLiters: _legacyFuel,
    ...safeExtraction
  } = oldExtraction;
  return {
    ...(receipt as unknown as ReceiptImport),
    extraction: {
      ...safeExtraction,
      period: typeof oldExtraction.period === "string" ? oldExtraction.period : "",
      ...(resource ? { resource } : {}),
      ...(quantity !== undefined ? { quantity } : {}),
      ...(unit ? { unit } : {}),
      billedAmount: Number(oldExtraction.billedAmount) || 0,
      invoiceNumber:
        typeof oldExtraction.invoiceNumber === "string" ? oldExtraction.invoiceNumber : "",
      provider:
        typeof oldExtraction.provider === "string"
          ? oldExtraction.provider
          : "Proveedor no identificado",
      confidence: Number(oldExtraction.confidence) || 0,
      warnings: Array.isArray(oldExtraction.warnings)
        ? oldExtraction.warnings.filter((item): item is string => typeof item === "string")
        : [],
    },
  };
}

export function migrateAppState(value: unknown): AppState | null {
  if (!hasCoreState(value)) return null;
  const sourceVersion = Number(value.schemaVersion);
  const isLegacy = sourceVersion === 1;
  const isFinancialLegacy = sourceVersion < 3;
  const records = value.environmentalRecords as AppState["environmentalRecords"];
  const existingReadings = Array.isArray(value.resourceReadings)
    ? (value.resourceReadings as ResourceReading[])
    : [];
  const legacyReadings = isLegacy ? migrateLegacyReadings(records) : [];
  const receiptImports = Array.isArray(value.receiptImports)
    ? value.receiptImports.filter(isRecord).map(normalizeReceipt)
    : [];
  const migratedAt = new Date().toISOString();
  const rawProducts = (value.products as unknown[]).filter(isRecord);
  const products = rawProducts.map((row) => {
    const { recipe: _legacyRecipe, ...product } = row;
    return product as unknown as Product;
  });
  const recipes: Recipe[] =
    sourceVersion >= 7
      ? (value.recipes as Recipe[])
      : rawProducts.flatMap((row) => {
          if (row.type !== "finished" || !Array.isArray(row.recipe)) return [];
          const components = row.recipe
            .filter(isRecord)
            .filter(
              (line) =>
                typeof line.productId === "string" &&
                Number.isFinite(Number(line.quantity)) &&
                Number(line.quantity) > 0,
            )
            .map((line) => ({ productId: String(line.productId), quantity: Number(line.quantity) }));
          if (!components.length) return [];
          const productId = String(row.id ?? "");
          const versionId = `legacy-recipe-version-${productId}-1`;
          return [
            {
              id: `legacy-recipe-${productId}`,
              productId,
              activeVersionId: versionId,
              versions: [
                {
                  id: versionId,
                  versionNumber: 1,
                  status: "active" as const,
                  baseQuantity: 1,
                  expectedYieldPercent: 100,
                  components,
                  createdAt: migratedAt,
                  activatedAt: migratedAt,
                },
              ],
            },
          ];
        });
  const inventoryMovements = Array.isArray(value.inventoryMovements)
    ? (value.inventoryMovements as AppState["inventoryMovements"])
    : products.map((product) => ({
        id: `opening-${product.id}`,
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        unit: product.unit,
        quantity: Number(product.stock) || 0,
        movementType: "opening_balance" as const,
        reason: "Existencia disponible al activar el historial",
        occurredAt: migratedAt,
        createdAt: migratedAt,
        balanceAfter: Number(product.stock) || 0,
      }));
  const sales = (value.sales as AppState["sales"]).map((sale) => ({
    ...sale,
    payments: (sale.payments ?? []).map((payment) => ({ ...payment })),
  }));
  const cashMovements = Array.isArray(value.cashMovements)
    ? (value.cashMovements as AppState["cashMovements"])
    : isFinancialLegacy
      ? sales.flatMap((sale) =>
          sale.payments.map((payment) => {
            const movementId = payment.cashMovementId ?? `legacy-cash-${payment.id}`;
            payment.cashMovementId = movementId;
            return {
              id: movementId,
              direction: "in" as const,
              amount: payment.amount,
              date: payment.date,
              method: payment.method,
              category: "Abono histórico de venta",
              description: `Abono histórico ${sale.number}`,
              sourceType: "sale" as const,
              sourceId: sale.id,
              legacyUnassigned: true,
            };
          }),
        )
      : [];
  const purchases = (value.purchases as AppState["purchases"]).map((purchase) => ({
    ...purchase,
    payments: Array.isArray(purchase.payments) ? purchase.payments : [],
    payableReviewStatus:
      purchase.payableReviewStatus ??
      (isFinancialLegacy ? ("review_required" as const) : ("confirmed" as const)),
  }));
  return {
    ...(value as unknown as AppState),
    schemaVersion: 7,
    contacts: value.contacts as AppState["contacts"],
    products,
    recipes,
    sales,
    taxConfiguration: {
      legalAddress: "",
      invoiceEmail: "",
      taxRegime: "",
      taxResponsibilities: [],
      providerId: "",
      environment: "test",
      resolutionNumber: "",
      prefix: "",
      rangeFrom: null,
      rangeTo: null,
      validFrom: "",
      validTo: "",
      contingencyPrefix: "",
      contingencyRangeFrom: null,
      contingencyRangeTo: null,
      ...(isRecord(value.taxConfiguration) ? value.taxConfiguration : {}),
      countryCode: "CO",
      currency: "COP",
    },
    electronicDocuments: Array.isArray(value.electronicDocuments)
      ? (value.electronicDocuments.filter(isRecord) as unknown as AppState["electronicDocuments"])
      : [],
    supplierInvoices: Array.isArray(value.supplierInvoices)
      ? (value.supplierInvoices.filter(isRecord) as unknown as AppState["supplierInvoices"])
      : [],
    purchases,
    inventoryMovements,
    financialAccounts: Array.isArray(value.financialAccounts)
      ? (value.financialAccounts as AppState["financialAccounts"])
      : [],
    cashMovements,
    productionOrders: value.productionOrders as AppState["productionOrders"],
    environmentalRecords: records.map((record) => ({
      source: "manual",
      sourceLabel: "Registro manual",
      ...record,
    })),
    resourceReadings: [...existingReadings, ...legacyReadings],
    emissionFactors:
      Array.isArray(value.emissionFactors) && value.emissionFactors.length
        ? (value.emissionFactors as AppState["emissionFactors"])
        : structuredClone(DEFAULT_EMISSION_FACTORS),
    indicatorTargets: Array.isArray(value.indicatorTargets)
      ? (value.indicatorTargets as AppState["indicatorTargets"])
      : [],
    environmentalActions: Array.isArray(value.environmentalActions)
      ? (value.environmentalActions as AppState["environmentalActions"])
      : [],
    receiptImports,
    importExtras: Array.isArray(value.importExtras)
      ? (value.importExtras.filter(isRecord) as unknown as AppState["importExtras"])
      : [],
    environmentalConfig: {
      providerId: "local-receipt",
      providerName: "Enel Colombia",
      accountNumber: "",
      businessUnit: "",
      geography: "Colombia SIN",
      ...(isRecord(value.environmentalConfig) ? value.environmentalConfig : {}),
      benchmarking: {
        countryCode: "CO",
        region: "Antioquia",
        sectorCode: "1104",
        outputUnit: "L",
        assumedMonthlyOutput: 100000,
        preferredSources: ["dane-eai", "xm", "unsd", "eia-mecs", "company-public"],
        ...(isRecord(value.environmentalConfig) && isRecord(value.environmentalConfig.benchmarking)
          ? value.environmentalConfig.benchmarking
          : {}),
      },
    },
  };
}

async function readServerState(): Promise<LoadedState | null> {
  const response = await fetch(API_PATH, { cache: "no-store" });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : "No se pudo leer la base de datos local.";
    throw new Error(message);
  }
  if (!isRecord(payload) || typeof payload.revision !== "number") {
    throw new Error("El servidor devolvió una respuesta de almacenamiento no válida.");
  }
  if (payload.state === null) return null;
  const migratedState = migrateAppState(payload.state);
  if (!migratedState) {
    throw new Error(
      "Los datos SQLite no tienen un formato compatible. Restaura un respaldo JSON válido.",
    );
  }
  const rawState = payload.state;
  const rawReceipts =
    isRecord(rawState) && Array.isArray(rawState.receiptImports) ? rawState.receiptImports : [];
  const containsTransientReceiptText = rawReceipts.some(
    (receipt) =>
      isRecord(receipt) &&
      isRecord(receipt.extraction) &&
      typeof receipt.extraction.textPreview === "string",
  );
  return {
    state: migratedState,
    revision: payload.revision,
    legacyReadOnly: false,
    migrated: !isAppState(payload.state) || containsTransientReceiptText,
  };
}

function readLegacyBrowserState(): AppState | null {
  try {
    const saved = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!saved) return null;
    const parsed: unknown = JSON.parse(saved);
    return migrateAppState(parsed);
  } catch {
    return null;
  }
}

export async function loadState(): Promise<LoadedState> {
  let serverState: LoadedState | null;
  try {
    serverState = await readServerState();
  } catch (error) {
    const legacyState = readLegacyBrowserState();
    if (legacyState) {
      return {
        state: legacyState,
        revision: 0,
        legacyReadOnly: true,
        warning: error instanceof Error ? error.message : "No se pudo conectar con SQLite.",
      };
    }
    throw error;
  }
  if (serverState) {
    if (serverState.migrated) {
      try {
        const revision = await saveState(serverState.state, serverState.revision);
        return { ...serverState, revision, migrated: false, legacyReadOnly: false };
      } catch (error) {
        if (error instanceof StateConflictError && error.latestState)
          return { ...error.latestState, legacyReadOnly: false };
        return {
          ...serverState,
          legacyReadOnly: true,
          warning:
            error instanceof Error
              ? error.message
              : "La base se leyó, pero no se pudo guardar la actualización. Pide a un administrador que revise la base.",
        };
      }
    }
    return { ...serverState, legacyReadOnly: false };
  }

  const legacyState = readLegacyBrowserState();
  if (!legacyState) return { state: createEmptyState(), revision: 0, legacyReadOnly: false };

  try {
    const revision = await saveState(legacyState, 0);
    return { state: legacyState, revision, legacyReadOnly: false };
  } catch (error) {
    if (error instanceof StateConflictError && error.latestState) {
      return { ...error.latestState, legacyReadOnly: false };
    }
    return {
      state: legacyState,
      revision: 0,
      legacyReadOnly: true,
      warning: error instanceof Error ? error.message : "No se pudo migrar la copia local.",
    };
  }
}

export async function saveState(
  state: AppState,
  expectedRevision: number,
  restore = false,
): Promise<number> {
  let response: Response;
  try {
    response = await fetch(restore ? `${API_PATH}?restore=1` : API_PATH, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision, state }),
    });
  } catch {
    throw new Error(
      "No se pudo conectar con SQLite. Abre Pyme360 con su lanzador e inténtalo de nuevo.",
    );
  }

  const payload: unknown = await response.json().catch(() => null);
  if (response.status === 409) {
    const latest = isRecord(payload) ? migrateAppState(payload.state) : null;
    const latestState =
      isRecord(payload) && typeof payload.revision === "number" && latest
        ? { state: latest, revision: payload.revision, legacyReadOnly: false }
        : null;
    const message =
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : "Los datos cambiaron en otra pestaña.";
    throw new StateConflictError(message, latestState);
  }
  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : "SQLite no confirmó el guardado.";
    throw new Error(message);
  }
  if (!isRecord(payload) || typeof payload.revision !== "number") {
    throw new Error("El servidor guardó una respuesta incompleta.");
  }
  return payload.revision;
}

export function serializeBackup(state: AppState): string {
  return JSON.stringify(
    {
      format: "pyme360-typescript-model",
      schemaVersion: 7,
      exportedAt: new Date().toISOString(),
      state,
    },
    null,
    2,
  );
}

export function parseBackup(content: string): AppState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new Error("El archivo no contiene JSON válido.");
  }
  const state = isRecord(parsed) && "state" in parsed ? parsed.state : parsed;
  const migrated = migrateAppState(state);
  if (!migrated) {
    throw new Error("El archivo no es un respaldo compatible de Pyme360.");
  }
  return migrated;
}
