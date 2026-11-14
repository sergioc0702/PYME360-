import assert from "node:assert/strict";
import { build } from "esbuild";
import { resolve } from "node:path";
import test from "node:test";

const bundle = await build({
  stdin: {
    contents: `
      export * from "./src/domain/business";
      export * from "./src/domain/insights";
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

const reading = (resource, quantity, period, extra = {}) => ({
  resource,
  activity: resource === "water" ? "withdrawal" : "consumption",
  quantity,
  unit: resource === "water" ? "m³" : "kWh",
  periodStart: `${period}-01`,
  periodEnd: `${period}-28`,
  siteId: "site-main",
  source: "manual",
  quality: "confirmed",
  sourceLabel: "Prueba",
  ...extra,
});

const order = (id, productId, productName, quantity, wasteQuantity, date) => ({
  id,
  number: id,
  date,
  productId,
  productName,
  quantity,
  wasteQuantity,
  status: "completed",
  consumedMaterials: [],
  completedAt: date,
});

function sampleState() {
  let state = app.createEmptyState();
  state = app.saveResourceReading(state, reading("electricity", 1000, "2026-01"));
  state = app.saveResourceReading(
    state,
    reading("electricity", 900, "2026-02", { billedAmount: 720000 }),
  );
  state = app.saveResourceReading(state, reading("water", 100, "2026-01"));
  state = app.saveResourceReading(
    state,
    reading("water", 130, "2026-02", { billedAmount: 390000 }),
  );
  state.productionOrders = [
    order("o1", "p1", "Pan", 100, 0, "2026-01-15"),
    order("o2", "p1", "Pan", 75, 0, "2026-02-15"),
    order("o3", "p2", "Torta", 30, 5, "2026-02-20"),
  ];
  return state;
}

test("el ahorro se ajusta por producción y se expresa en pesos y CO2", () => {
  const savings = app.calculateSavings(sampleState(), "2026-01", "2026-02");
  assert.equal(savings.electricity.basis, "per-unit");
  // Base: 10 kWh por unidad. Con 100 unidades se esperaban 1.000 kWh y se usaron 900.
  assert.equal(savings.electricity.savedQuantity, 100);
  assert.equal(savings.electricity.savedPesos, 80000);
  assert.ok(Math.abs(savings.electricity.savedKgCo2e - 22) < 1e-9);
});

test("un aumento de consumo da ahorro negativo", () => {
  const savings = app.calculateSavings(sampleState(), "2026-01", "2026-02");
  assert.equal(savings.water.savedQuantity, -30);
  assert.equal(savings.water.savedPesos, -90000);
  assert.equal(savings.totalPesos, -10000);
});

test("sin producción compara consumos totales y sin valor pagado no inventa pesos", () => {
  let state = app.createEmptyState();
  state = app.saveResourceReading(state, reading("electricity", 1000, "2026-01"));
  state = app.saveResourceReading(state, reading("electricity", 800, "2026-02"));
  const savings = app.calculateSavings(state, "2026-01", "2026-02");
  assert.equal(savings.electricity.basis, "total");
  assert.equal(savings.electricity.savedQuantity, 200);
  assert.equal(savings.electricity.savedPesos, null);
  assert.equal(savings.totalPesos, null);
});

test("el mes base debe ser anterior al mes revisado", () => {
  assert.equal(app.calculateSavings(sampleState(), "2026-02", "2026-02"), null);
  assert.equal(app.calculateSavings(sampleState(), "2026-02", "2026-01"), null);
});

test("el valor pagado también sale del recibo vinculado", () => {
  const state = app.createEmptyState();
  state.receiptImports = [{ id: "r1", extraction: { billedAmount: 500000 } }];
  const linked = reading("electricity", 1000, "2026-03", { receiptImportId: "r1" });
  assert.equal(app.readingCost(state, linked), 500000);
  state.resourceReadings = [linked];
  assert.equal(app.averageUnitPrice(state, "2026-03", "electricity"), 500);
});

test("el consumo por producto reparte todo el consumo del mes", () => {
  const rows = app.calculateProductFootprint(sampleState(), "2026-02");
  assert.deepEqual(
    rows.map((row) => [row.productName, row.goodUnits, row.wasteUnits]),
    [
      ["Pan", 75, 0],
      ["Torta", 25, 5],
    ],
  );
  assert.equal(rows[0].electricityKwh, 675);
  assert.equal(rows[1].electricityKwh, 225);
  assert.equal(rows[0].energyCost + rows[1].energyCost, 720000);
  assert.equal(
    rows.reduce((sum, row) => sum + row.waterM3, 0),
    130,
  );
});

test("sin órdenes terminadas no hay consumo por producto", () => {
  const state = sampleState();
  state.productionOrders = [];
  assert.deepEqual(app.calculateProductFootprint(state, "2026-02"), []);
});

test("las sugerencias salen de los datos y no repiten acciones abiertas", () => {
  const state = sampleState();
  const ids = app.buildSavingsSuggestions(state, "2026-02", "2026-01").map((item) => item.id);
  assert.ok(ids.includes("water-increase"));
  assert.ok(ids.includes("product-waste-p2"));
  assert.ok(!ids.includes("energy-increase"));
  const water = app
    .buildSavingsSuggestions(state, "2026-02", "2026-01")
    .find((item) => item.id === "water-increase");
  const next = app.addEnvironmentalAction(state, {
    indicatorId: water.indicatorId,
    title: water.title,
    owner: "Ana",
    dueDate: "2026-03-30",
    notes: "",
  });
  assert.ok(
    !app
      .buildSavingsSuggestions(next, "2026-02", "2026-01")
      .some((item) => item.id === "water-increase"),
  );
});

test("pide los datos que faltan", () => {
  let state = app.createEmptyState();
  state = app.saveResourceReading(state, reading("electricity", 1000, "2026-01"));
  const ids = app.buildSavingsSuggestions(state, "2026-01", null).map((item) => item.id);
  assert.deepEqual(ids, ["missing-production", "missing-price"]);
});

test("el valor pagado no puede ser negativo", () => {
  assert.throws(() =>
    app.saveResourceReading(
      app.createEmptyState(),
      reading("electricity", 10, "2026-01", { billedAmount: -1 }),
    ),
  );
});

test("el informe incluye consumo, ahorro, productos y plan", () => {
  const report = app.buildEnvironmentalReport(sampleState(), "2026-02", "2026-01");
  const titles = report.sections.map((section) => section.title);
  assert.equal(titles.length, 4);
  assert.match(titles[1], /enero de 2026/);
  const text = report.sections.flatMap((section) => section.lines).join("\n");
  assert.match(text, /Energía: Ahorro de 100 kWh/);
  assert.match(text, /Agua: Aumento de 30 m³/);
  assert.match(text, /Torta/);
  assert.match(report.note, /no es un certificado oficial/i);
});

test("el último mes de consumo ignora meses que solo tienen ventas o producción", () => {
  const metrics = [
    { period: "2026-09", electricityKwh: 125, waterWithdrawalM3: null },
    { period: "2026-10", electricityKwh: null, waterWithdrawalM3: 13 },
    { period: "2026-11", electricityKwh: null, waterWithdrawalM3: null },
  ];
  assert.equal(app.latestConsumptionPeriod(metrics), "2026-10");
  assert.equal(app.latestConsumptionPeriod([metrics[2]]), null);
});
