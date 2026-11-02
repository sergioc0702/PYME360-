const localRuntimeAssets = [
  "vendor/receipt-reader/tesseract/tesseract.min.js",
  "receipt-reader.js",
  "vendor/xlsx.full.min.js",
] as const;

let runtimeAssetsPromise: Promise<void> | undefined;

function loadClassicScript(path: string): Promise<void> {
  const source = `${import.meta.env.BASE_URL}${path}`;
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = source;
    script.async = false;
    script.dataset.pyme360RuntimeAsset = path;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`No se pudo cargar el recurso local ${path}.`));
    document.head.append(script);
  });
}

/** Loads the local UMD libraries in dependency order without treating them as Vite modules. */
export function ensureLocalRuntimeAssets(): Promise<void> {
  runtimeAssetsPromise ??= localRuntimeAssets.reduce<Promise<void>>(
    (loaded, path) => loaded.then(() => loadClassicScript(path)),
    Promise.resolve(),
  );
  return runtimeAssetsPromise;
}
