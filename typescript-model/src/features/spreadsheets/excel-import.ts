import { decodeText, parseDelimitedText } from "./delimited";
import type {
  AppState,
  CashMovement,
  Company,
  Contact,
  ContactRole,
  ConsumptionSource,
  EnvironmentalAction,
  EnvironmentalConfig,
  EnvironmentalRecord,
  EmissionFactor,
  FinancialAccount,
  ImportExtraEntity,
  ImportExtraField,
  ImportExtraValue,
  IndicatorTarget,
  InventoryMovement,
  InventoryMovementType,
  Payment,
  Product,
  ProductTaxCategory,
  ProductType,
  Recipe,
  RecipeVersion,
  ProductionOrder,
  Purchase,
  PurchaseLine,
  PurchaseStatus,
  ReceiptImport,
  ResourceReading,
  Sale,
  SaleLine,
} from "../../domain/types";
import { DEFAULT_SITE_ID } from "../../domain/environmental";

export type ImportModuleId =
  | "company"
  | "contacts"
  | "products"
  | "recipes"
  | "sales"
  | "salePayments"
  | "purchases"
  | "purchasePayments"
  | "inventoryMovements"
  | "financialAccounts"
  | "cashMovements"
  | "productionOrders"
  | "productionConsumption"
  | "environmentalRecords"
  | "resourceReadings"
  | "emissionFactors"
  | "indicatorTargets"
  | "environmentalActions"
  | "receiptImports"
  | "environmentalConfig"
  | "importExtras";

export type ImportCell = string | number | boolean | Date | null;
export type ImportRowStatus = "ready" | "error" | "duplicate" | "warning" | "blocked";

export interface ImportFieldDefinition {
  key: string;
  label: string;
  kind: "text" | "number" | "date" | "boolean" | "enum";
  required?: boolean;
  aliases: string[];
}

export interface ImportModuleDefinition {
  id: ImportModuleId;
  label: string;
  adminOnly?: boolean;
  sheetAliases: string[];
  fields: ImportFieldDefinition[];
  /** Required fields for selecting a recognizable worksheet automatically. */
  autoRequired?: string[];
}

export interface ExcelSheetData {
  name: string;
  rows: ImportCell[][];
}

export interface ExcelWorkbookData {
  fileName: string;
  sheets: ExcelSheetData[];
}

export interface PreparedImportRow {
  moduleId: ImportModuleId;
  sheetName: string;
  sourceRow: number;
  values: Record<string, ImportCell>;
  extras: Array<{ fieldName: string; value: ImportExtraValue }>;
}

export interface ImportRowResult {
  moduleId: ImportModuleId;
  sheetName: string;
  sourceRow: number;
  status: ImportRowStatus;
  message: string;
}

export interface ImportPlan {
  state: AppState;
  results: ImportRowResult[];
  added: number;
  duplicates: number;
  errors: number;
  warnings: number;
  blocked: number;
}

// Definición de hojas, columnas y permisos de importación
const field = (
  key: string,
  label: string,
  kind: ImportFieldDefinition["kind"],
  aliases: string[],
  required = false,
): ImportFieldDefinition => ({ key, label, kind, aliases: [key, ...aliases], required });

export const IMPORT_MODULES: ImportModuleDefinition[] = [
  {
    id: "company",
    label: "Empresa",
    adminOnly: true,
    sheetAliases: ["empresa", "company"],
    fields: [
      field("name", "Razón social", "text", ["razon social", "nombre", "nombre empresa"], true),
      field("taxId", "NIT", "text", ["nit", "identificacion tributaria"]),
      field("city", "Ciudad", "text", ["ciudad"]),
      field("activity", "Actividad", "text", ["actividad", "actividad economica"]),
    ],
    autoRequired: ["name"],
  },
  {
    id: "contacts",
    label: "Contactos",
    sheetAliases: ["contactos", "clientes", "proveedores"],
    fields: [
      field("id", "ID", "text", ["id contacto"]),
      field("name", "Nombre", "text", ["nombre", "contacto", "razon social"], true),
      field("role", "Rol", "enum", ["tipo", "rol", "tipo contacto"], true),
      field("ordinaryCustomer", "Cliente de mostrador", "boolean", [
        "cliente ordinario",
        "cliente de mostrador",
      ]),
      field("taxId", "NIT o identificación", "text", [
        "nit",
        "identificacion",
        "cedula",
        "nit o cedula",
      ]),
      field("email", "Correo", "text", ["correo", "email", "e mail"]),
      field("phone", "Teléfono", "text", ["telefono", "celular"]),
      field("identificationType", "Tipo de identificación", "text", [
        "tipo identificacion",
        "tipo de documento",
      ]),
    ],
    autoRequired: ["name", "role"],
  },
  {
    id: "products",
    label: "Inventario / productos",
    sheetAliases: ["inventario", "productos", "inventory"],
    fields: [
      field("id", "ID", "text", ["id producto"]),
      field("sku", "SKU", "text", ["codigo", "referencia", "codigo producto"], true),
      field("name", "Producto", "text", ["nombre", "producto", "descripcion"], true),
      field("type", "Tipo", "enum", ["tipo producto", "clase"], true),
      field("unit", "Unidad", "text", ["unidad", "unidad de medida"], true),
      field("stock", "Existencia", "number", ["stock", "existencia", "cantidad disponible"]),
      field("minimumStock", "Existencia mínima", "number", [
        "minimo",
        "existencia minima",
        "stock minimo",
      ]),
      field("unitCost", "Costo unitario", "number", ["costo", "costo unitario cop"]),
      field("unitPrice", "Precio unitario", "number", [
        "precio",
        "precio cop",
        "precio unitario cop",
      ]),
      field("vatRate", "IVA (%)", "number", [
        "iva",
        "tarifa iva",
        "iva estimado (%)",
        "tarifa iva %",
      ]),
      field("taxCategory", "Clasificación tributaria", "enum", [
        "categoria tributaria",
        "clasificacion tributaria",
      ]),
      field("environmentalUnit", "Unidad ambiental base", "text", ["unidad ambiental"]),
      field("environmentalConversionFactor", "Factor conversión ambiental", "number", [
        "factor conversion ambiental",
        "conversion ambiental",
      ]),
      field("recycledContentPercent", "Contenido reciclado (%)", "number", [
        "reciclado (%)",
        "contenido reciclado",
      ]),
      field("benchmarkOutputUnit", "Unidad de producción comparable", "text", [
        "unidad de salida comparable",
        "unidad de produccion comparable",
      ]),
      field("benchmarkOutputFactor", "Litros por unidad terminada", "number", [
        "litros por unidad",
        "litros por unidad terminada",
        "factor de litros por producto",
      ]),
    ],
    autoRequired: ["sku", "name", "type", "unit"],
  },
  {
    id: "recipes",
    label: "Recetas",
    sheetAliases: ["recetas", "formulas"],
    fields: [
      field("recipeId", "ID receta", "text", ["id receta"]),
      field("versionId", "ID versión", "text", ["id version", "version id"]),
      field("versionNumber", "Número de versión", "number", [
        "version",
        "numero version",
        "numero de version",
      ]),
      field("versionStatus", "Estado de versión", "enum", [
        "estado version",
        "estado de version",
        "estado receta",
      ]),
      field("baseQuantity", "Cantidad base del lote", "number", [
        "cantidad base",
        "lote base",
        "cantidad base del lote",
      ]),
      field("expectedYieldPercent", "Rendimiento esperado (%)", "number", [
        "rendimiento esperado",
        "rendimiento (%)",
        "rendimiento esperado (%)",
      ]),
      field("createdAt", "Creada el", "text", ["fecha creacion", "creada el"]),
      field("activatedAt", "Activada el", "text", ["fecha activacion", "activada el"]),
      field("unit", "Unidad del material", "text", ["unidad material", "unidad componente"]),
      field("productName", "Producto terminado", "text", [
        "nombre producto terminado",
        "producto terminado",
      ]),
      field("materialName", "Material", "text", ["nombre material", "material"]),
      field("productId", "ID producto terminado", "text", ["producto id", "id producto terminado"]),
      field(
        "productSku",
        "SKU producto terminado",
        "text",
        ["producto sku", "sku producto terminado"],
        true,
      ),
      field("materialProductId", "ID material", "text", [
        "material id",
        "id material",
        "id insumo",
      ]),
      field(
        "materialSku",
        "SKU material",
        "text",
        ["sku material", "material sku", "sku insumo"],
        true,
      ),
      field(
        "quantity",
        "Cantidad del componente",
        "number",
        [
          "cantidad por unidad",
          "cantidad",
          "consumo unitario",
          "cantidad componente",
          "cantidad del componente",
        ],
        true,
      ),
    ],
    autoRequired: ["productSku", "materialSku", "quantity"],
  },
  {
    id: "sales",
    label: "Ventas (con detalle de productos)",
    sheetAliases: ["detalle ventas", "detalle de ventas", "ventas por producto", "sales lines"],
    fields: [
      field("id", "ID venta", "text", ["id", "id venta"]),
      field(
        "number",
        "Documento / folio",
        "text",
        ["documento", "numero", "numero venta", "folio", "sale number"],
        true,
      ),
      field("date", "Fecha", "date", ["fecha", "fecha venta"], true),
      field("customerId", "ID cliente", "text", ["id cliente"]),
      field("customer", "Cliente", "text", ["cliente", "nombre cliente"]),
      field("sku", "SKU producto", "text", ["sku", "codigo producto"], true),
      field("productName", "Producto", "text", ["producto", "nombre producto"]),
      field("quantity", "Cantidad", "number", ["cantidad", "unidades"], true),
      field("unitPrice", "Precio unitario", "number", [
        "precio unitario",
        "precio unitario cop",
        "valor unitario",
      ]),
      field("vatRate", "IVA (%)", "number", ["iva", "iva (%)", "tarifa iva"]),
      field("subtotal", "Subtotal línea", "number", ["subtotal", "subtotal cop"]),
      field("discountShare", "Descuento de línea", "number", [
        "descuento",
        "descuento asignado",
        "descuento asignado cop",
      ]),
      field("vatAmount", "IVA de línea", "number", ["iva cop", "valor iva"]),
      field("lineTotal", "Total línea", "number", [
        "total",
        "total cop",
        "total linea",
        "total linea cop",
        "valor total",
      ]),
      field("invoiceFollowUpStatus", "Seguimiento factura", "enum", [
        "seguimiento factura",
        "estado seguimiento",
        "invoice follow up status",
      ]),
      field("externalInvoiceNumber", "Factura externa", "text", [
        "numero factura externa",
        "numero documento externo",
      ]),
      field("externalInvoiceDate", "Fecha factura externa", "date", [
        "fecha factura externa",
        "fecha documento externo",
      ]),
      field("dueDate", "Vencimiento", "date", ["vencimiento", "fecha vencimiento"]),
    ],
    autoRequired: ["number", "date", "sku", "quantity"],
  },
  {
    id: "salePayments",
    label: "Abonos de ventas",
    sheetAliases: ["abonos", "pagos recibidos", "pagos ventas"],
    fields: [
      field("id", "ID abono", "text", ["id", "id abono", "id pago"]),
      field("saleId", "ID venta", "text", ["id venta"]),
      field("saleNumber", "Documento de venta", "text", [
        "documento",
        "numero venta",
        "folio",
        "sale number",
      ]),
      field("date", "Fecha", "date", ["fecha"], true),
      field(
        "amount",
        "Valor",
        "number",
        ["valor", "valor cop", "monto", "valor recibido cop"],
        true,
      ),
      field("method", "Medio de pago", "text", ["medio", "medio pago", "metodo de pago"], true),
      field("accountId", "ID cuenta", "text", ["cuenta id", "id cuenta"]),
      field("cashMovementId", "ID movimiento de caja", "text", ["id movimiento caja"]),
    ],
    autoRequired: ["date", "amount", "saleId"],
  },
  {
    id: "purchases",
    label: "Compras (con detalle de productos)",
    sheetAliases: [
      "detalle compras",
      "detalle de compras",
      "compras por producto",
      "purchase lines",
    ],
    fields: [
      field("id", "ID compra", "text", ["id", "id compra"]),
      field(
        "number",
        "Documento / folio",
        "text",
        ["documento", "numero", "numero compra", "folio", "purchase number"],
        true,
      ),
      field("date", "Fecha", "date", ["fecha", "fecha compra"], true),
      field("supplierId", "ID proveedor", "text", ["id proveedor"]),
      field("supplier", "Proveedor", "text", ["proveedor", "nombre proveedor"]),
      field("sku", "SKU producto", "text", ["sku", "codigo producto"], true),
      field("productName", "Producto", "text", ["producto", "nombre producto"]),
      field("quantity", "Cantidad", "number", ["cantidad", "unidades"], true),
      field(
        "lineTotal",
        "Valor de línea",
        "number",
        ["valor de linea", "valor de linea cop", "total linea", "costo total cop", "valor total"],
        true,
      ),
      field("status", "Estado de recepción", "enum", ["estado", "estado compra", "recibida"]),
      field("dueDate", "Vencimiento", "date", ["vencimiento", "fecha vencimiento"]),
      field("payableReviewStatus", "Estado cuenta por pagar", "enum", ["estado cuenta por pagar"]),
      field("payableAmount", "Saldo inicial por pagar", "number", [
        "saldo inicial por pagar cop",
        "saldo por pagar",
      ]),
      field("environmentalUnit", "Unidad ambiental", "text", ["unidad ambiental"]),
      field("environmentalConversionFactor", "Conversión ambiental", "number", [
        "conversion ambiental",
        "factor conversion ambiental",
      ]),
      field("recycledContentPercent", "Reciclado (%)", "number", [
        "reciclado (%)",
        "contenido reciclado",
      ]),
    ],
    autoRequired: ["number", "date", "sku", "quantity", "lineTotal"],
  },
  {
    id: "purchasePayments",
    label: "Pagos de compras",
    sheetAliases: ["pagos de compras", "abonos compras", "purchase payments"],
    fields: [
      field("id", "ID pago", "text", ["id", "id pago"]),
      field("purchaseId", "ID compra", "text", ["id compra"]),
      field("purchaseNumber", "Documento de compra", "text", [
        "documento",
        "numero compra",
        "folio",
      ]),
      field("date", "Fecha", "date", ["fecha"], true),
      field("amount", "Valor", "number", ["valor", "valor cop", "monto"], true),
      field("method", "Medio de pago", "text", ["medio", "medio pago", "metodo de pago"], true),
      field("accountId", "ID cuenta", "text", ["cuenta id", "id cuenta"]),
      field("cashMovementId", "ID movimiento de caja", "text", ["id movimiento caja"]),
    ],
    autoRequired: ["date", "amount", "purchaseId"],
  },
  {
    id: "inventoryMovements",
    label: "Movimientos de inventario",
    sheetAliases: ["movimientos inventario", "movimientos de inventario", "inventory movements"],
    fields: [
      field("id", "ID", "text", ["id movimiento"]),
      field(
        "date",
        "Fecha del movimiento",
        "date",
        ["fecha", "fecha movimiento", "occurred at"],
        true,
      ),
      field("productId", "ID producto", "text", ["id producto"]),
      field("sku", "SKU", "text", ["sku", "codigo producto"]),
      field("productName", "Producto", "text", ["producto", "nombre producto"]),
      field("movementType", "Tipo movimiento", "enum", ["tipo", "tipo movimiento"], true),
      field("quantity", "Cantidad (+/-)", "number", ["cantidad", "cantidad firmada"], true),
      field("balanceAfter", "Saldo después", "number", ["saldo despues", "existencia resultante"]),
      field("unit", "Unidad", "text", ["unidad"]),
      field("reason", "Motivo", "text", ["motivo", "razon"]),
      field("createdAt", "Fecha de creación", "date", ["creado", "created at"]),
      field("sourceType", "Tipo de origen", "text", ["origen", "tipo origen"]),
      field("sourceId", "ID origen", "text", ["id origen"]),
      field("reversesMovementId", "Movimiento revertido", "text", [
        "revierte movimiento",
        "id movimiento revertido",
      ]),
    ],
    autoRequired: ["date", "movementType", "quantity", "sku"],
  },
  {
    id: "financialAccounts",
    label: "Cuentas de caja y bancos",
    adminOnly: true,
    sheetAliases: ["cuentas", "cuentas financieras", "caja y bancos cuentas"],
    fields: [
      field("id", "ID", "text", ["id cuenta"]),
      field("name", "Nombre", "text", ["nombre", "cuenta"], true),
      field("type", "Tipo", "enum", ["tipo cuenta", "tipo"], true),
      field(
        "openingBalance",
        "Saldo inicial",
        "number",
        ["saldo inicial cop", "saldo inicial"],
        true,
      ),
      field("active", "Activa", "boolean", ["estado", "activa"]),
      field("createdAt", "Creada", "date", ["creada", "fecha creacion"]),
    ],
    autoRequired: ["name", "type", "openingBalance"],
  },
  {
    id: "cashMovements",
    label: "Movimientos de caja y bancos",
    sheetAliases: ["caja y bancos", "movimientos de caja", "cash movements"],
    fields: [
      field("id", "ID", "text", ["id movimiento"]),
      field("date", "Fecha", "date", ["fecha"], true),
      field("accountId", "ID cuenta", "text", ["id cuenta"]),
      field("account", "Cuenta", "text", ["cuenta", "nombre cuenta"]),
      field("direction", "Dirección", "enum", ["direccion", "tipo movimiento"], true),
      field("amount", "Valor", "number", ["valor", "valor cop", "monto"], true),
      field("method", "Medio", "text", ["medio", "medio pago", "metodo"]),
      field("category", "Categoría", "text", ["categoria"]),
      field("description", "Descripción", "text", ["descripcion", "detalle"]),
      field("sourceType", "Origen", "text", ["tipo origen"]),
      field("sourceId", "ID origen", "text", ["id origen"]),
      field("reversesMovementId", "Movimiento revertido", "text", ["revierte movimiento"]),
      field("legacyUnassigned", "Sin cuenta asignada", "boolean", ["pendiente de asignar"]),
    ],
    autoRequired: ["date", "direction", "amount"],
  },
  {
    id: "productionOrders",
    label: "Órdenes de producción",
    sheetAliases: ["produccion", "ordenes de produccion", "production"],
    fields: [
      field("id", "ID", "text", ["id orden"]),
      field("number", "Orden", "text", ["numero", "numero orden", "folio"], true),
      field("date", "Fecha", "date", ["fecha"], true),
      field("productId", "ID producto", "text", ["id producto"]),
      field("productSku", "SKU producto", "text", ["sku", "sku producto"]),
      field("productName", "Producto terminado", "text", [
        "producto",
        "producto terminado",
        "nombre producto",
      ]),
      field("quantity", "Cantidad", "number", ["unidades", "cantidad a producir"], true),
      field("wasteQuantity", "Desperdicio", "number", ["desperdicio", "desperdicio kg"]),
      field("estimatedMaterialCost", "Costo estimado materiales COP", "number", [
        "costo estimado materiales",
        "costo directo materiales",
      ]),
      field("materialCostPerGoodUnit", "Costo materiales por unidad buena COP", "number", [
        "costo materiales por unidad buena",
        "costo unitario materiales",
      ]),
      field("recipeVersionId", "ID versión de receta", "text", [
        "version receta id",
        "id version receta",
        "id version de receta",
      ]),
      field("recipeVersionNumber", "Número de versión de receta", "number", [
        "version receta",
        "numero version receta",
        "numero de version de receta",
      ]),
      field("expectedYieldPercent", "Rendimiento esperado (%)", "number", [
        "rendimiento esperado",
        "rendimiento (%)",
      ]),
      field("expectedGoodOutputQuantity", "Salida buena esperada", "number", [
        "unidades buenas esperadas",
        "salida esperada",
      ]),
      field("status", "Estado", "enum", ["estado"], true),
      field("completedAt", "Fecha de cierre", "date", ["fecha cierre", "fecha terminacion"]),
    ],
    autoRequired: ["number", "date", "quantity", "status"],
  },
  {
    id: "productionConsumption",
    label: "Consumos de producción",
    sheetAliases: ["consumo produccion", "consumos de produccion", "production inputs"],
    fields: [
      field("orderId", "ID orden", "text", ["id orden"]),
      field("orderNumber", "Orden", "text", ["numero orden", "orden"], true),
      field("materialProductId", "ID material", "text", ["id material"]),
      field("materialSku", "SKU material", "text", ["sku material", "sku"], true),
      field("materialName", "Material", "text", ["material"]),
      field("quantity", "Cantidad consumida", "number", ["cantidad", "consumo"], true),
      field("environmentalUnit", "Unidad ambiental", "text", ["unidad ambiental"]),
      field("environmentalConversionFactor", "Conversión ambiental", "number", [
        "conversion ambiental",
      ]),
      field("unitCostSnapshot", "Costo unitario snapshot COP", "number", [
        "costo unitario snapshot",
      ]),
      field("lineCostSnapshot", "Costo línea snapshot COP", "number", ["costo linea snapshot"]),
    ],
    autoRequired: ["orderNumber", "materialSku", "quantity"],
  },
  {
    id: "environmentalRecords",
    label: "Registros ambientales mensuales",
    sheetAliases: ["impacto ambiental", "registros ambientales", "environment"],
    fields: [
      field("id", "ID", "text", ["id registro"]),
      field("period", "Período (AAAA-MM)", "date", ["periodo", "mes"], true),
      field("electricityKwh", "Energía kWh", "number", ["energia kwh", "electricidad kwh", "kwh"]),
      field("waterM3", "Agua m³", "number", ["agua m3", "agua"]),
      field("fuelLiters", "Combustible L", "number", [
        "combustible l",
        "combustible litros",
        "fuel liters",
      ]),
      field("productionUnits", "Producción unidades", "number", [
        "produccion unidades",
        "unidades producidas",
      ]),
      field("wasteKg", "Residuos kg", "number", ["residuos kg", "residuos"]),
      field("recoveredKg", "Recuperado kg", "number", ["recuperado kg", "residuos recuperados"]),
      field("source", "Fuente", "enum", ["tipo de origen", "fuente"]),
      field("sourceLabel", "Origen / descripción", "text", ["origen", "descripcion de origen"]),
      field("receiptImportId", "ID recibo", "text", ["id recibo"]),
      field("lastUpdatedAt", "Última actualización", "date", [
        "actualizado",
        "ultima actualizacion",
      ]),
    ],
    autoRequired: ["period"],
  },
  {
    id: "resourceReadings",
    label: "Lecturas ambientales",
    sheetAliases: ["lecturas ambientales", "lecturas de recursos", "resource readings"],
    fields: [
      field("id", "ID", "text", ["id lectura"]),
      field("resource", "Recurso", "enum", ["tipo de recurso"], true),
      field("activity", "Actividad", "enum", ["tipo actividad"], true),
      field("quantity", "Cantidad", "number", ["cantidad"], true),
      field("unit", "Unidad", "text", ["unidad"], true),
      field("periodStart", "Desde", "date", ["periodo inicio", "fecha inicio", "desde"], true),
      field("periodEnd", "Hasta", "date", ["periodo fin", "fecha fin", "hasta"], true),
      field("siteId", "Sede", "text", ["sede", "id sede"]),
      field("source", "Origen técnico", "enum", ["fuente tecnica", "origen tecnico"]),
      field("quality", "Calidad", "enum", ["calidad"], true),
      field("billedAmount", "Valor pagado", "number", ["valor pagado", "valor"]),
      field("sourceLabel", "Fuente / descripción", "text", ["origen", "fuente", "descripcion"]),
      field("capturedAt", "Capturada", "date", ["fecha captura", "capturada"]),
      field("materialProductId", "ID material", "text", ["id producto material"]),
      field("receiptImportId", "ID recibo", "text", ["id recibo"]),
      field("externalReference", "Factura/referencia", "text", ["factura", "referencia"]),
      field("legacyRecordId", "ID registro histórico", "text", ["id registro historico"]),
    ],
    autoRequired: [
      "resource",
      "activity",
      "quantity",
      "unit",
      "periodStart",
      "periodEnd",
      "quality",
    ],
  },
  {
    id: "emissionFactors",
    label: "Factores de emisión",
    adminOnly: true,
    sheetAliases: ["factores gei", "factores de emision", "emission factors"],
    fields: [
      field("id", "ID", "text", ["id factor"]),
      field("scope", "Alcance", "number", ["alcance", "scope"], true),
      field("activity", "Actividad", "enum", ["actividad"], true),
      field(
        "kgCo2ePerUnit",
        "kg CO₂e por unidad",
        "number",
        ["kg co2e unidad", "kg co2e por unidad"],
        true,
      ),
      field("activityUnit", "Unidad", "text", ["unidad", "unidad del factor"], true),
      field("geography", "Ubicación", "text", ["ubicacion", "geografia"]),
      field("year", "Año", "number", ["ano"], true),
      field("version", "Versión", "text", ["version"], true),
      field("source", "Fuente", "text", ["fuente"], true),
      field("method", "Método", "text", ["metodo"]),
    ],
    autoRequired: [
      "scope",
      "activity",
      "kgCo2ePerUnit",
      "activityUnit",
      "year",
      "version",
      "source",
    ],
  },
  {
    id: "indicatorTargets",
    label: "Metas ambientales",
    adminOnly: true,
    sheetAliases: ["metas ambientales", "metas", "indicator targets"],
    fields: [
      field("id", "ID", "text", ["id meta"]),
      field("indicatorId", "Indicador", "enum", ["indicador"], true),
      field("direction", "Dirección", "enum", ["direccion"], true),
      field("horizonMonths", "Horizonte (meses)", "number", ["horizonte meses", "horizonte"], true),
      field("baselinePeriod", "Período base", "text", ["periodo base", "periodo linea base"], true),
      field("baselineValue", "Línea base", "number", ["linea base", "valor base"], true),
      field(
        "reductionPercent",
        "Cambio objetivo (%)",
        "number",
        ["cambio objetivo", "reduccion (%)"],
        true,
      ),
      field("approvedAt", "Aprobada", "date", ["aprobada", "fecha aprobacion"]),
      field("createdAt", "Creada", "date", ["creada", "fecha creacion"]),
    ],
    autoRequired: [
      "indicatorId",
      "direction",
      "horizonMonths",
      "baselinePeriod",
      "baselineValue",
      "reductionPercent",
    ],
  },
  {
    id: "environmentalActions",
    label: "Acciones ambientales",
    sheetAliases: ["acciones ambientales", "acciones", "environmental actions"],
    fields: [
      field("id", "ID", "text", ["id accion"]),
      field("indicatorId", "Indicador", "enum", ["indicador"], true),
      field("title", "Acción", "text", ["accion", "titulo"], true),
      field("owner", "Responsable", "text", ["responsable", "propietario"]),
      field("dueDate", "Fecha límite", "date", ["fecha limite", "vencimiento"], true),
      field("status", "Estado", "enum", ["estado"]),
      field("notes", "Notas", "text", ["notas", "observaciones"]),
      field("createdAt", "Creada", "date", ["creada", "fecha creacion"]),
      field("completedAt", "Completada", "date", ["completada", "fecha completada"]),
    ],
    autoRequired: ["indicatorId", "title", "dueDate"],
  },
  {
    id: "receiptImports",
    label: "Metadatos de recibos ambientales",
    sheetAliases: ["recibos ambientales", "recibos", "receipt imports"],
    fields: [
      field("id", "ID", "text", ["id recibo"]),
      field("fileName", "Nombre de archivo", "text", ["archivo", "nombre archivo"]),
      field("fileHash", "Huella del archivo", "text", ["huella del archivo", "hash"]),
      field("importedAt", "Fecha de importación", "date", ["fecha de importacion", "importado"]),
      field("provider", "Proveedor", "text", ["proveedor"], true),
      field("accountNumber", "Cuenta", "text", ["cuenta", "numero de cuenta"]),
      field("period", "Período", "text", ["periodo"], true),
      field("status", "Estado", "enum", ["estado"]),
      field("source", "Origen", "enum", ["origen"]),
      field("resource", "Recurso", "enum", ["recurso"]),
      field("quantity", "Cantidad", "number", ["cantidad"]),
      field("unit", "Unidad", "text", ["unidad"]),
      field("billedAmount", "Valor facturado", "number", [
        "valor facturado cop",
        "valor facturado",
      ]),
      field("invoiceNumber", "Factura", "text", ["factura", "numero factura"]),
      field("confidence", "Confianza", "number", ["confianza"]),
      field("warnings", "Advertencias", "text", ["advertencias"]),
    ],
    autoRequired: ["provider", "period"],
  },
  {
    id: "environmentalConfig",
    label: "Configuración ambiental",
    adminOnly: true,
    sheetAliases: ["configuracion ambiental", "configuracion de consumo", "environmental config"],
    fields: [
      field("providerId", "ID proveedor", "text", ["id proveedor"]),
      field("providerName", "Proveedor", "text", ["proveedor", "nombre proveedor"]),
      field("accountNumber", "Cuenta", "text", ["cuenta", "numero cuenta"]),
      field("businessUnit", "Unidad de negocio", "text", ["unidad de negocio"]),
      field("geography", "Geografía", "text", ["geografia", "ubicacion"]),
      field("benchmarkCountryCode", "País de referencia", "text", ["pais de referencia"]),
      field("benchmarkRegion", "Región de referencia", "text", ["region de referencia"]),
      field("benchmarkSectorCode", "Sector CIIU", "text", ["sector", "ciiu"]),
      field("benchmarkOutputUnit", "Unidad de producción", "text", ["unidad de produccion"]),
      field("assumedMonthlyOutput", "Producción mensual ilustrativa", "number", [
        "produccion mensual ilustrativa",
      ]),
      field("benchmarkPreferredSources", "Fuentes preferidas", "text", ["fuentes preferidas"]),
    ],
    autoRequired: ["providerName"],
  },
  {
    id: "importExtras",
    label: "Datos adicionales",
    sheetAliases: ["datos adicionales", "campos adicionales", "import extras"],
    fields: [
      field("id", "ID", "text", ["id campo"]),
      field("entityType", "Entidad", "enum", ["entidad", "modulo"], true),
      field(
        "entityId",
        "ID del registro",
        "text",
        ["clave del registro", "id registro", "registro"],
        true,
      ),
      field("fieldName", "Campo original", "text", ["campo original", "campo"], true),
      field("value", "Valor", "text", ["valor"]),
      field("sourceSheet", "Hoja de origen", "text", ["hoja de origen", "hoja"]),
    ],
  },
];

// Detección de encabezados, mapeo y preparación de filas
export function getImportModule(id: ImportModuleId): ImportModuleDefinition {
  return IMPORT_MODULES.find((item) => item.id === id)!;
}

export function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CO")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isComputedImportSheet(sheetName: string): boolean {
  return ["cuentas por cobrar", "cuentas por pagar", "indicadores ambientales"].includes(
    normalizeHeader(sheetName),
  );
}

function asCell(value: unknown): ImportCell {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return value;
  return null;
}

interface SheetJsWorkbook {
  SheetNames: string[];
  Sheets: Record<string, unknown>;
}

interface SheetJsApi {
  read(
    data: ArrayBuffer,
    options: { type: "array"; cellDates: true; sheetRows: number },
  ): SheetJsWorkbook;
  utils: {
    sheet_to_json(
      sheet: unknown,
      options: { header: 1; defval: ""; raw: true; blankrows: false },
    ): unknown[][];
    book_new(): SheetJsWorkbook;
    aoa_to_sheet(rows: unknown[][]): unknown;
    book_append_sheet(workbook: SheetJsWorkbook, sheet: unknown, name: string): void;
    writeFile(workbook: SheetJsWorkbook, name: string, options?: { compression: boolean }): void;
  };
}

declare global {
  interface Window {
    XLSX?: SheetJsApi;
  }
}

function xlsxApi(): SheetJsApi {
  if (!window.XLSX)
    throw new Error("No se cargó el lector Excel local. Recarga Pyme360 e inténtalo de nuevo.");
  return window.XLSX;
}

export async function readExcelWorkbook(file: File): Promise<ExcelWorkbookData> {
  if (!/\.(xlsx?|csv|txt)$/i.test(file.name))
    throw new Error("Elige un archivo .xlsx, .xls o .csv.");
  if (file.size > 10 * 1024 * 1024) throw new Error("El archivo supera el límite local de 10 MB.");
  if (/\.(csv|txt)$/i.test(file.name)) {
    const rows = parseDelimitedText(decodeText(await file.arrayBuffer()));
    if (!rows.length) throw new Error("El archivo no contiene filas para importar.");
    if (rows.length > 10_000)
      throw new Error("El archivo contiene más de 10.000 filas. Divídelo en varios archivos.");
    return { fileName: file.name, sheets: [{ name: file.name.replace(/\.\w+$/, ""), rows }] };
  }
  const api = xlsxApi();
  let workbook: SheetJsWorkbook;
  try {
    workbook = api.read(await file.arrayBuffer(), {
      type: "array",
      cellDates: true,
      sheetRows: 10_001,
    });
  } catch {
    throw new Error(
      "No se pudo abrir el libro Excel. Verifica que el archivo no esté protegido o dañado.",
    );
  }
  let totalRows = 0;
  const sheets = workbook.SheetNames.map((name) => {
    const rows = api.utils
      .sheet_to_json(workbook.Sheets[name], { header: 1, defval: "", raw: true, blankrows: false })
      .map((row) => row.map(asCell));
    totalRows += rows.length;
    return { name, rows };
  });
  if (totalRows > 10_000)
    throw new Error("El archivo contiene más de 10.000 filas. Divídelo en varios archivos.");
  if (!sheets.length || !sheets.some((sheet) => sheet.rows.length > 0))
    throw new Error("El archivo no contiene filas para importar.");
  return { fileName: file.name, sheets };
}

export function suggestHeaderRow(sheet: ExcelSheetData): number {
  let bestIndex = 0;
  let bestScore = -1;
  for (let rowIndex = 0; rowIndex < Math.min(sheet.rows.length, 15); rowIndex += 1) {
    const headers = sheet.rows[rowIndex].map((cell) => normalizeHeader(String(cell ?? "")));
    const score = IMPORT_MODULES.reduce(
      (maximum, module) =>
        Math.max(
          maximum,
          module.fields.reduce(
            (count, definition) =>
              count +
              (headers.some((header) =>
                definition.aliases.some((alias) => normalizeHeader(alias) === header),
              )
                ? 1
                : 0),
            0,
          ),
        ),
      0,
    );
    if (score > bestScore) {
      bestScore = score;
      bestIndex = rowIndex;
    }
  }
  return bestIndex;
}

export function suggestImportModule(
  sheet: ExcelSheetData,
  headerRow = suggestHeaderRow(sheet),
): ImportModuleId | null {
  if (isComputedImportSheet(sheet.name)) return null;
  const sheetName = normalizeHeader(sheet.name);
  const named = IMPORT_MODULES.find((module) =>
    module.sheetAliases.some((alias) => normalizeHeader(alias) === sheetName),
  );
  if (named) return named.id;
  const headers = (sheet.rows[headerRow] ?? []).map((cell) => normalizeHeader(String(cell ?? "")));
  let best: ImportModuleDefinition | undefined;
  let bestScore = 0;
  for (const module of IMPORT_MODULES) {
    const score = module.fields.reduce(
      (count, definition) =>
        count +
        (headers.some((header) =>
          definition.aliases.some((alias) => normalizeHeader(alias) === header),
        )
          ? 1
          : 0),
      0,
    );
    if (score > bestScore) {
      best = module;
      bestScore = score;
    }
  }
  return bestScore >= 2 ? (best?.id ?? null) : null;
}

export function autoMapColumns(
  sheet: ExcelSheetData,
  headerRow: number,
  moduleId: ImportModuleId,
): Record<string, number | null> {
  const headers = (sheet.rows[headerRow] ?? []).map((cell) => normalizeHeader(String(cell ?? "")));
  const used = new Set<number>();
  return Object.fromEntries(
    getImportModule(moduleId).fields.map((definition) => {
      const match = headers.findIndex(
        (header, index) =>
          !used.has(index) &&
          header !== "" &&
          definition.aliases.some((alias) => normalizeHeader(alias) === header),
      );
      if (match >= 0) used.add(match);
      return [definition.key, match >= 0 ? match : null];
    }),
  );
}

/** Maps the bundled UCI catalog sample without relying on header aliases. */
export function mapBundledCatalogSampleColumns(
  sheet: ExcelSheetData,
  headerRow = 0,
): Record<string, number | null> {
  const headers = (sheet.rows[headerRow] ?? []).map((cell) => normalizeHeader(String(cell ?? "")));
  const sampleHeaders: Record<string, string> = {
    sku: "Referencia de catálogo",
    name: "Nombre comercial",
    type: "Clasificación de artículo",
    unit: "Unidad de venta",
    stock: "Saldo inicial referencial",
    minimumStock: "Punto de reposición",
    unitCost: "Costo COP estimado",
    unitPrice: "Precio COP estimado",
    vatRate: "IVA (%)",
    taxCategory: "Categoría tributaria ilustrativa",
  };
  return Object.fromEntries(
    getImportModule("products").fields.map((definition) => [
      definition.key,
      headers.indexOf(normalizeHeader(sampleHeaders[definition.key] ?? "")) >= 0
        ? headers.indexOf(normalizeHeader(sampleHeaders[definition.key] ?? ""))
        : null,
    ]),
  );
}

export function prepareImportRows(
  sheet: ExcelSheetData,
  headerRow: number,
  moduleId: ImportModuleId,
  mapping: Record<string, number | null>,
): PreparedImportRow[] {
  const headers = sheet.rows[headerRow] ?? [];
  const mappedIndexes = new Set(
    Object.values(mapping).filter((index): index is number => index !== null),
  );
  const records: PreparedImportRow[] = [];
  for (let index = headerRow + 1; index < sheet.rows.length; index += 1) {
    const row = sheet.rows[index];
    if (!row.some((cell) => cell !== null && String(cell).trim() !== "")) continue;
    const values: Record<string, ImportCell> = {};
    for (const [key, columnIndex] of Object.entries(mapping)) {
      if (columnIndex !== null && columnIndex >= 0 && columnIndex < row.length)
        values[key] = row[columnIndex] ?? null;
    }
    const extras = headers.flatMap((header, columnIndex) => {
      const headerName = String(header ?? "").trim();
      const cell = row[columnIndex];
      if (
        !headerName ||
        mappedIndexes.has(columnIndex) ||
        CALCULATED_HEADERS.has(normalizeHeader(headerName)) ||
        cell === null ||
        String(cell).trim() === ""
      )
        return [];
      const value = asCell(cell);
      return [
        { fieldName: headerName, value: value instanceof Date ? value.toISOString() : value },
      ];
    });
    records.push({ moduleId, sheetName: sheet.name, sourceRow: index + 1, values, extras });
  }
  return records;
}

export function downloadImportTemplate(): void {
  const api = xlsxApi();
  const workbook = api.utils.book_new();
  api.utils.book_append_sheet(
    workbook,
    api.utils.aoa_to_sheet([
      ["Plantilla de importación Pyme360"],
      [
        "Cada hoja contiene columnas sugeridas. Puedes cambiar nombres y completar solo los datos que tengas.",
      ],
      [
        "Los detalles de ventas/compras requieren una fila por producto. Los movimientos se importan solo desde sus hojas.",
      ],
      ["Usuarios, credenciales, cuentas por cobrar/pagar e indicadores calculados no se importan."],
    ]),
    "Instrucciones",
  );
  for (const module of IMPORT_MODULES) {
    api.utils.book_append_sheet(
      workbook,
      api.utils.aoa_to_sheet([module.fields.map((definition) => definition.label)]),
      safeSheetName(module.label),
    );
  }
  api.utils.writeFile(workbook, "pyme360-plantilla-importacion.xlsx", { compression: true });
}

function safeSheetName(value: string): string {
  return value.replace(/[\\/?*:[\]]/g, " ").slice(0, 31);
}

function cellText(value: ImportCell | undefined): string {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : value === null || value === undefined
      ? ""
      : String(value).trim();
}

// Normalización y validación de los valores del libro
export function parseLocalizedNumber(value: ImportCell | undefined): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  let text = value
    .trim()
    .replace(/[\s\u00a0]/g, "")
    .replace(/COP|\$|%/gi, "")
    .replace(/[^0-9,.-]/g, "");
  if (!text || text === "-" || text === "." || text === ",") return undefined;
  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : ".";
    if (decimal === ",") text = text.replace(/\./g, "").replace(/,/g, ".");
    else text = text.replace(/,/g, "");
  } else if (comma >= 0) {
    if (/^[1-9]\d{0,2}(,\d{3})+$/.test(text)) text = text.replace(/,/g, "");
    else {
      const lastComma = text.lastIndexOf(",");
      text = `${text.slice(0, lastComma).replace(/,/g, "")}.${text.slice(lastComma + 1)}`;
    }
  } else if (dot >= 0) {
    if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, "");
    else if (text.indexOf(".") !== dot) {
      const lastDot = text.lastIndexOf(".");
      text = `${text.slice(0, lastDot).replace(/\./g, "")}.${text.slice(lastDot + 1)}`;
    }
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseDate(value: ImportCell | undefined): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return localDate(value);
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
    return date.toISOString().slice(0, 10);
  }
  const text = cellText(value);
  if (!text) return undefined;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const regional = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(text);
  if (regional) {
    const year = Number(regional[3].length === 2 ? `20${regional[3]}` : regional[3]);
    const day = Number(regional[1]);
    const month = Number(regional[2]);
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (
      candidate.getUTCFullYear() === year &&
      candidate.getUTCMonth() === month - 1 &&
      candidate.getUTCDate() === day
    )
      return candidate.toISOString().slice(0, 10);
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

function localDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function parseBoolean(value: ImportCell | undefined, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  const text = normalizeHeader(cellText(value));
  if (
    ["1", "si", "yes", "true", "activo", "activa", "recibida", "confirmado", "completada"].includes(
      text,
    )
  )
    return true;
  if (
    ["0", "no", "false", "inactivo", "inactiva", "pendiente", "por recibir", "cancelada"].includes(
      text,
    )
  )
    return false;
  return fallback;
}

function makeId(prefix: string): string {
  return `${prefix}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function normalized(value: string): string {
  return normalizeHeader(value);
}

function parseEnum<T extends string>(
  value: ImportCell | undefined,
  options: Record<string, T>,
  fallback?: T,
): T {
  const key = normalized(cellText(value));
  const match = Object.entries(options).find(([option]) => normalized(option) === key)?.[1];
  if (match) return match;
  if (!key && fallback) return fallback;
  throw new Error(
    `El valor «${cellText(value) || "vacío"}» no pertenece a las opciones admitidas.`,
  );
}

function fieldText(row: PreparedImportRow, key: string, required = false): string {
  const value = cellText(row.values[key]);
  if (required && !value)
    throw new Error(
      `Falta el campo «${getImportModule(row.moduleId).fields.find((item) => item.key === key)?.label ?? key}».`,
    );
  return value;
}

function fieldNumber(row: PreparedImportRow, key: string, required = false, fallback = 0): number {
  const raw = row.values[key];
  if (raw === undefined || raw === null || raw === "") {
    if (required)
      throw new Error(
        `Falta el campo «${getImportModule(row.moduleId).fields.find((item) => item.key === key)?.label ?? key}».`,
      );
    return fallback;
  }
  const value = parseLocalizedNumber(raw);
  if (value === undefined) throw new Error(`«${fieldText(row, key)}» no es un número válido.`);
  return value;
}

function fieldDate(row: PreparedImportRow, key: string, required = false): string {
  const value = parseDate(row.values[key]);
  if (!value && required)
    throw new Error(
      `Falta una fecha válida en «${getImportModule(row.moduleId).fields.find((item) => item.key === key)?.label ?? key}».`,
    );
  return value ?? "";
}

function fieldDateTime(
  row: PreparedImportRow,
  key: string,
  fallback = new Date().toISOString(),
): string {
  const raw = row.values[key];
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString();
  if (typeof raw === "string" && raw.includes("T")) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  const date = parseDate(raw);
  return date ? `${date}T12:00:00.000Z` : fallback;
}

function optionalNumber(row: PreparedImportRow, key: string): number | undefined {
  const raw = row.values[key];
  if (raw === undefined || raw === null || raw === "") return undefined;
  const value = parseLocalizedNumber(raw);
  if (value === undefined) throw new Error(`«${fieldText(row, key)}» no es un número válido.`);
  return value;
}

function extraValue(value: ImportCell | undefined): ImportExtraValue {
  if (value instanceof Date) return value.toISOString();
  return value === undefined ? null : value;
}

function nowIso(): string {
  return new Date().toISOString();
}

export type ImportRole = "admin" | "operator" | "viewer";

const CALCULATED_HEADERS = new Set([
  "balance",
  "saldo",
  "saldo cop",
  "saldo actual",
  "saldo actual cop",
  "saldo reconocido",
  "saldo reconocido cop",
  "saldo pendiente",
  "pagado",
  "pagado cop",
  "valor firmado cop",
  "energia por unidad kwh u",
  "electricidad por unidad kwh u",
  "agua por unidad m3 u",
]);

function rowsFor(rows: PreparedImportRow[], moduleId: ImportModuleId): PreparedImportRow[] {
  return rows.filter((row) => row.moduleId === moduleId);
}

function rowToken(row: PreparedImportRow): string {
  return `${row.moduleId}\u0000${row.sheetName}\u0000${row.sourceRow}`;
}

function setRowsResult(
  results: ImportRowResult[],
  rows: PreparedImportRow[],
  status: ImportRowStatus,
  message: string,
): void {
  const tokens = new Set(rows.map(rowToken));
  for (const result of results) {
    if (tokens.has(`${result.moduleId}\u0000${result.sheetName}\u0000${result.sourceRow}`)) {
      result.status = status;
      result.message = message;
    }
  }
}

function textOptional(row: PreparedImportRow, key: string): string | undefined {
  const value = fieldText(row, key);
  return value || undefined;
}

function resolveContact(
  state: AppState,
  idValue: string,
  nameValue: string,
  expected: "customer" | "supplier",
): Contact {
  let matches = idValue ? state.contacts.filter((contact) => contact.id === idValue) : [];
  if (!matches.length && (idValue || nameValue)) {
    const identifier = (idValue || nameValue).trim().toLocaleLowerCase("es-CO");
    matches = state.contacts.filter(
      (contact) =>
        contact.taxId.trim().toLocaleLowerCase("es-CO") === identifier ||
        contact.name.trim().toLocaleLowerCase("es-CO") === identifier,
    );
  }
  if (!matches.length && nameValue)
    matches = state.contacts.filter(
      (contact) =>
        contact.name.trim().toLocaleLowerCase("es-CO") ===
        nameValue.trim().toLocaleLowerCase("es-CO"),
    );
  if (matches.length > 1)
    throw new Error(
      `La referencia a ${expected === "customer" ? "cliente" : "proveedor"} «${idValue || nameValue}» es ambigua.`,
    );
  const match = matches[0];
  if (!match)
    throw new Error(
      `No se encontró el ${expected === "customer" ? "cliente" : "proveedor"} «${idValue || nameValue}». Importa primero Contactos o relaciona un ID/NIT válido.`,
    );
  if (expected === "customer" && match.role === "supplier")
    throw new Error(`El contacto «${match.name}» no tiene rol de cliente.`);
  if (expected === "supplier" && match.role === "customer")
    throw new Error(`El contacto «${match.name}» no tiene rol de proveedor.`);
  return match;
}

function resolveProduct(
  state: AppState,
  idValue: string,
  skuValue: string,
  nameValue = "",
): Product {
  let matches = idValue ? state.products.filter((product) => product.id === idValue) : [];
  if (!matches.length && skuValue)
    matches = state.products.filter(
      (product) =>
        product.sku.trim().toLocaleLowerCase("es-CO") ===
        skuValue.trim().toLocaleLowerCase("es-CO"),
    );
  if (!matches.length && nameValue)
    matches = state.products.filter(
      (product) =>
        product.name.trim().toLocaleLowerCase("es-CO") ===
        nameValue.trim().toLocaleLowerCase("es-CO"),
    );
  if (matches.length > 1)
    throw new Error(`La referencia al producto «${idValue || skuValue || nameValue}» es ambigua.`);
  if (!matches[0])
    throw new Error(
      `No se encontró el producto «${idValue || skuValue || nameValue}». Importa primero Inventario.`,
    );
  return matches[0];
}

function resolveAccount(
  state: AppState,
  idValue: string,
  nameValue = "",
): FinancialAccount | undefined {
  if (!idValue && (!nameValue || normalized(nameValue) === "sin asignar")) return undefined;
  let matches = idValue ? state.financialAccounts.filter((account) => account.id === idValue) : [];
  if (!matches.length)
    matches = state.financialAccounts.filter(
      (account) =>
        account.name.trim().toLocaleLowerCase("es-CO") ===
        (idValue || nameValue).trim().toLocaleLowerCase("es-CO"),
    );
  if (matches.length > 1) throw new Error(`La cuenta «${idValue || nameValue}» es ambigua.`);
  if (!matches[0])
    throw new Error(`No se encontró la cuenta financiera «${idValue || nameValue}».`);
  return matches[0];
}

function addExtras(
  state: AppState,
  row: PreparedImportRow,
  entityType: ImportExtraEntity,
  entityId: string,
): void {
  for (const extra of row.extras) {
    const duplicate = state.importExtras.some(
      (item) =>
        item.entityType === entityType &&
        item.entityId === entityId &&
        item.fieldName === extra.fieldName &&
        item.sourceSheet === row.sheetName,
    );
    if (duplicate) continue;
    state.importExtras.push({
      id: makeId("extra"),
      entityType,
      entityId,
      fieldName: extra.fieldName,
      value: extra.value,
      sourceSheet: row.sheetName,
    });
  }
}

function createResult(rows: PreparedImportRow[]): ImportRowResult[] {
  return rows.map((row) => ({
    moduleId: row.moduleId,
    sheetName: row.sheetName,
    sourceRow: row.sourceRow,
    status: "ready",
    message: "Fila lista para validar.",
  }));
}

function markError(results: ImportRowResult[], row: PreparedImportRow, message: string): void {
  setRowsResult(results, [row], "error", message);
}

function checkAccess(
  rows: PreparedImportRow[],
  role: ImportRole,
  results: ImportRowResult[],
): void {
  for (const row of rows) {
    if (role === "viewer")
      setRowsResult(results, [row], "blocked", "El rol Consulta no puede importar datos.");
    else if (getImportModule(row.moduleId).adminOnly && role !== "admin")
      setRowsResult(
        results,
        [row],
        "blocked",
        "Esta sección solo puede importarla un administrador.",
      );
  }
}

function isBlocked(row: PreparedImportRow, results: ImportRowResult[]): boolean {
  return results.some(
    (result) =>
      result.moduleId === row.moduleId &&
      result.sheetName === row.sheetName &&
      result.sourceRow === row.sourceRow &&
      result.status === "blocked",
  );
}

function importCompanyAndConfig(
  state: AppState,
  rows: PreparedImportRow[],
  results: ImportRowResult[],
): void {
  for (const row of rowsFor(rows, "company")) {
    if (state.company) {
      setRowsResult(
        results,
        [row],
        "duplicate",
        "Ya hay una empresa registrada; la importación es aditiva y no la reemplaza.",
      );
      continue;
    }
    try {
      const company: Company = {
        name: fieldText(row, "name", true),
        taxId: fieldText(row, "taxId"),
        city: fieldText(row, "city"),
        activity: fieldText(row, "activity"),
      };
      state.company = company;
      addExtras(state, row, "company", "settings");
      setRowsResult(results, [row], "ready", "Empresa agregada.");
    } catch (error) {
      markError(
        results,
        row,
        error instanceof Error ? error.message : "Fila de empresa no válida.",
      );
    }
  }
  for (const row of rowsFor(rows, "environmentalConfig")) {
    const existingConfig = state.environmentalConfig;
    const isDefaultConfig =
      existingConfig?.providerName === "Enel Colombia" &&
      !existingConfig.accountNumber &&
      !existingConfig.businessUnit &&
      (existingConfig.geography ?? "Colombia SIN") === "Colombia SIN";
    if (existingConfig?.providerName && !isDefaultConfig) {
      setRowsResult(
        results,
        [row],
        "duplicate",
        "Ya existe una configuración ambiental; no se reemplazó.",
      );
      continue;
    }
    try {
      const importedSources = fieldText(row, "benchmarkPreferredSources")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const config: EnvironmentalConfig = {
        providerId: fieldText(row, "providerId") || "local-receipt",
        providerName: fieldText(row, "providerName", true),
        accountNumber: fieldText(row, "accountNumber"),
        businessUnit: fieldText(row, "businessUnit"),
        geography: fieldText(row, "geography") || "Colombia SIN",
        benchmarking: {
          countryCode: fieldText(row, "benchmarkCountryCode") || "CO",
          region: fieldText(row, "benchmarkRegion") || "Antioquia",
          sectorCode: fieldText(row, "benchmarkSectorCode") || "1104",
          outputUnit: fieldText(row, "benchmarkOutputUnit") || "L",
          assumedMonthlyOutput: fieldNumber(row, "assumedMonthlyOutput", false, 100000),
          preferredSources: importedSources.length
            ? importedSources
            : (existingConfig?.benchmarking.preferredSources ?? [
                "dane-eai",
                "xm",
                "unsd",
                "eia-mecs",
                "company-public",
              ]),
        },
      };
      state.environmentalConfig = config;
      addExtras(state, row, "environmentalConfig", "settings");
      setRowsResult(results, [row], "ready", "Configuración ambiental agregada.");
    } catch (error) {
      markError(results, row, error instanceof Error ? error.message : "Configuración no válida.");
    }
  }
}

function importContacts(
  state: AppState,
  rows: PreparedImportRow[],
  results: ImportRowResult[],
): void {
  for (const row of rowsFor(rows, "contacts")) {
    try {
      const name = fieldText(row, "name", true);
      const taxId = fieldText(row, "taxId");
      const role = parseEnum<ContactRole>(row.values.role, {
        customer: "customer",
        cliente: "customer",
        supplier: "supplier",
        proveedor: "supplier",
        both: "both",
        ambos: "both",
        "cliente y proveedor": "both",
        "cliente y proveedor ambos": "both",
      });
      const existingId = fieldText(row, "id");
      const duplicate = state.contacts.some(
        (contact) =>
          (existingId && contact.id === existingId) ||
          (taxId && contact.taxId && contact.taxId.toLowerCase() === taxId.toLowerCase()) ||
          (!taxId && contact.name.toLowerCase() === name.toLowerCase() && contact.role === role),
      );
      if (duplicate) {
        setRowsResult(
          results,
          [row],
          "duplicate",
          "El contacto ya existe por ID, identificación o nombre y tipo.",
        );
        continue;
      }
      const contact: Contact = {
        id: existingId || makeId("contact"),
        name,
        role,
        ordinaryCustomer: parseBoolean(row.values.ordinaryCustomer),
        taxId,
        email: fieldText(row, "email"),
        phone: fieldText(row, "phone"),
        identificationType: fieldText(row, "identificationType") as Contact["identificationType"],
      };
      state.contacts.push(contact);
      addExtras(state, row, "contacts", contact.id);
      setRowsResult(results, [row], "ready", "Contacto agregado.");
    } catch (error) {
      markError(results, row, error instanceof Error ? error.message : "Contacto no válido.");
    }
  }
}

function productHasImportedMovement(row: PreparedImportRow, rows: PreparedImportRow[]): boolean {
  const id = fieldText(row, "id");
  const sku = fieldText(row, "sku").toLowerCase();
  return rowsFor(rows, "inventoryMovements").some((movement) => {
    const movementId = fieldText(movement, "productId");
    const movementSku = fieldText(movement, "sku").toLowerCase();
    return (id && movementId === id) || (sku && movementSku === sku);
  });
}

function importProducts(
  state: AppState,
  rows: PreparedImportRow[],
  results: ImportRowResult[],
  declaredStock: Map<string, number>,
): Set<string> {
  const newProducts = new Set<string>();
  for (const row of rowsFor(rows, "products")) {
    try {
      const sku = fieldText(row, "sku", true);
      const name = fieldText(row, "name", true);
      const id = fieldText(row, "id") || makeId("product");
      const existing = state.products.find(
        (product) => product.id === id || product.sku.toLowerCase() === sku.toLowerCase(),
      );
      if (existing) {
        setRowsResult(
          results,
          [row],
          "duplicate",
          `El producto ${existing.sku} ya existe; no se actualizó su existencia.`,
        );
        continue;
      }
      const type = parseEnum<ProductType>(row.values.type, {
        raw_material: "raw_material",
        "materia prima": "raw_material",
        supply: "supply",
        insumo: "supply",
        finished: "finished",
        "producto terminado": "finished",
      });
      const declared = fieldNumber(row, "stock", false, 0);
      const explicitMovements = productHasImportedMovement(row, rows);
      const product: Product = {
        id,
        sku,
        name,
        type,
        unit: fieldText(row, "unit", true),
        stock: explicitMovements ? 0 : declared,
        minimumStock: fieldNumber(row, "minimumStock", false, 0),
        unitCost: fieldNumber(row, "unitCost", false, 0),
        unitPrice: fieldNumber(row, "unitPrice", false, 0),
        vatRate: fieldNumber(row, "vatRate", false, 0),
        taxCategory: parseEnum<ProductTaxCategory>(
          row.values.taxCategory,
          {
            unclassified: "unclassified",
            "por clasificar": "unclassified",
            taxable: "taxable",
            gravado: "taxable",
            exempt: "exempt",
            exento: "exempt",
            excluded: "excluded",
            excluido: "excluded",
            not_applicable: "not_applicable",
            "no aplica": "not_applicable",
          },
          "unclassified",
        ),
        environmentalUnit: textOptional(row, "environmentalUnit"),
        environmentalConversionFactor: optionalNumber(row, "environmentalConversionFactor"),
        recycledContentPercent: optionalNumber(row, "recycledContentPercent"),
        benchmarkOutputUnit: fieldText(row, "benchmarkOutputUnit") === "L" ? "L" : undefined,
        benchmarkOutputFactor: optionalNumber(row, "benchmarkOutputFactor"),
      };
      if (
        [
          product.stock,
          product.minimumStock,
          product.unitCost,
          product.unitPrice,
          product.vatRate,
        ].some((value) => value < 0) ||
        product.vatRate > 100
      )
        throw new Error(
          "Existencias, costos, precios e IVA deben ser valores válidos; el IVA no puede superar 100 %.",
        );
      if (
        product.recycledContentPercent !== undefined &&
        (product.recycledContentPercent < 0 || product.recycledContentPercent > 100)
      )
        throw new Error("El contenido reciclado debe estar entre 0 y 100 %.");
      if (
        product.benchmarkOutputFactor !== undefined &&
        (product.type !== "finished" ||
          product.benchmarkOutputUnit !== "L" ||
          product.benchmarkOutputFactor <= 0)
      )
        throw new Error(
          "La conversión a litros debe ser positiva y pertenecer a un producto terminado.",
        );
      if (product.benchmarkOutputUnit !== undefined && product.benchmarkOutputFactor === undefined)
        throw new Error("La unidad de producción comparable requiere un factor en litros.");
      state.products.push(product);
      newProducts.add(id);
      declaredStock.set(id, declared);
      addExtras(state, row, "products", id);
      if (!explicitMovements && declared > 0) {
        const occurredAt = nowIso();
        const movement: InventoryMovement = {
          id: makeId("opening"),
          productId: id,
          productName: name,
          sku,
          unit: product.unit,
          quantity: declared,
          movementType: "opening_balance",
          reason: "Existencia inicial importada desde Excel",
          occurredAt,
          createdAt: occurredAt,
          balanceAfter: declared,
        };
        state.inventoryMovements.push(movement);
      }
      setRowsResult(
        results,
        [row],
        "ready",
        explicitMovements
          ? "Producto agregado; el saldo se calculará desde los movimientos importados."
          : declared > 0
            ? "Producto y saldo inicial agregados."
            : "Producto agregado.",
      );
    } catch (error) {
      markError(results, row, error instanceof Error ? error.message : "Producto no válido.");
    }
  }
  return newProducts;
}

function importAccounts(
  state: AppState,
  rows: PreparedImportRow[],
  results: ImportRowResult[],
): void {
  for (const row of rowsFor(rows, "financialAccounts")) {
    try {
      const id = fieldText(row, "id") || makeId("account");
      const name = fieldText(row, "name", true);
      const duplicate = state.financialAccounts.some(
        (account) => account.id === id || account.name.toLowerCase() === name.toLowerCase(),
      );
      if (duplicate) {
        setRowsResult(
          results,
          [row],
          "duplicate",
          "La cuenta financiera ya existe; no se modificó su saldo inicial.",
        );
        continue;
      }
      const type = parseEnum<FinancialAccount["type"]>(row.values.type, {
        cash: "cash",
        caja: "cash",
        efectivo: "cash",
        bank: "bank",
        banco: "bank",
      });
      const openingBalance = fieldNumber(row, "openingBalance", true);
      if (openingBalance < 0) throw new Error("El saldo inicial no puede ser negativo.");
      const account: FinancialAccount = {
        id,
        name,
        type,
        openingBalance,
        active: parseBoolean(row.values.active, true),
        createdAt: fieldDateTime(row, "createdAt"),
      };
      state.financialAccounts.push(account);
      addExtras(state, row, "financialAccounts", id);
      setRowsResult(
        results,
        [row],
        "ready",
        "Cuenta agregada con su saldo inicial; no se creó ningún movimiento de caja.",
      );
    } catch (error) {
      markError(
        results,
        row,
        error instanceof Error ? error.message : "Cuenta financiera no válida.",
      );
    }
  }
}

function importRecipes(
  state: AppState,
  rows: PreparedImportRow[],
  results: ImportRowResult[],
): void {
  const grouped = new Map<
    string,
    Array<{ row: PreparedImportRow; component: { productId: string; quantity: number } }>
  >();
  for (const row of rowsFor(rows, "recipes")) {
    try {
      const finished = resolveProduct(
        state,
        fieldText(row, "productId"),
        fieldText(row, "productSku"),
      );
      const material = resolveProduct(
        state,
        fieldText(row, "materialProductId"),
        fieldText(row, "materialSku"),
      );
      if (
        finished.type !== "finished" ||
        material.type === "finished" ||
        material.id === finished.id
      )
        throw new Error(
          "La receta debe relacionar un producto terminado con un material o insumo distinto.",
        );
      const quantity = fieldNumber(row, "quantity", true);
      if (quantity <= 0) throw new Error("La cantidad del componente debe ser mayor que cero.");
      const versionId = fieldText(row, "versionId") || `legacy-version-${finished.id}`;
      const key = `${finished.id}\u0000${versionId}`;
      grouped.set(key, [
        ...(grouped.get(key) ?? []),
        { row, component: { productId: material.id, quantity } },
      ]);
    } catch (error) {
      markError(results, row, error instanceof Error ? error.message : "Receta no válida.");
    }
  }

  const activeGroupsByProduct = new Map<string, PreparedImportRow[][]>();
  for (const group of grouped.values()) {
    const first = group[0]?.row;
    if (!first) continue;
    const statusValue = normalized(fieldText(first, "versionStatus"));
    const hasVersionMetadata = ["versionNumber", "baseQuantity", "expectedYieldPercent"].some(
      (key) => fieldText(first, key) !== "",
    );
    const legacyFormat =
      !fieldText(first, "versionId") && !hasVersionMetadata && !fieldText(first, "versionStatus");
    if (statusValue !== "activa" && statusValue !== "active" && !legacyFormat) continue;
    const finished = resolveProduct(
      state,
      fieldText(first, "productId"),
      fieldText(first, "productSku"),
    );
    activeGroupsByProduct.set(finished.id, [
      ...(activeGroupsByProduct.get(finished.id) ?? []),
      group.map((item) => item.row),
    ]);
  }
  const productsWithConflictingActiveVersions = new Set(
    [...activeGroupsByProduct]
      .filter(([, versionGroups]) => versionGroups.length > 1)
      .map(([productId]) => productId),
  );
  for (const [productId, versionGroups] of activeGroupsByProduct) {
    if (!productsWithConflictingActiveVersions.has(productId)) continue;
    for (const rowsInGroup of versionGroups)
      setRowsResult(
        results,
        rowsInGroup,
        "error",
        "El archivo declara más de una versión activa para el mismo producto.",
      );
  }

  for (const group of grouped.values()) {
    const rowsInGroup = group.map((item) => item.row);
    const first = rowsInGroup[0];
    if (!first) continue;
    try {
      const finished = resolveProduct(
        state,
        fieldText(first, "productId"),
        fieldText(first, "productSku"),
      );
      if (productsWithConflictingActiveVersions.has(finished.id)) continue;
      const components = group.map((item) => item.component);
      const componentIds = components.map((component) => component.productId);
      if (new Set(componentIds).size !== componentIds.length)
        throw new Error("La versión contiene el mismo material más de una vez.");
      for (const { row } of group.slice(1)) {
        for (const key of [
          "recipeId",
          "versionNumber",
          "versionStatus",
          "baseQuantity",
          "expectedYieldPercent",
        ]) {
          const currentValue = row.values[key];
          const firstValue = first.values[key];
          if (
            currentValue !== undefined &&
            currentValue !== null &&
            currentValue !== "" &&
            firstValue !== undefined &&
            firstValue !== null &&
            firstValue !== "" &&
            String(currentValue) !== String(firstValue)
          ) {
            throw new Error(
              "Las filas de una misma versión deben conservar los mismos datos de cabecera.",
            );
          }
        }
      }
      for (const item of group) {
        const unit = fieldText(item.row, "unit");
        const material = state.products.find((product) => product.id === item.component.productId);
        if (
          unit &&
          material &&
          unit.trim().toLocaleLowerCase("es-CO") !== material.unit.trim().toLocaleLowerCase("es-CO")
        )
          throw new Error(
            `La unidad «${unit}» no coincide con la unidad de inventario «${material.unit}».`,
          );
      }
      const versionId = fieldText(first, "versionId") || `legacy-version-${finished.id}`;
      const recipeId = fieldText(first, "recipeId") || `imported-recipe-${finished.id}`;
      const idMatch = state.recipes.find((recipe) => recipe.id === recipeId);
      if (idMatch && idMatch.productId !== finished.id)
        throw new Error("El ID de receta ya pertenece a otro producto terminado.");
      const existingRecipe = state.recipes.find(
        (recipe) => recipe.productId === finished.id || recipe.id === recipeId,
      );
      if (
        existingRecipe?.versions.some(
          (version) =>
            version.id === versionId ||
            version.versionNumber === (optionalNumber(first, "versionNumber") ?? 1),
        )
      ) {
        setRowsResult(
          results,
          rowsInGroup,
          "duplicate",
          "La receta o versión ya existe; no se modificó.",
        );
        continue;
      }
      const legacyFormat =
        !fieldText(first, "versionId") &&
        optionalNumber(first, "versionNumber") === undefined &&
        optionalNumber(first, "baseQuantity") === undefined &&
        optionalNumber(first, "expectedYieldPercent") === undefined &&
        !fieldText(first, "versionStatus");
      const statusValue = normalized(fieldText(first, "versionStatus"));
      const status: RecipeVersion["status"] =
        statusValue === "activa" || statusValue === "active"
          ? "active"
          : statusValue === "archivada" || statusValue === "archived"
            ? "archived"
            : statusValue === "borrador" || statusValue === "draft"
              ? "draft"
              : legacyFormat
                ? "active"
                : (() => {
                    throw new Error(
                      `Estado de versión «${fieldText(first, "versionStatus")}» no válido.`,
                    );
                  })();
      const versionNumber =
        optionalNumber(first, "versionNumber") ??
        Math.max(0, ...(existingRecipe?.versions.map((version) => version.versionNumber) ?? [])) +
          1;
      const baseQuantity = optionalNumber(first, "baseQuantity") ?? 1;
      const expectedYieldPercent = optionalNumber(first, "expectedYieldPercent") ?? 100;
      if (
        !Number.isInteger(versionNumber) ||
        versionNumber < 1 ||
        baseQuantity <= 0 ||
        expectedYieldPercent <= 0 ||
        expectedYieldPercent > 100
      )
        throw new Error("Número de versión, lote base o rendimiento fuera de rango.");
      const createdAt = fieldDateTime(first, "createdAt");
      const version: RecipeVersion = {
        id: versionId,
        versionNumber,
        status,
        baseQuantity,
        expectedYieldPercent,
        components,
        createdAt,
        ...(status === "active"
          ? { activatedAt: fieldDateTime(first, "activatedAt") || createdAt }
          : {}),
      };
      let recipe: Recipe;
      if (existingRecipe) {
        if (status === "active" && existingRecipe.activeVersionId) {
          const current = existingRecipe.versions.find(
            (item) => item.id === existingRecipe.activeVersionId,
          );
          if (current) current.status = "archived";
        }
        existingRecipe.versions.push(version);
        if (status === "active") existingRecipe.activeVersionId = version.id;
        recipe = existingRecipe;
      } else {
        recipe = {
          id: recipeId,
          productId: finished.id,
          activeVersionId: status === "active" ? version.id : null,
          versions: [version],
        };
        state.recipes.push(recipe);
      }
      for (const row of rowsInGroup) addExtras(state, row, "recipes", recipe.id);
      setRowsResult(
        results,
        rowsInGroup,
        "ready",
        `Versión ${versionNumber} agregada con ${components.length} componentes.`,
      );
    } catch (error) {
      markError(
        results,
        first,
        error instanceof Error ? error.message : "Versión de receta no válida.",
      );
      for (const row of rowsInGroup.slice(1))
        markError(results, row, "La versión agrupada contiene un componente no válido.");
    }
  }
}

function groupedRows(
  rows: PreparedImportRow[],
  moduleId: "sales" | "purchases",
  results: ImportRowResult[],
): PreparedImportRow[][] {
  const groups = new Map<string, PreparedImportRow[]>();
  for (const row of rowsFor(rows, moduleId)) {
    try {
      const numberKey = fieldText(row, "number", true);
      const counterpart =
        fieldText(row, moduleId === "sales" ? "customerId" : "supplierId") ||
        fieldText(row, moduleId === "sales" ? "customer" : "supplier");
      const key = `${numberKey.toLocaleLowerCase("es-CO")}\u0000${counterpart.toLocaleLowerCase("es-CO")}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    } catch (error) {
      markError(
        results,
        row,
        error instanceof Error ? error.message : "Falta el folio del documento.",
      );
    }
  }
  return [...groups.values()];
}

function importSales(state: AppState, rows: PreparedImportRow[], results: ImportRowResult[]): void {
  for (const group of groupedRows(rows, "sales", results)) {
    const first = group[0];
    if (!first) continue;
    try {
      const id = fieldText(first, "id") || makeId("sale");
      const number = fieldText(first, "number", true);
      if (new Set(group.map((row) => fieldText(row, "id")).filter(Boolean)).size > 1)
        throw new Error("Las líneas de un mismo folio tienen IDs de venta distintos.");
      const customerId = fieldText(first, "customerId");
      const customerName = fieldText(first, "customer");
      if (!customerId && !customerName) throw new Error("Indica el cliente por ID o nombre.");
      const customer = resolveContact(state, customerId, customerName, "customer");
      const duplicate = state.sales.find(
        (sale) =>
          sale.id === id ||
          (sale.number.toLocaleLowerCase("es-CO") === number.toLocaleLowerCase("es-CO") &&
            sale.customerId === customer.id),
      );
      if (duplicate) {
        setRowsResult(
          results,
          group,
          "duplicate",
          `La venta ${duplicate.number} ya existe para este cliente.`,
        );
        continue;
      }
      const lines: SaleLine[] = group.map((row) => {
        const product = resolveProduct(
          state,
          "",
          fieldText(row, "sku", true),
          fieldText(row, "productName"),
        );
        const quantity = fieldNumber(row, "quantity", true);
        if (quantity <= 0)
          throw new Error(`La cantidad de ${product.name} debe ser mayor que cero.`);
        const unitPrice = optionalNumber(row, "unitPrice") ?? product.unitPrice;
        if (unitPrice < 0)
          throw new Error(`El precio unitario de ${product.name} no puede ser negativo.`);
        const vatRate = optionalNumber(row, "vatRate") ?? product.vatRate;
        if (vatRate < 0 || vatRate > 100)
          throw new Error(`La tarifa de IVA de ${product.name} debe estar entre 0 y 100 %.`);
        const subtotal = optionalNumber(row, "subtotal") ?? Math.round(quantity * unitPrice);
        const discountShare = optionalNumber(row, "discountShare") ?? 0;
        const vatAmount =
          optionalNumber(row, "vatAmount") ??
          Math.round(((subtotal - discountShare) * vatRate) / 100);
        const total = optionalNumber(row, "lineTotal") ?? subtotal - discountShare + vatAmount;
        if (
          [subtotal, discountShare, vatAmount, total].some((value) => value < 0) ||
          discountShare > subtotal
        )
          throw new Error(`Los valores de la línea de ${product.name} no son coherentes.`);
        return {
          productId: product.id,
          sku: product.sku,
          productName: product.name,
          quantity,
          unitPrice,
          vatRate,
          subtotal,
          discountShare,
          vatAmount,
          total,
        };
      });
      const date = fieldDate(first, "date", true);
      if (group.some((row) => fieldDate(row, "date", true) !== date))
        throw new Error("Las líneas de un mismo folio tienen fechas distintas.");
      const invoiceStatus = parseEnum<Sale["invoiceFollowUpStatus"]>(
        first.values.invoiceFollowUpStatus,
        {
          to_review: "to_review",
          "por revisar": "to_review",
          registered_externally: "registered_externally",
          "registrada por fuera": "registered_externally",
          not_applicable: "not_applicable",
          "no aplica": "not_applicable",
        },
        "to_review",
      );
      const sale: Sale = {
        id,
        number,
        date,
        customerId: customer.id,
        customerName: customer.name,
        lines,
        subtotal: lines.reduce((sum, line) => sum + line.subtotal, 0),
        discount: lines.reduce((sum, line) => sum + line.discountShare, 0),
        vatAmount: lines.reduce((sum, line) => sum + line.vatAmount, 0),
        total: lines.reduce((sum, line) => sum + line.total, 0),
        payments: [],
        invoiceFollowUpStatus: invoiceStatus,
        externalInvoiceNumber: fieldText(first, "externalInvoiceNumber"),
        externalInvoiceDate: fieldDate(first, "externalInvoiceDate"),
        dueDate: textOptional(first, "dueDate") ? fieldDate(first, "dueDate") : undefined,
      };
      state.sales.push(sale);
      for (const row of group) addExtras(state, row, "sales", id);
      setRowsResult(
        results,
        group,
        "ready",
        `${lines.length} línea(s) agregadas; no se generaron movimientos de inventario ni de caja.`,
      );
    } catch (error) {
      setRowsResult(
        results,
        group,
        "error",
        error instanceof Error ? error.message : "No se pudo importar la venta.",
      );
    }
  }
}

function importPurchases(
  state: AppState,
  rows: PreparedImportRow[],
  results: ImportRowResult[],
): void {
  for (const group of groupedRows(rows, "purchases", results)) {
    const first = group[0];
    if (!first) continue;
    try {
      const id = fieldText(first, "id") || makeId("purchase");
      const number = fieldText(first, "number", true);
      if (new Set(group.map((row) => fieldText(row, "id")).filter(Boolean)).size > 1)
        throw new Error("Las líneas de un mismo folio tienen IDs de compra distintos.");
      const supplierId = fieldText(first, "supplierId");
      const supplierName = fieldText(first, "supplier");
      if (!supplierId && !supplierName) throw new Error("Indica el proveedor por ID o nombre.");
      const supplier = resolveContact(state, supplierId, supplierName, "supplier");
      const duplicate = state.purchases.find(
        (purchase) =>
          purchase.id === id ||
          (purchase.number.toLocaleLowerCase("es-CO") === number.toLocaleLowerCase("es-CO") &&
            purchase.supplierId === supplier.id),
      );
      if (duplicate) {
        setRowsResult(
          results,
          group,
          "duplicate",
          `La compra ${duplicate.number} ya existe para este proveedor.`,
        );
        continue;
      }
      const lines: PurchaseLine[] = group.map((row) => {
        const product = resolveProduct(
          state,
          "",
          fieldText(row, "sku", true),
          fieldText(row, "productName"),
        );
        const quantity = fieldNumber(row, "quantity", true);
        const lineTotal = fieldNumber(row, "lineTotal", true);
        if (quantity <= 0 || lineTotal < 0)
          throw new Error(`La cantidad o el costo de ${product.name} no es válido.`);
        return {
          productId: product.id,
          sku: product.sku,
          productName: product.name,
          quantity,
          lineTotal,
          environmentalUnit: textOptional(row, "environmentalUnit"),
          environmentalConversionFactor: optionalNumber(row, "environmentalConversionFactor"),
          recycledContentPercent: optionalNumber(row, "recycledContentPercent"),
        };
      });
      const date = fieldDate(first, "date", true);
      if (group.some((row) => fieldDate(row, "date", true) !== date))
        throw new Error("Las líneas de un mismo folio tienen fechas distintas.");
      const status = parseEnum<PurchaseStatus>(
        first.values.status,
        {
          received: "received",
          recibida: "received",
          recibido: "received",
          pending: "pending",
          pendiente: "pending",
          "por recibir": "pending",
        },
        "pending",
      );
      const total = lines.reduce((sum, line) => sum + line.lineTotal, 0);
      const payableReviewStatus = parseEnum<Purchase["payableReviewStatus"]>(
        first.values.payableReviewStatus,
        {
          confirmed: "confirmed",
          confirmada: "confirmed",
          review_required: "review_required",
          "por revisar": "review_required",
        },
        "confirmed",
      );
      const payableInput = optionalNumber(first, "payableAmount");
      const purchase: Purchase = {
        id,
        number,
        date,
        supplierId: supplier.id,
        supplierName: supplier.name,
        status,
        lines,
        total,
        dueDate: textOptional(first, "dueDate") ? fieldDate(first, "dueDate") : undefined,
        payments: [],
        payableReviewStatus,
        payableAmount:
          payableInput ??
          (status === "received" && payableReviewStatus === "confirmed" ? total : undefined),
      };
      state.purchases.push(purchase);
      for (const row of group) addExtras(state, row, "purchases", id);
      setRowsResult(
        results,
        group,
        "ready",
        `${lines.length} línea(s) agregadas; el libro de inventario no se modifica por esta compra.`,
      );
    } catch (error) {
      setRowsResult(
        results,
        group,
        "error",
        error instanceof Error ? error.message : "No se pudo importar la compra.",
      );
    }
  }
}

function resolveSale(state: AppState, id: string, number: string): Sale {
  let matches = id ? state.sales.filter((sale) => sale.id === id) : [];
  if (!matches.length && number)
    matches = state.sales.filter(
      (sale) => sale.number.toLocaleLowerCase("es-CO") === number.toLocaleLowerCase("es-CO"),
    );
  if (matches.length > 1) throw new Error(`El documento de venta «${id || number}» es ambiguo.`);
  if (!matches[0])
    throw new Error(`No se encontró la venta «${id || number}». Importa primero sus detalles.`);
  return matches[0];
}

function resolvePurchase(state: AppState, id: string, number: string): Purchase {
  let matches = id ? state.purchases.filter((purchase) => purchase.id === id) : [];
  if (!matches.length && number)
    matches = state.purchases.filter(
      (purchase) =>
        purchase.number.toLocaleLowerCase("es-CO") === number.toLocaleLowerCase("es-CO"),
    );
  if (matches.length > 1) throw new Error(`El documento de compra «${id || number}» es ambiguo.`);
  if (!matches[0])
    throw new Error(`No se encontró la compra «${id || number}». Importa primero sus detalles.`);
  return matches[0];
}

function addSalePayments(
  state: AppState,
  rows: PreparedImportRow[],
  results: ImportRowResult[],
  importedCashIds: Set<string>,
): void {
  for (const row of rowsFor(rows, "salePayments")) {
    try {
      const sale = resolveSale(state, fieldText(row, "saleId"), fieldText(row, "saleNumber"));
      const id = fieldText(row, "id") || makeId("payment");
      const amount = fieldNumber(row, "amount", true);
      const date = fieldDate(row, "date", true);
      const method = fieldText(row, "method", true);
      const duplicate = sale.payments.find(
        (payment) =>
          payment.id === id ||
          (payment.date === date &&
            payment.amount === amount &&
            payment.method.toLowerCase() === method.toLowerCase()),
      );
      if (duplicate) {
        setRowsResult(results, [row], "duplicate", `El abono de ${sale.number} ya existe.`);
        continue;
      }
      if (
        amount <= 0 ||
        amount > sale.total - sale.payments.reduce((sum, payment) => sum + payment.amount, 0) + 0.01
      )
        throw new Error("El valor del abono debe ser positivo y no superar el saldo pendiente.");
      const account = resolveAccount(state, fieldText(row, "accountId"));
      const cashMovementId = fieldText(row, "cashMovementId");
      if (
        cashMovementId &&
        !importedCashIds.has(cashMovementId) &&
        !state.cashMovements.some((movement) => movement.id === cashMovementId)
      )
        throw new Error(`No se encontró el movimiento de caja ${cashMovementId}.`);
      const payment: Payment = {
        id,
        date,
        amount,
        method,
        accountId: account?.id,
        cashMovementId: cashMovementId || undefined,
      };
      sale.payments.push(payment);
      addExtras(state, row, "sales", sale.id);
      setRowsResult(
        results,
        [row],
        "ready",
        "Abono agregado sin generar movimientos de caja adicionales.",
      );
    } catch (error) {
      markError(results, row, error instanceof Error ? error.message : "Abono no válido.");
    }
  }
}

function addPurchasePayments(
  state: AppState,
  rows: PreparedImportRow[],
  results: ImportRowResult[],
  importedCashIds: Set<string>,
): void {
  for (const row of rowsFor(rows, "purchasePayments")) {
    try {
      const purchase = resolvePurchase(
        state,
        fieldText(row, "purchaseId"),
        fieldText(row, "purchaseNumber"),
      );
      const id = fieldText(row, "id") || makeId("payment");
      const amount = fieldNumber(row, "amount", true);
      const date = fieldDate(row, "date", true);
      const method = fieldText(row, "method", true);
      const duplicate = purchase.payments.find(
        (payment) =>
          payment.id === id ||
          (payment.date === date &&
            payment.amount === amount &&
            payment.method.toLowerCase() === method.toLowerCase()),
      );
      if (duplicate) {
        setRowsResult(results, [row], "duplicate", `El pago de ${purchase.number} ya existe.`);
        continue;
      }
      const canValidateBalance =
        purchase.status === "received" && purchase.payableReviewStatus === "confirmed";
      const payableTotal = purchase.payableAmount ?? purchase.total;
      if (
        amount <= 0 ||
        (canValidateBalance &&
          amount >
            payableTotal -
              purchase.payments.reduce((sum, payment) => sum + payment.amount, 0) +
              0.01)
      )
        throw new Error("El pago debe ser positivo y no superar el saldo por pagar confirmado.");
      const account = resolveAccount(state, fieldText(row, "accountId"));
      const cashMovementId = fieldText(row, "cashMovementId");
      if (
        cashMovementId &&
        !importedCashIds.has(cashMovementId) &&
        !state.cashMovements.some((movement) => movement.id === cashMovementId)
      )
        throw new Error(`No se encontró el movimiento de caja ${cashMovementId}.`);
      purchase.payments.push({
        id,
        date,
        amount,
        method,
        accountId: account?.id,
        cashMovementId: cashMovementId || undefined,
      });
      addExtras(state, row, "purchases", purchase.id);
      setRowsResult(
        results,
        [row],
        canValidateBalance ? "ready" : "warning",
        canValidateBalance
          ? "Pago agregado sin generar movimientos de caja adicionales."
          : "Pago histórico conservado; no se calculó saldo porque la compra está por revisar o pendiente de recepción.",
      );
    } catch (error) {
      markError(results, row, error instanceof Error ? error.message : "Pago de compra no válido.");
    }
  }
}

function inventoryMovementType(row: PreparedImportRow): InventoryMovementType {
  return parseEnum<InventoryMovementType>(row.values.movementType, {
    opening_balance: "opening_balance",
    "saldo inicial": "opening_balance",
    "existencia inicial": "opening_balance",
    sale: "sale",
    venta: "sale",
    purchase: "purchase",
    compra: "purchase",
    production_consumption: "production_consumption",
    "consumo produccion": "production_consumption",
    production_output: "production_output",
    "entrada produccion": "production_output",
    adjustment: "adjustment",
    ajuste: "adjustment",
    reversal: "reversal",
    reverso: "reversal",
    reversión: "reversal",
  });
}

function importInventoryMovements(
  state: AppState,
  rows: PreparedImportRow[],
  results: ImportRowResult[],
  newProductIds: Set<string>,
  declaredStock: Map<string, number>,
): void {
  const movementRows = rowsFor(rows, "inventoryMovements");
  const sorted = movementRows.slice().sort((a, b) => {
    const left = fieldDate(a, "date") || "";
    const right = fieldDate(b, "date") || "";
    return left.localeCompare(right) || a.sourceRow - b.sourceRow;
  });
  const importedKeys = new Set<string>();
  const importedLastBalance = new Map<string, number>();
  for (const row of sorted) {
    try {
      const product = resolveProduct(
        state,
        fieldText(row, "productId"),
        fieldText(row, "sku"),
        fieldText(row, "productName"),
      );
      const id = fieldText(row, "id") || makeId("movement");
      const occurredDate = fieldDate(row, "date", true);
      const occurredAt =
        row.values.date instanceof Date || typeof row.values.date === "number"
          ? `${occurredDate}T12:00:00.000Z`
          : cellText(row.values.date).includes("T")
            ? cellText(row.values.date)
            : `${occurredDate}T12:00:00.000Z`;
      const movementType = inventoryMovementType(row);
      const quantity = fieldNumber(row, "quantity", true);
      if (quantity === 0) throw new Error("La cantidad del movimiento no puede ser cero.");
      const reason = fieldText(row, "reason") || "Movimiento importado desde Excel";
      const naturalKey = `${product.id}\u0000${occurredAt}\u0000${movementType}\u0000${quantity}\u0000${reason.toLowerCase()}`;
      if (
        state.inventoryMovements.some((movement) => movement.id === id) ||
        state.inventoryMovements.some(
          (movement) =>
            `${movement.productId}\u0000${movement.occurredAt}\u0000${movement.movementType}\u0000${movement.quantity}\u0000${movement.reason.toLowerCase()}` ===
            naturalKey,
        ) ||
        importedKeys.has(naturalKey)
      ) {
        setRowsResult(
          results,
          [row],
          "duplicate",
          "El movimiento ya está en el libro o se repite dentro del archivo.",
        );
        continue;
      }
      if (movementType === "reversal") {
        const reversesMovementId = fieldText(row, "reversesMovementId");
        if (
          !reversesMovementId ||
          !state.inventoryMovements.some((movement) => movement.id === reversesMovementId)
        )
          throw new Error("El movimiento de reversión debe referenciar un movimiento existente.");
      }
      const before = importedLastBalance.get(product.id) ?? product.stock;
      const balanceAfter = before + quantity;
      if (balanceAfter < -0.0001)
        throw new Error(`El movimiento dejaría inventario negativo para ${product.name}.`);
      const sourceTypeRaw = fieldText(row, "sourceType");
      const sourceType = sourceTypeRaw
        ? parseEnum<NonNullable<InventoryMovement["sourceType"]>>(row.values.sourceType, {
            sale: "sale",
            venta: "sale",
            purchase: "purchase",
            compra: "purchase",
            production: "production",
            produccion: "production",
            adjustment: "adjustment",
            ajuste: "adjustment",
          })
        : undefined;
      const sourceId = textOptional(row, "sourceId");
      if (sourceId && sourceType === "sale" && !state.sales.some((sale) => sale.id === sourceId))
        throw new Error(`No se encontró la venta de origen ${sourceId}.`);
      if (
        sourceId &&
        sourceType === "purchase" &&
        !state.purchases.some((purchase) => purchase.id === sourceId)
      )
        throw new Error(`No se encontró la compra de origen ${sourceId}.`);
      if (
        sourceId &&
        sourceType === "production" &&
        !state.productionOrders.some((order) => order.id === sourceId)
      )
        throw new Error(`No se encontró la orden de producción de origen ${sourceId}.`);
      const movement: InventoryMovement = {
        id,
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        unit: fieldText(row, "unit") || product.unit,
        quantity,
        movementType,
        reason,
        occurredAt,
        createdAt: fieldDateTime(row, "createdAt"),
        sourceType,
        sourceId,
        reversesMovementId: textOptional(row, "reversesMovementId"),
        balanceAfter,
      };
      state.inventoryMovements.push(movement);
      product.stock = Number(balanceAfter.toFixed(4));
      importedLastBalance.set(product.id, product.stock);
      importedKeys.add(naturalKey);
      addExtras(state, row, "inventoryMovements", id);
      const suppliedBalance = optionalNumber(row, "balanceAfter");
      if (suppliedBalance !== undefined && Math.abs(suppliedBalance - balanceAfter) > 0.0001)
        setRowsResult(
          results,
          [row],
          "warning",
          `Movimiento guardado. El saldo del archivo (${suppliedBalance}) difiere del saldo recalculado (${balanceAfter}).`,
        );
      else setRowsResult(results, [row], "ready", "Movimiento agregado al libro inmutable.");
    } catch (error) {
      markError(
        results,
        row,
        error instanceof Error ? error.message : "Movimiento de inventario no válido.",
      );
    }
  }
  for (const productId of newProductIds) {
    const product = state.products.find((item) => item.id === productId);
    if (!product || !importedLastBalance.has(productId)) continue;
    const expected = declaredStock.get(productId) ?? 0;
    if (Math.abs(product.stock - expected) > 0.0001) {
      const productRow = rowsFor(rows, "products").find(
        (row) =>
          fieldText(row, "id") === productId ||
          fieldText(row, "sku").toLowerCase() === product.sku.toLowerCase(),
      );
      if (productRow)
        setRowsResult(
          results,
          [productRow],
          "warning",
          `La existencia del Excel era ${expected}; el libro explícito de movimientos suma ${product.stock}. Se conservó el saldo calculado desde movimientos.`,
        );
    }
  }
}

function cashDirection(row: PreparedImportRow): CashMovement["direction"] {
  return parseEnum<CashMovement["direction"]>(row.values.direction, {
    in: "in",
    ingreso: "in",
    entrada: "in",
    out: "out",
    egreso: "out",
    salida: "out",
  });
}

function importCashMovements(
  state: AppState,
  rows: PreparedImportRow[],
  results: ImportRowResult[],
): Set<string> {
  const importedIds = new Set<string>();
  for (const row of rowsFor(rows, "cashMovements")) {
    try {
      const id = fieldText(row, "id") || makeId("cash");
      const date = fieldDate(row, "date", true);
      const direction = cashDirection(row);
      const amount = fieldNumber(row, "amount", true);
      if (amount <= 0) throw new Error("El valor del movimiento debe ser mayor que cero.");
      const account = resolveAccount(state, fieldText(row, "accountId"), fieldText(row, "account"));
      const category = fieldText(row, "category") || "Importado";
      const method = fieldText(row, "method") || "Sin especificar";
      const description = fieldText(row, "description") || category;
      const duplicate = state.cashMovements.some(
        (movement) =>
          movement.id === id ||
          (movement.date === date &&
            movement.direction === direction &&
            movement.amount === amount &&
            movement.category.toLowerCase() === category.toLowerCase() &&
            movement.description.toLowerCase() === description.toLowerCase() &&
            movement.accountId === account?.id),
      );
      if (duplicate) {
        setRowsResult(results, [row], "duplicate", "El movimiento de caja ya existe.");
        continue;
      }
      const sourceTypeValue = fieldText(row, "sourceType");
      const sourceType = sourceTypeValue
        ? parseEnum<NonNullable<CashMovement["sourceType"]>>(row.values.sourceType, {
            sale: "sale",
            venta: "sale",
            purchase: "purchase",
            compra: "purchase",
            manual: "manual",
            reversal: "reversal",
            reverso: "reversal",
          })
        : undefined;
      const sourceId = textOptional(row, "sourceId");
      if (sourceId && sourceType === "sale" && !state.sales.some((sale) => sale.id === sourceId))
        throw new Error(`No se encontró la venta de origen ${sourceId}.`);
      if (
        sourceId &&
        sourceType === "purchase" &&
        !state.purchases.some((purchase) => purchase.id === sourceId)
      )
        throw new Error(`No se encontró la compra de origen ${sourceId}.`);
      const movement: CashMovement = {
        id,
        accountId: account?.id,
        direction,
        amount,
        date,
        method,
        category,
        description,
        sourceType,
        sourceId,
        reversesMovementId: textOptional(row, "reversesMovementId"),
        legacyUnassigned: parseBoolean(row.values.legacyUnassigned, !account),
      };
      if (
        movement.reversesMovementId &&
        !state.cashMovements.some((item) => item.id === movement.reversesMovementId)
      )
        throw new Error(
          "El movimiento de reversión debe referenciar un movimiento de caja existente.",
        );
      state.cashMovements.push(movement);
      importedIds.add(id);
      addExtras(state, row, "cashMovements", id);
      setRowsResult(
        results,
        [row],
        "ready",
        "Movimiento de caja agregado sin vincular pagos automáticamente.",
      );
    } catch (error) {
      markError(
        results,
        row,
        error instanceof Error ? error.message : "Movimiento de caja no válido.",
      );
    }
  }
  return importedIds;
}

function importProductionOrders(
  state: AppState,
  rows: PreparedImportRow[],
  results: ImportRowResult[],
): void {
  for (const row of rowsFor(rows, "productionOrders")) {
    try {
      const id = fieldText(row, "id") || makeId("production");
      const number = fieldText(row, "number", true);
      const product = resolveProduct(
        state,
        fieldText(row, "productId"),
        fieldText(row, "productSku"),
        fieldText(row, "productName"),
      );
      if (product.type !== "finished")
        throw new Error("La orden debe referirse a un producto terminado.");
      const duplicate = state.productionOrders.some(
        (order) => order.id === id || order.number.toLowerCase() === number.toLowerCase(),
      );
      if (duplicate) {
        setRowsResult(results, [row], "duplicate", `La orden ${number} ya existe.`);
        continue;
      }
      const status = parseEnum<ProductionOrder["status"]>(
        row.values.status,
        {
          active: "active",
          "en proceso": "active",
          pendiente: "active",
          completed: "completed",
          completada: "completed",
          cancelled: "cancelled",
          cancelada: "cancelled",
        },
        "active",
      );
      const date = fieldDate(row, "date", true);
      const order: ProductionOrder = {
        id,
        number,
        date,
        productId: product.id,
        productName: product.name,
        quantity: fieldNumber(row, "quantity", true),
        wasteQuantity: fieldNumber(row, "wasteQuantity", false, 0),
        status,
        consumedMaterials: [],
        completedAt: fieldDate(row, "completedAt") || (status === "completed" ? date : ""),
        estimatedMaterialCost: optionalNumber(row, "estimatedMaterialCost"),
        materialCostPerGoodUnit: optionalNumber(row, "materialCostPerGoodUnit"),
        recipeVersionId: textOptional(row, "recipeVersionId"),
        recipeVersionNumber: optionalNumber(row, "recipeVersionNumber"),
        expectedYieldPercent: optionalNumber(row, "expectedYieldPercent"),
        expectedGoodOutputQuantity: optionalNumber(row, "expectedGoodOutputQuantity"),
      };
      if (order.quantity <= 0 || order.wasteQuantity < 0 || order.wasteQuantity > order.quantity)
        throw new Error("La cantidad producida o el desperdicio no son válidos.");
      if (
        (order.recipeVersionNumber !== undefined &&
          (!Number.isInteger(order.recipeVersionNumber) || order.recipeVersionNumber < 1)) ||
        (order.expectedYieldPercent !== undefined &&
          (order.expectedYieldPercent <= 0 || order.expectedYieldPercent > 100)) ||
        (order.expectedGoodOutputQuantity !== undefined && order.expectedGoodOutputQuantity < 0)
      )
        throw new Error("La instantánea de receta de la orden contiene valores no válidos.");
      state.productionOrders.push(order);
      addExtras(state, row, "productionOrders", id);
      setRowsResult(results, [row], "ready", "Orden agregada sin crear movimientos de inventario.");
    } catch (error) {
      markError(
        results,
        row,
        error instanceof Error ? error.message : "Orden de producción no válida.",
      );
    }
  }
}

function importProductionConsumption(
  state: AppState,
  rows: PreparedImportRow[],
  results: ImportRowResult[],
): void {
  for (const row of rowsFor(rows, "productionConsumption")) {
    try {
      const orderId = fieldText(row, "orderId");
      const orderNumber = fieldText(row, "orderNumber", true);
      const orderMatches = orderId
        ? state.productionOrders.filter((item) => item.id === orderId)
        : state.productionOrders.filter(
            (item) => item.number.toLowerCase() === orderNumber.toLowerCase(),
          );
      if (orderMatches.length > 1)
        throw new Error(`La orden «${orderId || orderNumber}» es ambigua.`);
      const order = orderMatches[0];
      if (!order)
        throw new Error(
          `No se encontró la orden ${orderId || orderNumber}. Importa primero Producción.`,
        );
      const material = resolveProduct(
        state,
        fieldText(row, "materialProductId"),
        fieldText(row, "materialSku"),
        fieldText(row, "materialName"),
      );
      if (material.type === "finished")
        throw new Error("Selecciona una materia prima o insumo como material consumido.");
      const quantity = fieldNumber(row, "quantity", true);
      if (quantity <= 0) throw new Error("La cantidad consumida debe ser mayor que cero.");
      if (order.consumedMaterials.some((item) => item.productId === material.id)) {
        setRowsResult(
          results,
          [row],
          "duplicate",
          `El material ${material.sku} ya está registrado en esa orden.`,
        );
        continue;
      }
      order.consumedMaterials.push({
        productId: material.id,
        sku: material.sku,
        productName: material.name,
        quantity,
        environmentalUnit: textOptional(row, "environmentalUnit"),
        environmentalConversionFactor: optionalNumber(row, "environmentalConversionFactor"),
        unitCostSnapshot: optionalNumber(row, "unitCostSnapshot"),
        lineCostSnapshot: optionalNumber(row, "lineCostSnapshot"),
      });
      addExtras(state, row, "productionOrders", order.id);
      setRowsResult(
        results,
        [row],
        "ready",
        "Consumo adjuntado a la orden; no se generó otro movimiento de inventario.",
      );
    } catch (error) {
      markError(
        results,
        row,
        error instanceof Error ? error.message : "Consumo de producción no válido.",
      );
    }
  }
}

function resourceKind(row: PreparedImportRow): ResourceReading["resource"] {
  return parseEnum<ResourceReading["resource"]>(row.values.resource, {
    electricity: "electricity",
    electricidad: "electricity",
    energia: "electricity",
    water: "water",
    agua: "water",
    fuel: "fuel",
    combustible: "fuel",
    material: "material",
    materiales: "material",
    waste: "waste",
    residuos: "waste",
  });
}

function importReceiptMetadata(
  state: AppState,
  rows: PreparedImportRow[],
  results: ImportRowResult[],
): Set<string> {
  const newReceiptIds = new Set<string>();
  for (const row of rowsFor(rows, "receiptImports")) {
    try {
      const id = fieldText(row, "id") || makeId("receipt");
      const provider = fieldText(row, "provider", true);
      const periodValue = fieldText(row, "period", true);
      const period = /^\d{4}-\d{2}$/.test(periodValue)
        ? periodValue
        : fieldDate(row, "period", true).slice(0, 7);
      const resourceLabel = fieldText(row, "resource");
      const resource =
        resourceLabel && normalized(resourceLabel) !== "historico sin clasificar"
          ? parseEnum<NonNullable<ReceiptImport["extraction"]["resource"]>>(row.values.resource, {
              electricity: "electricity",
              electricidad: "electricity",
              energy: "electricity",
              water: "water",
              agua: "water",
              fuel: "fuel",
              combustible: "fuel",
            })
          : undefined;
      const quantity = optionalNumber(row, "quantity");
      if ((quantity !== undefined && quantity < 0) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period))
        throw new Error("El período o la cantidad del recibo no son válidos.");
      const accountNumber = fieldText(row, "accountNumber");
      const invoiceNumber = fieldText(row, "invoiceNumber");
      const duplicate = state.receiptImports.find(
        (receipt) =>
          receipt.id === id ||
          (receipt.provider.toLowerCase() === provider.toLowerCase() &&
            (receipt.accountNumber ?? "") === accountNumber &&
            receipt.extraction.period === period &&
            receipt.extraction.resource === resource &&
            ((!invoiceNumber && !receipt.extraction.invoiceNumber) ||
              receipt.extraction.invoiceNumber === invoiceNumber)) ||
          (fieldText(row, "fileHash") && receipt.fileHash === fieldText(row, "fileHash")),
      );
      if (duplicate) {
        setRowsResult(
          results,
          [row],
          "duplicate",
          "Ya existe un recibo del mismo proveedor, cuenta, recurso y período.",
        );
        continue;
      }
      const warnings = fieldText(row, "warnings")
        .split(/\s*\|\s*/)
        .filter(Boolean);
      let confidence = fieldNumber(row, "confidence", false, 1);
      if (confidence > 1 && confidence <= 100) confidence /= 100;
      if (confidence < 0 || confidence > 1)
        throw new Error("La confianza del recibo debe estar entre 0 y 1 o entre 0 y 100 %.");
      const status = parseEnum<ReceiptImport["status"]>(
        row.values.status,
        {
          pending: "pending",
          pendiente: "pending",
          confirmed: "confirmed",
          confirmado: "confirmed",
          warning: "warning",
          advertencia: "warning",
        },
        warnings.length || confidence < 0.75 ? "warning" : "confirmed",
      );
      const source = parseEnum<ConsumptionSource>(
        row.values.source,
        {
          local_receipt: "local_receipt",
          manual: "manual",
          api: "api",
          production: "production",
          purchase: "purchase",
          legacy: "legacy",
        },
        "local_receipt",
      );
      const receipt: ReceiptImport = {
        id,
        fileName: fieldText(row, "fileName") || "Metadatos importados desde Excel",
        fileHash: textOptional(row, "fileHash"),
        importedAt: fieldDateTime(row, "importedAt"),
        status,
        source,
        provider,
        accountNumber: accountNumber || undefined,
        extraction: {
          period,
          ...(resource ? { resource } : {}),
          ...(quantity !== undefined ? { quantity } : {}),
          unit:
            fieldText(row, "unit") ||
            (resource === "electricity"
              ? "kWh"
              : resource === "water"
                ? "m³"
                : resource === "fuel"
                  ? "L"
                  : undefined),
          billedAmount: fieldNumber(row, "billedAmount", false, 0),
          invoiceNumber,
          provider,
          confidence,
          warnings,
        },
      };
      state.receiptImports.push(receipt);
      newReceiptIds.add(id);
      addExtras(state, row, "receiptImports", id);
      setRowsResult(
        results,
        [row],
        "ready",
        "Metadatos de recibo agregados; la evidencia original no se guarda.",
      );
    } catch (error) {
      markError(
        results,
        row,
        error instanceof Error ? error.message : "Recibo ambiental no válido.",
      );
    }
  }
  return newReceiptIds;
}

function importEnvironmentalRecords(
  state: AppState,
  rows: PreparedImportRow[],
  results: ImportRowResult[],
): void {
  for (const row of rowsFor(rows, "environmentalRecords")) {
    try {
      const rawPeriod = fieldText(row, "period", true);
      const periodDate = /^\d{4}-\d{2}$/.test(rawPeriod)
        ? `${rawPeriod}-01`
        : fieldDate(row, "period", true);
      const period = periodDate.slice(0, 7);
      const id = fieldText(row, "id") || makeId("environment");
      const duplicate = state.environmentalRecords.some(
        (record) => record.id === id || record.period === period,
      );
      if (duplicate) {
        setRowsResult(
          results,
          [row],
          "duplicate",
          `Ya existe un registro ambiental mensual para ${period}.`,
        );
        continue;
      }
      const source = parseEnum<ConsumptionSource>(
        row.values.source,
        {
          manual: "manual",
          local_receipt: "local_receipt",
          api: "api",
          production: "production",
          purchase: "purchase",
          legacy: "legacy",
        },
        "manual",
      );
      const record: EnvironmentalRecord = {
        id,
        period,
        electricityKwh: fieldNumber(row, "electricityKwh", false, 0),
        waterM3: fieldNumber(row, "waterM3", false, 0),
        fuelLiters: fieldNumber(row, "fuelLiters", false, 0),
        productionUnits: fieldNumber(row, "productionUnits", false, 0),
        wasteKg: fieldNumber(row, "wasteKg", false, 0),
        recoveredKg: fieldNumber(row, "recoveredKg", false, 0),
        source,
        sourceLabel: fieldText(row, "sourceLabel") || "Importado desde Excel",
        receiptImportId: textOptional(row, "receiptImportId"),
        lastUpdatedAt: fieldText(row, "lastUpdatedAt") || nowIso(),
      };
      if (
        [
          record.electricityKwh,
          record.waterM3,
          record.fuelLiters,
          record.productionUnits,
          record.wasteKg,
          record.recoveredKg,
        ].some((value) => value < 0) ||
        record.recoveredKg > record.wasteKg
      )
        throw new Error(
          "Los consumos no pueden ser negativos y lo recuperado no puede superar los residuos.",
        );
      if (
        record.receiptImportId &&
        !state.receiptImports.some((receipt) => receipt.id === record.receiptImportId)
      )
        throw new Error(`No se encontró el recibo ${record.receiptImportId}.`);
      state.environmentalRecords.push(record);
      addExtras(state, row, "environmentalRecords", id);
      setRowsResult(results, [row], "ready", "Registro ambiental mensual agregado.");
    } catch (error) {
      markError(
        results,
        row,
        error instanceof Error ? error.message : "Registro ambiental no válido.",
      );
    }
  }
}

function importResourceReadings(
  state: AppState,
  rows: PreparedImportRow[],
  results: ImportRowResult[],
  newReceiptIds: Set<string>,
): void {
  const allowedActivity: Record<ResourceReading["resource"], ResourceReading["activity"][]> = {
    electricity: ["consumption"],
    water: ["withdrawal", "discharge"],
    fuel: ["consumption"],
    material: ["consumption"],
    waste: ["generated", "recovered"],
  };
  for (const row of rowsFor(rows, "resourceReadings")) {
    try {
      const id = fieldText(row, "id") || makeId("reading");
      const resource = resourceKind(row);
      const activity = parseEnum<ResourceReading["activity"]>(row.values.activity, {
        consumption: "consumption",
        consumo: "consumption",
        withdrawal: "withdrawal",
        retirada: "withdrawal",
        discharge: "discharge",
        descarga: "discharge",
        purchase: "purchase",
        compra: "purchase",
        generated: "generated",
        generado: "generated",
        generados: "generated",
        recovered: "recovered",
        recuperado: "recovered",
        recuperados: "recovered",
      });
      if (!allowedActivity[resource].includes(activity))
        throw new Error("La actividad no corresponde al recurso seleccionado.");
      const quantity = fieldNumber(row, "quantity", true);
      if (quantity < 0) throw new Error("La cantidad de la lectura no puede ser negativa.");
      const periodStart = fieldDate(row, "periodStart", true);
      const periodEnd = fieldDate(row, "periodEnd", true);
      if (periodStart > periodEnd)
        throw new Error("La fecha inicial del período no puede ser posterior a la final.");
      const quality = parseEnum<ResourceReading["quality"]>(row.values.quality, {
        measured: "measured",
        medida: "measured",
        medido: "measured",
        estimated: "estimated",
        estimada: "estimated",
        estimado: "estimated",
        confirmed: "confirmed",
        confirmada: "confirmed",
        confirmado: "confirmed",
      });
      const source = parseEnum<ConsumptionSource>(
        row.values.source,
        {
          manual: "manual",
          local_receipt: "local_receipt",
          api: "api",
          production: "production",
          purchase: "purchase",
          legacy: "legacy",
        },
        "manual",
      );
      const materialProductId = textOptional(row, "materialProductId");
      if (
        materialProductId &&
        !state.products.some(
          (product) => product.id === materialProductId && product.type !== "finished",
        )
      )
        throw new Error(`No se encontró la materia prima ${materialProductId}.`);
      const receiptImportId = textOptional(row, "receiptImportId");
      if (
        receiptImportId &&
        !state.receiptImports.some((receipt) => receipt.id === receiptImportId)
      )
        throw new Error(`No se encontró el recibo ${receiptImportId}.`);
      const reading: ResourceReading = {
        id,
        resource,
        activity,
        quantity,
        unit: fieldText(row, "unit", true),
        periodStart,
        periodEnd,
        siteId: fieldText(row, "siteId") || DEFAULT_SITE_ID,
        source,
        quality,
        sourceLabel: fieldText(row, "sourceLabel") || "Importado desde Excel",
        capturedAt: fieldDateTime(row, "capturedAt"),
        billedAmount: fieldNumber(row, "billedAmount", false, 0) || undefined,
        materialProductId,
        receiptImportId,
        externalReference: textOptional(row, "externalReference"),
        legacyRecordId: textOptional(row, "legacyRecordId"),
      };
      const natural = (item: ResourceReading) =>
        item.resource === reading.resource &&
        item.activity === reading.activity &&
        item.periodStart === periodStart &&
        item.periodEnd === periodEnd &&
        item.siteId === reading.siteId &&
        item.quantity === quantity &&
        item.unit.toLowerCase() === reading.unit.toLowerCase() &&
        (item.externalReference ?? "") === (reading.externalReference ?? "");
      if (state.resourceReadings.some((item) => item.id === id || natural(item))) {
        setRowsResult(
          results,
          [row],
          "duplicate",
          "La lectura ya existe; se conservan lecturas de otros recursos del mismo período.",
        );
        continue;
      }
      state.resourceReadings.push(reading);
      addExtras(state, row, "resourceReadings", id);
      setRowsResult(
        results,
        [row],
        "ready",
        newReceiptIds.has(receiptImportId ?? "")
          ? "Lectura agregada junto con los metadatos del recibo."
          : "Lectura ambiental agregada.",
      );
    } catch (error) {
      markError(
        results,
        row,
        error instanceof Error ? error.message : "Lectura ambiental no válida.",
      );
    }
  }
}

function importEmissionFactors(
  state: AppState,
  rows: PreparedImportRow[],
  results: ImportRowResult[],
): void {
  for (const row of rowsFor(rows, "emissionFactors")) {
    try {
      const id = fieldText(row, "id") || makeId("factor");
      const scopeNumber = fieldNumber(row, "scope", true);
      if (scopeNumber !== 1 && scopeNumber !== 2 && scopeNumber !== 3)
        throw new Error("El alcance debe ser 1, 2 o 3.");
      const activity = parseEnum<EmissionFactor["activity"]>(row.values.activity, {
        electricity: "electricity",
        electricidad: "electricity",
        fuel: "fuel",
        combustible: "fuel",
        material_purchase: "material_purchase",
        "compra de materiales": "material_purchase",
        waste: "waste",
        residuos: "waste",
        transport: "transport",
        transporte: "transport",
      });
      const factor: EmissionFactor = {
        id,
        scope: scopeNumber,
        activity,
        kgCo2ePerUnit: fieldNumber(row, "kgCo2ePerUnit", true),
        activityUnit: fieldText(row, "activityUnit", true),
        geography: fieldText(row, "geography") || "Colombia",
        year: fieldNumber(row, "year", true),
        version: fieldText(row, "version", true),
        source: fieldText(row, "source", true),
        method: fieldText(row, "method") || "Importado desde Excel",
      };
      const activityMatchesScope =
        (factor.scope === 1 && factor.activity === "fuel") ||
        (factor.scope === 2 && factor.activity === "electricity") ||
        (factor.scope === 3 &&
          ["material_purchase", "waste", "transport"].includes(factor.activity));
      if (!activityMatchesScope)
        throw new Error("La actividad no corresponde al alcance de emisiones.");
      if (
        factor.kgCo2ePerUnit < 0 ||
        !Number.isInteger(factor.year) ||
        factor.year < 2000 ||
        factor.year > 2200
      )
        throw new Error("El factor debe ser positivo y el año debe estar entre 2000 y 2200.");
      const duplicate = state.emissionFactors.some(
        (item) =>
          item.id === factor.id ||
          (item.scope === factor.scope &&
            item.activity === factor.activity &&
            item.activityUnit.toLowerCase() === factor.activityUnit.toLowerCase() &&
            item.geography.toLowerCase() === factor.geography.toLowerCase() &&
            item.year === factor.year &&
            item.version === factor.version),
      );
      if (duplicate) {
        setRowsResult(
          results,
          [row],
          "duplicate",
          "El factor de emisión ya existe para ese alcance, actividad, ubicación, año y versión.",
        );
        continue;
      }
      state.emissionFactors.push(factor);
      addExtras(state, row, "emissionFactors", id);
      setRowsResult(results, [row], "ready", "Factor documentado agregado.");
    } catch (error) {
      markError(
        results,
        row,
        error instanceof Error ? error.message : "Factor de emisión no válido.",
      );
    }
  }
}

function importIndicatorTargets(
  state: AppState,
  rows: PreparedImportRow[],
  results: ImportRowResult[],
): void {
  const ids = [
    "energy-intensity",
    "water-intensity",
    "material-intensity",
    "recycled-material-share",
    "waste-recovery",
    "scope-1",
    "scope-2",
    "scope-3",
    "data-coverage",
  ] as const;
  for (const row of rowsFor(rows, "indicatorTargets")) {
    try {
      const id = fieldText(row, "id") || makeId("target");
      const indicatorId = parseEnum<(typeof ids)[number]>(
        row.values.indicatorId,
        Object.fromEntries(ids.map((item) => [item, item])),
      );
      const direction = parseEnum<IndicatorTarget["direction"]>(row.values.direction, {
        decrease: "decrease",
        disminuir: "decrease",
        increase: "increase",
        aumentar: "increase",
      });
      const horizonMonths = fieldNumber(row, "horizonMonths", true);
      if (horizonMonths !== 6 && horizonMonths !== 18 && horizonMonths !== 36)
        throw new Error("El horizonte debe ser 6, 18 o 36 meses.");
      const rawPeriod = fieldText(row, "baselinePeriod", true);
      const baselinePeriod = /^\d{4}-\d{2}$/.test(rawPeriod)
        ? rawPeriod
        : fieldDate(row, "baselinePeriod", true).slice(0, 7);
      const baselineValue = fieldNumber(row, "baselineValue", true);
      const reductionPercent = fieldNumber(row, "reductionPercent", true);
      if (baselineValue < 0 || reductionPercent < 0 || reductionPercent >= 100)
        throw new Error("La línea base y el cambio objetivo deben tener valores válidos.");
      const target: IndicatorTarget = {
        id,
        indicatorId,
        direction,
        horizonMonths,
        baselinePeriod,
        baselineValue,
        reductionPercent,
        approvedAt: textOptional(row, "approvedAt") ? fieldDate(row, "approvedAt") : undefined,
        createdAt: textOptional(row, "createdAt") ? fieldDateTime(row, "createdAt") : nowIso(),
      };
      const duplicate = state.indicatorTargets.some(
        (item) =>
          item.id === id ||
          (item.indicatorId === indicatorId &&
            item.horizonMonths === horizonMonths &&
            item.baselinePeriod === baselinePeriod),
      );
      if (duplicate) {
        setRowsResult(
          results,
          [row],
          "duplicate",
          "La meta para ese indicador, horizonte y línea base ya existe.",
        );
        continue;
      }
      state.indicatorTargets.push(target);
      addExtras(state, row, "indicatorTargets", id);
      setRowsResult(results, [row], "ready", "Meta ambiental agregada.");
    } catch (error) {
      markError(results, row, error instanceof Error ? error.message : "Meta ambiental no válida.");
    }
  }
}

function importEnvironmentalActions(
  state: AppState,
  rows: PreparedImportRow[],
  results: ImportRowResult[],
): void {
  const ids = [
    "energy-intensity",
    "water-intensity",
    "material-intensity",
    "recycled-material-share",
    "waste-recovery",
    "scope-1",
    "scope-2",
    "scope-3",
    "data-coverage",
  ] as const;
  for (const row of rowsFor(rows, "environmentalActions")) {
    try {
      const id = fieldText(row, "id") || makeId("action");
      const indicatorId = parseEnum<(typeof ids)[number]>(
        row.values.indicatorId,
        Object.fromEntries(ids.map((item) => [item, item])),
      );
      const title = fieldText(row, "title", true);
      const dueDate = fieldDate(row, "dueDate", true);
      const status = parseEnum<EnvironmentalAction["status"]>(
        row.values.status,
        {
          open: "open",
          abierta: "open",
          pendiente: "open",
          completed: "completed",
          completada: "completed",
          cerrada: "completed",
        },
        "open",
      );
      const action: EnvironmentalAction = {
        id,
        indicatorId,
        title,
        owner: fieldText(row, "owner"),
        dueDate,
        status,
        notes: fieldText(row, "notes"),
        createdAt: textOptional(row, "createdAt") ? fieldDateTime(row, "createdAt") : nowIso(),
        completedAt: textOptional(row, "completedAt") ? fieldDate(row, "completedAt") : undefined,
      };
      const duplicate = state.environmentalActions.some(
        (item) =>
          item.id === id ||
          (item.title.toLowerCase() === title.toLowerCase() &&
            item.dueDate === dueDate &&
            item.owner.toLowerCase() === action.owner.toLowerCase()),
      );
      if (duplicate) {
        setRowsResult(results, [row], "duplicate", "La acción ambiental ya existe.");
        continue;
      }
      state.environmentalActions.push(action);
      addExtras(state, row, "environmentalActions", id);
      setRowsResult(results, [row], "ready", "Acción ambiental agregada.");
    } catch (error) {
      markError(
        results,
        row,
        error instanceof Error ? error.message : "Acción ambiental no válida.",
      );
    }
  }
}

function entityExists(state: AppState, type: ImportExtraEntity, id: string): boolean {
  if (type === "company" || type === "environmentalConfig")
    return (
      id === "settings" &&
      (type === "company" ? Boolean(state.company) : Boolean(state.environmentalConfig))
    );
  const records: Partial<Record<ImportExtraEntity, Array<{ id: string }>>> = {
    contacts: state.contacts,
    products: state.products,
    recipes: state.recipes,
    sales: state.sales,
    purchases: state.purchases,
    inventoryMovements: state.inventoryMovements,
    financialAccounts: state.financialAccounts,
    cashMovements: state.cashMovements,
    productionOrders: state.productionOrders,
    environmentalRecords: state.environmentalRecords,
    resourceReadings: state.resourceReadings,
    emissionFactors: state.emissionFactors,
    indicatorTargets: state.indicatorTargets,
    environmentalActions: state.environmentalActions,
    receiptImports: state.receiptImports,
  };
  return records[type]?.some((item) => item.id === id) ?? false;
}

function importAdditionalData(
  state: AppState,
  rows: PreparedImportRow[],
  results: ImportRowResult[],
  role: ImportRole,
): void {
  const entities: ImportExtraEntity[] = [
    "company",
    "contacts",
    "products",
    "recipes",
    "sales",
    "purchases",
    "inventoryMovements",
    "financialAccounts",
    "cashMovements",
    "productionOrders",
    "environmentalRecords",
    "resourceReadings",
    "emissionFactors",
    "indicatorTargets",
    "environmentalActions",
    "receiptImports",
    "environmentalConfig",
  ];
  const operatorEntities: ImportExtraEntity[] = [
    "contacts",
    "products",
    "recipes",
    "sales",
    "purchases",
    "inventoryMovements",
    "cashMovements",
    "productionOrders",
    "environmentalRecords",
    "resourceReadings",
    "environmentalActions",
    "receiptImports",
  ];
  for (const row of rowsFor(rows, "importExtras")) {
    try {
      const entityType = parseEnum<ImportExtraEntity>(
        row.values.entityType,
        Object.fromEntries(entities.map((item) => [item, item])),
      );
      if (role !== "admin" && !operatorEntities.includes(entityType))
        throw new Error(
          "El operador no puede importar campos de configuración o secciones restringidas.",
        );
      const entityId = fieldText(row, "entityId", true);
      if (!entityExists(state, entityType, entityId))
        throw new Error(
          `No existe el registro ${entityId} de ${entityType}. Importa primero esa sección.`,
        );
      const fieldName = fieldText(row, "fieldName", true);
      const value = extraValue(row.values.value);
      const sourceSheet = fieldText(row, "sourceSheet") || row.sheetName;
      const id = fieldText(row, "id") || makeId("extra");
      if (
        state.importExtras.some(
          (item) =>
            item.id === id ||
            (item.entityType === entityType &&
              item.entityId === entityId &&
              item.fieldName === fieldName &&
              item.sourceSheet === sourceSheet),
        )
      ) {
        setRowsResult(
          results,
          [row],
          "duplicate",
          "Ese campo adicional ya existe para el registro.",
        );
        continue;
      }
      const extra: ImportExtraField = { id, entityType, entityId, fieldName, value, sourceSheet };
      state.importExtras.push(extra);
      setRowsResult(results, [row], "ready", "Campo adicional agregado al registro.");
    } catch (error) {
      markError(
        results,
        row,
        error instanceof Error ? error.message : "Campo adicional no válido.",
      );
    }
  }
}

function countStateRows(state: AppState): number {
  return (
    [
      state.contacts,
      state.products,
      state.sales,
      state.purchases,
      state.inventoryMovements,
      state.financialAccounts,
      state.cashMovements,
      state.productionOrders,
      state.environmentalRecords,
      state.resourceReadings,
      state.emissionFactors,
      state.indicatorTargets,
      state.environmentalActions,
      state.receiptImports,
      state.importExtras,
    ].reduce((sum, section) => sum + section.length, 0) +
    state.recipes.reduce(
      (sum, recipe) =>
        sum +
        recipe.versions.length +
        recipe.versions.reduce((components, version) => components + version.components.length, 0),
      0,
    ) +
    state.productionOrders.reduce((sum, order) => sum + order.consumedMaterials.length, 0) +
    state.sales.reduce((sum, sale) => sum + sale.payments.length, 0) +
    state.purchases.reduce((sum, purchase) => sum + purchase.payments.length, 0) +
    (state.company ? 1 : 0) +
    (state.environmentalConfig ? 1 : 0)
  );
}

// Aplicación en memoria y resumen del lote antes de guardar
export function buildImportPlan(
  current: AppState,
  rows: PreparedImportRow[],
  role: ImportRole,
): ImportPlan {
  const state = structuredClone(current);
  const results = createResult(rows);
  checkAccess(rows, role, results);
  const activeRows = rows.filter((row) => !isBlocked(row, results));
  const startCount = countStateRows(current);
  const declaredStock = new Map<string, number>();
  const newProductIds = new Set<string>();

  importCompanyAndConfig(state, activeRows, results);
  importContacts(state, activeRows, results);
  for (const productId of importProducts(state, activeRows, results, declaredStock))
    newProductIds.add(productId);
  importAccounts(state, activeRows, results);
  importRecipes(state, activeRows, results);
  importSales(state, activeRows, results);
  importPurchases(state, activeRows, results);
  importProductionOrders(state, activeRows, results);
  importProductionConsumption(state, activeRows, results);
  importInventoryMovements(state, activeRows, results, newProductIds, declaredStock);
  const importedCashIds = importCashMovements(state, activeRows, results);
  addSalePayments(state, activeRows, results, importedCashIds);
  addPurchasePayments(state, activeRows, results, importedCashIds);
  const newReceiptIds = importReceiptMetadata(state, activeRows, results);
  importEnvironmentalRecords(state, activeRows, results);
  importResourceReadings(state, activeRows, results, newReceiptIds);
  importEmissionFactors(state, activeRows, results);
  importIndicatorTargets(state, activeRows, results);
  importEnvironmentalActions(state, activeRows, results);
  importAdditionalData(state, activeRows, results, role);

  return {
    state,
    results,
    added: Math.max(0, countStateRows(state) - startCount),
    duplicates: results.filter((result) => result.status === "duplicate").length,
    errors: results.filter((result) => result.status === "error").length,
    warnings: results.filter((result) => result.status === "warning").length,
    blocked: results.filter((result) => result.status === "blocked").length,
  };
}
