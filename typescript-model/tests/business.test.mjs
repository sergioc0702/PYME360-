import assert from "node:assert/strict";
import { build } from "esbuild";
import { resolve } from "node:path";
import test from "node:test";

const bundle = await build({
  entryPoints: [resolve("src/domain/business.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const business = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`
);

const baseProduct = (overrides = {}) => ({
  type: "raw_material",
  unit: "kg",
  stock: 0,
  minimumStock: 0,
  unitCost: 100,
  unitPrice: 0,
  vatRate: 0,
  ...overrides,
});

function createState() {
  let state = business.createEmptyState();
  state = business.addContact(state, {
    name: "Cliente de prueba",
    role: "customer",
    ordinaryCustomer: false,
    taxId: "",
    email: "",
    phone: "",
  });
  state = business.addContact(state, {
    name: "Proveedor de prueba",
    role: "supplier",
    ordinaryCustomer: false,
    taxId: "",
    email: "",
    phone: "",
  });
  const customer = state.contacts.find((contact) => contact.role === "customer");
  const supplier = state.contacts.find((contact) => contact.role === "supplier");
  state = business.addProduct(state, baseProduct({
    name: "Producto terminado",
    type: "finished",
    unit: "unidad",
    stock: 5,
    unitCost: 0,
    unitPrice: 100,
  }));
  state = business.addProduct(state, baseProduct({
    name: "Materia prima",
    stock: 20,
    unitCost: 50,
  }));
  const finished = state.products.find((product) => product.name === "Producto terminado");
  const material = state.products.find((product) => product.name === "Materia prima");
  state = business.saveRecipeVersion(state, {
    productId: finished.id,
    baseQuantity: 1,
    expectedYieldPercent: 100,
    components: [{ productId: material.id, quantity: 2 }],
  });
  const recipe = state.recipes.find((item) => item.productId === finished.id);
  state = business.activateRecipeVersion(state, recipe.id, recipe.versions[0].id);
  return { state, customer, supplier, finished, material };
}

test("cotizar no mueve existencias y convertir conserva el precio, el IVA y el saldo ofrecidos", () => {
  const { state, customer, finished } = createState();
  const configured = { ...state, company: { name: "Taller", taxId: "123", city: "Duitama", activity: "" } };
  const offered = business.createQuotation(configured, {
    date: "2026-11-09", validUntil: "2026-11-10", customerId: customer.id,
    lines: [{ productId: finished.id, quantity: 2 }, { productId: finished.id, quantity: 1 }],
    discount: 20,
  });
  const quote = offered.quotations[0];
  assert.deepEqual(offered.sales, configured.sales);
  assert.deepEqual(offered.inventoryMovements, configured.inventoryMovements);
  assert.deepEqual(offered.cashMovements, configured.cashMovements);
  const edited = business.updateProduct(offered, finished.id, { ...finished, unitPrice: 900, vatRate: 19 });
  const converted = business.convertQuotation(edited, quote.id, "2026-11-10");
  const sale = converted.sales[0];
  assert.deepEqual(sale.lines, quote.lines);
  assert.equal(sale.total, 280);
  assert.equal(business.outstandingBalance(sale), quote.total);
  assert.equal(converted.products.find((product) => product.id === finished.id).stock, 2);
  assert.equal(converted.inventoryMovements.length, configured.inventoryMovements.length + 1);
  assert.equal(converted.quotations[0].saleId, sale.id);
  assert.equal(business.convertQuotation(converted, quote.id, "2026-11-10"), converted);
  const deleted = business.deleteSale(converted, sale.id);
  assert.equal(business.convertQuotation(deleted, quote.id, "2026-11-10"), deleted);
  assert.throws(() => business.convertQuotation(offered, quote.id, "2026-11-11"), /vigencia/);

  const insufficient = business.createQuotation(configured, {
    date: "2026-11-09", validUntil: "2026-11-10", customerId: customer.id,
    lines: [{ productId: finished.id, quantity: 6 }], discount: 0,
  });
  assert.throws(() => business.convertQuotation(insufficient, insufficient.quotations[0].id, "2026-11-09"), /inventario/);
  assert.equal(insufficient.sales.length, 0);
});

test("la devolución reduce el saldo, reembolsa el excedente y reintegra solo lo vendible", () => {
  const { state, customer, finished } = createState();
  const ready = business.addFinancialAccount(state, { name: "Caja", type: "cash", openingBalance: 0 });
  const accountId = ready.financialAccounts[0].id;
  const sold = business.createSale(ready, {
    date: "2026-11-09", customerId: customer.id, lines: [{ productId: finished.id, quantity: 4 }],
    discount: 0, initialPayment: 300, initialPaymentAccountId: accountId,
    initialPaymentMethod: "Efectivo", invoiceFollowUpStatus: "to_review",
    externalInvoiceNumber: "", externalInvoiceDate: "",
  });
  const saleId = sold.sales[0].id;
  const input = {
    date: "2026-11-09", reason: "Cambio de pedido",
    lines: [{ lineIndex: 0, quantity: 2, restock: true }],
  };
  assert.throws(() => business.registerSaleReturn(sold, saleId, input), /caja o banco/i);
  const record = business.registerSaleReturn(sold, saleId, { ...input, refundAccountId: accountId }, "retry");
  assert.equal(record.sales[0].total, 400);
  assert.deepEqual(record.sales[0].payments, sold.sales[0].payments);
  assert.equal(record.sales[0].returns[0].refund, 100);
  assert.equal(business.outstandingBalance(record.sales[0]), 0);
  assert.equal(record.products.find((product) => product.id === finished.id).stock, 3);
  assert.equal(record.cashMovements.at(-1).amount, 100);
  assert.equal(record.cashMovements.at(-1).direction, "out");
  assert.equal(business.registerSaleReturn(record, saleId, input, "retry"), record);
  assert.throws(() => business.deleteSale(record, saleId), /devoluciones/);
  assert.throws(() => business.registerSaleReturn(record, saleId, {
    ...input, lines: [{ lineIndex: 0, quantity: 3, restock: true }],
  }), /cantidad/);
  const damaged = business.registerSaleReturn(record, saleId, {
    ...input, refundAccountId: accountId, lines: [{ lineIndex: 0, quantity: 1, restock: false }],
  });
  assert.equal(damaged.products.find((product) => product.id === finished.id).stock, 3);
  assert.equal(damaged.cashMovements.at(-1).amount, 100);
  assert.equal(business.netSalePaid(damaged.sales[0]), 100);
});

test("venta descuenta existencias, conserva el saldo y limita abonos", () => {
  const { state, customer, finished } = createState();
  const sold = business.createSale(state, {
    date: "2026-10-31",
    customerId: customer.id,
    lines: [{ productId: finished.id, quantity: 2 }],
    discount: 0,
    initialPayment: 25,
    initialPaymentMethod: "Transferencia",
    invoiceFollowUpStatus: "not_applicable",
    externalInvoiceNumber: "",
    externalInvoiceDate: "",
  });
  const sale = sold.sales[0];
  assert.equal(sold.products.find((product) => product.id === finished.id).stock, 3);
  assert.equal(business.outstandingBalance(sale), 175);
  assert.equal(sold.cashMovements.length, 1);

  const partial = business.addSalePayment(sold, sale.id, 75, "2026-10-31", "Efectivo");
  assert.equal(business.outstandingBalance(partial.sales[0]), 100);
  assert.equal(partial.cashMovements.length, 2);
  assert.throws(
    () => business.addSalePayment(partial, sale.id, 101, "2026-10-31", "Efectivo"),
    /no puede superar el saldo pendiente/i,
  );
  assert.equal(business.outstandingBalance(partial.sales[0]), 100);
  assert.throws(
    () => business.createSale(state, {
      date: "2026-10-31",
      customerId: customer.id,
      lines: [{ productId: finished.id, quantity: 6 }],
      discount: 0,
      initialPayment: 0,
      initialPaymentMethod: "",
      invoiceFollowUpStatus: "not_applicable",
      externalInvoiceNumber: "",
      externalInvoiceDate: "",
    }),
    /No hay suficiente inventario/i,
  );
  assert.equal(state.products.find((product) => product.id === finished.id).stock, 5);
});

test("compra pendiente no suma existencias y recibir, editar o eliminar conserva el saldo", () => {
  const { state, supplier, material } = createState();
  const pending = business.createPurchase(state, {
    date: "2026-10-31",
    supplierId: supplier.id,
    status: "pending",
    lines: [{ productId: material.id, quantity: 4, lineTotal: 400 }],
  });
  const purchase = pending.purchases[0];
  assert.equal(pending.products.find((product) => product.id === material.id).stock, 20);
  assert.equal(pending.inventoryMovements.length, state.inventoryMovements.length);

  const received = business.updatePurchase(pending, purchase.id, {
    date: "2026-10-31",
    supplierId: supplier.id,
    status: "received",
    lines: [{ productId: material.id, quantity: 4, lineTotal: 400 }],
  });
  assert.equal(received.products.find((product) => product.id === material.id).stock, 24);
  assert.equal(business.payableBalance(received.purchases[0]), 400);
  const partlyPaid = business.addPurchasePayment(
    received,
    purchase.id,
    150,
    "2026-10-31",
    "Transferencia",
  );
  assert.equal(business.payableBalance(partlyPaid.purchases[0]), 250);
  assert.equal(partlyPaid.cashMovements[0].direction, "out");
  assert.throws(
    () => business.addPurchasePayment(partlyPaid, purchase.id, 251, "2026-10-31", "Efectivo"),
    /no puede superar el saldo pendiente/i,
  );
  const edited = business.updatePurchase(partlyPaid, purchase.id, {
    date: "2026-10-31",
    supplierId: supplier.id,
    status: "received",
    lines: [{ productId: material.id, quantity: 6, lineTotal: 600 }],
  });
  assert.equal(edited.products.find((product) => product.id === material.id).stock, 26);
  const deleted = business.deletePurchase(edited, purchase.id);
  assert.equal(deleted.products.find((product) => product.id === material.id).stock, 20);
  assert.ok(deleted.inventoryMovements.length > received.inventoryMovements.length);
});

test("un conteo físico ajusta la existencia con un movimiento trazable y rechaza saldos negativos", () => {
  const { state, material } = createState();
  const beforeMovementCount = state.inventoryMovements.length;
  const counted = business.reconcileInventoryCount(state, material.id, 13.5, "Conteo de cierre");
  assert.equal(counted.products.find((product) => product.id === material.id).stock, 13.5);
  assert.equal(counted.inventoryMovements.length, beforeMovementCount + 1);
  assert.equal(counted.inventoryMovements.at(-1).quantity, -6.5);
  assert.match(counted.inventoryMovements.at(-1).reason, /Conteo físico: contado 13\.5 kg/);
  assert.match(counted.inventoryMovements.at(-1).reason, /Conteo de cierre/);

  assert.throws(
    () => business.reconcileInventoryCount(state, material.id, -1, "Conteo inválido"),
    /no puede ser negativo/i,
  );
});

test("producción consume receta, incorpora producto bueno y asigna costo de materiales", () => {
  const { state, finished, material } = createState();
  assert.throws(
    () => business.createProductionOrder(state, finished.id, 11, "2026-10-31"),
    /No hay suficiente/i,
  );
  assert.equal(state.products.find((product) => product.id === material.id).stock, 20);
  const started = business.createProductionOrder(state, finished.id, 5, "2026-10-31");
  const order = started.productionOrders[0];
  assert.equal(started.products.find((product) => product.id === material.id).stock, 10);
  assert.equal(order.consumedMaterials[0].quantity, 10);
  assert.equal(order.consumedMaterials[0].unitCostSnapshot, 50);
  assert.equal(order.consumedMaterials[0].lineCostSnapshot, 500);
  assert.equal(order.estimatedMaterialCost, 500);
  assert.equal(order.recipeVersionNumber, 1);
  assert.equal(order.expectedYieldPercent, 100);
  assert.equal(order.expectedGoodOutputQuantity, 5);

  const materialAfterCatalogChange = started.products.find((product) => product.id === material.id);
  const repriced = business.updateProduct(started, material.id, {
    ...materialAfterCatalogChange,
    unitCost: 100,
  });
  const completed = business.completeProductionOrder(repriced, order.id, 1, "2026-10-31");
  const completedOrder = completed.productionOrders[0];
  assert.equal(completed.products.find((product) => product.id === finished.id).stock, 9);
  assert.equal(completedOrder.materialCostPerGoodUnit, 125);
  assert.equal(completedOrder.wasteQuantity, 1);
  assert.equal(completed.inventoryMovements.at(-1).quantity, 4);
});

test("el cierre ajusta solo la diferencia de materiales y conserva el costo inicial", () => {
  const { state, finished, material } = createState();
  const started = business.createProductionOrder(state, finished.id, 5, "2026-10-31");
  const order = started.productionOrders[0];
  const costs = { actualQuantities: [12], laborHours: 1.5, laborHourlyRate: 200, energyCost: 70, overheadCost: 0 };
  const close = (actualQuantities) =>
    business.completeProductionOrder(started, order.id, 1, "2026-10-31", { ...costs, actualQuantities });

  assert.throws(() => close([21]), /inventario negativo/);
  assert.equal(started.productionOrders[0].status, "active");
  assert.equal(started.products.find((product) => product.id === material.id).stock, 10);

  const extra = close([12]);
  assert.equal(extra.products.find((product) => product.id === material.id).stock, 8);
  assert.equal(extra.inventoryMovements.at(-2).quantity, -2);
  assert.equal(extra.productionOrders[0].materialCostPerGoodUnit, 150);

  const returned = close([8]);
  assert.equal(returned.products.find((product) => product.id === material.id).stock, 12);
  assert.equal(returned.inventoryMovements.at(-2).quantity, 2);
  assert.equal(returned.productionOrders[0].consumedMaterials[0].quantity, 10);
  assert.equal(returned.productionOrders[0].consumedMaterials[0].actualQuantity, 8);
  assert.equal(returned.productionOrders[0].estimatedMaterialCost, 500);
  assert.equal(returned.productionOrders[0].materialCostPerGoodUnit, 100);
  assert.throws(
    () => business.completeProductionOrder(returned, order.id, 1, "2026-10-31", costs),
    /orden activa/,
  );
});

test("recetas por lote escalan componentes, conservan versiones y fijan la instantánea de la orden", () => {
  const { state, finished, material } = createState();
  const firstVersion = state.recipes[0].versions[0];
  const withDraft = business.saveRecipeVersion(state, {
    productId: finished.id,
    baseQuantity: 10,
    expectedYieldPercent: 90,
    components: [{ productId: material.id, quantity: 20 }],
  });
  const recipe = withDraft.recipes[0];
  const draft = recipe.versions.find((version) => version.status === "draft");
  assert.equal(draft.versionNumber, 2);
  const activated = business.activateRecipeVersion(withDraft, recipe.id, draft.id);
  assert.equal(activated.recipes[0].versions.find((version) => version.id === firstVersion.id).status, "archived");
  assert.equal(activated.recipes[0].activeVersionId, draft.id);

  const orderState = business.createProductionOrder(activated, finished.id, 5, "2026-10-31");
  const order = orderState.productionOrders[0];
  assert.equal(order.consumedMaterials[0].quantity, 10);
  assert.equal(order.recipeVersionId, draft.id);
  assert.equal(order.recipeVersionNumber, 2);
  assert.equal(order.expectedGoodOutputQuantity, 4.5);
  assert.throws(
    () => business.saveRecipeVersion(state, {
      productId: finished.id,
      baseQuantity: 1,
      expectedYieldPercent: 100,
      components: [{ productId: finished.id, quantity: 1 }],
    }),
    /propia receta|propia/i,
  );
});

test("sin costo de catálogo no presenta un costo total ficticio", () => {
  const { state, finished, material } = createState();
  const withoutCost = {
    ...state,
    products: state.products.map((product) =>
      product.id === material.id ? { ...product, unitCost: 0 } : product,
    ),
  };
  const started = business.createProductionOrder(withoutCost, finished.id, 2, "2026-10-31");
  const order = started.productionOrders[0];
  assert.equal(order.estimatedMaterialCost, null);
  assert.equal(order.consumedMaterials[0].unitCostSnapshot, null);
  const completed = business.completeProductionOrder(started, order.id, 0, "2026-10-31");
  assert.equal(completed.productionOrders[0].materialCostPerGoodUnit, null);
});

test("un borrador electrónico sin enviar se elimina y libera la venta", () => {
  const { state: initial, customer, finished } = createState();
  let state = business.createSale(initial, {
    customerId: customer.id,
    date: "2026-01-10",
    lines: [{ productId: finished.id, quantity: 1 }],
    discount: 0,
    initialPayment: 0,
    invoiceFollowUpStatus: "to_review",
    externalInvoiceNumber: "",
    externalInvoiceDate: "",
  });
  const sale = state.sales[0];
  state = { ...state, company: { name: "Empresa", taxId: "900", city: "Medellín", activity: "" } };
  state = business.prepareElectronicInvoice(state, sale.id, "Prueba");
  assert.throws(() => business.deleteSale(state, sale.id), /Facturación y documentos/);

  const draft = state.electronicDocuments[0];
  const sent = { ...state, electronicDocuments: [{ ...draft, status: "transmitted" }] };
  assert.throws(() => business.deleteElectronicDraft(sent, draft.id), /nunca se haya enviado/);
  const attempted = {
    ...state,
    electronicDocuments: [{ ...draft, attempts: [{ id: "attempt-1" }] }],
  };
  assert.throws(() => business.deleteElectronicDraft(attempted, draft.id), /nunca se haya enviado/);

  state = business.deleteElectronicDraft(state, draft.id);
  assert.equal(state.electronicDocuments.length, 0);
  assert.equal(business.deleteSale(state, sale.id).sales.length, 0);
});

test("el costo se recalcula con promedio ponderado y se revierte al eliminar la compra", () => {
  const { state: initial, supplier, material } = createState();
  const received = {
    supplierId: supplier.id,
    date: "2026-01-10",
    status: "received",
    lines: [{ productId: material.id, quantity: 20, lineTotal: 2000 }],
  };
  let state = business.createPurchase(initial, received);
  const cost = () => state.products.find((product) => product.id === material.id).unitCost;
  assert.equal(cost(), 75);

  const pending = business.createPurchase(initial, { ...received, status: "pending" });
  assert.equal(pending.products.find((item) => item.id === material.id).unitCost, 50);

  state = business.deletePurchase(state, state.purchases[0].id);
  assert.equal(cost(), 50);
});

test("completar una orden asigna al producto el costo de materiales por unidad buena", () => {
  const { state: initial, finished } = createState();
  let state = business.createProductionOrder(initial, finished.id, 4, "2026-01-10");
  state = business.completeProductionOrder(state, state.productionOrders[0].id, 0, "2026-01-11");
  assert.equal(state.products.find((item) => item.id === finished.id).unitCost, 100);
});

test("un contacto rechaza teléfono inválido, NIT corto e identificación repetida", () => {
  const contact = {
    name: "Proveedor",
    role: "supplier",
    ordinaryCustomer: false,
    taxId: "900123456-7",
    email: "",
    phone: "604 444 5566",
  };
  const state = business.addContact(business.createEmptyState(), contact);
  assert.throws(() => business.addContact(state, { ...contact, taxId: "", phone: "abc" }), /teléfono/);
  assert.throws(() => business.addContact(state, { ...contact, taxId: "123" }), /6 dígitos/);
  assert.throws(() => business.addContact(state, { ...contact, taxId: "900.123.456-7" }), /Ya existe/);
  assert.equal(
    business.addContact(state, { ...contact, taxId: "AB1234", identificationType: "PASSPORT" }).contacts
      .length,
    2,
  );

  const legacy = { ...state, contacts: [{ ...state.contacts[0], phone: "abc" }] };
  const updated = business.updateContact(legacy, legacy.contacts[0].id, {
    ...legacy.contacts[0],
    email: "nuevo@ejemplo.test",
  });
  assert.equal(updated.contacts[0].email, "nuevo@ejemplo.test");
});

test("eliminar una venta intermedia no repite el número de la siguiente", () => {
  const { state: initial, customer, finished } = createState();
  const sale = {
    customerId: customer.id,
    date: "2026-01-10",
    lines: [{ productId: finished.id, quantity: 1 }],
    discount: 0,
    initialPayment: 0,
    invoiceFollowUpStatus: "to_review",
    externalInvoiceNumber: "",
    externalInvoiceDate: "",
  };
  let state = business.createSale(initial, sale);
  state = business.createSale(state, sale);
  const first = state.sales.find((item) => item.number === "V-0001");
  state = business.deleteSale(state, first.id);
  state = business.createSale(state, sale);
  const numbers = state.sales.map((item) => item.number).sort();
  assert.deepEqual(numbers, ["V-0002", "V-0003"]);
});
