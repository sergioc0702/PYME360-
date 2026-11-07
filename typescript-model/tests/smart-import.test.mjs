import assert from "node:assert/strict";
import { build } from "esbuild";
import { resolve } from "node:path";
import test from "node:test";

const bundle = await build({
  stdin: {
    contents: `
      export { createEmptyState } from "./src/domain/business";
      export { buildImportPlan } from "./src/features/spreadsheets/excel-import";
      export * from "./src/features/spreadsheets/smart-import";
      export * from "./src/features/spreadsheets/delimited";
      export { buildEnvironmentalReport } from "./src/features/environment/report";
    `,
    resolveDir: resolve("."),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  external: ["jspdf"],
});
const app = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`
);

const concept = (analysis, header) =>
  analysis.columns.find((column) => column.header === header)?.concept;

const messySales = {
  name: "Hoja1",
  rows: [
    ["PANADERÍA LA ESPIGA - REGISTRO 2026", "", "", "", "", "", ""],
    ["", "", "", "", "", "", ""],
    [
      "Fecha",
      "No. Factura",
      "Nombre Cliente",
      "Artículo",
      "Cant.",
      "Vr. Unitario",
      "Vendedor nota",
    ],
    ["15/03/2026", "FV-101", "Juan Pérez", "Pan integral", 10, "$ 2.500", "pagó en efectivo"],
    ["15/03/2026", "FV-101", "juan perez ", "Torta", 1, "$ 40.000", ""],
    ["16/03/2026", "FV-102", "", "Pan integral", 4, "$ 2.500", ""],
    ["TOTAL", "", "", "", 15, "", ""],
  ],
};

test("encuentra los títulos debajo del nombre del negocio", () => {
  assert.equal(app.findHeaderRow(messySales), 2);
});

test("reconoce títulos parecidos y clasifica la hoja", () => {
  const analysis = app.analyzeSheet(messySales);
  assert.equal(analysis.kind, "sales");
  assert.equal(concept(analysis, "Fecha"), "date");
  assert.equal(concept(analysis, "No. Factura"), "document");
  assert.equal(concept(analysis, "Nombre Cliente"), "customer");
  assert.equal(concept(analysis, "Artículo"), "product");
  assert.equal(concept(analysis, "Cant."), "quantity");
  assert.equal(concept(analysis, "Vr. Unitario"), "price");
});

test("reconoce columnas por su contenido aunque el título no diga nada", () => {
  const analysis = app.analyzeSheet({
    name: "Proveedores",
    rows: [
      ["Razón social", "Dato 1", "Dato 2", "Dato 3"],
      ["Harinas SA", "ventas@harinas.co", "3101234567", "900.123.456-7"],
      ["Azúcar Ltda", "info@azucar.co", "310 555 1234", "800.111.222-3"],
    ],
  });
  assert.equal(analysis.kind, "contacts");
  assert.equal(analysis.contactRole, "proveedor");
  assert.equal(concept(analysis, "Dato 1"), "email");
  assert.equal(concept(analysis, "Dato 2"), "phone");
  assert.equal(concept(analysis, "Dato 3"), "taxId");
});

test("NIT proveedor es identificación, no el nombre del proveedor", () => {
  const analysis = app.analyzeSheet({
    name: "Compras",
    rows: [
      [
        "Fecha compra",
        "Proveedor",
        "NIT proveedor",
        "Tel. contacto",
        "Producto",
        "Cantidad",
        "Total",
      ],
      ["2026-03-01", "Harinas SA", "900123456", "3101234567", "Harina", 5, 100000],
    ],
  });
  assert.equal(analysis.kind, "purchases");
  assert.equal(concept(analysis, "NIT proveedor"), "taxId");
  assert.equal(concept(analysis, "Proveedor"), "supplier");
  assert.equal(concept(analysis, "Tel. contacto"), "phone");
  assert.equal(concept(analysis, "Total"), "total");
});

test("una hoja que no se entiende no se adivina", () => {
  const analysis = app.analyzeSheet({
    name: "Notas",
    rows: [
      ["Comentario", "Otro"],
      ["hola", "mundo"],
    ],
  });
  assert.equal(analysis.kind, null);
});

test("una hoja mezclada crea clientes, productos y ventas válidas", () => {
  const state = app.createEmptyState();
  const workbook = { fileName: "x.xlsx", sheets: [messySales] };
  const results = app.buildSmartRows(workbook, app.analyzeWorkbook(workbook), state);
  assert.equal(results[0].newProducts, 2);
  assert.equal(results[0].newContacts, 2);
  const plan = app.buildImportPlan(
    state,
    results.flatMap((item) => item.rows),
    "admin",
  );
  assert.equal(plan.errors, 0, JSON.stringify(plan.results.filter((r) => r.status === "error")));
  assert.deepEqual(plan.state.contacts.map((contact) => contact.name).sort(), [
    "Cliente de mostrador",
    "Juan Pérez",
  ]);
  assert.equal(plan.state.products.length, 2);
  assert.equal(plan.state.sales.length, 2);
  const first = plan.state.sales.find((sale) => sale.number === "FV-101");
  assert.equal(first.lines.length, 2);
  assert.equal(first.total, 65000);
  assert.equal(first.date, "2026-03-15");
});

test("los datos del contacto de una hoja de compras no se pierden", () => {
  const state = app.createEmptyState();
  const workbook = {
    fileName: "x.xlsx",
    sheets: [
      {
        name: "Compras",
        rows: [
          [
            "Fecha",
            "Proveedor",
            "NIT proveedor",
            "Tel. proveedor",
            "Producto",
            "Cantidad",
            "Total",
          ],
          ["01/03/2026", "Harinas SA", "900123456", "3101234567", "Harina", 5, 100000],
        ],
      },
    ],
  };
  const rows = app
    .buildSmartRows(workbook, app.analyzeWorkbook(workbook), state)
    .flatMap((item) => item.rows);
  const contact = app.buildImportPlan(state, rows, "admin").state.contacts[0];
  assert.equal(contact.taxId, "900123456");
  assert.equal(contact.phone, "3101234567");
});

test("la columna sin sección se conserva en datos adicionales", () => {
  const state = app.createEmptyState();
  const workbook = { fileName: "x.xlsx", sheets: [messySales] };
  const analyses = app.analyzeWorkbook(workbook);
  assert.equal(concept(analyses[0], "Vendedor nota"), null);
  const rows = app.buildSmartRows(workbook, analyses, state).flatMap((item) => item.rows);
  const plan = app.buildImportPlan(state, rows, "admin");
  assert.ok(plan.state.importExtras.some((extra) => extra.fieldName === "Vendedor nota"));
  const report = app.buildEnvironmentalReport(plan.state, "2026-03", null);
  assert.match(JSON.stringify(report.sections), /Vendedor nota/);
});

test("reutiliza los contactos y productos que ya existen", () => {
  const first = app.createEmptyState();
  const workbook = { fileName: "x.xlsx", sheets: [messySales] };
  const rows = app
    .buildSmartRows(workbook, app.analyzeWorkbook(workbook), first)
    .flatMap((item) => item.rows);
  const state = app.buildImportPlan(first, rows, "admin").state;
  const results = app.buildSmartRows(workbook, app.analyzeWorkbook(workbook), state);
  assert.equal(results[0].newContacts, 0);
  assert.equal(results[0].newProducts, 0);
  const plan = app.buildImportPlan(
    state,
    results.flatMap((item) => item.rows),
    "admin",
  );
  assert.equal(plan.state.sales.length, 2);
  assert.equal(plan.errors, 0);
});

test("una compra sin total lo calcula con cantidad y costo", () => {
  const state = app.createEmptyState();
  const workbook = {
    fileName: "x.xlsx",
    sheets: [
      {
        name: "Compras",
        rows: [
          ["Fecha", "Proveedor", "Producto", "Cantidad", "Costo"],
          ["01/03/2026", "Harinas SA", "Harina", 5, "20.000"],
        ],
      },
    ],
  };
  const rows = app
    .buildSmartRows(workbook, app.analyzeWorkbook(workbook), state)
    .flatMap((item) => item.rows);
  const plan = app.buildImportPlan(state, rows, "admin");
  assert.equal(plan.errors, 0, JSON.stringify(plan.results));
  assert.equal(plan.state.purchases[0].total, 100000);
  assert.equal(plan.state.purchases[0].status, "received");
  assert.equal(plan.state.products[0].type, "raw_material");
  assert.equal(plan.state.products[0].unitCost, 20000);
});

test("una hoja de productos sin código ni tipo se importa", () => {
  const state = app.createEmptyState();
  const workbook = {
    fileName: "x.xlsx",
    sheets: [
      {
        name: "Inventario",
        rows: [
          ["Descripción", "Stock", "Precio"],
          ["Pan integral", 12, "2.500"],
        ],
      },
    ],
  };
  const rows = app
    .buildSmartRows(workbook, app.analyzeWorkbook(workbook), state)
    .flatMap((item) => item.rows);
  const plan = app.buildImportPlan(state, rows, "admin");
  assert.equal(plan.errors, 0, JSON.stringify(plan.results));
  assert.equal(plan.state.products[0].stock, 12);
  assert.equal(plan.state.products[0].unitPrice, 2500);
});

test("lee CSV con punto y coma, comillas y tildes en Windows-1252", () => {
  assert.deepEqual(app.parseDelimitedText('Nombre;Nota\r\n"Pérez; Juan";"dijo ""hola"""\r\n'), [
    ["Nombre", "Nota"],
    ["Pérez; Juan", 'dijo "hola"'],
  ]);
  assert.deepEqual(app.parseDelimitedText("a,b\n1,2\n"), [
    ["a", "b"],
    ["1", "2"],
  ]);
  const latin = new Uint8Array([0x50, 0xe9, 0x72, 0x65, 0x7a]).buffer;
  assert.equal(app.decodeText(latin), "Pérez");
});
