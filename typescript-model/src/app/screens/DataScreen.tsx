import { useState } from "react";
import type { AppState } from "../../domain/types";
import type { UserRole } from "../../infrastructure/auth";
import { serializeBackup } from "../../infrastructure/storage";
import { formatNumber, today } from "../AppViews";
import { ExcelImportWizard } from "./ExcelImport";

function downloadBackup(state: AppState): void {
  const file = new Blob([serializeBackup(state)], { type: "application/json" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = `pyme360-respaldo-${today()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Datos y respaldo: sacar una copia, recuperarla y mover datos con Excel. */
export function DataPage({
  state,
  onRestore,
  onExportExcel,
  onImportWorkbook,
  role = "viewer",
  readOnly = false,
  canRestore = false,
  canImport = false,
}: {
  state: AppState;
  onRestore: (file: File) => void;
  onExportExcel: () => Promise<void>;
  onImportWorkbook?: (state: AppState) => Promise<boolean>;
  role?: UserRole;
  readOnly?: boolean;
  canRestore?: boolean;
  canImport?: boolean;
}) {
  const [exportingExcel, setExportingExcel] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const counts = [
    ["Clientes y proveedores", state.contacts.length],
    ["Productos", state.products.length],
    ["Movimientos de inventario", state.inventoryMovements.length],
    ["Ventas", state.sales.length],
    ["Facturas preparadas", state.electronicDocuments.length],
    ["Facturas de proveedores", state.supplierInvoices.length],
    ["Compras", state.purchases.length],
    ["Cajas y bancos", state.financialAccounts.length],
    ["Entradas y salidas de dinero", state.cashMovements.length],
    ["Órdenes de producción", state.productionOrders.length],
    ["Consumos", state.resourceReadings.length],
    ["Metas de ahorro", state.indicatorTargets.length],
    ["Planes de ahorro", state.environmentalActions.length],
    ["Recibos", state.receiptImports.length],
    ["Datos adicionales importados", state.importExtras.length],
  ] as const;

  async function exportWorkbook() {
    setExportingExcel(true);
    try {
      await onExportExcel();
    } finally {
      setExportingExcel(false);
    }
  }

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>Datos y respaldo</h1>
      </header>
      <p className="screen-note">
        Tus datos se guardan en este computador y cada día se hace una copia aquí mismo. Si el
        computador se daña, esa copia se puede perder: descarga también un respaldo y guárdalo en
        otro lugar.
      </p>
      {readOnly && (
        <p className="screen-note">
          Tu usuario solo puede consultar. Puedes descargar los datos, pero no cambiarlos.
        </p>
      )}

      <section aria-labelledby="datos-respaldo">
        <h2 id="datos-respaldo">Respaldo</h2>
        <ul className="task-list">
          <li>
            <div>
              <strong>Descargar un respaldo</strong>
              <span>Un archivo con todos los datos de tu empresa.</span>
            </div>
            <button className="action-primary" type="button" onClick={() => downloadBackup(state)}>
              Descargar respaldo
            </button>
          </li>
          <li>
            <div>
              <strong>Recuperar un respaldo</strong>
              <span>
                {canRestore
                  ? "Cambia todos los datos de ahora por los del archivo. Los usuarios y el historial se conservan."
                  : "Solo un administrador puede recuperar un respaldo."}
              </span>
            </div>
            {canRestore && (
              <label className="action-secondary action-file">
                Elegir archivo
                <input
                  className="sr-only"
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) onRestore(file);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            )}
          </li>
        </ul>
      </section>

      <section aria-labelledby="datos-excel">
        <h2 id="datos-excel">Excel</h2>
        <ul className="task-list">
          <li>
            <div>
              <strong>Descargar en Excel</strong>
              <span>
                Ventas, compras, inventario, dinero, producción y consumo, cada uno en su hoja.
              </span>
            </div>
            <button
              className="action-secondary"
              type="button"
              disabled={exportingExcel}
              aria-busy={exportingExcel}
              onClick={() => void exportWorkbook()}
            >
              {exportingExcel ? "Preparando…" : "Descargar Excel"}
            </button>
          </li>
          <li>
            <div>
              <strong>Traer datos desde un archivo</strong>
              <span>
                {canImport && onImportWorkbook
                  ? "Acepta Excel y CSV. Revisas todo antes de guardar y no se borra nada de lo que ya tienes."
                  : "Solo un administrador o un operador puede traer datos."}
              </span>
            </div>
            {canImport && onImportWorkbook && (
              <button
                className="action-secondary"
                type="button"
                onClick={() => setImportOpen(true)}
              >
                Elegir archivo
              </button>
            )}
          </li>
        </ul>
      </section>

      <h2 className="screen-more-title">Más detalle</h2>
      <details className="environment-disclosure">
        <summary>Qué hay guardado</summary>
        <div className="environment-disclosure-content">
          <dl className="data-counts">
            {counts.map(([label, count]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{formatNumber(count)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </details>
      <details className="environment-disclosure">
        <summary>Archivo de muestra para probar</summary>
        <div className="environment-disclosure-content">
          <p className="screen-note">
            Trae 12 productos de un catálogo público para que veas cómo se relacionan las columnas.
            Los precios, cantidades e IVA son solo de ejemplo.
          </p>
          <a
            className="action-link"
            href={`${import.meta.env.BASE_URL}sample-data/catalogo-uci-online-retail-pyme360.xlsx`}
            download="catalogo-uci-online-retail-pyme360.xlsx"
          >
            Descargar archivo de muestra
          </a>
        </div>
      </details>
      <p className="screen-note">
        Esta versión es para una empresa en un solo computador. Los recibos se leen aquí mismo:
        Pyme360 no entra a los portales de las empresas de servicios ni guarda sus claves.
      </p>

      {importOpen && onImportWorkbook && (
        <ExcelImportWizard
          state={state}
          role={role}
          onCommit={onImportWorkbook}
          onClose={() => setImportOpen(false)}
        />
      )}
    </div>
  );
}
