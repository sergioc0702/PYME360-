import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><div id=root></div>", { url: "http://127.0.0.1/" });
for (const key of ["window", "document", "HTMLElement", "Event", "FormData", "localStorage"]) {
  Object.defineProperty(globalThis, key, {
    value: key === "window" ? dom.window : dom.window[key],
    configurable: true,
  });
}

const bundle = await build({
  stdin: {
    contents: `
      export { createElement } from "react";
      export { createRoot } from "react-dom/client";
      export { ResourceReadingForm } from "./src/app/AppForms";
    `,
    resolveDir: resolve("."),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  jsx: "automatic",
  write: false,
  define: { "import.meta.env.BASE_URL": '"/"', "process.env.NODE_ENV": '"production"' },
  loader: { ".css": "empty" },
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});
const directory = await mkdtemp(join(tmpdir(), "pyme360-form-"));
const file = join(directory, "form.mjs");
await writeFile(file, bundle.outputFiles[0].contents);
const { createElement, createRoot, ResourceReadingForm } = await import(pathToFileURL(file).href);
await rm(directory, { recursive: true, force: true });

const nextTick = () => new Promise((resolveTick) => setTimeout(resolveTick, 0));

async function renderForm() {
  const saved = [];
  const container = document.createElement("div");
  document.body.append(container);
  createRoot(container).render(
    createElement(ResourceReadingForm, {
      products: [],
      onClose: () => {},
      onSave: (input) => saved.push(input),
    }),
  );
  await nextTick();
  return { container, saved };
}

async function selectResource(container, value) {
  const select = container.querySelector("[name=resource]");
  select.value = value;
  select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await nextTick();
}

for (const [resource, activity] of [
  ["water", "withdrawal"],
  ["waste", "generated"],
  ["fuel", "consumption"],
]) {
  test(`el formulario de lecturas guarda ${resource} con un solo selector de actividad`, async () => {
    const { container, saved } = await renderForm();
    await selectResource(container, resource);
    assert.equal(container.querySelectorAll("[name=activity]").length, 1);

    container.querySelector("[name=quantity]").value = "5";
    container
      .querySelector("form")
      .dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await nextTick();
    assert.equal(saved[0].resource, resource);
    assert.equal(saved[0].activity, activity);
  });
}
