import { useMemo, useState, type ChangeEvent } from "react";
import type { AppState } from "../../domain/types";
import {
  autoMapColumns,
  buildImportPlan,
  downloadImportTemplate,
  getImportModule,
  IMPORT_MODULES,
  isComputedImportSheet,
  mapBundledCatalogSampleColumns,
  prepareImportRows,
  readExcelWorkbook,
  suggestHeaderRow,
  suggestImportModule,
  type ExcelSheetData,
  type ExcelWorkbookData,
  type ImportModuleId,
  type ImportRole,
  type PreparedImportRow,
} from "../../features/spreadsheets/excel-import";

interface StagedSheet {
  sheetName: string;
  moduleId: ImportModuleId;
  rows: PreparedImportRow[];
}

interface ExcelImportProps {
  state: AppState;
  role: ImportRole;
  onCommit: (state: AppState) => Promise<boolean>;
  onClose: () => void;
}

function moduleName(id: ImportModuleId): string {
  return getImportModule(id).label;
}

export function ExcelImportWizard({ state, role, onCommit, onClose }: ExcelImportProps) {
  const [workbook, setWorkbook] = useState<ExcelWorkbookData | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [headerRow, setHeaderRow] = useState(0);
  const [moduleId, setModuleId] = useState<ImportModuleId>("contacts");
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [staged, setStaged] = useState<StagedSheet[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedSheet = workbook?.sheets.find((sheet) => sheet.name === sheetName) ?? null;
  const module = getImportModule(moduleId);
  const currentRows = useMemo(
    () => (selectedSheet ? prepareImportRows(selectedSheet, headerRow, moduleId, mapping) : []),
    [selectedSheet, headerRow, moduleId, mapping],
  );
  const stagedRows = useMemo(() => staged.flatMap((item) => item.rows), [staged]);
  const preview = useMemo(
    () => buildImportPlan(state, stagedRows, role),
    [state, stagedRows, role],
  );
  const readyCount = preview.results.filter((item) => item.status === "ready").length;

  function updateSelection(nextWorkbook: ExcelWorkbookData, nextSheet: ExcelSheetData) {
    const detectedHeader = suggestHeaderRow(nextSheet);
    const detectedModule = suggestImportModule(nextSheet, detectedHeader) ?? "contacts";
    setWorkbook(nextWorkbook);
    setSheetName(nextSheet.name);
    setHeaderRow(detectedHeader);
    setModuleId(detectedModule);
    setMapping(autoMapColumns(nextSheet, detectedHeader, detectedModule));
    setStaged([]);
    setError("");
  }

  async function loadFile(file: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const loaded = await readExcelWorkbook(file);
      const first = loaded.sheets.find((sheet) => sheet.rows.length > 0);
      if (!first) throw new Error("El libro no contiene hojas con filas.");
      updateSelection(loaded, first);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo leer el archivo Excel.");
    } finally {
      setBusy(false);
    }
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) await loadFile(file);
  }

  async function loadBundledCatalogSample() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `${import.meta.env.BASE_URL}sample-data/catalogo-uci-online-retail-pyme360.xlsx`,
      );
      if (!response.ok) throw new Error("No se pudo cargar el catálogo de muestra.");
      const file = new File(
        [await response.arrayBuffer()],
        "catalogo-uci-online-retail-pyme360.xlsx",
        { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      );
      const loaded = await readExcelWorkbook(file);
      const sampleSheet = loaded.sheets.find((sheet) => sheet.name === "Catalogo importable");
      if (!sampleSheet) throw new Error("El libro no contiene la hoja Catalogo importable.");
      setWorkbook(loaded);
      setSheetName(sampleSheet.name);
      setHeaderRow(0);
      setModuleId("products");
      const sampleMapping = mapBundledCatalogSampleColumns(sampleSheet);
      setMapping(sampleMapping);
      setStaged([
        {
          sheetName: sampleSheet.name,
          moduleId: "products",
          rows: prepareImportRows(sampleSheet, 0, "products", sampleMapping),
        },
      ]);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo abrir la muestra Excel.");
    } finally {
      setBusy(false);
    }
  }

  function changeSheet(name: string) {
    if (!workbook) return;
    const nextSheet = workbook.sheets.find((sheet) => sheet.name === name);
    if (!nextSheet) return;
    const detectedHeader = suggestHeaderRow(nextSheet);
    const detectedModule = suggestImportModule(nextSheet, detectedHeader) ?? moduleId;
    setSheetName(name);
    setHeaderRow(detectedHeader);
    setModuleId(detectedModule);
    setMapping(autoMapColumns(nextSheet, detectedHeader, detectedModule));
  }

  function changeModule(nextModule: ImportModuleId) {
    setModuleId(nextModule);
    if (selectedSheet) setMapping(autoMapColumns(selectedSheet, headerRow, nextModule));
  }

  function changeHeaderRow(value: string) {
    const parsed = Math.max(0, Number(value) - 1);
    setHeaderRow(parsed);
    if (selectedSheet) setMapping(autoMapColumns(selectedSheet, parsed, moduleId));
  }

  function addCurrentSheet() {
    if (!selectedSheet) return;
    if (isComputedImportSheet(selectedSheet.name)) {
      setError(
        "Esta hoja es un resumen calculado; se obtiene de nuevo a partir de los registros base y no se importa.",
      );
      return;
    }
    const prepared = prepareImportRows(selectedSheet, headerRow, moduleId, mapping);
    setStaged((current) => [
      ...current.filter((item) => item.sheetName !== selectedSheet.name),
      { sheetName: selectedSheet.name, moduleId, rows: prepared },
    ]);
    setError("");
  }

  function addRecognizedSheets() {
    if (!workbook) return;
    const recognized: StagedSheet[] = [];
    for (const sheet of workbook.sheets) {
      const detectedHeader = suggestHeaderRow(sheet);
      const detectedModule = suggestImportModule(sheet, detectedHeader);
      if (!detectedModule) continue;
      const detectedMapping = autoMapColumns(sheet, detectedHeader, detectedModule);
      const definition = getImportModule(detectedModule);
      if (definition.autoRequired?.some((key) => detectedMapping[key] === null)) continue;
      const rows = prepareImportRows(sheet, detectedHeader, detectedModule, detectedMapping);
      if (rows.length) recognized.push({ sheetName: sheet.name, moduleId: detectedModule, rows });
    }
    if (!recognized.length) {
      setError(
        "No se encontraron hojas reconocibles con las columnas básicas. Selecciona la hoja y mapea sus columnas manualmente.",
      );
      return;
    }
    setStaged((current) => {
      const bySheet = new Map(current.map((item) => [item.sheetName, item]));
      for (const item of recognized) bySheet.set(item.sheetName, item);
      return [...bySheet.values()];
    });
    setError("");
  }

  async function confirmImport() {
    if (!preview.added) return;
    const summary = `Se procesarán ${readyCount} filas válidas. Se agregarán sus registros base y los movimientos iniciales que correspondan. ${preview.duplicates} duplicadas y ${preview.errors} con error se omitirán. ¿Continuar?`;
    if (!window.confirm(summary)) return;
    setBusy(true);
    try {
      const saved = await onCommit(preview.state);
      if (saved) onClose();
    } finally {
      setBusy(false);
    }
  }

  const headerCells = selectedSheet?.rows[headerRow] ?? [];
  const resultLabel: Record<string, string> = {
    ready: "Lista",
    error: "Error",
    duplicate: "Duplicada",
    warning: "Advertencia",
    blocked: "Bloqueada",
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="modal excel-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="excel-import-title"
      >
        <header className="modal-header">
          <div>
            <h2 id="excel-import-title">Importar datos desde Excel</h2>
            <p>El archivo se lee en este navegador. Solo las filas válidas se guardan en SQLite.</p>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Cerrar asistente"
          >
            ×
          </button>
        </header>
        <div className="modal-body excel-import-body">
          <div className="excel-import-toolbar">
            <label className="button button-primary">
              {busy ? "Procesando…" : "Seleccionar .xlsx o .xls"}
              <input
                type="file"
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                hidden
                disabled={busy}
                onChange={(event) => void chooseFile(event)}
              />
            </label>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => {
                try {
                  downloadImportTemplate();
                } catch (reason) {
                  setError(
                    reason instanceof Error ? reason.message : "No se pudo crear la plantilla.",
                  );
                }
              }}
            >
              Descargar plantilla
            </button>
            <button
              className="button button-secondary"
              type="button"
              disabled={busy}
              onClick={() => void loadBundledCatalogSample()}
            >
              {busy ? "Cargando libro…" : "Cargar catálogo de muestra"}
            </button>
            {workbook && (
              <button
                className="button button-secondary"
                type="button"
                onClick={addRecognizedSheets}
              >
                Reconocer hojas del libro maestro
              </button>
            )}
            {workbook && (
              <span className="field-hint">
                {workbook.fileName} · {workbook.sheets.length} hoja(s)
              </span>
            )}
          </div>
          {error && (
            <div className="notice warning" role="alert">
              {error}
            </div>
          )}
          {workbook && selectedSheet && (
            <>
              <section className="excel-import-section">
                <div className="excel-import-section-heading">
                  <div>
                    <strong>1. Selecciona la hoja y el módulo</strong>
                    <span>La detección es una sugerencia; confirma el mapeo antes de agregar.</span>
                  </div>
                </div>
                <div className="excel-import-controls">
                  <label className="field">
                    <span>Hoja del archivo</span>
                    <select value={sheetName} onChange={(event) => changeSheet(event.target.value)}>
                      {workbook.sheets.map((sheet) => (
                        <option key={sheet.name} value={sheet.name}>
                          {sheet.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Módulo Pyme360</span>
                    <select
                      value={moduleId}
                      onChange={(event) => changeModule(event.target.value as ImportModuleId)}
                    >
                      {IMPORT_MODULES.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                          {item.adminOnly ? " · administrador" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Fila de encabezados</span>
                    <input
                      type="number"
                      min={1}
                      max={Math.max(selectedSheet.rows.length, 1)}
                      value={headerRow + 1}
                      onChange={(event) => changeHeaderRow(event.target.value)}
                    />
                  </label>
                </div>
                {role !== "admin" && module.adminOnly && (
                  <div className="notice warning">
                    Este módulo requiere permisos de administrador. Sus filas aparecerán bloqueadas
                    en la vista previa.
                  </div>
                )}
              </section>
              <section className="excel-import-section">
                <div className="excel-import-section-heading">
                  <div>
                    <strong>2. Relaciona las columnas</strong>
                    <span>
                      Los campos sin asignar pueden quedar vacíos si no son obligatorios. Las
                      columnas restantes se conservan en Datos adicionales.
                    </span>
                  </div>
                </div>
                <div className="excel-mapping-grid">
                  {module.fields.map((definition) => (
                    <label className="field" key={definition.key}>
                      <span>
                        {definition.label}
                        {definition.required ? " *" : ""}
                      </span>
                      <select
                        value={mapping[definition.key] ?? ""}
                        onChange={(event) =>
                          setMapping((current) => ({
                            ...current,
                            [definition.key]:
                              event.target.value === "" ? null : Number(event.target.value),
                          }))
                        }
                      >
                        <option value="">No asignar</option>
                        {headerCells.map((cell, index) => (
                          <option key={`${index}-${String(cell)}`} value={index}>
                            {String(cell || `Columna ${index + 1}`)} · {index + 1}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <div className="excel-import-actions">
                  <span className="field-hint">
                    {isComputedImportSheet(selectedSheet.name)
                      ? "Hoja calculada: no se importa."
                      : `${currentRows.length} fila(s) de datos detectadas en esta hoja.`}
                  </span>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={isComputedImportSheet(selectedSheet.name)}
                    onClick={addCurrentSheet}
                  >
                    Agregar / reemplazar hoja en el lote
                  </button>
                </div>
              </section>
              <section className="excel-import-section">
                <div className="excel-import-section-heading">
                  <div>
                    <strong>3. Vista previa y confirmación</strong>
                    <span>
                      Agrega las hojas que necesites; el lote se guardará con una sola operación
                      SQLite.
                    </span>
                  </div>
                </div>
                {staged.length > 0 ? (
                  <>
                    <div className="excel-import-staged">
                      {staged.map((item) => (
                        <div className="alert-item" key={item.sheetName}>
                          <div>
                            <strong>{item.sheetName}</strong>
                            <span>
                              {moduleName(item.moduleId)} · {item.rows.length} fila(s)
                            </span>
                          </div>
                          <button
                            className="icon-button"
                            type="button"
                            aria-label={`Quitar ${item.sheetName}`}
                            onClick={() =>
                              setStaged((current) =>
                                current.filter((entry) => entry.sheetName !== item.sheetName),
                              )
                            }
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="excel-import-summary">
                      <span>
                        <strong>{readyCount}</strong> listas
                      </span>
                      <span>
                        <strong>{preview.duplicates}</strong> duplicadas
                      </span>
                      <span>
                        <strong>{preview.errors}</strong> con error
                      </span>
                      <span>
                        <strong>{preview.blocked}</strong> bloqueadas
                      </span>
                      <span>
                        <strong>{preview.warnings}</strong> advertencias
                      </span>
                    </div>
                    <div className="table-wrap excel-import-results">
                      <table>
                        <thead>
                          <tr>
                            <th>Hoja</th>
                            <th>Fila</th>
                            <th>Módulo</th>
                            <th>Resultado</th>
                            <th>Detalle</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.results.slice(0, 250).map((result) => (
                            <tr key={`${result.moduleId}-${result.sheetName}-${result.sourceRow}`}>
                              <td>{result.sheetName}</td>
                              <td>{result.sourceRow}</td>
                              <td>{moduleName(result.moduleId)}</td>
                              <td>
                                <span className={`import-status import-status-${result.status}`}>
                                  {resultLabel[result.status]}
                                </span>
                              </td>
                              <td>{result.message}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {preview.results.length > 250 && (
                        <p className="field-hint">
                          Se muestran las primeras 250 filas; la validación considera todas.
                        </p>
                      )}
                    </div>
                    <div className="notice">
                      Las hojas de saldos por cobrar/pagar e indicadores se omiten porque se
                      calculan de nuevo. Las ventas, compras, pagos u órdenes importados no crean
                      movimientos de inventario o caja; esos libros solo reciben movimientos de sus
                      hojas explícitas.
                    </div>
                    <footer className="modal-footer">
                      <button
                        className="button button-secondary"
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                      >
                        Cancelar
                      </button>
                      <button
                        className="button button-primary"
                        type="button"
                        onClick={() => void confirmImport()}
                        disabled={busy || !preview.added}
                      >
                        {busy ? "Guardando lote…" : `Importar ${readyCount} fila(s) válida(s)`}
                      </button>
                    </footer>
                  </>
                ) : (
                  <div className="empty-state">
                    Agrega una hoja para preparar la vista previa. Puedes incluir varias hojas del
                    mismo libro en un solo lote.
                  </div>
                )}
              </section>
            </>
          )}
          {!workbook && !error && (
            <div className="excel-import-empty">
              <strong>Selecciona un libro Excel</strong>
              <span>Admite .xlsx y .xls · máximo 10 MB y 10.000 filas por libro.</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
