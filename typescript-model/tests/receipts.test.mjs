import assert from "node:assert/strict";
import { build } from "esbuild";
import { resolve } from "node:path";
import test from "node:test";

const bundle = await build({
  entryPoints: [resolve("src/features/environment/consumption.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const receipts = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`
);

test("reconoce cualquier empresa de servicios públicos, sin lista", () => {
  assert.equal(
    receipts.detectProvider("Factura de servicios\nAcueducto de Paipa S.A. E.S.P.\nNIT 800"),
    "Acueducto de Paipa S.A. E.S.P.",
  );
  assert.equal(
    receipts.detectProvider("Aguas del Sur SAS ESP - Periodo marzo"),
    "Aguas del Sur SAS ESP",
  );
  assert.equal(receipts.detectProvider("Recibo sin datos de empresa"), "");
});

test("toma el valor del agua cuando el recibo lo separa", () => {
  const text = `Acueducto $ 45.300\nAlcantarillado $ 30.100\nAseo $ 22.000\nTotal a pagar $ 97.400`;
  assert.deepEqual(receipts.serviceAmount(text, "water", 97400), {
    billedAmount: 45300,
    otherServices: true,
  });
});

test("toma el valor de la energía cuando el recibo lo separa", () => {
  const text = `Total energía 210.500\nAlumbrado público 18.000\nTotal a pagar 228.500`;
  assert.equal(receipts.serviceAmount(text, "electricity", 228500).billedAmount, 210500);
});

test("encuentra el valor aunque el PDF pierda los saltos de línea", () => {
  const text = `Consumo facturado 18 m3 Acueducto $ 45.300 Alcantarillado $ 30.100 Aseo $ 22.000 Total a pagar $ 97.400`;
  assert.equal(receipts.serviceAmount(text, "water", 97400).billedAmount, 45300);
});

test("no confunde el NIT de la empresa con un valor", () => {
  const text = `Acueducto de Tunja S.A. E.S.P. NIT 800.123.456 Alcantarillado $ 30.100`;
  assert.equal(receipts.serviceAmount(text, "water", 97400).billedAmount, 0);
});

test("no confunde un consumo con un valor en pesos", () => {
  const text = `Energía activa 1.200 kWh Alumbrado público 18.000 Total a pagar 228.500`;
  assert.equal(receipts.serviceAmount(text, "electricity", 228500).billedAmount, 0);
});

test("no usa el total si trae otros servicios sin separar", () => {
  const text = `Servicios: acueducto, alcantarillado y aseo\nConsumo 12 m3\nTotal a pagar $ 97.400`;
  assert.deepEqual(receipts.serviceAmount(text, "water", 97400), {
    billedAmount: 0,
    otherServices: true,
  });
});

test("usa el total si el recibo es de un solo servicio", () => {
  const text = `Servicio de acueducto\nConsumo 12 m3\nTotal a pagar $ 45.300`;
  assert.deepEqual(receipts.serviceAmount(text, "water", 45300), {
    billedAmount: 45300,
    otherServices: false,
  });
});

test("recuerda el proveedor del mismo servicio", () => {
  const list = [
    { provider: "EBSA", extraction: { resource: "electricity" } },
    { provider: "Proveedor no identificado", extraction: { resource: "water" } },
    { provider: "Coservicios", extraction: { resource: "water" } },
  ];
  assert.equal(receipts.rememberedProvider(list, "water"), "Coservicios");
  assert.equal(receipts.rememberedProvider(list, "electricity"), "EBSA");
  assert.equal(receipts.rememberedProvider(list, "fuel"), "");
});
