import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { applyTheme, getInitialTheme } from "./app/AppViews";
import { ensureLocalRuntimeAssets } from "./infrastructure/runtime-assets";
import "@fontsource-variable/figtree";
import "./tailwind.css";

applyTheme(getInitialTheme());

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("No encontramos el contenedor principal de Pyme360.");
const appRoot = rootElement;

async function bootstrapApplication(): Promise<void> {
  await ensureLocalRuntimeAssets();
  createRoot(appRoot).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrapApplication().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "No se pudieron cargar los componentes locales.";
  const status = document.createElement("p");
  status.className = "runtime-error";
  status.setAttribute("role", "alert");
  status.textContent = `Pyme360 no pudo iniciar: ${message}`;
  appRoot.replaceChildren(status);
});
