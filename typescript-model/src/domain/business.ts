import type {
  AppState,
  Company,
  Contact,
  ResourceReading,
  ResourceReadingInput,
  EmissionFactor,
  EmissionFactorInput,
  IndicatorTarget,
  IndicatorTargetInput,
  EnvironmentalActionInput,
  ElectronicDocument,
  ElectronicDocumentSnapshot,
  InvoiceDocumentKind,
  Payment,
  Product,
  Recipe,
  RecipeComponent,
  RecipeVersion,
  RecipeVersionInput,
  Purchase,
  PurchaseInput,
  PurchaseLine,
  PurchaseStatus,
  Sale,
  SaleInput,
  InventoryMovement,
  InventoryMovementType,
  FinancialAccount,
  CashMovement,
  SupplierInvoiceDocument,
  TaxConfiguration,
} from "./types";
import { convertUnit, DEFAULT_EMISSION_FACTORS, DEFAULT_SITE_ID } from "./environmental";
import { calculateRecipeRequirements, estimateMaterialCost } from "./costing";

export class BusinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessError";
  }
}

// Estado inicial y configuración ambiental
export function createEmptyState(): AppState {
  return {
    schemaVersion: 7,
    company: null,
    contacts: [],
    products: [],
    recipes: [],
    sales: [],
    taxConfiguration: {
      countryCode: "CO",
      currency: "COP",
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
    },
    electronicDocuments: [],
    supplierInvoices: [],
    purchases: [],
    inventoryMovements: [],
    financialAccounts: [],
    cashMovements: [],
    productionOrders: [],
    environmentalRecords: [],
    resourceReadings: [],
    emissionFactors: structuredClone(DEFAULT_EMISSION_FACTORS),
    indicatorTargets: [],
    environmentalActions: [],
    receiptImports: [],
    importExtras: [],
    environmentalConfig: {
      providerId: "local-receipt",
      providerName: "Enel Colombia",
      accountNumber: "",
      businessUnit: "",
      geography: "Colombia SIN",
      benchmarking: {
        countryCode: "CO",
        region: "Antioquia",
        sectorCode: "1104",
        outputUnit: "L",
        assumedMonthlyOutput: 100000,
        preferredSources: ["dane-eai", "xm", "unsd", "eia-mecs", "company-public"],
      },
    },
  };
}

export function saveEnvironmentalConfig(
  state: AppState,
  config: NonNullable<AppState["environmentalConfig"]>,
): AppState {
  const next = cloneState(state);
  const benchmarking = config.benchmarking ?? {
    countryCode: "CO",
    region: "Antioquia",
    sectorCode: "1104",
    outputUnit: "L",
    assumedMonthlyOutput: 100000,
    preferredSources: ["dane-eai", "xm", "unsd", "eia-mecs", "company-public"],
  };
  next.environmentalConfig = {
    providerId: config.providerId.trim() || "local-receipt",
    providerName: config.providerName.trim() || "Enel Colombia",
    accountNumber: config.accountNumber.trim(),
    businessUnit: config.businessUnit.trim(),
    geography: config.geography?.trim() || "Colombia SIN",
    benchmarking: {
      countryCode: benchmarking.countryCode.trim().toUpperCase() || "CO",
      region: benchmarking.region.trim() || "Antioquia",
      sectorCode: benchmarking.sectorCode.trim() || "1104",
      outputUnit: benchmarking.outputUnit.trim() || "L",
      assumedMonthlyOutput: Number(benchmarking.assumedMonthlyOutput),
      preferredSources: [...benchmarking.preferredSources],
    },
  };
  requireNonNegative(
    next.environmentalConfig.benchmarking.assumedMonthlyOutput,
    "El volumen ilustrativo",
  );
  return next;
}

export function saveResourceReading(
  state: AppState,
  input: ResourceReadingInput,
  readingId?: string,
): AppState {
  const validDate = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (
    !validDate(input.periodStart) ||
    !validDate(input.periodEnd) ||
    input.periodStart > input.periodEnd
  ) {
    throw new BusinessError(
      "Indica un período válido; la fecha inicial no puede ser posterior a la final.",
    );
  }
  requireNonNegative(input.quantity, "La cantidad medida");
  if (input.billedAmount !== undefined) requireNonNegative(input.billedAmount, "El valor pagado");
  requireText(input.unit, "La unidad");
  requireText(input.siteId, "La sede");
  const allowedActivities: Record<ResourceReading["resource"], ResourceReading["activity"][]> = {
    electricity: ["consumption"],
    water: ["withdrawal", "discharge"],
    fuel: ["consumption"],
    material: ["consumption"],
    waste: ["generated", "recovered"],
  };
  if (!allowedActivities[input.resource].includes(input.activity))
    throw new BusinessError("La actividad no corresponde al recurso seleccionado.");
  if (
    input.resource === "material" &&
    input.materialProductId &&
    !state.products.some(
      (product) => product.id === input.materialProductId && product.type !== "finished",
    )
  ) {
    throw new BusinessError("Selecciona una materia prima o insumo válido.");
  }
  const next = cloneState(state);
  const existingIndex = readingId
    ? next.resourceReadings.findIndex((reading) => reading.id === readingId)
    : -1;
  if (readingId && existingIndex < 0)
    throw new BusinessError("No encontramos la lectura ambiental.");
  if (input.resource === "waste") {
    const period = input.periodEnd.slice(0, 7);
    const existingWaste = next.resourceReadings.filter(
      (reading) =>
        reading.id !== readingId &&
        reading.resource === "waste" &&
        reading.periodEnd.slice(0, 7) === period &&
        (reading.activity === "generated" || reading.activity === "recovered"),
    );
    const quantities = existingWaste.map((reading) => ({
      activity: reading.activity,
      amount: convertUnit(reading.quantity, reading.unit, "kg"),
    }));
    const inputKg = convertUnit(input.quantity, input.unit, "kg");
    if (inputKg !== null && quantities.every((item) => item.amount !== null)) {
      const generated =
        quantities
          .filter((item) => item.activity === "generated")
          .reduce((sum, item) => sum + (item.amount ?? 0), 0) +
        (input.activity === "generated" ? inputKg : 0);
      const recovered =
        quantities
          .filter((item) => item.activity === "recovered")
          .reduce((sum, item) => sum + (item.amount ?? 0), 0) +
        (input.activity === "recovered" ? inputKg : 0);
      if (recovered > generated + 1e-9)
        throw new BusinessError(
          "Los residuos recuperados no pueden superar los residuos generados en el mismo mes.",
        );
    }
  }
  const reading: ResourceReading = {
    ...input,
    id: readingId ?? createId("reading"),
    unit: input.unit.trim(),
    siteId: input.siteId || DEFAULT_SITE_ID,
    sourceLabel: requireText(input.sourceLabel, "El origen de la lectura"),
    capturedAt: input.capturedAt ?? new Date().toISOString(),
  };
  if (existingIndex >= 0) next.resourceReadings[existingIndex] = reading;
  else next.resourceReadings.push(reading);
  next.resourceReadings.sort(
    (a, b) =>
      a.periodStart.localeCompare(b.periodStart) || a.capturedAt.localeCompare(b.capturedAt),
  );
  return next;
}

export function deleteResourceReading(state: AppState, readingId: string): AppState {
  const next = cloneState(state);
  const index = next.resourceReadings.findIndex((reading) => reading.id === readingId);
  if (index < 0) throw new BusinessError("No encontramos la lectura ambiental.");
  next.resourceReadings.splice(index, 1);
  return next;
}

export function saveEmissionFactor(
  state: AppState,
  input: EmissionFactorInput,
  factorId?: string,
): AppState {
  if (!Number.isFinite(input.kgCo2ePerUnit) || input.kgCo2ePerUnit < 0)
    throw new BusinessError("El factor debe ser un número igual o mayor que cero.");
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2200)
    throw new BusinessError("Indica un año válido para el factor.");
  const validScopeActivity =
    input.scope === 1
      ? input.activity === "fuel"
      : input.scope === 2
        ? input.activity === "electricity"
        : ["material_purchase", "waste", "transport"].includes(input.activity);
  if (!validScopeActivity)
    throw new BusinessError("La actividad seleccionada no corresponde al alcance de emisiones.");
  for (const [value, label] of [
    [input.activityUnit, "La unidad del factor"],
    [input.geography, "La ubicación del factor"],
    [input.version, "La versión"],
    [input.source, "La fuente"],
  ] as const)
    requireText(value, label);
  const next = cloneState(state);
  const id = factorId ?? createId("factor");
  const duplicate = next.emissionFactors.some(
    (factor) =>
      factor.id !== id &&
      factor.scope === input.scope &&
      factor.activity === input.activity &&
      factor.activityUnit.toLowerCase() === input.activityUnit.toLowerCase() &&
      factor.geography.toLowerCase() === input.geography.toLowerCase() &&
      factor.year === input.year &&
      factor.version === input.version,
  );
  if (duplicate)
    throw new BusinessError(
      "Ya existe ese factor para el mismo alcance, actividad, ubicación, año y versión.",
    );
  const factor: EmissionFactor = { ...input, id };
  const index = next.emissionFactors.findIndex((item) => item.id === id);
  if (index >= 0) next.emissionFactors[index] = factor;
  else next.emissionFactors.push(factor);
  return next;
}

export function deleteEmissionFactor(state: AppState, factorId: string): AppState {
  const next = cloneState(state);
  if (factorId === "factor-upme-sin-2024")
    throw new BusinessError("El factor UPME de referencia se conserva en el catálogo.");
  const index = next.emissionFactors.findIndex((factor) => factor.id === factorId);
  if (index < 0) throw new BusinessError("No encontramos el factor de emisión.");
  next.emissionFactors.splice(index, 1);
  return next;
}

export function saveIndicatorTarget(
  state: AppState,
  input: IndicatorTargetInput,
  targetId?: string,
): AppState {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.baselinePeriod))
    throw new BusinessError("El período de línea base debe tener el formato AAAA-MM.");
  const supportsZeroBaselineIncrease = [
    "recycled-material-share",
    "waste-recovery",
    "data-coverage",
  ].includes(input.indicatorId);
  if (
    !Number.isFinite(input.baselineValue) ||
    input.baselineValue < 0 ||
    (input.baselineValue === 0 && (input.direction === "decrease" || !supportsZeroBaselineIncrease))
  )
    throw new BusinessError(
      "El valor de línea base debe ser mayor que cero, salvo indicadores porcentuales con meta de aumento.",
    );
  if (
    !Number.isFinite(input.reductionPercent) ||
    input.reductionPercent < 0 ||
    input.reductionPercent >= 100
  )
    throw new BusinessError("El cambio objetivo debe estar entre 0 y menos de 100 %.");
  if (
    input.direction === "increase" &&
    supportsZeroBaselineIncrease &&
    input.baselineValue + input.reductionPercent > 100
  )
    throw new BusinessError("La meta porcentual no puede superar 100 %.");
  const next = cloneState(state);
  const existing = next.indicatorTargets.find((item) => item.id === targetId);
  const target: IndicatorTarget = {
    ...input,
    id: targetId ?? createId("target"),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  const index = next.indicatorTargets.findIndex((item) => item.id === target.id);
  if (index >= 0) next.indicatorTargets[index] = target;
  else next.indicatorTargets.push(target);
  return next;
}

export function deleteIndicatorTarget(state: AppState, targetId: string): AppState {
  const next = cloneState(state);
  const index = next.indicatorTargets.findIndex((target) => target.id === targetId);
  if (index < 0) throw new BusinessError("No encontramos la meta ambiental.");
  next.indicatorTargets.splice(index, 1);
  return next;
}

export function addEnvironmentalAction(state: AppState, input: EnvironmentalActionInput): AppState {
  const next = cloneState(state);
  next.environmentalActions.unshift({
    ...input,
    id: createId("environment-action"),
    title: requireText(input.title, "El nombre de la acción"),
    owner: requireText(input.owner, "El responsable"),
    dueDate: requireText(input.dueDate, "La fecha límite"),
    status: "open",
    createdAt: new Date().toISOString(),
  });
  return next;
}

export function completeEnvironmentalAction(state: AppState, actionId: string): AppState {
  const next = cloneState(state);
  const action = next.environmentalActions.find((item) => item.id === actionId);
  if (!action) throw new BusinessError("No encontramos la acción ambiental.");
  action.status = action.status === "completed" ? "open" : "completed";
  action.completedAt = action.status === "completed" ? new Date().toISOString() : undefined;
  return next;
}

export function deleteEnvironmentalAction(state: AppState, actionId: string): AppState {
  const next = cloneState(state);
  const index = next.environmentalActions.findIndex((item) => item.id === actionId);
  if (index < 0) throw new BusinessError("No encontramos la acción ambiental.");
  next.environmentalActions.splice(index, 1);
  return next;
}

// Validaciones y utilidades compartidas
export function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value == null) throw new BusinessError(message);
  return value;
}

function requireText(value: string, label: string): string {
  const result = value.trim();
  if (!result) throw new BusinessError(`${label} es obligatorio.`);
  return result;
}

function requirePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new BusinessError(`${label} debe ser mayor que cero.`);
  }
}

/** Parte del mayor código usado: contar registros repetía números después de eliminar uno. */
function nextCode(prefix: string, codes: string[]): string {
  const highest = codes.reduce((maximum, code) => {
    const sequence = code.startsWith(prefix) ? Number(code.slice(prefix.length)) : 0;
    return Number.isSafeInteger(sequence) ? Math.max(maximum, sequence) : maximum;
  }, codes.length);
  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}

function requireNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new BusinessError(`${label} no puede ser negativo.`);
  }
}

function validateBenchmarkOutputConversion(input: Omit<Product, "id" | "sku">): void {
  if (input.benchmarkOutputFactor !== undefined)
    requirePositive(input.benchmarkOutputFactor, "La conversión del producto a litros");
  if (
    Boolean(input.benchmarkOutputUnit) !== (input.benchmarkOutputFactor !== undefined) ||
    (input.benchmarkOutputUnit !== undefined && input.benchmarkOutputUnit !== "L") ||
    (input.type !== "finished" && input.benchmarkOutputFactor !== undefined)
  )
    throw new BusinessError(
      "Configura un factor en litros solo para productos terminados, o deja ambos campos vacíos.",
    );
}

function roundCop(value: number): number {
  return Math.round(value);
}

function cloneState(state: AppState): AppState {
  return structuredClone(state);
}

function getProduct(state: AppState, productId: string): Product {
  return requireValue(
    state.products.find((product) => product.id === productId),
    "No encontramos el producto seleccionado.",
  );
}

function getContact(state: AppState, contactId: string): Contact {
  return requireValue(
    state.contacts.find((contact) => contact.id === contactId),
    "No encontramos el contacto seleccionado.",
  );
}

function addStock(
  state: AppState,
  productId: string,
  change: number,
  options: {
    movementType?: InventoryMovementType;
    reason?: string;
    sourceType?: InventoryMovement["sourceType"];
    sourceId?: string;
    reversesMovementId?: string;
    occurredAt?: string;
  } = {},
): InventoryMovement {
  const product = getProduct(state, productId);
  const nextStock = product.stock + change;
  if (nextStock < -1e-9) {
    throw new BusinessError(
      `El ajuste dejaría ${product.name} con inventario negativo. Revisa los movimientos relacionados.`,
    );
  }
  product.stock = Math.max(0, Number(nextStock.toFixed(4)));
  const movement: InventoryMovement = {
    id: createId("movement"),
    productId: product.id,
    productName: product.name,
    sku: product.sku,
    unit: product.unit,
    quantity: Number(change.toFixed(4)),
    movementType: options.movementType ?? "adjustment",
    reason: options.reason?.trim() || "Ajuste de inventario",
    occurredAt: options.occurredAt ?? new Date().toISOString(),
    createdAt: new Date().toISOString(),
    sourceType: options.sourceType,
    sourceId: options.sourceId,
    reversesMovementId: options.reversesMovementId,
    balanceAfter: product.stock,
  };
  state.inventoryMovements.push(movement);
  return movement;
}

function reverseInventorySource(
  state: AppState,
  sourceType: NonNullable<InventoryMovement["sourceType"]>,
  sourceId: string,
  reason: string,
  occurredAt?: string,
): void {
  const reversedIds = new Set(
    state.inventoryMovements
      .map((movement) => movement.reversesMovementId)
      .filter((id): id is string => Boolean(id)),
  );
  const activeMovements = state.inventoryMovements.filter(
    (movement) =>
      movement.sourceType === sourceType &&
      movement.sourceId === sourceId &&
      !movement.reversesMovementId &&
      !reversedIds.has(movement.id),
  );
  for (const movement of activeMovements) {
    addStock(state, movement.productId, -movement.quantity, {
      movementType: "reversal",
      reason,
      sourceType,
      sourceId,
      reversesMovementId: movement.id,
      occurredAt,
    });
  }
}

function addCashMovement(state: AppState, movement: Omit<CashMovement, "id">): CashMovement {
  requirePositive(movement.amount, "El movimiento de caja o banco");
  const record = { ...movement, id: createId("cash") };
  state.cashMovements.push(record);
  return record;
}

function reverseCashSource(
  state: AppState,
  sourceType: "sale" | "purchase",
  sourceId: string,
  occurredAt = new Date().toISOString(),
): void {
  const reversedIds = new Set(
    state.cashMovements
      .map((movement) => movement.reversesMovementId)
      .filter((id): id is string => Boolean(id)),
  );
  const activeMovements = state.cashMovements.filter(
    (movement) =>
      movement.sourceType === sourceType &&
      movement.sourceId === sourceId &&
      !movement.reversesMovementId &&
      !reversedIds.has(movement.id),
  );
  for (const movement of activeMovements) {
    addCashMovement(state, {
      accountId: movement.accountId,
      direction: movement.direction === "in" ? "out" : "in",
      amount: movement.amount,
      date: occurredAt.slice(0, 10),
      method: movement.method,
      category: "Reversión de operación",
      description: `Reversión de ${movement.description}`,
      sourceType: "reversal",
      sourceId,
      reversesMovementId: movement.id,
      legacyUnassigned: movement.legacyUnassigned,
    });
  }
}

// Saldos y tesorería
export function outstandingBalance(
  sale: Sale,
  documents: AppState["electronicDocuments"] = [],
): number {
  const adjustments = documents
    .filter(
      (document) =>
        document.saleId === sale.id &&
        ["accepted", "delivered"].includes(document.status) &&
        document.kind !== "invoice",
    )
    .reduce(
      (sum, document) =>
        sum +
        (document.kind === "credit_note"
          ? -(document.adjustmentAmount ?? document.snapshot.total)
          : (document.adjustmentAmount ?? document.snapshot.total)),
      0,
    );
  return Math.max(
    0,
    sale.total + adjustments - sale.payments.reduce((sum, payment) => sum + payment.amount, 0),
  );
}

export function payableBalance(purchase: Purchase): number {
  if (purchase.status !== "received" || purchase.payableReviewStatus === "review_required")
    return 0;
  const amount = purchase.payableAmount ?? purchase.total;
  return Math.max(0, amount - purchase.payments.reduce((sum, payment) => sum + payment.amount, 0));
}

export function financialAccountBalance(state: AppState, account: FinancialAccount): number {
  const movementTotal = state.cashMovements
    .filter((movement) => movement.accountId === account.id)
    .reduce(
      (sum, movement) => sum + (movement.direction === "in" ? movement.amount : -movement.amount),
      0,
    );
  return account.openingBalance + movementTotal;
}

function validateAccount(state: AppState, accountId?: string): void {
  if (!accountId) return;
  if (!state.financialAccounts.some((account) => account.id === accountId && account.active)) {
    throw new BusinessError("Selecciona una cuenta de caja o banco activa.");
  }
}

export function addFinancialAccount(
  state: AppState,
  input: Omit<FinancialAccount, "id" | "createdAt" | "active">,
): AppState {
  const name = requireText(input.name, "El nombre de la cuenta");
  requireNonNegative(input.openingBalance, "El saldo inicial");
  if (
    state.financialAccounts.some(
      (account) => account.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
  ) {
    throw new BusinessError("Ya existe una cuenta con ese nombre.");
  }
  const next = cloneState(state);
  next.financialAccounts.push({
    ...input,
    id: createId("account"),
    name,
    openingBalance: roundCop(input.openingBalance),
    active: true,
    createdAt: new Date().toISOString(),
  });
  return next;
}

export function addManualCashMovement(
  state: AppState,
  input: Omit<
    CashMovement,
    "id" | "sourceType" | "sourceId" | "reversesMovementId" | "legacyUnassigned"
  >,
): AppState {
  validateAccount(state, input.accountId);
  requireText(input.date, "La fecha del movimiento");
  requireText(input.category, "La categoría del movimiento");
  requireText(input.description, "La descripción del movimiento");
  const next = cloneState(state);
  addCashMovement(next, {
    ...input,
    amount: roundCop(input.amount),
    method: input.method.trim() || "Otro",
    sourceType: "manual",
  });
  return next;
}

// Empresa y contactos
export function saveCompany(state: AppState, input: Company): AppState {
  const next = cloneState(state);
  next.company = {
    name: requireText(input.name, "El nombre de la empresa"),
    taxId: input.taxId.trim(),
    city: input.city.trim(),
    activity: input.activity.trim(),
  };
  return next;
}

export function saveTaxConfiguration(state: AppState, input: TaxConfiguration): AppState {
  const next = cloneState(state);
  const validRange = (from: number | null, to: number | null, label: string) => {
    if ((from === null) !== (to === null))
      throw new BusinessError(`Completa el inicio y fin del rango ${label}.`);
    if (
      from !== null &&
      to !== null &&
      (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from)
    )
      throw new BusinessError(
        `El rango ${label} debe ser numérico y tener un fin igual o mayor al inicio.`,
      );
  };
  validRange(input.rangeFrom, input.rangeTo, "autorizado");
  validRange(input.contingencyRangeFrom, input.contingencyRangeTo, "de contingencia");
  if (input.validFrom && input.validTo && input.validFrom > input.validTo)
    throw new BusinessError("La fecha inicial de vigencia no puede superar la fecha final.");
  next.taxConfiguration = {
    ...input,
    legalAddress: input.legalAddress.trim(),
    invoiceEmail: input.invoiceEmail.trim(),
    taxRegime: input.taxRegime.trim(),
    taxResponsibilities: [
      ...new Set(input.taxResponsibilities.map((item) => item.trim()).filter(Boolean)),
    ],
    providerId: input.providerId.trim(),
    resolutionNumber: input.resolutionNumber.trim(),
    prefix: input.prefix.trim().toUpperCase(),
    contingencyPrefix: input.contingencyPrefix.trim().toUpperCase(),
  };
  return next;
}

export function prepareElectronicInvoice(
  state: AppState,
  saleId: string,
  createdBy: string,
): AppState {
  const sale = state.sales.find((item) => item.id === saleId);
  if (!sale) throw new BusinessError("No encontramos la venta que se quiere facturar.");
  if (sale.invoiceFollowUpStatus === "registered_externally" || sale.externalInvoiceNumber.trim())
    throw new BusinessError(
      "Esta venta tiene una factura registrada por fuera de Pyme360. No prepares otra factura para evitar duplicados.",
    );
  if (
    state.electronicDocuments.some(
      (document) => document.saleId === saleId && document.kind === "invoice",
    )
  )
    throw new BusinessError("Esta venta ya tiene una factura electrónica preparada.");
  const company = state.company;
  const tax = state.taxConfiguration;
  const buyer = state.contacts.find((contact) => contact.id === sale.customerId);
  if (!company || !buyer)
    throw new BusinessError(
      "Completa los datos de empresa y cliente antes de preparar la factura.",
    );
  const validationIssues: string[] = [];
  if (!company.name.trim() || !company.taxId.trim())
    validationIssues.push("Falta razón social o NIT de la empresa.");
  if (!company.city.trim()) validationIssues.push("Falta la ciudad de la empresa.");
  if (!tax.legalAddress.trim()) validationIssues.push("Falta la dirección fiscal de la empresa.");
  if (!tax.taxRegime.trim() || tax.taxResponsibilities.length === 0)
    validationIssues.push("Completa el perfil y las responsabilidades tributarias según el RUT.");
  if (!buyer.taxId.trim() || !buyer.identificationType)
    validationIssues.push("Completa identificación y tipo de documento del cliente.");
  if (!tax.resolutionNumber || !tax.prefix || tax.rangeFrom === null || tax.rangeTo === null)
    validationIssues.push("Configura la resolución y el rango de numeración autorizado.");
  if (!tax.validFrom || !tax.validTo)
    validationIssues.push("Completa la vigencia de la numeración.");
  if (tax.validFrom && sale.date < tax.validFrom)
    validationIssues.push("La vigencia de la numeración comienza después de la fecha de la venta.");
  if (tax.validTo && sale.date > tax.validTo)
    validationIssues.push("La numeración autorizada está vencida para la fecha de la venta.");
  if (sale.total <= 0)
    validationIssues.push("El total de la venta debe ser mayor que cero.");
  if (!sale.lines.length) validationIssues.push("La venta no tiene renglones para facturar.");
  if (!tax.providerId)
    validationIssues.push("Selecciona un proveedor tecnológico antes de transmitir.");
  const lines = sale.lines.map((line, originalLineIndex) => {
    const product = state.products.find((item) => item.id === line.productId);
    const taxCategory = product?.taxCategory ?? "unclassified";
    if (taxCategory === "unclassified")
      validationIssues.push(`Clasifica tributariamente el producto ${line.productName}.`);
    if (taxCategory !== "taxable" && line.vatRate > 0)
      validationIssues.push(
        `El producto ${line.productName} tiene IVA, pero su clasificación no es gravada.`,
      );
    if (!(line.quantity > 0))
      validationIssues.push(`La cantidad de ${line.productName} debe ser mayor que cero.`);
    const expectedTax = Math.round(
      (Math.max(0, line.subtotal - line.discountShare) * line.vatRate) / 100,
    );
    if (Math.abs(expectedTax - line.vatAmount) > 1)
      validationIssues.push(
        `El IVA de ${line.productName} no coincide con su base gravable; revisa la venta.`,
      );
    return {
      productId: line.productId,
      originalLineIndex,
      sku: line.sku,
      description: line.productName,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      taxCategory,
      vatRate: line.vatRate,
      subtotal: line.subtotal,
      discount: line.discountShare,
      taxAmount: line.vatAmount,
      total: line.total,
    };
  });
  const snapshot: ElectronicDocumentSnapshot = {
    seller: {
      legalName: company.name,
      taxId: company.taxId,
      city: company.city,
      address: tax.legalAddress,
    },
    buyer: {
      name: buyer.name,
      taxId: buyer.taxId,
      identificationType: buyer.identificationType ?? null,
      email: buyer.email,
    },
    currency: "COP",
    issueDate: sale.date,
    dueDate: sale.dueDate ?? null,
    lines,
    subtotal: sale.subtotal,
    discount: sale.discount,
    vatAmount: sale.vatAmount,
    total: sale.total,
  };
  const next = cloneState(state);
  const document: ElectronicDocument = {
    id: createId("e-doc"),
    kind: "invoice",
    saleId,
    status: "draft",
    providerId: tax.providerId || undefined,
    environment: tax.environment,
    validationIssues: [...new Set(validationIssues)],
    createdAt: new Date().toISOString(),
    createdBy: createdBy.trim() || "Usuario Pyme360",
    snapshot,
    attempts: [],
  };
  // Electronic documents form an append-only audit trail. The local SQLite
  // API rejects reordering existing documents, so new drafts must be appended.
  next.electronicDocuments.push(document);
  return next;
}

export function isUnsentElectronicDraft(document: AppState["electronicDocuments"][number]): boolean {
  return (
    document.status === "draft" &&
    document.attempts.length === 0 &&
    !document.documentNumber &&
    !document.providerReference &&
    !document.cufe
  );
}

/** Solo retira borradores que nunca llegaron al proveedor; lo enviado se conserva. */
export function deleteElectronicDraft(state: AppState, documentId: string): AppState {
  const document = state.electronicDocuments.find((item) => item.id === documentId);
  if (!document) throw new BusinessError("No encontramos el borrador electrónico.");
  if (!isUnsentElectronicDraft(document))
    throw new BusinessError(
      "Solo se puede eliminar un borrador que nunca se haya enviado al proveedor.",
    );
  const next = cloneState(state);
  next.electronicDocuments = next.electronicDocuments.filter((item) => item.id !== documentId);
  return next;
}

export function prepareElectronicAdjustmentNote(
  state: AppState,
  originalDocumentId: string,
  kind: Extract<InvoiceDocumentKind, "credit_note" | "debit_note">,
  reason: string,
  changes: Array<{ originalLineIndex: number; quantity: number }>,
  createdBy: string,
): AppState {
  const original = state.electronicDocuments.find((document) => document.id === originalDocumentId);
  if (
    !original ||
    original.kind !== "invoice" ||
    !["accepted", "delivered"].includes(original.status)
  )
    throw new BusinessError(
      "Solo puedes preparar una nota sobre una factura aceptada o entregada.",
    );
  const noteReason = requireText(reason, "El motivo de la nota");
  if (!changes.length) throw new BusinessError("Selecciona al menos una línea para ajustar.");
  const uniqueIndexes = new Set<number>();
  const noteLines = changes.map(({ originalLineIndex, quantity }) => {
    if (
      !Number.isInteger(originalLineIndex) ||
      originalLineIndex < 0 ||
      originalLineIndex >= original.snapshot.lines.length
    )
      throw new BusinessError("Una línea seleccionada no pertenece a la factura original.");
    if (uniqueIndexes.has(originalLineIndex))
      throw new BusinessError("No repitas una línea en la misma nota.");
    uniqueIndexes.add(originalLineIndex);
    requirePositive(quantity, "La cantidad ajustada");
    const source = original.snapshot.lines[originalLineIndex];
    if (kind === "credit_note") {
      const alreadyCredited = state.electronicDocuments
        .filter(
          (document) =>
            document.relatedDocumentId === original.id &&
            document.kind === "credit_note" &&
            ["draft", "queued", "transmitted", "accepted", "delivered"].includes(document.status),
        )
        .flatMap((document) => document.snapshot.lines)
        .filter((line) => line.originalLineIndex === originalLineIndex)
        .reduce((sum, line) => sum + line.quantity, 0);
      if (alreadyCredited + quantity > source.quantity + 1e-9)
        throw new BusinessError(
          `La cantidad acreditada de ${source.description} superaría lo facturado.`,
        );
    }
    const ratio = quantity / source.quantity;
    const subtotal = roundCop(source.subtotal * ratio);
    const discount = kind === "credit_note" ? roundCop(source.discount * ratio) : 0;
    const taxableBase = Math.max(0, subtotal - discount);
    const taxAmount = roundCop((taxableBase * source.vatRate) / 100);
    return {
      ...source,
      quantity,
      subtotal,
      discount,
      taxAmount,
      total: taxableBase + taxAmount,
    };
  });
  const subtotal = noteLines.reduce((sum, line) => sum + line.subtotal, 0);
  const discount = noteLines.reduce((sum, line) => sum + line.discount, 0);
  const vatAmount = noteLines.reduce((sum, line) => sum + line.taxAmount, 0);
  const total = noteLines.reduce((sum, line) => sum + line.total, 0);
  const next = cloneState(state);
  next.electronicDocuments.push({
    id: createId("e-note"),
    kind,
    saleId: original.saleId,
    relatedDocumentId: original.id,
    status: "draft",
    providerId: state.taxConfiguration.providerId || undefined,
    environment: state.taxConfiguration.environment,
    adjustmentReason: noteReason,
    adjustmentAmount: total,
    validationIssues: [],
    createdAt: new Date().toISOString(),
    createdBy: createdBy.trim() || "Usuario Pyme360",
    snapshot: {
      ...original.snapshot,
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: null,
      lines: noteLines,
      subtotal,
      discount,
      vatAmount,
      total,
    },
    attempts: [],
  });
  return next;
}

export function addSupplierInvoiceDocument(
  state: AppState,
  input: Omit<SupplierInvoiceDocument, "id" | "importedAt" | "status" | "supplierContactId"> & {
    supplierContactId?: string;
  },
): AppState {
  const normalizedNumber = input.documentNumber.trim().toLocaleLowerCase();
  if (!normalizedNumber || !input.supplierTaxId.trim())
    throw new BusinessError(
      "El XML debe contener número de factura e identificación del proveedor.",
    );
  if (
    state.supplierInvoices.some(
      (invoice) =>
        invoice.documentNumber.trim().toLocaleLowerCase() === normalizedNumber &&
        invoice.supplierTaxId.trim().toLocaleLowerCase() ===
          input.supplierTaxId.trim().toLocaleLowerCase(),
    )
  )
    throw new BusinessError(
      "Ya se importó una factura con ese número e identificación de proveedor.",
    );
  const purchase = input.purchaseId
    ? state.purchases.find((item) => item.id === input.purchaseId)
    : undefined;
  if (input.purchaseId && !purchase)
    throw new BusinessError("La compra seleccionada ya no existe.");
  if (purchase) {
    if (input.currency !== "COP")
      throw new BusinessError(
        "Convierte la factura a COP antes de vincularla a una compra; Pyme360 no aplica tasas de cambio automáticamente.",
      );
    if (
      input.buyerTaxId.trim().toLocaleLowerCase() !==
      (state.company?.taxId ?? "").trim().toLocaleLowerCase()
    )
      throw new BusinessError("La identificación del adquirente no coincide con esta empresa.");
    const contact = state.contacts.find((item) => item.id === purchase.supplierId);
    if (
      !contact ||
      contact.taxId.trim().toLocaleLowerCase() !== input.supplierTaxId.trim().toLocaleLowerCase()
    )
      throw new BusinessError(
        "El proveedor de la compra no coincide con el NIT/identificación del XML.",
      );
  }
  const next = cloneState(state);
  const matchedContact = input.supplierContactId
    ? next.contacts.find((item) => item.id === input.supplierContactId)
    : next.contacts.find(
        (item) =>
          item.taxId.trim().toLocaleLowerCase() === input.supplierTaxId.trim().toLocaleLowerCase(),
      );
  next.supplierInvoices.unshift({
    ...input,
    id: createId("supplier-invoice"),
    importedAt: new Date().toISOString(),
    supplierTaxId: input.supplierTaxId.trim(),
    documentNumber: input.documentNumber.trim(),
    supplierName: input.supplierName.trim(),
    supplierContactId: matchedContact?.id,
    purchaseId: purchase?.id,
    status: purchase ? "linked" : "pending_review",
    lines: structuredClone(input.lines),
  });
  return next;
}

function identificationKey(taxId: string): string {
  return taxId.replace(/[^0-9a-z]/gi, "").toLowerCase();
}

/** Valida solo lo que cambió, para que un dato antiguo no impida editar el resto del contacto. */
function validateContactFields(
  contacts: Contact[],
  input: Pick<Contact, "taxId" | "phone" | "identificationType">,
  previous?: Contact,
): void {
  const taxId = input.taxId.trim();
  const phone = input.phone.trim();
  if (phone && phone !== previous?.phone) {
    if (!/^\+?[0-9 ()-]+$/.test(phone) || phone.replace(/\D/g, "").length < 7)
      throw new BusinessError("Escribe un teléfono válido, con al menos 7 dígitos.");
  }
  if (!taxId || taxId === previous?.taxId) return;
  const numericType = input.identificationType === "NIT" || input.identificationType === "CC";
  const looksNumeric = /^[0-9. -]+$/.test(taxId);
  if (numericType && !looksNumeric)
    throw new BusinessError("El NIT o la cédula solo pueden tener números, puntos y guiones.");
  if ((numericType || !input.identificationType) && looksNumeric) {
    if (taxId.replace(/\D/g, "").length < 6)
      throw new BusinessError("El NIT o la cédula deben tener al menos 6 dígitos.");
  }
  const duplicate = contacts.find(
    (contact) =>
      contact.id !== previous?.id && identificationKey(contact.taxId) === identificationKey(taxId),
  );
  if (duplicate)
    throw new BusinessError(`Ya existe un contacto con esa identificación: ${duplicate.name}.`);
}

export function addContact(
  state: AppState,
  input: Omit<Contact, "id" | "name"> & { name: string },
): AppState {
  const next = cloneState(state);
  const ordinaryCustomer = input.ordinaryCustomer && input.role !== "supplier";
  const name = ordinaryCustomer
    ? "Cliente de mostrador"
    : requireText(input.name, "El nombre del contacto");

  if (ordinaryCustomer && next.contacts.some((contact) => contact.ordinaryCustomer)) {
    throw new BusinessError("Ya existe un cliente de mostrador.");
  }
  validateContactFields(next.contacts, input);

  next.contacts.unshift({
    id: createId("contact"),
    ...input,
    name,
    ordinaryCustomer,
    taxId: input.taxId.trim(),
    email: input.email.trim(),
    phone: input.phone.trim(),
  });
  return next;
}

export function updateContact(
  state: AppState,
  contactId: string,
  input: Omit<Contact, "id">,
): AppState {
  const next = cloneState(state);
  const index = next.contacts.findIndex((contact) => contact.id === contactId);
  if (index < 0) throw new BusinessError("No encontramos el contacto.");
  const ordinaryCustomer = input.ordinaryCustomer && input.role !== "supplier";
  const name = ordinaryCustomer
    ? "Cliente de mostrador"
    : requireText(input.name, "El nombre del contacto");
  if (
    ordinaryCustomer &&
    next.contacts.some(
      (contact, contactIndex) => contactIndex !== index && contact.ordinaryCustomer,
    )
  ) {
    throw new BusinessError("Ya existe un cliente de mostrador.");
  }
  validateContactFields(next.contacts, input, next.contacts[index]);
  next.contacts[index] = {
    ...input,
    id: contactId,
    name,
    ordinaryCustomer,
    taxId: input.taxId.trim(),
    email: input.email.trim(),
    phone: input.phone.trim(),
  };
  return next;
}

export function deleteContact(state: AppState, contactId: string): AppState {
  const next = cloneState(state);
  if (
    next.sales.some((sale) => sale.customerId === contactId) ||
    next.purchases.some((purchase) => purchase.supplierId === contactId) ||
    next.supplierInvoices.some((invoice) => invoice.supplierContactId === contactId)
  ) {
    throw new BusinessError(
      "No puedes eliminar un contacto que ya está asociado a ventas o compras.",
    );
  }
  const index = next.contacts.findIndex((contact) => contact.id === contactId);
  if (index < 0) throw new BusinessError("No encontramos el contacto.");
  next.contacts.splice(index, 1);
  return next;
}

// Productos e inventario
export function addProduct(state: AppState, input: Omit<Product, "id" | "sku">): AppState {
  const next = cloneState(state);
  const name = requireText(input.name, "El nombre del producto");
  const unit = requireText(input.unit, "La unidad de medida");
  requireNonNegative(input.stock, "La existencia inicial");
  requireNonNegative(input.minimumStock, "El inventario mínimo");
  requireNonNegative(input.unitCost, "El costo unitario");
  requireNonNegative(input.unitPrice, "El precio de venta");
  if (input.environmentalConversionFactor !== undefined)
    requirePositive(input.environmentalConversionFactor, "La conversión ambiental");
  validateBenchmarkOutputConversion(input);
  if (
    Boolean(input.environmentalUnit?.trim()) !==
    (input.environmentalConversionFactor !== undefined)
  )
    throw new BusinessError(
      "Indica tanto la unidad ambiental base como su factor de conversión, o deja ambos vacíos.",
    );
  if (
    !Number.isFinite(input.recycledContentPercent ?? 0) ||
    (input.recycledContentPercent ?? 0) < 0 ||
    (input.recycledContentPercent ?? 0) > 100
  ) {
    throw new BusinessError("El contenido reciclado debe estar entre 0 y 100 %.");
  }
  if (!Number.isFinite(input.vatRate) || input.vatRate < 0 || input.vatRate > 100) {
    throw new BusinessError("La tarifa de IVA debe estar entre 0 y 100 %.");
  }

  const sku = nextCode("P-", next.products.map((product) => product.sku));
  next.products.unshift({
    ...input,
    taxCategory: input.taxCategory ?? "unclassified",
    id: createId("product"),
    sku,
    name,
    unit,
    environmentalUnit: input.environmentalUnit?.trim() || undefined,
    stock: Number(input.stock.toFixed(4)),
    minimumStock: Number(input.minimumStock.toFixed(4)),
    unitCost: roundCop(input.unitCost),
    unitPrice: roundCop(input.unitPrice),
  });
  const createdProduct = next.products[0];
  if (createdProduct.stock > 0) {
    const initialStock = createdProduct.stock;
    createdProduct.stock = 0;
    addStock(next, createdProduct.id, initialStock, {
      movementType: "opening_balance",
      reason: "Existencia inicial del producto",
    });
  }
  return next;
}

export function updateProduct(
  state: AppState,
  productId: string,
  input: Omit<Product, "id" | "sku">,
): AppState {
  const next = cloneState(state);
  const index = next.products.findIndex((product) => product.id === productId);
  if (index < 0) throw new BusinessError("No encontramos el producto.");
  const current = next.products[index];
  const name = requireText(input.name, "El nombre del producto");
  const unit = requireText(input.unit, "La unidad de medida");
  requireNonNegative(input.stock, "La existencia");
  requireNonNegative(input.minimumStock, "El inventario mínimo");
  requireNonNegative(input.unitCost, "El costo unitario");
  requireNonNegative(input.unitPrice, "El precio de venta");
  if (input.environmentalConversionFactor !== undefined)
    requirePositive(input.environmentalConversionFactor, "La conversión ambiental");
  validateBenchmarkOutputConversion(input);
  if (
    Boolean(input.environmentalUnit?.trim()) !==
    (input.environmentalConversionFactor !== undefined)
  )
    throw new BusinessError(
      "Indica tanto la unidad ambiental base como su factor de conversión, o deja ambos vacíos.",
    );
  if (
    !Number.isFinite(input.recycledContentPercent ?? 0) ||
    (input.recycledContentPercent ?? 0) < 0 ||
    (input.recycledContentPercent ?? 0) > 100
  )
    throw new BusinessError("El contenido reciclado debe estar entre 0 y 100 %.");
  if (!Number.isFinite(input.vatRate) || input.vatRate < 0 || input.vatRate > 100)
    throw new BusinessError("La tarifa de IVA debe estar entre 0 y 100 %.");
  next.products[index] = {
    ...input,
    taxCategory: input.taxCategory ?? current.taxCategory ?? "unclassified",
    environmentalUnit: input.environmentalUnit?.trim() || undefined,
    id: current.id,
    sku: current.sku,
    name,
    unit,
    stock: current.stock,
    minimumStock: Number(input.minimumStock.toFixed(4)),
    unitCost: roundCop(input.unitCost),
    unitPrice: roundCop(input.unitPrice),
  };
  const stockChange = Number((input.stock - current.stock).toFixed(4));
  if (stockChange !== 0)
    addStock(next, productId, stockChange, {
      reason: "Ajuste de existencia al editar el producto",
    });
  return next;
}

export function deleteProduct(state: AppState, productId: string): AppState {
  const next = cloneState(state);
  const product = getProduct(next, productId);
  const referenced =
    next.sales.some((sale) => sale.lines.some((line) => line.productId === productId)) ||
    next.purchases.some((purchase) =>
      purchase.lines.some((line) => line.productId === productId),
    ) ||
    next.productionOrders.some(
      (order) =>
        order.productId === productId ||
        order.consumedMaterials.some((line) => line.productId === productId),
    ) ||
    next.recipes.some(
      (recipe) =>
        recipe.productId === productId ||
        recipe.versions.some((version) =>
          version.components.some((line) => line.productId === productId),
        ),
    );
  if (referenced)
    throw new BusinessError(
      `No puedes eliminar ${product.name} porque ya está usado en operaciones o recetas.`,
    );
  if (product.stock !== 0)
    throw new BusinessError("Ajusta la existencia a cero antes de eliminar el producto.");
  next.products.splice(
    next.products.findIndex((item) => item.id === productId),
    1,
  );
  next.recipes = next.recipes.filter((recipe) => recipe.productId !== productId);
  return next;
}

function validateRecipeComponents(
  state: AppState,
  finishedProductId: string,
  components: RecipeComponent[],
): RecipeComponent[] {
  const normalized = components.filter((line) => line.productId && line.quantity > 0);
  if (normalized.length === 0) throw new BusinessError("Agrega al menos un material a la receta.");
  const uniqueIds = new Set<string>();
  for (const line of normalized) {
    requirePositive(line.quantity, "La cantidad de la receta");
    const material = getProduct(state, line.productId);
    if (material.id === finishedProductId)
      throw new BusinessError("Un producto no puede formar parte de su propia receta.");
    if (material.type === "finished") {
      throw new BusinessError("Una receta solo puede usar materias primas e insumos.");
    }
    if (uniqueIds.has(line.productId)) {
      throw new BusinessError("No repitas el mismo material en una receta.");
    }
    uniqueIds.add(line.productId);
  }
  return normalized.map((line) => ({ ...line }));
}

export function activeRecipeVersion(
  state: AppState,
  productId: string,
): { recipe: Recipe; version: RecipeVersion } | null {
  const recipe = state.recipes.find((item) => item.productId === productId);
  const version = recipe?.versions.find(
    (item) => item.id === recipe.activeVersionId && item.status === "active",
  );
  return recipe && version ? { recipe, version } : null;
}

/** Saves a first draft, updates an existing draft, or creates a new draft from the active recipe. */
export function saveRecipeVersion(state: AppState, input: RecipeVersionInput): AppState {
  const next = cloneState(state);
  const product = getProduct(next, input.productId);
  if (product.type !== "finished")
    throw new BusinessError("La receta debe pertenecer a un producto terminado.");
  requirePositive(input.baseQuantity, "La cantidad base del lote");
  if (
    !Number.isFinite(input.expectedYieldPercent) ||
    input.expectedYieldPercent <= 0 ||
    input.expectedYieldPercent > 100
  ) {
    throw new BusinessError("El rendimiento esperado debe ser mayor que 0 y máximo 100 %.");
  }
  const components = validateRecipeComponents(next, product.id, input.components);
  let recipe = next.recipes.find((item) => item.productId === product.id);
  if (!recipe) {
    recipe = {
      id: createId("recipe"),
      productId: product.id,
      activeVersionId: null,
      versions: [],
    };
    next.recipes.push(recipe);
  }
  const now = new Date().toISOString();
  if (input.versionId) {
    const version = recipe.versions.find((item) => item.id === input.versionId);
    if (!version || version.status !== "draft")
      throw new BusinessError("Solo puedes editar una versión en borrador.");
    version.baseQuantity = Number(input.baseQuantity.toFixed(4));
    version.expectedYieldPercent = Number(input.expectedYieldPercent.toFixed(2));
    version.components = components;
  } else {
    const versionNumber = recipe.versions.reduce(
      (highest, version) => Math.max(highest, version.versionNumber),
      0,
    ) + 1;
    recipe.versions.push({
      id: createId("recipe-version"),
      versionNumber,
      status: "draft",
      baseQuantity: Number(input.baseQuantity.toFixed(4)),
      expectedYieldPercent: Number(input.expectedYieldPercent.toFixed(2)),
      components,
      createdAt: now,
    });
  }
  return next;
}

export function activateRecipeVersion(
  state: AppState,
  recipeId: string,
  versionId: string,
): AppState {
  const next = cloneState(state);
  const recipe = requireValue(
    next.recipes.find((item) => item.id === recipeId),
    "No encontramos la receta.",
  );
  const version = requireValue(
    recipe.versions.find((item) => item.id === versionId),
    "No encontramos la versión de la receta.",
  );
  if (version.status === "archived")
    throw new BusinessError("Crea una nueva versión para reactivar una receta archivada.");
  validateRecipeComponents(next, recipe.productId, version.components);
  for (const otherVersion of recipe.versions) {
    if (otherVersion.status === "active") otherVersion.status = "archived";
  }
  version.status = "active";
  version.activatedAt = new Date().toISOString();
  recipe.activeVersionId = version.id;
  return next;
}

export function adjustStock(
  state: AppState,
  productId: string,
  change: number,
  reason = "Ajuste manual",
): AppState {
  if (!Number.isFinite(change) || change === 0) {
    throw new BusinessError("El ajuste debe ser distinto de cero.");
  }
  if (!reason.trim()) throw new BusinessError("Indica el motivo del ajuste de inventario.");
  const next = cloneState(state);
  addStock(next, productId, change, { reason: reason.trim() });
  return next;
}

/** Reconciles a physical count against the current balance and records the variance in the stock ledger. */
export function reconcileInventoryCount(
  state: AppState,
  productId: string,
  countedQuantity: number,
  reason: string,
): AppState {
  requireNonNegative(countedQuantity, "La cantidad contada");
  const product = getProduct(state, productId);
  const counted = Number(countedQuantity.toFixed(4));
  const difference = Number((counted - product.stock).toFixed(4));
  if (difference === 0) return cloneState(state);
  const note = requireText(reason, "El motivo del conteo");
  return adjustStock(
    state,
    productId,
    difference,
    `Conteo físico: contado ${counted} ${product.unit}; saldo anterior ${product.stock} ${product.unit}. ${note}`,
  );
}

// Ventas y recaudos
function buildSaleLines(state: AppState, input: SaleInput, discount: number): Sale["lines"] {
  if (input.lines.length === 0) throw new BusinessError("Agrega al menos un producto a la venta.");

  const prepared = input.lines.map((line) => {
    requirePositive(line.quantity, "La cantidad vendida");
    const product = getProduct(state, line.productId);
    if (product.type !== "finished") {
      throw new BusinessError(`${product.name} no es un producto terminado que se pueda vender.`);
    }
    const rawPrice = line.unitPrice ?? product.unitPrice;
    requireNonNegative(rawPrice, "El precio de venta");
    const unitPrice = roundCop(rawPrice);
    return {
      product,
      quantity: line.quantity,
      unitPrice,
      subtotal: roundCop(line.quantity * unitPrice),
    };
  });

  const subtotal = prepared.reduce((sum, line) => sum + line.subtotal, 0);
  requireNonNegative(discount, "El descuento");
  if (discount > subtotal) throw new BusinessError("El descuento no puede superar el subtotal.");

  let allocatedDiscount = 0;
  return prepared.map((line, index) => {
    const discountShare =
      index === prepared.length - 1
        ? discount - allocatedDiscount
        : subtotal === 0
          ? 0
          : roundCop((discount * line.subtotal) / subtotal);
    allocatedDiscount += discountShare;
    const taxableBase = Math.max(0, line.subtotal - discountShare);
    const vatAmount = roundCop((taxableBase * line.product.vatRate) / 100);
    return {
      productId: line.product.id,
      sku: line.product.sku,
      productName: line.product.name,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      vatRate: line.product.vatRate,
      subtotal: line.subtotal,
      discountShare,
      vatAmount,
      total: taxableBase + vatAmount,
    };
  });
}

export function createSale(state: AppState, input: SaleInput): AppState {
  const next = cloneState(state);
  const saleId = createId("sale");
  validateAccount(next, input.initialPaymentAccountId);
  const customer = getContact(next, input.customerId);
  if (customer.role === "supplier") {
    throw new BusinessError("Selecciona un contacto con rol de cliente.");
  }

  const discount = roundCop(input.discount);
  const subtotal = input.lines.reduce((sum, line) => {
    const product = getProduct(next, line.productId);
    return sum + roundCop(line.quantity * roundCop(line.unitPrice ?? product.unitPrice));
  }, 0);
  const lines = buildSaleLines(next, input, discount);
  const vatAmount = lines.reduce((sum, line) => sum + line.vatAmount, 0);
  const total = lines.reduce((sum, line) => sum + line.total, 0);
  requireNonNegative(input.initialPayment, "El abono inicial");
  if (input.initialPayment > total) {
    throw new BusinessError("El abono inicial no puede superar el total de la venta.");
  }

  const requestedByProduct = new Map<string, number>();
  for (const line of lines) {
    requestedByProduct.set(
      line.productId,
      (requestedByProduct.get(line.productId) ?? 0) + line.quantity,
    );
  }
  for (const [productId, quantity] of requestedByProduct) {
    const product = getProduct(next, productId);
    if (quantity > product.stock) {
      throw new BusinessError(
        `No hay suficiente inventario de ${product.name}. Disponible: ${product.stock} ${product.unit}.`,
      );
    }
    addStock(next, productId, -quantity, {
      movementType: "sale",
      reason: "Salida por venta",
      sourceType: "sale",
      sourceId: saleId,
      occurredAt: `${input.date}T12:00:00.000Z`,
    });
  }

  const payments: Payment[] =
    input.initialPayment > 0
      ? [
          {
            id: createId("payment"),
            date: input.date,
            amount: roundCop(input.initialPayment),
            method: input.initialPaymentMethod.trim() || "Efectivo",
            accountId: input.initialPaymentAccountId || undefined,
          },
        ]
      : [];
  const sale: Sale = {
    id: saleId,
    number: nextCode("V-", next.sales.map((sale) => sale.number)),
    date: input.date,
    customerId: customer.id,
    customerName: customer.name,
    lines,
    subtotal,
    discount,
    vatAmount,
    total,
    payments,
    invoiceFollowUpStatus: input.invoiceFollowUpStatus,
    externalInvoiceNumber: input.externalInvoiceNumber.trim(),
    externalInvoiceDate: input.externalInvoiceDate,
    dueDate: input.dueDate || undefined,
  };
  if (payments[0]) {
    const movement = addCashMovement(next, {
      accountId: input.initialPaymentAccountId || undefined,
      direction: "in",
      amount: payments[0].amount,
      date: input.date,
      method: payments[0].method,
      category: "Abono de venta",
      description: `Abono inicial ${sale.number}`,
      sourceType: "sale",
      sourceId: saleId,
    });
    payments[0].cashMovementId = movement.id;
  }
  next.sales.unshift(sale);
  return next;
}

export function addSalePayment(
  state: AppState,
  saleId: string,
  amount: number,
  date: string,
  method: string,
  accountId?: string,
): AppState {
  requirePositive(amount, "El abono");
  validateAccount(state, accountId);
  const next = cloneState(state);
  const sale = requireValue(
    next.sales.find((item) => item.id === saleId),
    "No encontramos la venta.",
  );
  if (amount > outstandingBalance(sale, next.electronicDocuments)) {
    throw new BusinessError("El abono no puede superar el saldo pendiente.");
  }
  const cleanMethod = method.trim() || "Efectivo";
  const payment: Payment = {
    id: createId("payment"),
    date,
    amount: roundCop(amount),
    method: cleanMethod,
    accountId,
  };
  const movement = addCashMovement(next, {
    accountId,
    direction: "in",
    amount: payment.amount,
    date,
    method: cleanMethod,
    category: "Abono de venta",
    description: `Abono ${sale.number}`,
    sourceType: "sale",
    sourceId: saleId,
  });
  payment.cashMovementId = movement.id;
  sale.payments.push(payment);
  return next;
}

export function addPurchasePayment(
  state: AppState,
  purchaseId: string,
  amount: number,
  date: string,
  method: string,
  accountId?: string,
): AppState {
  requirePositive(amount, "El pago");
  validateAccount(state, accountId);
  const next = cloneState(state);
  const purchase = requireValue(
    next.purchases.find((item) => item.id === purchaseId),
    "No encontramos la compra.",
  );
  if (purchase.status !== "received")
    throw new BusinessError("Registra pagos cuando la compra haya sido recibida.");
  if (purchase.payableReviewStatus === "review_required")
    throw new BusinessError("Confirma primero el saldo histórico de esta compra.");
  if (amount > payableBalance(purchase))
    throw new BusinessError("El pago no puede superar el saldo pendiente.");
  const cleanMethod = method.trim() || "Efectivo";
  const payment: Payment = {
    id: createId("payment"),
    date,
    amount: roundCop(amount),
    method: cleanMethod,
    accountId,
  };
  const movement = addCashMovement(next, {
    accountId,
    direction: "out",
    amount: payment.amount,
    date,
    method: cleanMethod,
    category: "Pago de compra",
    description: `Pago ${purchase.number}`,
    sourceType: "purchase",
    sourceId: purchaseId,
  });
  payment.cashMovementId = movement.id;
  purchase.payments.push(payment);
  return next;
}

export function confirmLegacyPurchasePayable(
  state: AppState,
  purchaseId: string,
  outstandingAmount: number,
  dueDate = "",
): AppState {
  requireNonNegative(outstandingAmount, "El saldo pendiente confirmado");
  const next = cloneState(state);
  const purchase = requireValue(
    next.purchases.find((item) => item.id === purchaseId),
    "No encontramos la compra.",
  );
  if (purchase.payableReviewStatus !== "review_required")
    throw new BusinessError("Esta compra ya fue conciliada.");
  if (purchase.status !== "received")
    throw new BusinessError("Solo las compras recibidas pueden conciliarse como cuenta por pagar.");
  if (outstandingAmount > purchase.total)
    throw new BusinessError("El saldo confirmado no puede superar el total de la compra.");
  purchase.payableAmount = roundCop(outstandingAmount);
  purchase.dueDate = dueDate || undefined;
  purchase.payableReviewStatus = "confirmed";
  return next;
}

export function deleteSale(state: AppState, saleId: string): AppState {
  const next = cloneState(state);
  const index = next.sales.findIndex((sale) => sale.id === saleId);
  if (index < 0) throw new BusinessError("No encontramos la venta.");
  if (next.electronicDocuments.some((document) => document.saleId === saleId))
    throw new BusinessError(
      "Esta venta tiene un documento electrónico. Si es un borrador sin enviar, elimínalo primero en Facturación y documentos; los documentos enviados se conservan como historial.",
    );
  const sale = next.sales[index];
  const hasLedgerMovements = next.inventoryMovements.some(
    (movement) => movement.sourceType === "sale" && movement.sourceId === saleId,
  );
  if (hasLedgerMovements) {
    reverseInventorySource(next, "sale", saleId, `Reversión de venta ${sale.number}`);
  } else {
    for (const line of sale.lines)
      addStock(next, line.productId, line.quantity, {
        movementType: "reversal",
        reason: `Reversión de venta histórica ${sale.number}`,
        sourceType: "sale",
        sourceId: saleId,
      });
  }
  reverseCashSource(next, "sale", saleId);
  next.sales.splice(index, 1);
  return next;
}

// Compras y cuentas por pagar
function buildPurchaseLines(state: AppState, input: PurchaseInput): PurchaseLine[] {
  if (input.lines.length === 0) throw new BusinessError("Agrega al menos un producto a la compra.");
  return input.lines.map((line) => {
    requirePositive(line.quantity, "La cantidad comprada");
    requireNonNegative(line.lineTotal, "El costo del renglón");
    const product = getProduct(state, line.productId);
    if (product.type === "finished") {
      throw new BusinessError("Las compras deben ser materias primas o insumos.");
    }
    return {
      productId: product.id,
      sku: product.sku,
      productName: product.name,
      quantity: line.quantity,
      lineTotal: roundCop(line.lineTotal),
      environmentalUnit: product.environmentalUnit ?? "",
      environmentalConversionFactor: product.environmentalConversionFactor ?? 0,
      recycledContentPercent: product.recycledContentPercent,
    };
  });
}

/** Promedio ponderado: un costo en cero se trata como desconocido y no diluye la entrada. */
function blendUnitCost(product: Product, quantity: number, totalCost: number): void {
  const knownStock = product.unitCost > 0 ? Math.max(product.stock, 0) : 0;
  const denominator = knownStock + quantity;
  if (denominator <= 0) return;
  product.unitCost = roundCop((knownStock * product.unitCost + totalCost) / denominator);
}

function removeFromUnitCost(product: Product, quantity: number, totalCost: number): void {
  const remaining = product.stock - quantity;
  const remainingValue = product.stock * product.unitCost - totalCost;
  if (remaining > 0 && remainingValue > 0) product.unitCost = roundCop(remainingValue / remaining);
}

function applyPurchaseChanges(
  state: AppState,
  previous: Purchase | null,
  updatedStatus: PurchaseStatus,
  updatedLines: PurchaseLine[],
  purchaseId: string,
  occurredAt: string,
): void {
  if (previous?.status === "received") {
    const reversed = new Map<string, { quantity: number; totalCost: number }>();
    for (const line of previous.lines) {
      const entry = reversed.get(line.productId) ?? { quantity: 0, totalCost: 0 };
      reversed.set(line.productId, {
        quantity: entry.quantity + line.quantity,
        totalCost: entry.totalCost + line.lineTotal,
      });
    }
    for (const [productId, entry] of reversed)
      removeFromUnitCost(getProduct(state, productId), entry.quantity, entry.totalCost);
    const hasLedgerMovements = state.inventoryMovements.some(
      (movement) => movement.sourceType === "purchase" && movement.sourceId === purchaseId,
    );
    if (hasLedgerMovements) {
      reverseInventorySource(
        state,
        "purchase",
        purchaseId,
        `Reversión de compra ${previous.number}`,
        occurredAt,
      );
    } else {
      for (const line of previous.lines) {
        addStock(state, line.productId, -line.quantity, {
          movementType: "reversal",
          reason: `Reversión de compra histórica ${previous.number}`,
          sourceType: "purchase",
          sourceId: purchaseId,
          occurredAt,
        });
      }
    }
  }
  if (updatedStatus === "received") {
    for (const line of updatedLines) {
      blendUnitCost(getProduct(state, line.productId), line.quantity, line.lineTotal);
      addStock(state, line.productId, line.quantity, {
        movementType: "purchase",
        reason: "Entrada por compra recibida",
        sourceType: "purchase",
        sourceId: purchaseId,
        occurredAt,
      });
    }
  }
}

export function createPurchase(state: AppState, input: PurchaseInput): AppState {
  const next = cloneState(state);
  const purchaseId = createId("purchase");
  const supplier = getContact(next, input.supplierId);
  if (supplier.role === "customer")
    throw new BusinessError("Selecciona un contacto con rol de proveedor.");
  const lines = buildPurchaseLines(next, input);
  applyPurchaseChanges(next, null, input.status, lines, purchaseId, `${input.date}T12:00:00.000Z`);
  const total = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  next.purchases.unshift({
    id: purchaseId,
    number: nextCode("C-", next.purchases.map((purchase) => purchase.number)),
    date: input.date,
    supplierId: supplier.id,
    supplierName: supplier.name,
    status: input.status,
    lines,
    total,
    dueDate: input.dueDate || undefined,
    payments: [],
    payableReviewStatus: "confirmed",
    payableAmount: input.status === "received" ? total : undefined,
  });
  return next;
}

export function updatePurchase(
  state: AppState,
  purchaseId: string,
  input: PurchaseInput,
): AppState {
  const next = cloneState(state);
  const index = next.purchases.findIndex((purchase) => purchase.id === purchaseId);
  if (index < 0) throw new BusinessError("No encontramos la compra.");
  const supplier = getContact(next, input.supplierId);
  if (supplier.role === "customer")
    throw new BusinessError("Selecciona un contacto con rol de proveedor.");
  const previous = next.purchases[index];
  if (next.supplierInvoices.some((invoice) => invoice.purchaseId === purchaseId))
    throw new BusinessError(
      "No puedes editar una compra vinculada a una factura de proveedor importada. Conserva el vínculo para trazabilidad.",
    );
  const lines = buildPurchaseLines(next, input);
  const total = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const paid = previous.payments.reduce((sum, payment) => sum + payment.amount, 0);
  if (input.status === "pending" && paid > 0)
    throw new BusinessError(
      "No puedes pasar a pendiente de recepción una compra que ya tiene pagos registrados.",
    );
  if (input.status === "received" && previous.payableReviewStatus === "confirmed" && paid > total)
    throw new BusinessError("El nuevo total no puede ser menor que los pagos aplicados.");
  applyPurchaseChanges(
    next,
    previous,
    input.status,
    lines,
    purchaseId,
    `${input.date}T12:00:00.000Z`,
  );
  next.purchases[index] = {
    ...previous,
    date: input.date,
    supplierId: supplier.id,
    supplierName: supplier.name,
    status: input.status,
    lines,
    total,
    dueDate: input.dueDate || undefined,
    payableAmount:
      previous.payableReviewStatus === "review_required"
        ? previous.payableAmount
        : input.status === "received"
          ? total
          : undefined,
  };
  return next;
}

export function deletePurchase(state: AppState, purchaseId: string): AppState {
  const next = cloneState(state);
  const index = next.purchases.findIndex((purchase) => purchase.id === purchaseId);
  if (index < 0) throw new BusinessError("No encontramos la compra.");
  const purchase = next.purchases[index];
  if (next.supplierInvoices.some((invoice) => invoice.purchaseId === purchaseId))
    throw new BusinessError(
      "No puedes eliminar una compra vinculada a una factura de proveedor importada.",
    );
  applyPurchaseChanges(next, purchase, "pending", [], purchaseId, new Date().toISOString());
  reverseCashSource(next, "purchase", purchaseId);
  next.purchases.splice(index, 1);
  return next;
}

// Órdenes de producción
export function createProductionOrder(
  state: AppState,
  productId: string,
  quantity: number,
  date: string,
): AppState {
  requirePositive(quantity, "La cantidad a producir");
  const next = cloneState(state);
  const orderId = createId("production");
  const product = getProduct(next, productId);
  if (product.type !== "finished") throw new BusinessError("Selecciona un producto terminado.");
  const activeRecipe = activeRecipeVersion(next, productId);
  if (!activeRecipe)
    throw new BusinessError("Este producto no tiene una receta configurada.");

  const requirements = calculateRecipeRequirements(activeRecipe.version, quantity);
  const consumedMaterials = requirements.map((requirement) => {
    const material = getProduct(next, requirement.productId);
    const consumed = requirement.quantity;
    if (material.stock < consumed) {
      throw new BusinessError(
        `No hay suficiente ${material.name}. Requiere ${consumed} ${material.unit}; disponible: ${material.stock} ${material.unit}.`,
      );
    }
    return {
      productId: material.id,
      sku: material.sku,
      productName: material.name,
      quantity: consumed,
      unit: material.unit,
      environmentalUnit: material.environmentalUnit ?? "",
      environmentalConversionFactor: material.environmentalConversionFactor ?? 0,
      unitCostSnapshot: material.unitCost > 0 ? material.unitCost : null,
      lineCostSnapshot: material.unitCost > 0 ? roundCop(consumed * material.unitCost) : null,
    };
  });
  const materialCost = estimateMaterialCost(
    next.products,
    requirements,
    quantity * (activeRecipe.version.expectedYieldPercent / 100),
  );
  for (const material of consumedMaterials)
    addStock(next, material.productId, -material.quantity, {
      movementType: "production_consumption",
      reason: "Consumo de materiales para producción",
      sourceType: "production",
      sourceId: orderId,
      occurredAt: `${date}T12:00:00.000Z`,
    });

  next.productionOrders.unshift({
    id: orderId,
    number: nextCode("OP-", next.productionOrders.map((order) => order.number)),
    date,
    productId: product.id,
    productName: product.name,
    quantity,
    wasteQuantity: 0,
    status: "active",
    consumedMaterials,
    completedAt: "",
    estimatedMaterialCost: materialCost.totalCost,
    materialCostPerGoodUnit: null,
    recipeVersionId: activeRecipe.version.id,
    recipeVersionNumber: activeRecipe.version.versionNumber,
    expectedYieldPercent: activeRecipe.version.expectedYieldPercent,
    expectedGoodOutputQuantity: Number(
      (quantity * (activeRecipe.version.expectedYieldPercent / 100)).toFixed(4),
    ),
  });
  return next;
}

export function completeProductionOrder(
  state: AppState,
  orderId: string,
  wasteQuantity: number,
  completedAt: string,
): AppState {
  const next = cloneState(state);
  const order = requireValue(
    next.productionOrders.find((item) => item.id === orderId),
    "No encontramos la orden de producción.",
  );
  if (order.status !== "active") throw new BusinessError("Solo puedes completar una orden activa.");
  requireNonNegative(wasteQuantity, "El desperdicio");
  if (wasteQuantity > order.quantity)
    throw new BusinessError("El desperdicio no puede superar las unidades procesadas.");
  const product = getProduct(next, order.productId);
  if (order.estimatedMaterialCost != null && order.quantity > wasteQuantity)
    blendUnitCost(product, order.quantity - wasteQuantity, order.estimatedMaterialCost);
  addStock(next, product.id, order.quantity - wasteQuantity, {
    movementType: "production_output",
    reason: "Entrada de producto terminado",
    sourceType: "production",
    sourceId: orderId,
    occurredAt: `${completedAt}T12:00:00.000Z`,
  });
  order.wasteQuantity = wasteQuantity;
  order.status = "completed";
  order.completedAt = completedAt;
  const goodOutputQuantity = order.quantity - wasteQuantity;
  order.materialCostPerGoodUnit =
    order.estimatedMaterialCost == null || goodOutputQuantity <= 0
      ? null
      : roundCop(order.estimatedMaterialCost / goodOutputQuantity);
  return next;
}

export function cancelProductionOrder(state: AppState, orderId: string): AppState {
  const next = cloneState(state);
  const index = next.productionOrders.findIndex((item) => item.id === orderId);
  if (index < 0) throw new BusinessError("No encontramos la orden de producción.");
  const order = next.productionOrders[index];
  if (order.status !== "active") throw new BusinessError("Solo puedes cancelar una orden activa.");
  const hasLedgerMovements = next.inventoryMovements.some(
    (movement) => movement.sourceType === "production" && movement.sourceId === orderId,
  );
  if (hasLedgerMovements) {
    reverseInventorySource(
      next,
      "production",
      orderId,
      `Reversión de orden de producción ${order.number}`,
    );
  } else {
    // Las órdenes activas anteriores al historial de inventario ya descontaron
    // materiales. Al cancelarlas, reconstruimos esa entrada con un movimiento.
    for (const material of order.consumedMaterials) {
      addStock(next, material.productId, material.quantity, {
        movementType: "reversal",
        reason: `Reversión de orden histórica ${order.number}`,
        sourceType: "production",
        sourceId: orderId,
      });
    }
  }
  order.status = "cancelled";
  return next;
}
