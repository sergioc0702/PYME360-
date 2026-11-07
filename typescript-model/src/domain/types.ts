export type ContactRole = "customer" | "supplier" | "both";

export type ProductType = "raw_material" | "supply" | "finished";

export type PurchaseStatus = "received" | "pending";
export type PayableReviewStatus = "confirmed" | "review_required";

export type InventoryMovementType =
  | "opening_balance"
  | "sale"
  | "purchase"
  | "production_consumption"
  | "production_output"
  | "adjustment"
  | "reversal";

export type FinancialAccountType = "cash" | "bank";
export type CashMovementDirection = "in" | "out";

export type ProductionStatus = "active" | "completed" | "cancelled";

export type InvoiceFollowUpStatus = "to_review" | "registered_externally" | "not_applicable";
export type ProductTaxCategory =
  "unclassified" | "taxable" | "exempt" | "excluded" | "not_applicable";
export type InvoiceDocumentKind = "invoice" | "credit_note" | "debit_note";
export type InvoiceDocumentStatus =
  | "draft"
  | "queued"
  | "transmitted"
  | "accepted"
  | "rejected"
  | "delivered"
  | "contingency_pending";
export type TaxEnvironment = "test" | "production";
export type SupplierInvoiceStatus = "pending_review" | "linked";

export type ConsumptionSource =
  "manual" | "local_receipt" | "api" | "production" | "purchase" | "legacy";
export type ReceiptImportStatus = "pending" | "confirmed" | "warning";
export type ResourceKind = "electricity" | "water" | "fuel" | "material" | "waste";
export type ReadingActivity =
  "consumption" | "withdrawal" | "discharge" | "purchase" | "generated" | "recovered";
export type ReadingQuality = "measured" | "estimated" | "confirmed";
export type IndicatorId =
  | "energy-intensity"
  | "water-intensity"
  | "material-intensity"
  | "recycled-material-share"
  | "waste-recovery"
  | "scope-1"
  | "scope-2"
  | "scope-3"
  | "data-coverage";

export interface Company {
  name: string;
  taxId: string;
  city: string;
  activity: string;
}

export interface Contact {
  id: string;
  name: string;
  role: ContactRole;
  ordinaryCustomer: boolean;
  taxId: string;
  email: string;
  phone: string;
  identificationType?: "NIT" | "CC" | "CE" | "PASSPORT" | "OTHER";
}

export type RecipeVersionStatus = "draft" | "active" | "archived";

export interface RecipeComponent {
  productId: string;
  quantity: number;
}

export interface RecipeVersion {
  id: string;
  versionNumber: number;
  status: RecipeVersionStatus;
  /** Gross finished-product inventory units processed by this standard batch. */
  baseQuantity: number;
  /** Expected good output as a percentage of the gross batch quantity. */
  expectedYieldPercent: number;
  components: RecipeComponent[];
  createdAt: string;
  activatedAt?: string;
}

export interface Recipe {
  id: string;
  productId: string;
  activeVersionId: string | null;
  versions: RecipeVersion[];
}

export interface RecipeVersionInput {
  productId: string;
  baseQuantity: number;
  expectedYieldPercent: number;
  components: RecipeComponent[];
  versionId?: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  type: ProductType;
  unit: string;
  stock: number;
  minimumStock: number;
  unitCost: number;
  unitPrice: number;
  vatRate: number;
  /** Missing/legacy categories are treated as unclassified for e-invoicing. */
  taxCategory?: ProductTaxCategory;
  environmentalUnit?: string;
  environmentalConversionFactor?: number;
  recycledContentPercent?: number;
  /** Converts one finished-product inventory unit into the benchmark output unit. */
  benchmarkOutputUnit?: "L";
  benchmarkOutputFactor?: number;
}

export interface SaleLine {
  productId: string;
  sku: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  subtotal: number;
  discountShare: number;
  vatAmount: number;
  total: number;
}

export interface Payment {
  id: string;
  date: string;
  amount: number;
  method: string;
  accountId?: string;
  cashMovementId?: string;
}

export interface Sale {
  id: string;
  number: string;
  date: string;
  customerId: string;
  customerName: string;
  lines: SaleLine[];
  subtotal: number;
  discount: number;
  vatAmount: number;
  total: number;
  payments: Payment[];
  invoiceFollowUpStatus: InvoiceFollowUpStatus;
  externalInvoiceNumber: string;
  externalInvoiceDate: string;
  dueDate?: string;
}

export interface TaxConfiguration {
  countryCode: "CO";
  currency: "COP";
  legalAddress: string;
  invoiceEmail: string;
  taxRegime: string;
  taxResponsibilities: string[];
  providerId: string;
  environment: TaxEnvironment;
  resolutionNumber: string;
  prefix: string;
  rangeFrom: number | null;
  rangeTo: number | null;
  validFrom: string;
  validTo: string;
  contingencyPrefix: string;
  contingencyRangeFrom: number | null;
  contingencyRangeTo: number | null;
}

export interface ElectronicDocumentLineSnapshot {
  originalLineIndex?: number;
  productId: string;
  sku: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxCategory: ProductTaxCategory;
  vatRate: number;
  subtotal: number;
  discount: number;
  taxAmount: number;
  total: number;
}

export interface ElectronicDocumentSnapshot {
  seller: { legalName: string; taxId: string; city: string; address: string };
  buyer: {
    name: string;
    taxId: string;
    identificationType: Contact["identificationType"] | null;
    email: string;
  };
  currency: "COP";
  issueDate: string;
  dueDate: string | null;
  lines: ElectronicDocumentLineSnapshot[];
  subtotal: number;
  discount: number;
  vatAmount: number;
  total: number;
}

export interface ElectronicDocumentAttempt {
  id: string;
  attemptedAt: string;
  result:
    | "not_configured"
    | "queued"
    | "transmitted"
    | "accepted"
    | "rejected"
    | "delivered"
    | "contingency_pending"
    | "error";
  providerReference?: string;
  message: string;
}

/** Immutable snapshot of a sale prepared for an eventual provider transmission. */
export interface ElectronicDocument {
  id: string;
  kind: InvoiceDocumentKind;
  saleId: string;
  relatedDocumentId?: string;
  status: InvoiceDocumentStatus;
  documentNumber?: string;
  providerId?: string;
  environment?: TaxEnvironment;
  providerReference?: string;
  cufe?: string;
  validationMessage?: string;
  adjustmentReason?: string;
  adjustmentAmount?: number;
  validationIssues: string[];
  createdAt: string;
  createdBy: string;
  snapshot: ElectronicDocumentSnapshot;
  attempts: ElectronicDocumentAttempt[];
}

export interface SupplierInvoiceLine {
  description: string;
  quantity: number;
  unitCode: string;
  unitPrice: number;
  taxAmount: number;
  total: number;
}

/** Confirmed invoice metadata only; the uploaded XML itself is discarded. */
export interface SupplierInvoiceDocument {
  id: string;
  fileName: string;
  importedAt: string;
  documentNumber: string;
  issueDate: string;
  dueDate?: string;
  currency: string;
  supplierTaxId: string;
  supplierName: string;
  buyerTaxId: string;
  taxAmount: number;
  total: number;
  purchaseId?: string;
  supplierContactId?: string;
  status: SupplierInvoiceStatus;
  lines: SupplierInvoiceLine[];
}

export interface PurchaseLine {
  productId: string;
  sku: string;
  productName: string;
  quantity: number;
  lineTotal: number;
  environmentalUnit?: string;
  environmentalConversionFactor?: number;
  recycledContentPercent?: number;
}

export interface Purchase {
  id: string;
  number: string;
  date: string;
  supplierId: string;
  supplierName: string;
  status: PurchaseStatus;
  lines: PurchaseLine[];
  total: number;
  dueDate?: string;
  payments: Payment[];
  payableReviewStatus: PayableReviewStatus;
  /** For reconciled legacy purchases, the opening payable balance at cutover. */
  payableAmount?: number;
}

export interface InventoryMovement {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  quantity: number;
  movementType: InventoryMovementType;
  reason: string;
  occurredAt: string;
  createdAt: string;
  sourceType?: "sale" | "purchase" | "production" | "adjustment";
  sourceId?: string;
  reversesMovementId?: string;
  balanceAfter: number;
}

export interface FinancialAccount {
  id: string;
  name: string;
  type: FinancialAccountType;
  openingBalance: number;
  active: boolean;
  createdAt: string;
}

export interface CashMovement {
  id: string;
  accountId?: string;
  direction: CashMovementDirection;
  amount: number;
  date: string;
  method: string;
  category: string;
  description: string;
  sourceType?: "sale" | "purchase" | "manual" | "reversal";
  sourceId?: string;
  reversesMovementId?: string;
  legacyUnassigned?: boolean;
}

export interface ConsumedMaterial {
  productId: string;
  sku: string;
  productName: string;
  quantity: number;
  unit?: string;
  environmentalUnit?: string;
  environmentalConversionFactor?: number;
  /** Catalog cost captured when this production order was created; null means unknown. */
  unitCostSnapshot?: number | null;
  /** Extended direct material cost captured for the consumed quantity; null means unknown. */
  lineCostSnapshot?: number | null;
}

export interface ProductionOrder {
  id: string;
  number: string;
  date: string;
  productId: string;
  productName: string;
  quantity: number;
  wasteQuantity: number;
  status: ProductionStatus;
  consumedMaterials: ConsumedMaterial[];
  completedAt: string;
  /** Direct material estimate at creation time; excludes labor, energy, and overhead. */
  estimatedMaterialCost?: number | null;
  /** Direct material cost allocated per good unit at completion. */
  materialCostPerGoodUnit?: number | null;
  recipeVersionId?: string;
  recipeVersionNumber?: number;
  expectedYieldPercent?: number;
  expectedGoodOutputQuantity?: number;
}

export interface EnvironmentalRecord {
  id: string;
  period: string;
  electricityKwh: number;
  waterM3: number;
  fuelLiters: number;
  productionUnits: number;
  wasteKg: number;
  recoveredKg: number;
  source?: ConsumptionSource;
  sourceLabel?: string;
  receiptImportId?: string;
  lastUpdatedAt?: string;
}

/** A single observed resource flow. Periods use ISO dates and may span a billing cycle. */
export interface ResourceReading {
  id: string;
  resource: ResourceKind;
  activity: ReadingActivity;
  quantity: number;
  unit: string;
  periodStart: string;
  periodEnd: string;
  siteId: string;
  source: ConsumptionSource;
  quality: ReadingQuality;
  sourceLabel: string;
  capturedAt: string;
  /** Valor pagado en pesos por esta lectura. */
  billedAmount?: number;
  materialProductId?: string;
  receiptImportId?: string;
  externalReference?: string;
  legacyRecordId?: string;
}

export interface EmissionFactor {
  id: string;
  scope: 1 | 2 | 3;
  activity: "electricity" | "fuel" | "material_purchase" | "waste" | "transport";
  kgCo2ePerUnit: number;
  activityUnit: string;
  geography: string;
  year: number;
  version: string;
  source: string;
  method: string;
}

export interface IndicatorTarget {
  id: string;
  indicatorId: IndicatorId;
  direction: "decrease" | "increase";
  horizonMonths: 6 | 18 | 36;
  baselinePeriod: string;
  baselineValue: number;
  reductionPercent: number;
  approvedAt?: string;
  createdAt: string;
}

export interface EnvironmentalAction {
  id: string;
  indicatorId: IndicatorId;
  title: string;
  owner: string;
  dueDate: string;
  status: "open" | "completed";
  notes: string;
  createdAt: string;
  completedAt?: string;
}

export interface ReceiptExtraction {
  period: string;
  resource?: "electricity" | "water" | "fuel";
  quantity?: number;
  unit?: string;
  /** Legacy fields are accepted only while migrating schema v1 backups. */
  electricityKwh?: number;
  waterM3?: number;
  fuelLiters?: number;
  billedAmount: number;
  /** El recibo cobra otros servicios: el valor debe ser solo el de este servicio. */
  otherServicesDetected?: boolean;
  invoiceNumber: string;
  provider: string;
  confidence: number;
  warnings: string[];
  /** Transient OCR preview; it is stripped before the receipt is persisted. */
  textPreview?: string;
}

export interface ReceiptImport {
  id: string;
  fileName: string;
  fileHash?: string;
  importedAt: string;
  status: ReceiptImportStatus;
  source: ConsumptionSource;
  provider: string;
  accountNumber?: string;
  extraction: ReceiptExtraction;
}

export interface EnvironmentalConfig {
  providerId: string;
  providerName: string;
  accountNumber: string;
  businessUnit: string;
  geography?: string;
  benchmarking: EnvironmentalBenchmarkProfile;
}

export interface EnvironmentalBenchmarkProfile {
  countryCode: string;
  region: string;
  sectorCode: string;
  outputUnit: string;
  /** Demonstration assumption only; never used as measured production. */
  assumedMonthlyOutput: number;
  preferredSources: string[];
}

export type BenchmarkResource = ResourceKind | "energy" | "emissions";
export type BenchmarkComparability = "direct" | "contextual" | "incomplete" | "unavailable";
export type BenchmarkSourceStatus = "ready" | "stale" | "error" | "not_configured";

export interface EnvironmentalBenchmark {
  id: string;
  sourceId: string;
  sourceName: string;
  resource: BenchmarkResource;
  indicator: string;
  value: number;
  unit: string;
  denominatorUnit?: string | null;
  periodStart: string;
  periodEnd: string;
  countryCode: string;
  country: string;
  region?: string | null;
  sectorCode?: string | null;
  sourceUrl: string;
  publishedAt?: string | null;
  retrievedAt: string;
  quality: string;
  comparability: BenchmarkComparability;
  note?: string;
  seriesCode?: string;
  dimensions?: unknown;
}

export interface EnvironmentalBenchmarkComparison {
  reference: EnvironmentalBenchmark;
  companyValue: number | null;
  companyUnit: string | null;
  gapPercent: number | null;
  comparability: BenchmarkComparability;
  note: string;
}

export interface EnvironmentalBenchmarkSource {
  id: string;
  name: string;
  url?: string;
  kind: "api" | "official_file" | "curated";
  status: BenchmarkSourceStatus;
  recordCount: number;
  lastUpdatedAt: string | null;
  stale: boolean;
  error: string | null;
}

export interface EnvironmentalBenchmarkResponse {
  profile: EnvironmentalBenchmarkProfile & { assumptionOnly: true };
  comparisons: EnvironmentalBenchmarkComparison[];
  sources: EnvironmentalBenchmarkSource[];
  refreshedAt: string | null;
}

export type ImportExtraValue = string | number | boolean | null;
export type ImportExtraEntity =
  | "company"
  | "contacts"
  | "products"
  | "recipes"
  | "sales"
  | "purchases"
  | "inventoryMovements"
  | "financialAccounts"
  | "cashMovements"
  | "productionOrders"
  | "environmentalRecords"
  | "resourceReadings"
  | "emissionFactors"
  | "indicatorTargets"
  | "environmentalActions"
  | "receiptImports"
  | "environmentalConfig";

/** User-provided columns that do not map to a Pyme360 field. */
export interface ImportExtraField {
  id: string;
  entityType: ImportExtraEntity;
  entityId: string;
  fieldName: string;
  value: ImportExtraValue;
  sourceSheet: string;
}

export interface AppState {
  schemaVersion: 7;
  company: Company | null;
  contacts: Contact[];
  products: Product[];
  recipes: Recipe[];
  sales: Sale[];
  taxConfiguration: TaxConfiguration;
  electronicDocuments: ElectronicDocument[];
  supplierInvoices: SupplierInvoiceDocument[];
  purchases: Purchase[];
  inventoryMovements: InventoryMovement[];
  financialAccounts: FinancialAccount[];
  cashMovements: CashMovement[];
  productionOrders: ProductionOrder[];
  environmentalRecords: EnvironmentalRecord[];
  resourceReadings: ResourceReading[];
  emissionFactors: EmissionFactor[];
  indicatorTargets: IndicatorTarget[];
  environmentalActions: EnvironmentalAction[];
  receiptImports: ReceiptImport[];
  environmentalConfig?: EnvironmentalConfig;
  importExtras: ImportExtraField[];
}

export interface SaleLineInput {
  productId: string;
  quantity: number;
  unitPrice?: number;
}

export interface SaleInput {
  date: string;
  customerId: string;
  lines: SaleLineInput[];
  discount: number;
  initialPayment: number;
  initialPaymentMethod: string;
  invoiceFollowUpStatus: InvoiceFollowUpStatus;
  externalInvoiceNumber: string;
  externalInvoiceDate: string;
  dueDate?: string;
  initialPaymentAccountId?: string;
}

export interface PurchaseLineInput {
  productId: string;
  quantity: number;
  lineTotal: number;
}

export interface PurchaseInput {
  date: string;
  dueDate?: string;
  supplierId: string;
  status: PurchaseStatus;
  lines: PurchaseLineInput[];
}

export interface EnvironmentalRecordInput {
  period: string;
  electricityKwh: number;
  waterM3: number;
  fuelLiters: number;
  productionUnits: number;
  wasteKg: number;
  recoveredKg: number;
  source?: ConsumptionSource;
  sourceLabel?: string;
  receiptImportId?: string;
}

export type ResourceReadingInput = Omit<ResourceReading, "id" | "capturedAt"> & {
  capturedAt?: string;
};
export type EmissionFactorInput = Omit<EmissionFactor, "id">;
export type IndicatorTargetInput = Omit<IndicatorTarget, "id" | "createdAt">;
export type EnvironmentalActionInput = Omit<
  EnvironmentalAction,
  "id" | "createdAt" | "completedAt" | "status"
>;
