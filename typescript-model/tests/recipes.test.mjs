import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function loadModule(entryPoint, externalPackages = []) {
  if (externalPackages.length) {
    const outputPath = resolve(`node_modules/.cache/${entryPoint.split("/").at(-1)}-${crypto.randomUUID()}.mjs`);
    mkdirSync(resolve("node_modules/.cache"), { recursive: true });
    await build({
      entryPoints: [resolve(entryPoint)],
      bundle: true,
      platform: "node",
      format: "esm",
      external: externalPackages,
      outfile: outputPath,
      write: true,
    });
    return import(pathToFileURL(outputPath).href);
  }
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

const [business, storage, importer, exporter] = await Promise.all([
  loadModule("src/domain/business.ts"),
  loadModule("src/infrastructure/storage.ts"),
  loadModule("src/features/spreadsheets/excel-import.ts"),
  loadModule("src/features/spreadsheets/exportExcel.ts", ["exceljs"]),
]);

function addProduct(state, overrides) {
  return business.addProduct(state, {
    sku: overrides.sku,
    name: overrides.name,
    type: overrides.type,
    unit: overrides.unit,
    stock: 0,
    minimumStock: 0,
    unitCost: overrides.unitCost ?? 5,
    unitPrice: overrides.unitPrice ?? 0,
    vatRate: 0,
  });
}

function stateWithProducts() {
  let state = business.createEmptyState();
  state = addProduct(state, { sku: "FIN-01", name: "Producto terminado", type: "finished", unit: "unidad" });
  state = addProduct(state, { sku: "MAT-01", name: "Materia prima", type: "raw_material", unit: "kg" });
  return state;
}

test("migra recetas legadas v6 a una versión activa sin alterar órdenes existentes", () => {
  const initial = stateWithProducts();
  const finished = initial.products.find((product) => product.type === "finished");
  const material = initial.products.find((product) => product.type === "raw_material");
  const historicalOrder = { id: "order-historical", productId: finished.id, consumedMaterials: [{ productId: material.id, quantity: 2 }] };
  const v6 = {
    ...initial,
    schemaVersion: 6,
    recipes: undefined,
    productionOrders: [historicalOrder],
    products: initial.products.map((product) => ({
      ...product,
      ...(product.id === finished.id ? { recipe: [{ productId: material.id, quantity: 2 }] } : { recipe: [] }),
    })),
  };

  const migrated = storage.migrateAppState(v6);
  assert.equal(migrated.schemaVersion, 7);
  assert.deepEqual(migrated.productionOrders, [historicalOrder]);
  assert.equal("recipe" in migrated.products.find((product) => product.id === finished.id), false);
  assert.deepEqual(migrated.recipes[0], {
    id: `legacy-recipe-${finished.id}`,
    productId: finished.id,
    activeVersionId: `legacy-recipe-version-${finished.id}-1`,
    versions: [
      {
        id: `legacy-recipe-version-${finished.id}-1`,
        versionNumber: 1,
        status: "active",
        baseQuantity: 1,
        expectedYieldPercent: 100,
        components: [{ productId: material.id, quantity: 2 }],
        createdAt: migrated.recipes[0].versions[0].createdAt,
        activatedAt: migrated.recipes[0].versions[0].activatedAt,
      },
    ],
  });
});

test("importa hojas de recetas antiguas como la primera versión activa por unidad", () => {
  const state = stateWithProducts();
  const finished = state.products.find((product) => product.type === "finished");
  const material = state.products.find((product) => product.type === "raw_material");
  const sheet = {
    name: "Recetas anteriores",
    rows: [
      ["SKU producto terminado", "SKU material", "Cantidad por unidad"],
      [finished.sku, material.sku, 2],
    ],
  };
  const mapping = importer.autoMapColumns(sheet, 0, "recipes");
  const prepared = importer.prepareImportRows(sheet, 0, "recipes", mapping);
  const plan = importer.buildImportPlan(state, prepared, "operator");
  const imported = plan.state.recipes[0];

  assert.equal(plan.errors, 0, JSON.stringify(plan.results));
  assert.equal(imported.activeVersionId, imported.versions[0].id);
  assert.equal(imported.versions[0].versionNumber, 1);
  assert.equal(imported.versions[0].status, "active");
  assert.equal(imported.versions[0].baseQuantity, 1);
  assert.equal(imported.versions[0].expectedYieldPercent, 100);
  assert.equal(imported.versions[0].components[0].quantity, 2);
});

test("el libro Excel conserva IDs, versiones, rendimiento y componentes de recetas", async () => {
  let original = stateWithProducts();
  const finished = original.products.find((product) => product.type === "finished");
  const material = original.products.find((product) => product.type === "raw_material");
  original = business.saveRecipeVersion(original, {
    productId: finished.id,
    baseQuantity: 12,
    expectedYieldPercent: 92.5,
    components: [{ productId: material.id, quantity: 24 }],
  });
  const recipe = original.recipes[0];
  original = business.activateRecipeVersion(original, recipe.id, recipe.versions[0].id);

  const workbook = exporter.buildExcelWorkbook(original);
  const worksheet = workbook.getWorksheet("Recetas");
  assert.ok(worksheet);
  const rows = [];
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    rows.push(row.values.slice(1));
  });
  const sheet = { name: worksheet.name, rows };
  const mapping = importer.autoMapColumns(sheet, 0, "recipes");
  assert.notEqual(mapping.versionId, null);
  assert.notEqual(mapping.baseQuantity, null);
  const prepared = importer.prepareImportRows(sheet, 0, "recipes", mapping);
  const importBase = { ...original, recipes: [] };
  const plan = importer.buildImportPlan(importBase, prepared, "operator");

  assert.equal(plan.errors, 0);
  assert.equal(plan.duplicates, 0);
  assert.equal(plan.state.recipes.length, 1);
  assert.equal(plan.state.recipes[0].id, original.recipes[0].id);
  assert.equal(plan.state.recipes[0].versions[0].id, original.recipes[0].versions[0].id);
  assert.equal(plan.state.recipes[0].versions[0].baseQuantity, 12);
  assert.equal(plan.state.recipes[0].versions[0].expectedYieldPercent, 92.5);
  assert.deepEqual(plan.state.recipes[0].versions[0].components, [{ productId: material.id, quantity: 24 }]);
});
