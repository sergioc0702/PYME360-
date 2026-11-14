import ExcelJS from "exceljs";
import type {
  AppState,
  EnvironmentalRecord,
  Product,
  ProductType,
  ProductionStatus,
  PurchaseStatus,
  ReceiptImport,
} from "../../domain/types";
import { calculateMonthlyEnvironmentalMetrics } from "../../domain/environmental";
import { netSalePaid, netSaleTotal, outstandingBalance } from "../../domain/business";

const EXCEL_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DATE_FORMAT = "dd/mm/yyyy";
const MONEY_FORMAT = "#,##0";
const QUANTITY_FORMAT = "#,##0.00";

interface SheetColumn {
  header: string;
  key: string;
  width: number;
  numberFormat?: string;
}

type SheetCell = string | number | boolean | Date;
type SheetRow = Record<string, SheetCell>;

// Estilos y formato compartido entre las hojas
function addSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: SheetColumn[],
  rows: SheetRow[],
): void {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns.map(({ numberFormat, ...column }) => ({
    ...column,
    ...(numberFormat ? { style: { numFmt: numberFormat } } : {}),
  }));
  sheet.addRows(rows);
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };
  sheet.getRow(1).height = 24;
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1C7C54" },
  };
  sheet.getRow(1).alignment = { vertical: "middle", wrapText: true };
}

function excelDate(value: string): Date | string {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}

function productTypeLabel(type: ProductType): string {
  if (type === "raw_material") return "Materia prima";
  if (type === "supply") return "Insumo";
  return "Producto terminado";
}

function purchaseStatusLabel(status: PurchaseStatus): string {
  return status === "received" ? "Recibida" : "Por recibir";
}

function productionStatusLabel(status: ProductionStatus): string {
  if (status === "completed") return "Completada";
  if (status === "cancelled") return "Cancelada";
  return "En proceso";
}

// Hojas de empresa, contactos, inventario y operaciones
function addCompanySheet(workbook: ExcelJS.Workbook, state: AppState): void {
  addSheet(
    workbook,
    "Empresa",
    [
      { header: "Razón social", key: "name", width: 32 },
      { header: "NIT", key: "taxId", width: 20 },
      { header: "Ciudad", key: "city", width: 22 },
      { header: "Actividad", key: "activity", width: 32 },
    ],
    state.company
      ? [
          {
            name: state.company.name,
            taxId: state.company.taxId,
            city: state.company.city,
            activity: state.company.activity,
          },
        ]
      : [],
  );
}

function addContactsSheet(workbook: ExcelJS.Workbook, state: AppState): void {
  addSheet(
    workbook,
    "Contactos",
    [
      { header: "ID", key: "id", width: 28 },
      { header: "Nombre", key: "name", width: 30 },
      { header: "Tipo", key: "role", width: 24 },
      { header: "Cliente de mostrador", key: "ordinaryCustomer", width: 22 },
      { header: "NIT o cédula", key: "taxId", width: 20 },
      { header: "Correo", key: "email", width: 32 },
      { header: "Teléfono", key: "phone", width: 20 },
      { header: "Tipo de identificación", key: "identificationType", width: 24 },
    ],
    state.contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      role: contact.role,
      ordinaryCustomer: contact.ordinaryCustomer,
      taxId: contact.taxId,
      email: contact.email,
      phone: contact.phone,
      identificationType: contact.identificationType ?? "",
    })),
  );
}

function addProductsAndRecipesSheets(workbook: ExcelJS.Workbook, state: AppState): void {
  const productsById = new Map<string, Product>(
    state.products.map((product) => [product.id, product]),
  );
  addSheet(
    workbook,
    "Inventario",
    [
      { header: "ID", key: "id", width: 28 },
      { header: "SKU", key: "sku", width: 18 },
      { header: "Producto", key: "name", width: 30 },
      { header: "Tipo", key: "type", width: 24 },
      { header: "Unidad", key: "unit", width: 14 },
      { header: "Existencia", key: "stock", width: 16, numberFormat: QUANTITY_FORMAT },
      {
        header: "Existencia mínima",
        key: "minimumStock",
        width: 18,
        numberFormat: QUANTITY_FORMAT,
      },
      { header: "Costo unitario (COP)", key: "unitCost", width: 22, numberFormat: MONEY_FORMAT },
      { header: "Precio unitario (COP)", key: "unitPrice", width: 22, numberFormat: MONEY_FORMAT },
      { header: "IVA (%)", key: "vatRate", width: 12, numberFormat: "0.0" },
      { header: "Clasificación tributaria", key: "taxCategory", width: 24 },
      { header: "Unidad ambiental base", key: "environmentalUnit", width: 22 },
      {
        header: "Factor conversión ambiental",
        key: "environmentalConversionFactor",
        width: 24,
        numberFormat: QUANTITY_FORMAT,
      },
      {
        header: "Contenido reciclado (%)",
        key: "recycledContentPercent",
        width: 22,
        numberFormat: "0.0",
      },
      { header: "Unidad de producción comparable", key: "benchmarkOutputUnit", width: 28 },
      {
        header: "Litros por unidad terminada",
        key: "benchmarkOutputFactor",
        width: 24,
        numberFormat: QUANTITY_FORMAT,
      },
    ],
    state.products.map((product) => ({
      id: product.id,
      sku: product.sku,
      name: product.name,
      type: productTypeLabel(product.type),
      unit: product.unit,
      stock: product.stock,
      minimumStock: product.minimumStock,
      unitCost: product.unitCost,
      unitPrice: product.unitPrice,
      vatRate: product.vatRate,
      taxCategory: product.taxCategory ?? "unclassified",
      environmentalUnit: product.environmentalUnit ?? "",
      environmentalConversionFactor: product.environmentalConversionFactor ?? "",
      recycledContentPercent: product.recycledContentPercent ?? "",
      benchmarkOutputUnit: product.benchmarkOutputUnit ?? "",
      benchmarkOutputFactor: product.benchmarkOutputFactor ?? "",
    })),
  );

  const recipeRows: SheetRow[] = [];
  for (const recipe of state.recipes) {
    const product = productsById.get(recipe.productId);
    for (const version of recipe.versions) {
      for (const component of version.components) {
        const material = productsById.get(component.productId);
        recipeRows.push({
          recipeId: recipe.id,
          versionId: version.id,
          versionNumber: version.versionNumber,
          versionStatus: version.status,
          baseQuantity: version.baseQuantity,
          expectedYieldPercent: version.expectedYieldPercent,
          createdAt: version.createdAt,
          activatedAt: version.activatedAt ?? "",
          productId: recipe.productId,
          productSku: product?.sku ?? "",
          productName: product?.name ?? "Producto eliminado",
          materialProductId: component.productId,
          materialSku: material?.sku ?? "",
          materialName: material?.name ?? "Material eliminado",
          quantity: component.quantity,
          unit: material?.unit ?? "",
        });
      }
    }
  }
  addSheet(
    workbook,
    "Recetas",
    [
      { header: "ID receta", key: "recipeId", width: 28 },
      { header: "ID versión", key: "versionId", width: 30 },
      { header: "Número de versión", key: "versionNumber", width: 18 },
      { header: "Estado de versión", key: "versionStatus", width: 20 },
      { header: "Cantidad base del lote", key: "baseQuantity", width: 22, numberFormat: QUANTITY_FORMAT },
      { header: "Rendimiento esperado (%)", key: "expectedYieldPercent", width: 24, numberFormat: "0.00" },
      { header: "Creada el", key: "createdAt", width: 26 },
      { header: "Activada el", key: "activatedAt", width: 26 },
      { header: "ID producto terminado", key: "productId", width: 28 },
      { header: "SKU producto terminado", key: "productSku", width: 22 },
      { header: "Producto terminado", key: "productName", width: 30 },
      { header: "ID material", key: "materialProductId", width: 28 },
      { header: "SKU material", key: "materialSku", width: 18 },
      { header: "Material", key: "materialName", width: 30 },
      { header: "Cantidad del componente", key: "quantity", width: 24, numberFormat: QUANTITY_FORMAT },
      { header: "Unidad", key: "unit", width: 14 },
    ],
    recipeRows,
  );
}

function addSalesSheets(workbook: ExcelJS.Workbook, state: AppState): void {
  const saleLines: SheetRow[] = [];
  const payments: SheetRow[] = [];
  const returns: SheetRow[] = [];
  const saleRows = state.sales.map((sale) => {
    const paid = sale.payments.reduce((sum, payment) => sum + payment.amount, 0);
    for (const line of sale.lines) {
      saleLines.push({
        saleId: sale.id,
        saleNumber: sale.number,
        date: excelDate(sale.date),
        customer: sale.customerName,
        sku: line.sku,
        product: line.productName,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        vatRate: line.vatRate,
        subtotal: line.subtotal,
        discount: line.discountShare,
        vat: line.vatAmount,
        total: line.total,
        customerId: sale.customerId,
        invoiceFollowUpStatus: sale.invoiceFollowUpStatus,
        externalInvoiceNumber: sale.externalInvoiceNumber,
        externalInvoiceDate: excelDate(sale.externalInvoiceDate),
        dueDate: excelDate(sale.dueDate ?? ""),
      });
    }
    for (const payment of sale.payments) {
      payments.push({
        paymentId: payment.id,
        saleId: sale.id,
        saleNumber: sale.number,
        date: excelDate(payment.date),
        amount: payment.amount,
        method: payment.method,
        accountId: payment.accountId ?? "",
        cashMovementId: payment.cashMovementId ?? "",
      });
    }
    for (const record of sale.returns ?? []) {
      for (const [lineNumber, line] of record.lines.entries()) {
        returns.push({
          returnId: record.id,
          saleNumber: sale.number,
          customer: sale.customerName,
          date: excelDate(record.date),
          reason: record.reason,
          product: sale.lines[line.lineIndex]?.productName ?? "",
          quantity: line.quantity,
          amount: line.amount,
          restock: line.restock ? "Sí" : "No",
          refund: lineNumber === 0 ? record.refund : 0,
          accountId: state.cashMovements.find((item) => item.id === record.cashMovementId)?.accountId ?? "",
          inventoryMovementId: line.inventoryMovementId ?? "",
          cashMovementId: record.cashMovementId ?? "",
        });
      }
    }
    return {
      id: sale.id,
      number: sale.number,
      date: excelDate(sale.date),
      customerId: sale.customerId,
      customer: sale.customerName,
      subtotal: sale.subtotal,
      discount: sale.discount,
      vat: sale.vatAmount,
      total: sale.total,
      paid,
      returned: sale.total - netSaleTotal(sale),
      refunded: paid - netSalePaid(sale),
      balance: outstandingBalance(sale, state.electronicDocuments),
      invoiceFollowUpStatus: sale.invoiceFollowUpStatus,
      externalInvoiceNumber: sale.externalInvoiceNumber,
      externalInvoiceDate: excelDate(sale.externalInvoiceDate),
      dueDate: excelDate(sale.dueDate ?? ""),
    };
  });
  addSheet(
    workbook,
    "Ventas",
    [
      { header: "ID", key: "id", width: 28 },
      { header: "Documento", key: "number", width: 18 },
      { header: "Fecha", key: "date", width: 14, numberFormat: DATE_FORMAT },
      { header: "ID cliente", key: "customerId", width: 28 },
      { header: "Cliente", key: "customer", width: 30 },
      { header: "Subtotal (COP)", key: "subtotal", width: 18, numberFormat: MONEY_FORMAT },
      { header: "Descuento (COP)", key: "discount", width: 18, numberFormat: MONEY_FORMAT },
      { header: "IVA (COP)", key: "vat", width: 16, numberFormat: MONEY_FORMAT },
      { header: "Total (COP)", key: "total", width: 18, numberFormat: MONEY_FORMAT },
      { header: "Pagado (COP)", key: "paid", width: 18, numberFormat: MONEY_FORMAT },
      { header: "Devuelto (COP)", key: "returned", width: 18, numberFormat: MONEY_FORMAT },
      { header: "Reembolsado (COP)", key: "refunded", width: 18, numberFormat: MONEY_FORMAT },
      { header: "Saldo (COP)", key: "balance", width: 18, numberFormat: MONEY_FORMAT },
      { header: "Seguimiento factura", key: "invoiceFollowUpStatus", width: 24 },
      { header: "Número factura externa", key: "externalInvoiceNumber", width: 24 },
      {
        header: "Fecha factura externa",
        key: "externalInvoiceDate",
        width: 23,
        numberFormat: DATE_FORMAT,
      },
      { header: "Vencimiento", key: "dueDate", width: 16, numberFormat: DATE_FORMAT },
    ],
    saleRows,
  );
  addSheet(workbook, "Devoluciones", [
    { header: "ID devolución", key: "returnId", width: 48 },
    { header: "Venta", key: "saleNumber", width: 18 },
    { header: "Cliente", key: "customer", width: 30 },
    { header: "Fecha", key: "date", width: 14, numberFormat: DATE_FORMAT },
    { header: "Motivo", key: "reason", width: 36 },
    { header: "Producto", key: "product", width: 30 },
    { header: "Cantidad", key: "quantity", width: 14, numberFormat: QUANTITY_FORMAT },
    { header: "Valor (COP)", key: "amount", width: 18, numberFormat: MONEY_FORMAT },
    { header: "Reintegrado", key: "restock", width: 15 },
    { header: "Reembolso por devolución (COP)", key: "refund", width: 29, numberFormat: MONEY_FORMAT },
    { header: "Cuenta del reembolso", key: "accountId", width: 29 },
    { header: "ID movimiento inventario", key: "inventoryMovementId", width: 48 },
    { header: "ID movimiento caja", key: "cashMovementId", width: 48 },
  ], returns);
  addSheet(
    workbook,
    "Detalle ventas",
    [
      { header: "ID venta", key: "saleId", width: 28 },
      { header: "Documento", key: "saleNumber", width: 18 },
      { header: "Fecha", key: "date", width: 14, numberFormat: DATE_FORMAT },
      { header: "Cliente", key: "customer", width: 28 },
      { header: "SKU", key: "sku", width: 18 },
      { header: "Producto", key: "product", width: 30 },
      { header: "Cantidad", key: "quantity", width: 14, numberFormat: QUANTITY_FORMAT },
      { header: "Precio unitario (COP)", key: "unitPrice", width: 22, numberFormat: MONEY_FORMAT },
      { header: "IVA (%)", key: "vatRate", width: 12, numberFormat: "0.0" },
      { header: "Subtotal (COP)", key: "subtotal", width: 18, numberFormat: MONEY_FORMAT },
      {
        header: "Descuento asignado (COP)",
        key: "discount",
        width: 25,
        numberFormat: MONEY_FORMAT,
      },
      { header: "IVA (COP)", key: "vat", width: 16, numberFormat: MONEY_FORMAT },
      { header: "Total (COP)", key: "total", width: 18, numberFormat: MONEY_FORMAT },
      { header: "ID cliente", key: "customerId", width: 28 },
      { header: "Seguimiento factura", key: "invoiceFollowUpStatus", width: 24 },
      { header: "Número factura externa", key: "externalInvoiceNumber", width: 24 },
      {
        header: "Fecha factura externa",
        key: "externalInvoiceDate",
        width: 23,
        numberFormat: DATE_FORMAT,
      },
      { header: "Vencimiento", key: "dueDate", width: 16, numberFormat: DATE_FORMAT },
    ],
    saleLines,
  );
  addSheet(
    workbook,
    "Abonos",
    [
      { header: "ID abono", key: "paymentId", width: 28 },
      { header: "ID venta", key: "saleId", width: 28 },
      { header: "Documento", key: "saleNumber", width: 18 },
      { header: "Fecha", key: "date", width: 14, numberFormat: DATE_FORMAT },
      { header: "Valor (COP)", key: "amount", width: 18, numberFormat: MONEY_FORMAT },
      { header: "Medio de pago", key: "method", width: 20 },
      { header: "ID cuenta", key: "accountId", width: 28 },
      { header: "ID movimiento caja", key: "cashMovementId", width: 30 },
    ],
    payments,
  );
}

function addPurchasesSheets(workbook: ExcelJS.Workbook, state: AppState): void {
  const purchaseLines: SheetRow[] = [];
  const purchasePayments: SheetRow[] = [];
  const purchaseRows = state.purchases.map((purchase) => {
    for (const line of purchase.lines) {
      purchaseLines.push({
        purchaseId: purchase.id,
        purchaseNumber: purchase.number,
        date: excelDate(purchase.date),
        supplier: purchase.supplierName,
        sku: line.sku,
        product: line.productName,
        quantity: line.quantity,
        environmentalUnit: line.environmentalUnit ?? "",
        environmentalConversionFactor: line.environmentalConversionFactor ?? "",
        recycledContentPercent: line.recycledContentPercent ?? "",
        lineTotal: line.lineTotal,
        supplierId: purchase.supplierId,
        status: purchase.status,
        dueDate: excelDate(purchase.dueDate ?? ""),
        payableReviewStatus: purchase.payableReviewStatus,
        payableAmount: purchase.payableAmount ?? "",
      });
    }
    for (const payment of purchase.payments) {
      purchasePayments.push({
        paymentId: payment.id,
        purchaseId: purchase.id,
        purchaseNumber: purchase.number,
        date: excelDate(payment.date),
        amount: payment.amount,
        method: payment.method,
        accountId: payment.accountId ?? "",
        cashMovementId: payment.cashMovementId ?? "",
      });
    }
    return {
      id: purchase.id,
      number: purchase.number,
      date: excelDate(purchase.date),
      supplierId: purchase.supplierId,
      supplier: purchase.supplierName,
      status: purchaseStatusLabel(purchase.status),
      total: purchase.total,
      dueDate: excelDate(purchase.dueDate ?? ""),
      payableReviewStatus: purchase.payableReviewStatus,
      payableAmount: purchase.payableAmount ?? "",
    };
  });
  addSheet(
    workbook,
    "Compras",
    [
      { header: "ID", key: "id", width: 28 },
      { header: "Documento", key: "number", width: 18 },
      { header: "Fecha", key: "date", width: 14, numberFormat: DATE_FORMAT },
      { header: "ID proveedor", key: "supplierId", width: 28 },
      { header: "Proveedor", key: "supplier", width: 30 },
      { header: "Estado", key: "status", width: 18 },
      { header: "Total (COP)", key: "total", width: 18, numberFormat: MONEY_FORMAT },
      { header: "Vencimiento", key: "dueDate", width: 16, numberFormat: DATE_FORMAT },
      { header: "Estado cuenta por pagar", key: "payableReviewStatus", width: 24 },
      {
        header: "Saldo inicial por pagar (COP)",
        key: "payableAmount",
        width: 26,
        numberFormat: MONEY_FORMAT,
      },
    ],
    purchaseRows,
  );
  addSheet(
    workbook,
    "Detalle compras",
    [
      { header: "ID compra", key: "purchaseId", width: 28 },
      { header: "Documento", key: "purchaseNumber", width: 18 },
      { header: "Fecha", key: "date", width: 14, numberFormat: DATE_FORMAT },
      { header: "Proveedor", key: "supplier", width: 30 },
      { header: "SKU", key: "sku", width: 18 },
      { header: "Producto", key: "product", width: 30 },
      { header: "Cantidad", key: "quantity", width: 14, numberFormat: QUANTITY_FORMAT },
      { header: "Unidad ambiental", key: "environmentalUnit", width: 20 },
      {
        header: "Conversión ambiental",
        key: "environmentalConversionFactor",
        width: 22,
        numberFormat: QUANTITY_FORMAT,
      },
      { header: "Reciclado (%)", key: "recycledContentPercent", width: 16, numberFormat: "0.0" },
      { header: "Valor de línea (COP)", key: "lineTotal", width: 22, numberFormat: MONEY_FORMAT },
      { header: "ID proveedor", key: "supplierId", width: 28 },
      { header: "Estado compra", key: "status", width: 18 },
      { header: "Vencimiento", key: "dueDate", width: 16, numberFormat: DATE_FORMAT },
      { header: "Estado cuenta por pagar", key: "payableReviewStatus", width: 24 },
      {
        header: "Saldo inicial por pagar (COP)",
        key: "payableAmount",
        width: 26,
        numberFormat: MONEY_FORMAT,
      },
    ],
    purchaseLines,
  );
  addSheet(
    workbook,
    "Pagos de compras",
    [
      { header: "ID pago", key: "paymentId", width: 28 },
      { header: "ID compra", key: "purchaseId", width: 28 },
      { header: "Documento", key: "purchaseNumber", width: 18 },
      { header: "Fecha", key: "date", width: 14, numberFormat: DATE_FORMAT },
      { header: "Valor (COP)", key: "amount", width: 18, numberFormat: MONEY_FORMAT },
      { header: "Medio de pago", key: "method", width: 20 },
      { header: "ID cuenta", key: "accountId", width: 28 },
      { header: "ID movimiento caja", key: "cashMovementId", width: 30 },
    ],
    purchasePayments,
  );
}

function addInventoryAndFinanceSheets(workbook: ExcelJS.Workbook, state: AppState): void {
  addSheet(
    workbook,
    "Movimientos inventario",
    [
      { header: "ID", key: "id", width: 28 },
      { header: "Fecha", key: "date", width: 22 },
      { header: "ID producto", key: "productId", width: 28 },
      { header: "SKU", key: "sku", width: 16 },
      { header: "Producto", key: "product", width: 28 },
      { header: "Tipo", key: "type", width: 22 },
      { header: "Cantidad (+/-)", key: "quantity", width: 19, numberFormat: QUANTITY_FORMAT },
      { header: "Saldo después", key: "balanceAfter", width: 18, numberFormat: QUANTITY_FORMAT },
      { header: "Unidad", key: "unit", width: 14 },
      { header: "Motivo", key: "reason", width: 38 },
      { header: "Origen", key: "sourceType", width: 18 },
      { header: "ID origen", key: "sourceId", width: 28 },
      { header: "Revierte movimiento", key: "reversesMovementId", width: 28 },
      { header: "Creado", key: "createdAt", width: 24 },
    ],
    state.inventoryMovements.map((movement) => ({
      id: movement.id,
      date: movement.occurredAt,
      productId: movement.productId,
      sku: movement.sku,
      product: movement.productName,
      type: movement.movementType,
      quantity: movement.quantity,
      balanceAfter: movement.balanceAfter,
      unit: movement.unit,
      reason: movement.reason,
      sourceType: movement.sourceType ?? "",
      sourceId: movement.sourceId ?? "",
      reversesMovementId: movement.reversesMovementId ?? "",
      createdAt: movement.createdAt,
    })),
  );

  const accountName = (accountId?: string) =>
    state.financialAccounts.find((account) => account.id === accountId)?.name ?? "Sin asignar";
  addSheet(
    workbook,
    "Cuentas",
    [
      { header: "ID", key: "id", width: 28 },
      { header: "Nombre", key: "name", width: 28 },
      { header: "Tipo", key: "type", width: 16 },
      {
        header: "Saldo inicial (COP)",
        key: "openingBalance",
        width: 21,
        numberFormat: MONEY_FORMAT,
      },
      { header: "Saldo actual (COP)", key: "balance", width: 21, numberFormat: MONEY_FORMAT },
      { header: "Estado", key: "active", width: 14 },
      { header: "Creada", key: "createdAt", width: 24 },
    ],
    state.financialAccounts.map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type === "cash" ? "Caja" : "Banco",
      openingBalance: account.openingBalance,
      balance:
        account.openingBalance +
        state.cashMovements
          .filter((movement) => movement.accountId === account.id)
          .reduce(
            (sum, movement) =>
              sum + (movement.direction === "in" ? movement.amount : -movement.amount),
            0,
          ),
      active: account.active ? "Activa" : "Inactiva",
      createdAt: account.createdAt,
    })),
  );

  addSheet(
    workbook,
    "Caja y bancos",
    [
      { header: "ID", key: "id", width: 28 },
      { header: "Fecha", key: "date", width: 14, numberFormat: DATE_FORMAT },
      { header: "Cuenta", key: "account", width: 26 },
      { header: "Dirección", key: "direction", width: 16 },
      { header: "Valor (COP)", key: "amount", width: 18, numberFormat: MONEY_FORMAT },
      { header: "Valor firmado (COP)", key: "signedAmount", width: 22, numberFormat: MONEY_FORMAT },
      { header: "Medio", key: "method", width: 18 },
      { header: "Categoría", key: "category", width: 25 },
      { header: "Descripción", key: "description", width: 38 },
      { header: "Origen", key: "sourceType", width: 16 },
      { header: "ID origen", key: "sourceId", width: 28 },
      { header: "Revierte movimiento", key: "reversesMovementId", width: 28 },
      { header: "Pendiente de asignar", key: "legacyUnassigned", width: 20 },
      { header: "ID cuenta", key: "accountId", width: 28 },
    ],
    state.cashMovements.map((movement) => ({
      id: movement.id,
      date: excelDate(movement.date),
      account: accountName(movement.accountId),
      direction: movement.direction === "in" ? "Ingreso" : "Egreso",
      amount: movement.amount,
      signedAmount: movement.direction === "in" ? movement.amount : -movement.amount,
      method: movement.method,
      category: movement.category,
      description: movement.description,
      sourceType: movement.sourceType ?? "",
      sourceId: movement.sourceId ?? "",
      reversesMovementId: movement.reversesMovementId ?? "",
      legacyUnassigned: movement.legacyUnassigned ? "Sí" : "No",
      accountId: movement.accountId ?? "",
    })),
  );

  addSheet(
    workbook,
    "Cuentas por cobrar",
    [
      { header: "ID venta", key: "id", width: 28 },
      { header: "Documento", key: "number", width: 18 },
      { header: "Cliente", key: "customer", width: 30 },
      { header: "Fecha", key: "date", width: 14, numberFormat: DATE_FORMAT },
      { header: "Vencimiento", key: "dueDate", width: 16, numberFormat: DATE_FORMAT },
      { header: "Total (COP)", key: "total", width: 18, numberFormat: MONEY_FORMAT },
      { header: "Abonado (COP)", key: "paid", width: 18, numberFormat: MONEY_FORMAT },
      { header: "Saldo (COP)", key: "balance", width: 18, numberFormat: MONEY_FORMAT },
    ],
    state.sales.map((sale) => {
      return {
        id: sale.id,
        number: sale.number,
        customer: sale.customerName,
        date: excelDate(sale.date),
        dueDate: excelDate(sale.dueDate ?? ""),
        total: netSaleTotal(sale),
        paid: netSalePaid(sale),
        balance: outstandingBalance(sale, state.electronicDocuments),
      };
    }),
  );

  addSheet(
    workbook,
    "Cuentas por pagar",
    [
      { header: "ID compra", key: "id", width: 28 },
      { header: "Documento", key: "number", width: 18 },
      { header: "Proveedor", key: "supplier", width: 30 },
      { header: "Fecha", key: "date", width: 14, numberFormat: DATE_FORMAT },
      { header: "Vencimiento", key: "dueDate", width: 16, numberFormat: DATE_FORMAT },
      { header: "Total (COP)", key: "total", width: 18, numberFormat: MONEY_FORMAT },
      { header: "Pagado (COP)", key: "paid", width: 18, numberFormat: MONEY_FORMAT },
      { header: "Saldo reconocido (COP)", key: "balance", width: 24, numberFormat: MONEY_FORMAT },
      { header: "Estado", key: "status", width: 20 },
    ],
    state.purchases.map((purchase) => {
      const paid = purchase.payments.reduce((sum, payment) => sum + payment.amount, 0);
      const underReview = purchase.payableReviewStatus === "review_required";
      const received = purchase.status === "received";
      return {
        id: purchase.id,
        number: purchase.number,
        supplier: purchase.supplierName,
        date: excelDate(purchase.date),
        dueDate: excelDate(purchase.dueDate ?? ""),
        total: purchase.total,
        paid,
        balance:
          underReview || !received
            ? ""
            : Math.max(0, (purchase.payableAmount ?? purchase.total) - paid),
        status: underReview ? "Por revisar" : !received ? "Por recibir" : "Confirmada",
      };
    }),
  );
}

function addProductionSheets(workbook: ExcelJS.Workbook, state: AppState): void {
  const consumedMaterials: SheetRow[] = [];
  const orderRows = state.productionOrders.map((order) => {
    for (const material of order.consumedMaterials) {
      consumedMaterials.push({
        orderId: order.id,
        orderNumber: order.number,
        orderDate: excelDate(order.date),
        productName: order.productName,
        sku: material.sku,
        materialName: material.productName,
        quantity: material.quantity,
        actualQuantity: material.actualQuantity ?? "",
        environmentalUnit: material.environmentalUnit ?? "",
        environmentalConversionFactor: material.environmentalConversionFactor ?? "",
        materialProductId: material.productId,
        unitCostSnapshot: material.unitCostSnapshot ?? "",
        lineCostSnapshot: material.lineCostSnapshot ?? "",
      });
    }
    return {
      id: order.id,
      number: order.number,
      date: excelDate(order.date),
      productId: order.productId,
      product: order.productName,
      quantity: order.quantity,
      wasteQuantity: order.wasteQuantity,
      estimatedMaterialCost: order.estimatedMaterialCost ?? "",
      materialCostPerGoodUnit: order.materialCostPerGoodUnit ?? "",
      laborHours: order.laborHours ?? "",
      laborHourlyRate: order.laborHourlyRate ?? "",
      energyCost: order.energyCost ?? "",
      overheadCost: order.overheadCost ?? "",
      recipeVersionId: order.recipeVersionId ?? "",
      recipeVersionNumber: order.recipeVersionNumber ?? "",
      expectedYieldPercent: order.expectedYieldPercent ?? "",
      expectedGoodOutputQuantity: order.expectedGoodOutputQuantity ?? "",
      status: productionStatusLabel(order.status),
      completedAt: excelDate(order.completedAt),
    };
  });
  addSheet(
    workbook,
    "Producción",
    [
      { header: "ID", key: "id", width: 28 },
      { header: "Orden", key: "number", width: 18 },
      { header: "Fecha", key: "date", width: 14, numberFormat: DATE_FORMAT },
      { header: "ID producto", key: "productId", width: 28 },
      { header: "Producto terminado", key: "product", width: 30 },
      { header: "Cantidad", key: "quantity", width: 14, numberFormat: QUANTITY_FORMAT },
      { header: "Desperdicio", key: "wasteQuantity", width: 16, numberFormat: QUANTITY_FORMAT },
      { header: "Costo estimado materiales COP", key: "estimatedMaterialCost", width: 26, numberFormat: MONEY_FORMAT },
      { header: "Costo materiales por unidad buena COP", key: "materialCostPerGoodUnit", width: 34, numberFormat: MONEY_FORMAT },
      { header: "Horas trabajadas", key: "laborHours", width: 18, numberFormat: "0.00" },
      { header: "Costo por hora COP", key: "laborHourlyRate", width: 20, numberFormat: MONEY_FORMAT },
      { header: "Energía asignada COP", key: "energyCost", width: 22, numberFormat: MONEY_FORMAT },
      { header: "Otros costos de la orden COP", key: "overheadCost", width: 28, numberFormat: MONEY_FORMAT },
      { header: "ID versión de receta", key: "recipeVersionId", width: 30 },
      { header: "Número de versión de receta", key: "recipeVersionNumber", width: 26, numberFormat: "0" },
      { header: "Rendimiento esperado (%)", key: "expectedYieldPercent", width: 24, numberFormat: "0.00" },
      { header: "Salida buena esperada", key: "expectedGoodOutputQuantity", width: 24, numberFormat: QUANTITY_FORMAT },
      { header: "Estado", key: "status", width: 18 },
      { header: "Fecha de cierre", key: "completedAt", width: 18, numberFormat: DATE_FORMAT },
    ],
    orderRows,
  );
  addSheet(
    workbook,
    "Consumo producción",
    [
      { header: "ID orden", key: "orderId", width: 28 },
      { header: "Orden", key: "orderNumber", width: 18 },
      { header: "Fecha", key: "orderDate", width: 14, numberFormat: DATE_FORMAT },
      { header: "Producto fabricado", key: "productName", width: 30 },
      { header: "SKU material", key: "sku", width: 18 },
      { header: "ID material", key: "materialProductId", width: 28 },
      { header: "Material", key: "materialName", width: 30 },
      { header: "Cantidad consumida", key: "quantity", width: 22, numberFormat: QUANTITY_FORMAT },
      { header: "Cantidad real consumida", key: "actualQuantity", width: 24, numberFormat: QUANTITY_FORMAT },
      { header: "Unidad ambiental", key: "environmentalUnit", width: 20 },
      {
        header: "Conversión ambiental",
        key: "environmentalConversionFactor",
        width: 22,
        numberFormat: QUANTITY_FORMAT,
      },
      { header: "Costo unitario snapshot COP", key: "unitCostSnapshot", width: 28, numberFormat: MONEY_FORMAT },
      { header: "Costo línea snapshot COP", key: "lineCostSnapshot", width: 25, numberFormat: MONEY_FORMAT },
    ],
    consumedMaterials,
  );
}

function addEnvironmentalSheet(workbook: ExcelJS.Workbook, records: EnvironmentalRecord[]): void {
  addSheet(
    workbook,
    "Impacto ambiental",
    [
      { header: "ID", key: "id", width: 28 },
      { header: "Período", key: "period", width: 14 },
      { header: "Energía (kWh)", key: "electricityKwh", width: 18, numberFormat: QUANTITY_FORMAT },
      { header: "Agua (m³)", key: "waterM3", width: 16, numberFormat: QUANTITY_FORMAT },
      { header: "Combustible (L)", key: "fuelLiters", width: 18, numberFormat: QUANTITY_FORMAT },
      {
        header: "Producción (unidades)",
        key: "productionUnits",
        width: 23,
        numberFormat: QUANTITY_FORMAT,
      },
      { header: "Residuos (kg)", key: "wasteKg", width: 17, numberFormat: QUANTITY_FORMAT },
      { header: "Recuperado (kg)", key: "recoveredKg", width: 19, numberFormat: QUANTITY_FORMAT },
      { header: "Fuente", key: "source", width: 18 },
      { header: "ID recibo", key: "receiptImportId", width: 28 },
      { header: "Actualizado", key: "lastUpdatedAt", width: 24 },
      {
        header: "Energía por unidad (kWh/u)",
        key: "electricityPerUnit",
        width: 27,
        numberFormat: QUANTITY_FORMAT,
      },
      {
        header: "Agua por unidad (m³/u)",
        key: "waterPerUnit",
        width: 24,
        numberFormat: QUANTITY_FORMAT,
      },
      { header: "Origen", key: "sourceLabel", width: 26 },
    ],
    records.map((record) => ({
      ...record,
      electricityPerUnit:
        record.productionUnits > 0 ? record.electricityKwh / record.productionUnits : "",
      waterPerUnit: record.productionUnits > 0 ? record.waterM3 / record.productionUnits : "",
      source: record.source ?? "manual",
      receiptImportId: record.receiptImportId ?? "",
      lastUpdatedAt: record.lastUpdatedAt ?? "",
    })),
  );
}

function addReceiptSheet(workbook: ExcelJS.Workbook, receipts: ReceiptImport[]): void {
  addSheet(
    workbook,
    "Recibos ambientales",
    [
      { header: "ID", key: "id", width: 28 },
      { header: "Archivo", key: "fileName", width: 34 },
      { header: "Fecha de importación", key: "importedAt", width: 24 },
      { header: "Proveedor", key: "provider", width: 24 },
      { header: "Cuenta", key: "accountNumber", width: 22 },
      { header: "Período", key: "period", width: 14 },
      { header: "Estado", key: "status", width: 16 },
      { header: "Recurso", key: "resource", width: 20 },
      { header: "Cantidad", key: "quantity", width: 18, numberFormat: QUANTITY_FORMAT },
      { header: "Unidad", key: "unit", width: 14 },
      {
        header: "Valor facturado (COP)",
        key: "billedAmount",
        width: 22,
        numberFormat: MONEY_FORMAT,
      },
      { header: "Factura", key: "invoiceNumber", width: 22 },
      { header: "Confianza", key: "confidence", width: 14, numberFormat: "0.0%" },
      { header: "Origen", key: "source", width: 18 },
      { header: "Huella del archivo", key: "fileHash", width: 32 },
      { header: "Advertencias", key: "warnings", width: 48 },
    ],
    receipts.map((receipt) => ({
      id: receipt.id,
      fileName: receipt.fileName,
      importedAt: receipt.importedAt,
      provider: receipt.provider,
      accountNumber: receipt.accountNumber ?? "",
      period: receipt.extraction.period,
      status: receipt.status,
      resource: receipt.extraction.resource ?? "Histórico sin clasificar",
      quantity:
        receipt.extraction.quantity ??
        receipt.extraction.electricityKwh ??
        receipt.extraction.waterM3 ??
        receipt.extraction.fuelLiters ??
        "",
      unit: receipt.extraction.unit ?? "",
      billedAmount: receipt.extraction.billedAmount,
      invoiceNumber: receipt.extraction.invoiceNumber,
      confidence: receipt.extraction.confidence,
      source: receipt.source,
      fileHash: receipt.fileHash ?? "",
      warnings: receipt.extraction.warnings.join(" | "),
    })),
  );
}

function addEnvironmentalConfigSheet(workbook: ExcelJS.Workbook, state: AppState): void {
  const config = state.environmentalConfig;
  addSheet(
    workbook,
    "Configuración ambiental",
    [
      { header: "ID proveedor", key: "providerId", width: 22 },
      { header: "Proveedor", key: "providerName", width: 28 },
      { header: "Cuenta", key: "accountNumber", width: 24 },
      { header: "Unidad de negocio", key: "businessUnit", width: 28 },
      { header: "Geografía", key: "geography", width: 24 },
      { header: "País de referencia", key: "benchmarkCountryCode", width: 20 },
      { header: "Región de referencia", key: "benchmarkRegion", width: 24 },
      { header: "Sector CIIU", key: "benchmarkSectorCode", width: 18 },
      { header: "Unidad de producción", key: "benchmarkOutputUnit", width: 22 },
      { header: "Producción mensual ilustrativa", key: "assumedMonthlyOutput", width: 30 },
      { header: "Fuentes preferidas", key: "benchmarkPreferredSources", width: 44 },
    ],
    config
      ? [
          {
            providerId: config.providerId,
            providerName: config.providerName,
            accountNumber: config.accountNumber,
            businessUnit: config.businessUnit,
            geography: config.geography ?? "",
            benchmarkCountryCode: config.benchmarking.countryCode,
            benchmarkRegion: config.benchmarking.region,
            benchmarkSectorCode: config.benchmarking.sectorCode,
            benchmarkOutputUnit: config.benchmarking.outputUnit,
            assumedMonthlyOutput: config.benchmarking.assumedMonthlyOutput,
            benchmarkPreferredSources: config.benchmarking.preferredSources.join(", "),
          },
        ]
      : [],
  );
}

function addElectronicInvoicingSheets(workbook: ExcelJS.Workbook, state: AppState): void {
  const tax = state.taxConfiguration;
  addSheet(
    workbook,
    "Configuración tributaria",
    [
      { header: "País", key: "countryCode", width: 14 },
      { header: "Moneda", key: "currency", width: 14 },
      { header: "Dirección fiscal", key: "legalAddress", width: 36 },
      { header: "Correo de facturación", key: "invoiceEmail", width: 32 },
      { header: "Régimen", key: "taxRegime", width: 24 },
      { header: "Responsabilidades", key: "taxResponsibilities", width: 36 },
      { header: "ID proveedor", key: "providerId", width: 24 },
      { header: "Ambiente", key: "environment", width: 16 },
      { header: "Resolución", key: "resolutionNumber", width: 24 },
      { header: "Prefijo", key: "prefix", width: 14 },
      { header: "Rango desde", key: "rangeFrom", width: 16 },
      { header: "Rango hasta", key: "rangeTo", width: 16 },
      { header: "Vigencia desde", key: "validFrom", width: 18 },
      { header: "Vigencia hasta", key: "validTo", width: 18 },
      { header: "Prefijo contingencia", key: "contingencyPrefix", width: 22 },
      { header: "Contingencia desde", key: "contingencyRangeFrom", width: 22 },
      { header: "Contingencia hasta", key: "contingencyRangeTo", width: 22 },
    ],
    [
      {
        ...tax,
        taxResponsibilities: tax.taxResponsibilities.join(", "),
        rangeFrom: tax.rangeFrom ?? "",
        rangeTo: tax.rangeTo ?? "",
        contingencyRangeFrom: tax.contingencyRangeFrom ?? "",
        contingencyRangeTo: tax.contingencyRangeTo ?? "",
      },
    ],
  );
  addSheet(
    workbook,
    "Documentos electrónicos",
    [
      { header: "ID", key: "id", width: 30 },
      { header: "Tipo", key: "kind", width: 18 },
      { header: "Estado", key: "status", width: 22 },
      { header: "ID venta", key: "saleId", width: 30 },
      { header: "Documento relacionado", key: "relatedDocumentId", width: 30 },
      { header: "Número", key: "documentNumber", width: 20 },
      { header: "Proveedor", key: "providerId", width: 24 },
      { header: "Ambiente", key: "environment", width: 16 },
      { header: "Referencia proveedor", key: "providerReference", width: 30 },
      { header: "CUFE", key: "cufe", width: 50 },
      { header: "Fecha borrador", key: "createdAt", width: 28 },
      { header: "Creado por", key: "createdBy", width: 24 },
      { header: "Validaciones", key: "validationIssues", width: 52 },
      { header: "Mensaje DIAN/proveedor", key: "validationMessage", width: 50 },
      { header: "Motivo de ajuste", key: "adjustmentReason", width: 40 },
      { header: "Valor de ajuste", key: "adjustmentAmount", width: 20, numberFormat: MONEY_FORMAT },
      { header: "Instantánea (JSON)", key: "snapshot", width: 70 },
      { header: "Intentos (JSON)", key: "attempts", width: 60 },
    ],
    state.electronicDocuments.map((document) => ({
      ...document,
      relatedDocumentId: document.relatedDocumentId ?? "",
      documentNumber: document.documentNumber ?? "",
      providerId: document.providerId ?? "",
      environment: document.environment ?? "",
      providerReference: document.providerReference ?? "",
      cufe: document.cufe ?? "",
      validationIssues: document.validationIssues.join(" | "),
      validationMessage: document.validationMessage ?? "",
      adjustmentReason: document.adjustmentReason ?? "",
      adjustmentAmount: document.adjustmentAmount ?? "",
      snapshot: JSON.stringify(document.snapshot),
      attempts: JSON.stringify(document.attempts),
    })),
  );
  addSheet(
    workbook,
    "Facturas proveedores XML",
    [
      { header: "ID", key: "id", width: 30 },
      { header: "Archivo (nombre)", key: "fileName", width: 32 },
      { header: "Importada", key: "importedAt", width: 28 },
      { header: "Factura", key: "documentNumber", width: 20 },
      { header: "Proveedor", key: "supplierName", width: 32 },
      { header: "NIT proveedor", key: "supplierTaxId", width: 20 },
      { header: "NIT adquirente", key: "buyerTaxId", width: 20 },
      { header: "Fecha emisión", key: "issueDate", width: 18 },
      { header: "Vencimiento", key: "dueDate", width: 18 },
      { header: "Moneda", key: "currency", width: 14 },
      { header: "Impuestos", key: "taxAmount", width: 18, numberFormat: MONEY_FORMAT },
      { header: "Total", key: "total", width: 18, numberFormat: MONEY_FORMAT },
      { header: "ID compra", key: "purchaseId", width: 30 },
      { header: "ID contacto", key: "supplierContactId", width: 30 },
      { header: "Estado", key: "status", width: 20 },
      { header: "Líneas (JSON)", key: "lines", width: 70 },
    ],
    state.supplierInvoices.map((invoice) => ({
      ...invoice,
      dueDate: invoice.dueDate ? excelDate(invoice.dueDate) : "",
      purchaseId: invoice.purchaseId ?? "",
      supplierContactId: invoice.supplierContactId ?? "",
      lines: JSON.stringify(invoice.lines),
    })),
  );
}

function addImportExtrasSheet(workbook: ExcelJS.Workbook, state: AppState): void {
  addSheet(
    workbook,
    "Datos adicionales",
    [
      { header: "ID", key: "id", width: 28 },
      { header: "Entidad", key: "entityType", width: 24 },
      { header: "ID del registro", key: "entityId", width: 30 },
      { header: "Campo original", key: "fieldName", width: 32 },
      { header: "Valor", key: "value", width: 40 },
      { header: "Hoja de origen", key: "sourceSheet", width: 24 },
    ],
    state.importExtras.map((extra) => ({ ...extra, value: extra.value ?? "" })),
  );
}

// Ensamblado del libro completo. Separado de la descarga para facilitar su validación y reutilización.
export function buildExcelWorkbook(state: AppState): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = state.company?.name || "Pyme360";
  workbook.subject = "Datos guardados por módulo";
  workbook.title = "Respaldo de datos Pyme360";
  workbook.created = new Date();

  addCompanySheet(workbook, state);
  addContactsSheet(workbook, state);
  addProductsAndRecipesSheets(workbook, state);
  addSalesSheets(workbook, state);
  addPurchasesSheets(workbook, state);
  addInventoryAndFinanceSheets(workbook, state);
  addProductionSheets(workbook, state);
  addEnvironmentalSheet(workbook, state.environmentalRecords);
  addReceiptSheet(workbook, state.receiptImports);
  addEnvironmentalConfigSheet(workbook, state);
  addElectronicInvoicingSheets(workbook, state);
  addImportExtrasSheet(workbook, state);
  addSheet(
    workbook,
    "Indicadores ambientales",
    [
      { header: "Período", key: "period", width: 14 },
      {
        header: "Electricidad (kWh)",
        key: "electricityKwh",
        width: 20,
        numberFormat: QUANTITY_FORMAT,
      },
      {
        header: "Intensidad energía (kWh/unidad)",
        key: "energyPerUnit",
        width: 28,
        numberFormat: QUANTITY_FORMAT,
      },
      {
        header: "Agua retirada (m³)",
        key: "waterWithdrawalM3",
        width: 20,
        numberFormat: QUANTITY_FORMAT,
      },
      {
        header: "Agua descargada (m³)",
        key: "waterDischargeM3",
        width: 21,
        numberFormat: QUANTITY_FORMAT,
      },
      {
        header: "Agua neta (m³)",
        key: "waterConsumptionM3",
        width: 18,
        numberFormat: QUANTITY_FORMAT,
      },
      {
        header: "Intensidad agua (m³/unidad)",
        key: "waterPerUnit",
        width: 26,
        numberFormat: QUANTITY_FORMAT,
      },
      {
        header: "Material consumido (kg)",
        key: "materialConsumedKg",
        width: 23,
        numberFormat: QUANTITY_FORMAT,
      },
      {
        header: "Material (kg/unidad)",
        key: "materialPerUnit",
        width: 22,
        numberFormat: QUANTITY_FORMAT,
      },
      {
        header: "Material reciclado (%)",
        key: "recycledMaterialPercent",
        width: 22,
        numberFormat: QUANTITY_FORMAT,
      },
      {
        header: "Residuos generados (kg)",
        key: "wasteGeneratedKg",
        width: 23,
        numberFormat: QUANTITY_FORMAT,
      },
      {
        header: "Residuos recuperados (kg)",
        key: "wasteRecoveredKg",
        width: 24,
        numberFormat: QUANTITY_FORMAT,
      },
      {
        header: "Recuperación (%)",
        key: "wasteRecoveryPercent",
        width: 18,
        numberFormat: QUANTITY_FORMAT,
      },
      {
        header: "Alcance 1 (kg CO₂e)",
        key: "scope1KgCo2e",
        width: 20,
        numberFormat: QUANTITY_FORMAT,
      },
      { header: "Factor(es) Alcance 1", key: "scope1Factors", width: 32 },
      {
        header: "Alcance 2 (kg CO₂e)",
        key: "scope2KgCo2e",
        width: 20,
        numberFormat: QUANTITY_FORMAT,
      },
      { header: "Factor(es) Alcance 2", key: "scope2Factors", width: 32 },
      {
        header: "Alcance 3 (kg CO₂e)",
        key: "scope3KgCo2e",
        width: 20,
        numberFormat: QUANTITY_FORMAT,
      },
      { header: "Categorías Alcance 3", key: "scope3Categories", width: 30 },
      { header: "Factor(es) Alcance 3", key: "scope3Factors", width: 32 },
      {
        header: "Cobertura (%)",
        key: "dataCoveragePercent",
        width: 16,
        numberFormat: QUANTITY_FORMAT,
      },
      { header: "Lecturas", key: "readingCount", width: 12, numberFormat: "0" },
      { header: "Lecturas estimadas", key: "estimatedReadingCount", width: 20, numberFormat: "0" },
      { header: "Última lectura", key: "latestReadingAt", width: 24 },
    ],
    calculateMonthlyEnvironmentalMetrics(state).map((metrics) => ({
      period: metrics.period,
      electricityKwh: metrics.electricityKwh ?? "",
      energyPerUnit: metrics.energyPerUnit ?? "",
      waterWithdrawalM3: metrics.waterWithdrawalM3 ?? "",
      waterDischargeM3: metrics.waterDischargeM3 ?? "",
      waterConsumptionM3: metrics.waterConsumptionM3 ?? "",
      waterPerUnit: metrics.waterPerUnit ?? "",
      materialConsumedKg: metrics.materialConsumedKg ?? "",
      materialPerUnit: metrics.materialPerUnit ?? "",
      recycledMaterialPercent: metrics.recycledMaterialPercent ?? "",
      wasteGeneratedKg: metrics.wasteGeneratedKg ?? "",
      wasteRecoveredKg: metrics.wasteRecoveredKg ?? "",
      wasteRecoveryPercent: metrics.wasteRecoveryPercent ?? "",
      scope1KgCo2e: metrics.scope1KgCo2e ?? "",
      scope1Factors: metrics.scope1FactorIds.join(", "),
      scope2KgCo2e: metrics.scope2KgCo2e ?? "",
      scope2Factors: metrics.scope2FactorIds.join(", "),
      scope3KgCo2e: metrics.scope3KgCo2e ?? "",
      scope3Categories: metrics.scope3Categories.join(", "),
      scope3Factors: metrics.scope3FactorIds.join(", "),
      dataCoveragePercent: metrics.dataCoveragePercent,
      readingCount: metrics.readingCount,
      estimatedReadingCount: metrics.estimatedReadingCount,
      latestReadingAt: metrics.latestReadingAt ?? "",
    })),
  );
  addSheet(
    workbook,
    "Lecturas ambientales",
    [
      { header: "ID", key: "id", width: 30 },
      { header: "Recurso", key: "resource", width: 18 },
      { header: "Actividad", key: "activity", width: 18 },
      { header: "Cantidad", key: "quantity", width: 16, numberFormat: QUANTITY_FORMAT },
      { header: "Unidad", key: "unit", width: 12 },
      { header: "Desde", key: "periodStart", width: 14 },
      { header: "Hasta", key: "periodEnd", width: 14 },
      { header: "Sede", key: "siteId", width: 18 },
      { header: "Origen", key: "sourceLabel", width: 26 },
      { header: "Calidad", key: "quality", width: 16 },
      { header: "Valor pagado", key: "billedAmount", width: 16 },
      { header: "Fuente técnica", key: "source", width: 18 },
      { header: "Capturada", key: "capturedAt", width: 24 },
      { header: "Factura/referencia", key: "externalReference", width: 24 },
      { header: "ID material", key: "materialProductId", width: 28 },
      { header: "ID recibo", key: "receiptImportId", width: 28 },
      { header: "ID registro histórico", key: "legacyRecordId", width: 28 },
    ],
    state.resourceReadings.map((reading) => ({
      ...reading,
      billedAmount: reading.billedAmount ?? "",
      externalReference: reading.externalReference ?? "",
      materialProductId: reading.materialProductId ?? "",
      receiptImportId: reading.receiptImportId ?? "",
      legacyRecordId: reading.legacyRecordId ?? "",
    })),
  );
  addSheet(
    workbook,
    "Factores GEI",
    [
      { header: "ID", key: "id", width: 26 },
      { header: "Alcance", key: "scope", width: 12 },
      { header: "Actividad", key: "activity", width: 22 },
      { header: "kg CO₂e/unidad", key: "kgCo2ePerUnit", width: 18, numberFormat: QUANTITY_FORMAT },
      { header: "Unidad", key: "activityUnit", width: 12 },
      { header: "Ubicación", key: "geography", width: 20 },
      { header: "Año", key: "year", width: 12 },
      { header: "Versión", key: "version", width: 36 },
      { header: "Método", key: "method", width: 24 },
      { header: "Fuente", key: "source", width: 48 },
    ],
    state.emissionFactors.map((factor) => ({
      id: factor.id,
      scope: factor.scope,
      activity: factor.activity,
      kgCo2ePerUnit: factor.kgCo2ePerUnit,
      activityUnit: factor.activityUnit,
      geography: factor.geography,
      year: factor.year,
      version: factor.version,
      method: factor.method,
      source: factor.source,
    })),
  );
  addSheet(
    workbook,
    "Metas ambientales",
    [
      { header: "ID", key: "id", width: 28 },
      { header: "Indicador", key: "indicatorId", width: 26 },
      { header: "Dirección", key: "direction", width: 14 },
      { header: "Horizonte (meses)", key: "horizonMonths", width: 18 },
      { header: "Línea base", key: "baselineValue", width: 18, numberFormat: QUANTITY_FORMAT },
      { header: "Período base", key: "baselinePeriod", width: 16 },
      { header: "Cambio objetivo (%)", key: "reductionPercent", width: 20, numberFormat: "0.0" },
      { header: "Aprobada", key: "approvedAt", width: 24 },
      { header: "Creada", key: "createdAt", width: 24 },
    ],
    state.indicatorTargets.map((target) => ({ ...target, approvedAt: target.approvedAt ?? "" })),
  );
  addSheet(
    workbook,
    "Acciones ambientales",
    [
      { header: "ID", key: "id", width: 28 },
      { header: "Indicador", key: "indicatorId", width: 24 },
      { header: "Acción", key: "title", width: 38 },
      { header: "Responsable", key: "owner", width: 24 },
      { header: "Fecha límite", key: "dueDate", width: 16 },
      { header: "Estado", key: "status", width: 16 },
      { header: "Notas", key: "notes", width: 40 },
      { header: "Creada", key: "createdAt", width: 24 },
      { header: "Completada", key: "completedAt", width: 24 },
    ],
    state.environmentalActions.map((action) => ({
      id: action.id,
      indicatorId: action.indicatorId,
      title: action.title,
      owner: action.owner,
      dueDate: action.dueDate,
      status: action.status,
      notes: action.notes,
      createdAt: action.createdAt,
      completedAt: action.completedAt ?? "",
    })),
  );

  return workbook;
}

export async function downloadExcelWorkbook(state: AppState): Promise<void> {
  const workbook = buildExcelWorkbook(state);
  const contents = await workbook.xlsx.writeBuffer();
  const blob = new Blob([new Uint8Array(contents)], { type: EXCEL_MIME_TYPE });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `pyme360-datos-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
