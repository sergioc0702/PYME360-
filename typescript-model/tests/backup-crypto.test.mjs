import assert from "node:assert/strict";
import { build } from "esbuild";
import { resolve } from "node:path";
import test from "node:test";

const bundle = await build({
  entryPoints: [resolve("src/infrastructure/backup-crypto.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
});
const { decryptBackup, encryptBackup, isEncryptedBackup } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

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
