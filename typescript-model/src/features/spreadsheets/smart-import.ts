import type { AppState } from "../../domain/types";
import {
  isComputedImportSheet,
  normalizeHeader,
  parseLocalizedNumber,
  type ExcelSheetData,
  type ExcelWorkbookData,
  type ImportCell,
  type ImportModuleId,
  type PreparedImportRow,
} from "./excel-import";

export type ColumnConcept =
  | "customer"
  | "supplier"
  | "contactName"
  | "contactRole"
  | "taxId"
  | "email"
  | "phone"
  | "product"
  | "sku"
  | "productType"
  | "unit"
  | "stock"
  | "cost"
  | "price"
  | "vat"
  | "quantity"
  | "date"
  | "document"
  | "total";

export type SheetKind = "contacts" | "products" | "sales" | "purchases";
export type ContactRoleChoice = "cliente" | "proveedor" | "ambos";

interface ConceptDefinition {
  label: string;
  keywords: string[];
  /** Palabras como "NIT" o "total" definen la columna aunque también diga "proveedor". */
  priority?: number;
  content?: "number" | "date";
}

export const COLUMN_CONCEPTS: Record<ColumnConcept, ConceptDefinition> = {
  customer: { label: "Cliente", keywords: ["cliente", "comprador", "customer"] },
  supplier: { label: "Proveedor", keywords: ["proveedor", "prov", "supplier"] },
  contactName: {
    label: "Nombre del contacto",
    keywords: ["nombre", "razon social", "tercero", "empresa", "contacto"],
  },
  contactRole: {
    label: "Tipo de contacto",
    keywords: ["tipo contacto", "tipo tercero", "rol"],
    priority: 0.1,
  },
  taxId: {
    label: "NIT o cédula",
    keywords: ["nit", "cedula", "cc", "identificacion", "rut", "documento identidad"],
    priority: 0.2,
  },
  email: { label: "Correo", keywords: ["correo", "email", "mail"], priority: 0.2 },
  phone: {
    label: "Teléfono",
    keywords: ["telefono", "tel", "celular", "cel", "movil", "whatsapp", "contacto telefonico"],
    priority: 0.2,
  },
  product: {
    label: "Producto",
    keywords: ["producto", "articulo", "item", "descripcion", "detalle", "mercancia", "material"],
  },
  sku: {
    label: "Código del producto",
    keywords: ["sku", "codigo", "cod", "referencia", "ref"],
    priority: 0.15,
  },
  productType: { label: "Tipo de producto", keywords: ["tipo producto", "clase", "categoria"] },
  unit: {
    label: "Unidad de medida",
    keywords: ["unidad de medida", "unidad", "medida", "um", "presentacion"],
  },
  stock: {
    label: "Existencia",
    keywords: ["existencia", "existencias", "stock", "disponible", "inventario"],
    content: "number",
  },
  cost: { label: "Costo", keywords: ["costo", "coste"], content: "number", priority: 0.05 },
  price: {
    label: "Precio",
    keywords: ["precio", "valor unitario", "vr unitario", "pvp", "tarifa"],
    content: "number",
    priority: 0.05,
  },
  vat: { label: "IVA (%)", keywords: ["iva"], content: "number", priority: 0.1 },
  quantity: {
    label: "Cantidad",
    keywords: ["cantidad", "cant", "unidades", "unds", "und", "qty"],
    content: "number",
    priority: 0.05,
  },
  date: { label: "Fecha", keywords: ["fecha", "dia"], content: "date", priority: 0.15 },
  document: {
    label: "Número de documento",
    keywords: ["factura", "folio", "remision", "recibo", "consecutivo", "numero", "documento"],
  },
  total: {
    label: "Valor total",
    keywords: ["total", "valor total", "monto", "importe", "valor"],
    content: "number",
    priority: 0.1,
  },
};

export interface ColumnAnalysis {
  index: number;
  header: string;
  concept: ColumnConcept | null;
  confidence: number;
  /** De dónde salió la propuesta, en palabras para el usuario. */
  evidence: "título" | "contenido" | "título y contenido" | "";
}

export interface SheetAnalysis {
  sheetName: string;
  headerRow: number;
  kind: SheetKind | null;
  confidence: number;
  columns: ColumnAnalysis[];
  contactRole: ContactRoleChoice;
  roleDetected: boolean;
}

const cellString = (cell: ImportCell | undefined) =>
  cell === null || cell === undefined ? "" : String(cell).trim();

function headerScore(header: string, keyword: string): number {
  const target = normalizeHeader(keyword);
  if (header === target) return 1;
  const tokens = header.split(" ");
  const wanted = target.split(" ");
  if (wanted.every((word) => tokens.includes(word))) return 0.85;
  const abbreviation = wanted.length === 1 && wanted[0].length >= 4;
  if (abbreviation && tokens.some((token) => token.length >= 3 && wanted[0].startsWith(token)))
    return 0.7;
  if (abbreviation && tokens.some((token) => token.startsWith(wanted[0]))) return 0.7;
  return 0;
}

interface ContentProfile {
  count: number;
  email: number;
  date: number;
  number: number;
  phone: number;
  taxId: number;
  document: number;
}

/** Más estricto que el lector de números, que ignora letras: "Caja 12" no es un número. */
function looksNumeric(cell: ImportCell): boolean {
  if (typeof cell === "number") return true;
  return typeof cell === "string" && /^\s*\$?\s*-?[\d.,\s]*\d[\d.,\s]*%?\s*(COP)?\s*$/i.test(cell);
}

function isDateLike(cell: ImportCell): boolean {
  if (cell instanceof Date) return true;
  return (
    typeof cell === "string" &&
    (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(cell.trim()) ||
      /^\d{4}-\d{1,2}-\d{1,2}/.test(cell.trim()))
  );
}

function profileColumn(cells: ImportCell[]): ContentProfile {
  const values = cells.filter((cell) => cellString(cell) !== "");
  const share = (test: (cell: ImportCell) => boolean) =>
    values.length ? values.filter(test).length / values.length : 0;
  return {
    count: values.length,
    email: share((cell) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cellString(cell))),
    date: share(isDateLike),
    number: share((cell) => !isDateLike(cell) && looksNumeric(cell)),
    phone: share((cell) =>
      /^(\+?57)?\s*(3\d{2}|60\d)[\s-]?\d{3}[\s-]?\d{4}$/.test(cellString(cell)),
    ),
    taxId: share((cell) => /^\d{1,3}(\.?\d{3}){2}-\d$/.test(cellString(cell))),
    document: share((cell) => /^[A-Za-z]{1,5}[-\s]?\d{1,10}$/.test(cellString(cell))),
  };
}

function classifyColumn(index: number, header: string, cells: ImportCell[]): ColumnAnalysis {
  const normalized = normalizeHeader(header);
  const content = profileColumn(cells);
  let best: { concept: ColumnConcept; score: number } | null = null;
  for (const [concept, definition] of Object.entries(COLUMN_CONCEPTS) as Array<
    [ColumnConcept, ConceptDefinition]
  >) {
    const hit = Math.max(0, ...definition.keywords.map((word) => headerScore(normalized, word)));
    if (!hit) continue;
    let score = Math.min(1, hit) + (definition.priority ?? 0);
    if (content.count) {
      if (definition.content === "number" && content.number < 0.6) score *= 0.3;
      if (definition.content === "date" && content.date < 0.6) score *= 0.3;
      if (concept === "unit" && content.number > 0.6) score *= 0.3;
      if (concept === "email" && content.email < 0.5) score *= 0.5;
    }
    if (!best || score > best.score) best = { concept, score };
  }
  const byContent: Array<[ColumnConcept, number]> = (
    [
      ["email", content.email],
      ["date", content.date],
      ["phone", content.phone],
      ["taxId", content.taxId],
      ["document", content.document],
    ] as Array<[ColumnConcept, number]>
  ).filter(([, share]) => share >= 0.7);
  const fromContent = byContent[0]?.[0] ?? null;
  if (best && best.score >= 0.5) {
    const agrees = best.concept === fromContent;
    return {
      index,
      header,
      concept: best.concept,
      confidence: agrees ? 0.95 : Math.min(0.85, best.score),
      evidence: agrees ? "título y contenido" : "título",
    };
  }
  if (fromContent)
    return { index, header, concept: fromContent, confidence: 0.6, evidence: "contenido" };
  return { index, header, concept: null, confidence: 0, evidence: "" };
}

/** Busca los títulos aunque arriba haya filas con el nombre del negocio o la fecha. */
export function findHeaderRow(sheet: ExcelSheetData): number {
  let bestIndex = 0;
  let bestScore = -1;
  for (let index = 0; index < Math.min(sheet.rows.length, 15); index += 1) {
    const filled = sheet.rows[index].filter((cell) => cellString(cell) !== "");
    if (filled.length < 2) continue;
    const texts = filled.filter((cell) => typeof cell === "string" && !looksNumeric(cell));
    const known = filled.filter((cell) => {
      const header = normalizeHeader(cellString(cell));
      return Object.values(COLUMN_CONCEPTS).some((item) =>
        item.keywords.some((word) => headerScore(header, word) > 0),
      );
    });
    const score = texts.length + known.length * 2 - (filled.length - texts.length) * 2;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function isDataRow(row: ImportCell[], headers: string[]): boolean {
  const filled = row.map(cellString).filter(Boolean);
  if (!filled.length) return false;
  if (/^(sub)?total|^suma|^gran total/.test(normalizeHeader(filled[0]))) return false;
  return !filled.every(
    (value, index) => normalizeHeader(value) === normalizeHeader(headers[index] ?? ""),
  );
}

function sheetHint(name: string): SheetKind | "customers" | "suppliers" | null {
  const value = normalizeHeader(name);
  if (/\bventa|\bfactura/.test(value)) return "sales";
  if (/\bcompra|\bgasto/.test(value)) return "purchases";
  if (/\bproveedor|\bprov\b/.test(value)) return "suppliers";
  if (/\bcliente/.test(value)) return "customers";
  if (/\binventario|\bproducto|\barticulo|\bcatalogo|\bbodega/.test(value)) return "products";
  return null;
}

function decideKind(
  concepts: Set<ColumnConcept>,
  hint: ReturnType<typeof sheetHint>,
): SheetKind | null {
  const has = (...items: ColumnConcept[]) => items.some((item) => concepts.has(item));
  const product = has("product", "sku");
  const party = has("customer", "supplier", "contactName");
  if (product && has("quantity", "total") && has("date", "document")) {
    if (concepts.has("supplier") || hint === "purchases") return "purchases";
    return "sales";
  }
  if (product && has("price", "cost", "stock", "unit") && !has("customer", "supplier"))
    return "products";
  if (party && (has("taxId", "email", "phone", "contactRole") || hint)) return "contacts";
  if (hint === "products" && product) return "products";
  return null;
}

/** Propone qué es cada columna y a qué sección pertenece la hoja. El usuario confirma. */
export function analyzeSheet(sheet: ExcelSheetData): SheetAnalysis {
  const headerRow = findHeaderRow(sheet);
  const headerCells = sheet.rows[headerRow] ?? [];
  const headers = headerCells.map(cellString);
  const width = Math.max(headers.length, ...sheet.rows.map((row) => row.length));
  const body = sheet.rows.slice(headerRow + 1).filter((row) => isDataRow(row, headers));
  const proposed = Array.from({ length: width }, (_, index) =>
    classifyColumn(
      index,
      headers[index] || `Columna ${index + 1}`,
      body.slice(0, 200).map((row) => row[index] ?? null),
    ),
  ).filter((column) => headers[column.index] || body.some((row) => cellString(row[column.index])));

  // Cada dato se asigna a una sola columna: se queda la propuesta más segura.
  const owner = new Map<ColumnConcept, ColumnAnalysis>();
  for (const column of [...proposed].sort((left, right) => right.confidence - left.confidence)) {
    if (!column.concept) continue;
    if (owner.has(column.concept)) {
      column.concept = null;
      column.confidence = 0;
      column.evidence = "";
    } else owner.set(column.concept, column);
  }
  const hint = sheetHint(sheet.name);
  const concepts = new Set(owner.keys());
  const kind = isComputedImportSheet(sheet.name) ? null : decideKind(concepts, hint);
  const used = proposed.filter((column) => column.concept);
  const roleDetected =
    concepts.has("contactRole") ||
    hint === "customers" ||
    hint === "suppliers" ||
    concepts.has("customer") !== concepts.has("supplier");
  return {
    sheetName: sheet.name,
    headerRow,
    kind,
    confidence: used.length
      ? used.reduce((sum, column) => sum + column.confidence, 0) / used.length
      : 0,
    columns: proposed,
    contactRole:
      hint === "suppliers" || (concepts.has("supplier") && !concepts.has("customer"))
        ? "proveedor"
        : "cliente",
    roleDetected,
  };
}

export function analyzeWorkbook(workbook: ExcelWorkbookData): SheetAnalysis[] {
  return workbook.sheets.filter((sheet) => sheet.rows.length > 0).map(analyzeSheet);
}

const key = (value: string) => normalizeHeader(value);

function skuFromName(name: string, taken: Set<string>): string {
  const base = `IMP-${key(name).replace(/ /g, "-").toUpperCase().slice(0, 24)}`;
  let sku = base;
  for (let counter = 2; taken.has(sku.toLowerCase()); counter += 1) sku = `${base}-${counter}`;
  taken.add(sku.toLowerCase());
  return sku;
}

function productTypeLabel(value: string, fallback: string): string {
  const text = key(value);
  if (/mater/.test(text)) return "materia prima";
  if (/insumo/.test(text)) return "insumo";
  if (/termin|venta/.test(text)) return "producto terminado";
  return fallback;
}

function roleLabel(value: string, fallback: ContactRoleChoice): ContactRoleChoice {
  const text = key(value);
  if (/ambos|cliente y proveedor/.test(text)) return "ambos";
  if (/prov/.test(text)) return "proveedor";
  if (/clien/.test(text)) return "cliente";
  return fallback;
}

export interface SmartSheetResult {
  sheetName: string;
  moduleId: ImportModuleId;
  rows: PreparedImportRow[];
  records: number;
  newContacts: number;
  newProducts: number;
}

/**
 * Convierte las hojas confirmadas en filas para el importador normal, que hace las validaciones.
 * De las hojas mezcladas saca primero los contactos y productos que las ventas o compras necesitan.
 */
export function buildSmartRows(
  workbook: ExcelWorkbookData,
  analyses: SheetAnalysis[],
  state: AppState,
): SmartSheetResult[] {
  const contacts = new Map<string, string>();
  const products = new Map<string, { sku: string; name: string }>();
  const skus = new Set(state.products.map((product) => product.sku.toLowerCase()));
  for (const contact of state.contacts) contacts.set(key(contact.name), contact.name);
  for (const product of state.products)
    products.set(key(product.name), { sku: product.sku, name: product.name });

  const pick = (analysis: SheetAnalysis, row: ImportCell[]) => {
    const values = new Map<ColumnConcept, ImportCell>();
    const extras: PreparedImportRow["extras"] = [];
    for (const column of analysis.columns) {
      const cell = row[column.index] ?? null;
      if (cellString(cell) === "") continue;
      if (column.concept) values.set(column.concept, cell);
      else
        extras.push({
          fieldName: column.header,
          value: cell instanceof Date ? cell.toISOString() : cell,
        });
    }
    return { values, extras };
  };
  const text = (values: Map<ColumnConcept, ImportCell>, ...concepts: ColumnConcept[]) => {
    for (const concept of concepts) {
      const value = cellString(values.get(concept));
      if (value) return value.replace(/\s+/g, " ");
    }
    return "";
  };
  const dataRows = (analysis: SheetAnalysis, sheet: ExcelSheetData) => {
    const headers = (sheet.rows[analysis.headerRow] ?? []).map(cellString);
    return sheet.rows
      .map((row, index) => ({ row, sourceRow: index + 1 }))
      .slice(analysis.headerRow + 1)
      .filter((item) => isDataRow(item.row, headers));
  };

  const ordered = analyses
    .filter((analysis) => analysis.kind)
    .sort(
      (left, right) =>
        Number(left.kind === "sales" || left.kind === "purchases") -
        Number(right.kind === "sales" || right.kind === "purchases"),
    );
  const results: SmartSheetResult[] = [];
  for (const analysis of ordered) {
    const sheet = workbook.sheets.find((item) => item.name === analysis.sheetName);
    if (!sheet || !analysis.kind) continue;
    const rows: PreparedImportRow[] = [];
    const derived: PreparedImportRow[] = [];
    let newContacts = 0;
    let newProducts = 0;
    const base = (moduleId: ImportModuleId, sourceRow: number) => ({
      moduleId,
      sheetName: sheet.name,
      sourceRow,
    });
    const ensureContact = (
      name: string,
      role: ContactRoleChoice,
      sourceRow: number,
      details: Map<ColumnConcept, ImportCell>,
      ordinaryCustomer = false,
    ) => {
      const existing = contacts.get(key(name));
      if (existing) return existing;
      contacts.set(key(name), name);
      newContacts += 1;
      derived.push({
        ...base("contacts", sourceRow),
        values: {
          name,
          role,
          ordinaryCustomer: ordinaryCustomer ? "si" : "no",
          ...(ordinaryCustomer
            ? {}
            : {
                taxId: text(details, "taxId"),
                email: text(details, "email"),
                phone: text(details, "phone"),
              }),
        },
        extras: [],
      });
      return name;
    };
    const ensureProduct = (
      values: Map<ColumnConcept, ImportCell>,
      type: string,
      sourceRow: number,
      unitCost: number | undefined,
    ) => {
      const name = text(values, "product") || text(values, "sku");
      const known = products.get(key(name));
      if (known) return known;
      const created = {
        sku: text(values, "sku") || skuFromName(name, skus),
        name,
      };
      skus.add(created.sku.toLowerCase());
      products.set(key(name), created);
      newProducts += 1;
      derived.push({
        ...base("products", sourceRow),
        values: {
          sku: created.sku,
          name,
          type,
          unit: text(values, "unit") || "unidad",
          unitPrice: type === "producto terminado" ? (values.get("price") ?? null) : null,
          unitCost: unitCost ?? null,
        },
        extras: [],
      });
      return created;
    };

    for (const { row, sourceRow } of dataRows(analysis, sheet)) {
      const { values, extras } = pick(analysis, row);
      if (analysis.kind === "contacts") {
        const name = text(values, "contactName", "customer", "supplier");
        if (!name) continue;
        if (contacts.has(key(name))) {
          const existing = state.contacts.some((contact) => key(contact.name) === key(name));
          if (!existing) continue;
        }
        contacts.set(key(name), name);
        rows.push({
          ...base("contacts", sourceRow),
          values: {
            name,
            role: roleLabel(text(values, "contactRole"), analysis.contactRole),
            taxId: text(values, "taxId"),
            email: text(values, "email"),
            phone: text(values, "phone"),
          },
          extras,
        });
      } else if (analysis.kind === "products") {
        const name = text(values, "product") || text(values, "sku");
        if (!name) continue;
        const known = products.get(key(name));
        const sku = text(values, "sku") || known?.sku || skuFromName(name, skus);
        skus.add(sku.toLowerCase());
        products.set(key(name), { sku, name: known?.name ?? name });
        rows.push({
          ...base("products", sourceRow),
          values: {
            sku,
            name,
            type: productTypeLabel(text(values, "productType"), "producto terminado"),
            unit: text(values, "unit") || "unidad",
            stock: values.get("stock") ?? null,
            unitCost: values.get("cost") ?? null,
            unitPrice: values.get("price") ?? null,
            vatRate: values.get("vat") ?? null,
          },
          extras,
        });
      } else {
        const sale = analysis.kind === "sales";
        if (!text(values, "product", "sku")) continue;
        const quantity = values.get("quantity") ?? 1;
        const total = parseLocalizedNumber(values.get("total") ?? null);
        const unit = parseLocalizedNumber(
          values.get(sale ? "price" : "cost") ?? values.get("price") ?? null,
        );
        const amount = parseLocalizedNumber(quantity) ?? 1;
        const partyName = text(values, sale ? "customer" : "supplier", "contactName");
        const fallback = sale ? "Cliente de mostrador" : "Proveedor sin identificar";
        const party = ensureContact(
          partyName || fallback,
          sale ? "cliente" : "proveedor",
          sourceRow,
          values,
          sale && !partyName,
        );
        const product = ensureProduct(
          values,
          sale ? "producto terminado" : "materia prima",
          sourceRow,
          sale ? undefined : (unit ?? (total === undefined ? undefined : total / amount)),
        );
        const number =
          text(values, "document") || `IMP-${key(sheet.name).replace(/ /g, "-")}-${sourceRow}`;
        rows.push({
          ...base(sale ? "sales" : "purchases", sourceRow),
          values: sale
            ? {
                number,
                date: values.get("date") ?? null,
                customer: party,
                sku: product.sku,
                productName: product.name,
                quantity,
                unitPrice: values.get("price") ?? null,
                vatRate: values.get("vat") ?? null,
                lineTotal: values.get("total") ?? null,
              }
            : {
                number,
                date: values.get("date") ?? null,
                supplier: party,
                sku: product.sku,
                productName: product.name,
                quantity,
                lineTotal: total ?? (unit === undefined ? null : unit * amount),
                status: "recibida",
                payableReviewStatus: "por revisar",
              },
          extras,
        });
      }
    }
    results.push({
      sheetName: sheet.name,
      moduleId: analysis.kind,
      rows: [...derived, ...rows],
      records: rows.length,
      newContacts,
      newProducts,
    });
  }
  return results;
}
