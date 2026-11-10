import assert from "node:assert/strict";
import { build } from "esbuild";
import test from "node:test";

const bundle = await build({
  stdin: {
    contents: `
      export * from "./src/infrastructure/backup-crypto.ts";
      export { parseBackup, serializeBackup } from "./src/infrastructure/storage.ts";
      export { addContact, addProduct, createEmptyState, createSale, outstandingBalance,
        createQuotation, convertQuotation } from "./src/domain/business.ts";
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
});
const {
  addContact,
  addProduct,
  createEmptyState,
  createSale,
  createQuotation,
  convertQuotation,
  decryptBackup,
  encryptBackup,
  isEncryptedBackup,
  outstandingBalance,
  parseBackup,
  serializeBackup,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("un respaldo anterior abre sin ofertas y uno nuevo conserva el vínculo con la venta", () => {
  const oldState = createEmptyState();
  delete oldState.quotations;
  let state = parseBackup(JSON.stringify({ state: oldState }));
  assert.deepEqual(state.quotations, []);
  state.company = { name: "Taller", city: "Duitama", taxId: "123", activity: "" };
  state = addContact(state, { name: "Cliente", role: "customer", taxId: "", email: "", phone: "" });
  state = addProduct(state, {
    name: "Producto", type: "finished", unit: "unidad", stock: 5, minimumStock: 0,
    unitCost: 50, unitPrice: 100, vatRate: 19,
  });
  state = createQuotation(state, {
    date: "2026-11-09", validUntil: "2026-11-09", discount: 10,
    customerId: state.contacts[0].id, lines: [{ productId: state.products[0].id, quantity: 2 }],
  });
  state = convertQuotation(state, state.quotations[0].id, "2026-11-09");
  const restored = parseBackup(serializeBackup(state));
  assert.deepEqual(restored.quotations, state.quotations);
  assert.equal(restored.quotations[0].saleId, restored.sales[0].id);
  assert.equal(restored.sales[0].quotationId, restored.quotations[0].id);
});

const content = JSON.stringify({ state: { company: { name: "Panadería ñ" } } });

test("un respaldo protegido no deja ver los datos y se recupera con su contraseña", async () => {
  const encrypted = await encryptBackup(content, "clave-de-prueba");
  assert.equal(encrypted.includes("Panader"), false);
  assert.equal(isEncryptedBackup(encrypted), true);
  assert.equal(await decryptBackup(encrypted, "clave-de-prueba"), content);
});

test("una contraseña equivocada o un archivo alterado no se abren", async () => {
  const encrypted = await encryptBackup(content, "clave-de-prueba");
  await assert.rejects(decryptBackup(encrypted, "otra-clave"), /contraseña/);
  const parsed = JSON.parse(encrypted);
  parsed.data = `${parsed.data[0] === "A" ? "B" : "A"}${parsed.data.slice(1)}`;
  await assert.rejects(decryptBackup(JSON.stringify(parsed), "clave-de-prueba"), /dañado/);
});

test("un respaldo antiguo sin proteger se reconoce como tal", () => {
  assert.equal(isEncryptedBackup(content), false);
  assert.equal(isEncryptedBackup("no es json"), false);
});

test("los respaldos grandes también se protegen", async () => {
  const large = "x".repeat(300_000);
  assert.equal(await decryptBackup(await encryptBackup(large, "clave"), "clave"), large);
});

test("recupera una venta con abono y sus movimientos desde un respaldo de la aplicación", async () => {
  let state = addContact(createEmptyState(), {
    name: "Cliente de prueba",
    role: "customer",
    taxId: "",
    email: "",
    phone: "",
  });
  state = addProduct(state, {
    name: "Producto de prueba",
    type: "finished",
    unit: "unidad",
    stock: 10,
    minimumStock: 0,
    unitCost: 40,
    unitPrice: 100,
    vatRate: 0,
  });
  const sold = createSale(state, {
    date: "2026-11-09",
    customerId: state.contacts[0].id,
    lines: [{ productId: state.products[0].id, quantity: 2 }],
    discount: 0,
    initialPayment: 50,
    initialPaymentMethod: "Efectivo",
    invoiceFollowUpStatus: "not_applicable",
    externalInvoiceNumber: "",
    externalInvoiceDate: "",
  });
  const serialized = serializeBackup(sold);
  const saved = JSON.parse(serialized).state;
  const encrypted = await encryptBackup(serialized, "clave-de-prueba");
  const restored = parseBackup(await decryptBackup(encrypted, "clave-de-prueba"));

  assert.equal(restored.products[0].stock, 8);
  assert.equal(restored.sales[0].total, 200);
  assert.equal(restored.sales[0].payments[0].amount, 50);
  assert.deepEqual(restored.sales[0].payments, saved.sales[0].payments);
  assert.equal(outstandingBalance(restored.sales[0]), 150);
  assert.deepEqual(restored.inventoryMovements, saved.inventoryMovements);
  assert.deepEqual(restored.cashMovements, saved.cashMovements);
});
