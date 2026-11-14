import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { build } from "esbuild";
import { resolve } from "node:path";
import test from "node:test";

async function loadModule(entryPoint) {
  const result = await build({
    entryPoints: [resolve(entryPoint)],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`
  );
}

test("el catálogo UCI adaptado se importa con sus campos adicionales y evita duplicados", async () => {
  const [imports, business] = await Promise.all([
    loadModule("src/features/spreadsheets/excel-import.ts"),
    loadModule("src/domain/business.ts"),
  ]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolve("public/sample-data/catalogo-uci-online-retail-pyme360.xlsx"));
  const worksheet = workbook.getWorksheet("Catalogo importable");
  assert.ok(worksheet);
  const rows = [];
  worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    rows[rowNumber - 1] = row.values.slice(1);
  });
  const sheet = { name: worksheet.name, rows };
  const headers = rows[0];
  const mapping = {
    sku: headers.indexOf("Referencia de catálogo"),
    name: headers.indexOf("Nombre comercial"),
    type: headers.indexOf("Clasificación de artículo"),
    unit: headers.indexOf("Unidad de venta"),
    stock: headers.indexOf("Saldo inicial referencial"),
    minimumStock: headers.indexOf("Punto de reposición"),
    unitCost: headers.indexOf("Costo COP estimado"),
    unitPrice: headers.indexOf("Precio COP estimado"),
    vatRate: headers.indexOf("IVA (%)"),
    taxCategory: headers.indexOf("Categoría tributaria ilustrativa"),
  };
  const bundledMapping = imports.mapBundledCatalogSampleColumns(sheet);
  for (const [field, columnIndex] of Object.entries(mapping)) {
    assert.equal(bundledMapping[field], columnIndex);
  }
  assert.equal(bundledMapping.id, null);
  assert.ok(Object.values(mapping).every((columnIndex) => columnIndex >= 0));
  const prepared = imports.prepareImportRows(sheet, 0, "products", mapping);
  assert.equal(prepared.length, 12);
  assert.ok(prepared.every((row) => row.extras.length === 3));

  const state = business.createEmptyState();
  const plan = imports.buildImportPlan(state, prepared, "operator");
  assert.equal(plan.added, 60); // Products, explicit opening-balance movements, and preserved source fields.
  assert.equal(plan.results.filter((row) => row.status === "ready").length, 12);
  assert.equal(plan.errors, 0);
  assert.equal(plan.duplicates, 0);
  assert.equal(plan.state.products.length, 12);
  assert.ok(plan.state.products.every((product) => product.type === "finished"));
  assert.ok(plan.state.products.every((product) => product.unitPrice > 0 && product.unitCost > 0));
  assert.equal(plan.state.importExtras.length, 36);
  assert.ok(
    plan.state.importExtras.some(
      (extra) => extra.fieldName === "Procedencia" && extra.value === "UCI Online Retail · UCI Machine Learning Repository",
    ),
  );

  const repeat = imports.buildImportPlan(plan.state, prepared, "operator");
  assert.equal(repeat.added, 0);
  assert.equal(repeat.duplicates, 12);
  assert.equal(repeat.state.products.length, 12);
});
