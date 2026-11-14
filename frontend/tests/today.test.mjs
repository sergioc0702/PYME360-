import assert from "node:assert/strict";
import { build } from "esbuild";
import { resolve } from "node:path";
import test from "node:test";

const bundle = await build({
  stdin: {
    contents: `
      export { createEmptyState, saveResourceReading } from "./src/domain/business";
      export * from "./src/domain/today";
      export { calculateConsumptionParcels, layoutParcels } from "./src/domain/insights";
    `,
    resolveDir: resolve("."),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
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

test("una empresa nueva ve qué hacer primero", () => {
  const ids = app.buildTodayTasks(app.createEmptyState(), "2026-11-09").map((task) => task.id);
  assert.deepEqual(ids, [
    "company",
    "energy-reading",
    "water-reading",
    "first-product",
    "first-contact",
  ]);
});

test("pide el recibo del mes anterior, también en enero", () => {
  const tasks = app.buildTodayTasks(app.createEmptyState(), "2027-01-05");
  assert.match(tasks.find((task) => task.id === "energy-reading").title, /diciembre/);
});

test("no pide el recibo que ya está", () => {
  const state = app.saveResourceReading(
    app.createEmptyState(),
    reading("electricity", 10, "2026-10"),
  );
  const ids = app.buildTodayTasks(state, "2026-11-09").map((task) => task.id);
  assert.ok(!ids.includes("energy-reading"));
  assert.ok(ids.includes("water-reading"));
});

test("cobra solo lo vencido y con saldo", () => {
  const state = app.createEmptyState();
  const sale = (id, dueDate, paid) => ({
    id,
    number: id,
    customerName: "Juan Pérez",
    total: 65000,
    dueDate,
    payments: paid ? [{ amount: 65000 }] : [],
  });
  state.sales = [
    sale("a", "2026-11-08", false),
    sale("b", "2026-11-20", false),
    sale("c", "2026-11-01", true),
  ];
  const tasks = app.buildTodayTasks(state, "2026-11-09").filter((task) => task.target === "sales");
  assert.deepEqual(
    tasks.map((task) => task.id),
    ["sale-a"],
  );
  assert.match(tasks[0].title, /Cobra a Juan Pérez/);
  assert.equal(tasks[0].urgent, true);
});

test("avisa qué reponer, sin contar productos sin mínimo", () => {
  const state = app.createEmptyState();
  const product = (id, name, type, stock, minimumStock) => ({
    id,
    name,
    type,
    stock,
    minimumStock,
    unit: "kg",
  });
  state.products = [
    product("a", "Harina", "raw_material", 3, 10),
    product("b", "Pan", "finished", 0, 5),
    product("c", "Sal", "raw_material", 0, 0),
  ];
  const tasks = app
    .buildTodayTasks(state, "2026-11-09")
    .filter((task) => task.id.startsWith("stock"));
  assert.deepEqual(
    tasks.map((task) => task.title),
    ["Produce Pan: quedan 0 kg", "Compra Harina: quedan 3 kg"],
  );
});

test("las parcelas ocupan todo el mapa sin taparse", () => {
  const placed = app.layoutParcels([
    { label: "a", value: 50, unit: "COP" },
    { label: "b", value: 30, unit: "COP" },
    { label: "c", value: 15, unit: "COP" },
    { label: "d", value: 5, unit: "COP" },
  ]);
  const area = placed.reduce((sum, item) => sum + item.width * item.height, 0);
  assert.ok(Math.abs(area - 10000) < 1e-6);
  assert.ok(Math.abs(placed[0].width * placed[0].height - 5000) < 1e-6);
});

test("sin valor pagado las parcelas van en kWh y no en pesos", () => {
  const state = app.saveResourceReading(
    app.createEmptyState(),
    reading("electricity", 100, "2026-10"),
  );
  assert.deepEqual(app.calculateConsumptionParcels(state, "2026-10"), [
    { label: "Energía", value: 100, unit: "kWh" },
  ]);
});
