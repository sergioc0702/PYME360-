import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(resolve("public/receipt-reader.js"), "utf8"), sandbox);
const { parse } = sandbox.window.Pyme360ReceiptReader;

// Textos como los que entrega el OCR de una foto real, con sus errores y sin datos personales.
const ENERGY_PHOTO = `MES DE SERVICIO SEP/2026 — me
DATOS CONSUMO
Periodo Servicio Desde 06/07/26 Hasta: 08/10/26
Tipo Liquidacion: TRIMESTRAL
Lectura Anterior — 655 Nivel Tension: Secundaria
Lectura Actual 780 Circuito Nudo
Consumo Mes 125 Estrato 3
Total Consumo 175 Propiedad Activos Redes Aereas EBSA 71
Consumo Mes 175
Lectura Anterior 655`;

const WATER_PHOTO = `ACUEDUCTO REGIONAL
FACTURA - ds-204709
INFORMACION DE LECTURA
2418 2431 13 M3
PERIODO FACTURADO: 2026/09/01 - 2026/10/31
SERVICIO ACUEDUCTO
PERIODO FACTURADO: 2026/09/01 - 2020/10/31`;

test("la resta del medidor corrige un consumo mal leído en la foto", () => {
  const result = parse(ENERGY_PHOTO, "OCR", 40);
  assert.equal(result.type, "energy");
  assert.equal(result.consumption, 125);
  assert.ok(result.confidence >= 0.9);
});

test("lee el mes de servicio abreviado", () => {
  assert.equal(parse(ENERGY_PHOTO, "OCR", 40).period, "2026-09");
});

test("avisa cuando el recibo cubre varios meses", () => {
  const energy = parse(ENERGY_PHOTO, "OCR", 40);
  assert.equal(energy.coveredMonths, 3);
  assert.ok(energy.warnings.some((warning) => warning.includes("3 meses")));
  assert.equal(parse(WATER_PHOTO, "OCR", 40).coveredMonths, 2);
});

test("lee un recibo de agua con fechas año/mes/día y descarta el año mal leído", () => {
  const result = parse(WATER_PHOTO, "OCR", 40);
  assert.equal(result.type, "water");
  assert.equal(result.consumption, 13);
  assert.equal(result.unit, "m³");
  assert.equal(result.period, "2026-10");
});

test("acepta el m3 mal leído en la fila del medidor", () => {
  const result = parse("ACUEDUCTO\nCONSUMO\n2410 2431 13 Mi\nSERVICIO ACUEDUCTO", "OCR", 40);
  assert.equal(result.type, "water");
  assert.equal(result.consumption, 13);
});

test("si el medidor no confirma, deja la advertencia de revisar", () => {
  const result = parse("Energia kwh\nTotal Consumo 175\nMES DE SERVICIO SEP/2026", "OCR", 40);
  assert.equal(result.consumption, 175);
  assert.ok(result.confidence < 0.75);
  assert.ok(result.warnings.some((warning) => warning.includes("dudosa")));
});

test("un recibo digital mensual sigue funcionando como antes", () => {
  const result = parse(
    "Periodo facturado marzo de 2026\nConsumo facturado 320 kWh\nTotal a pagar 180.000",
    "PDF con texto",
    95,
  );
  assert.equal(result.type, "energy");
  assert.equal(result.consumption, 320);
  assert.equal(result.period, "2026-03");
  assert.equal(result.coveredMonths, 1);
});

test("no confunde el promedio con el consumo", () => {
  const text = "ACUEDUCTO\nPROMEDIO: 17 M3\nPuma DIU: 1/7 MI\n2418 2431 13 M3\nSERVICIO ACUEDUCTO";
  assert.equal(parse(text, "OCR", 40).consumption, 13);
});

test("detecta varios meses aunque la foto dañe la palabra o el año", () => {
  assert.equal(parse("Energia 10 kWh\nTipo Liquidacion: MIMESTRAL", "OCR", 40).coveredMonths, 3);
  assert.equal(
    parse("Energia 10 kWh\nPeriodo Servicio Desde 06/07/76 Hasta: 08/10/76", "OCR", 40)
      .coveredMonths,
    4,
  );
});

test("acepta errores comunes en la palabra periodo", () => {
  const result = parse("ACUEDUCTO 13 M3\nPERTODO FACTURADO: 2026/09/01 - 2026/10/31", "OCR", 40);
  assert.equal(result.period, "2026-10");
  assert.equal(result.coveredMonths, 2);
});

test("si el total no cuadra con el medidor, usa la resta y avisa", () => {
  const text = "Lectura Anterior 655\nLectura Actual 780\nConsumo Mes 175\nTotal Consumo 175";
  const result = parse(text, "OCR", 70);
  assert.equal(result.consumption, 125);
  assert.ok(result.warnings.some((warning) => warning.includes("restar")));
});

test("toma el mes más reciente de la gráfica y no la fecha de pago", () => {
  const text = "Energia 10 kWh\nSEP/2025 DIC/2025 MAR/2026\nSEP/2026\nPago 03 NOV/2026";
  assert.equal(parse(text, "OCR", 70).period, "2026-09");
});

test("corrige un año final mal leído en el periodo", () => {
  const result = parse("ACUEDUCTO 13 M3\nPERIODO FACTURADO: 2026/09/04 - 2020/10/31", "OCR", 40);
  assert.equal(result.period, "2026-10");
  assert.equal(result.coveredMonths, 2);
});

test("no toma como consumo el promedio leído con una barra", () => {
  const result = parse("ACUEDUCTO\nPuma IU: 1/7 M3\nSERVICIO ACUEDUCTO", "OCR", 40);
  assert.equal(result.consumption, "");
});

test("en una foto no adivina con un número suelto junto a m3", () => {
  const result = parse("ACUEDUCTO\n0-22 M3 $4.500\nSERVICIO ACUEDUCTO", "OCR", 40);
  assert.equal(result.consumption, "");
  assert.ok(result.warnings.some((warning) => warning.includes("No encontramos un consumo")));
});
