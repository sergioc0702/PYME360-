import { useMemo, useState } from "react";
import type { AppState } from "../../domain/types";
import type { ExcelWorkbookData } from "../../features/spreadsheets/excel-import";
import {
  analyzeWorkbook,
  buildSmartRows,
  COLUMN_CONCEPTS,
  type ColumnConcept,
  type ContactRoleChoice,
  type SheetAnalysis,
  type SheetKind,
  type SmartSheetResult,
} from "../../features/spreadsheets/smart-import";

const KIND_LABELS: Record<SheetKind, string> = {
  sales: "Ventas",
  purchases: "Compras",
  contacts: "Clientes y proveedores",
  products: "Productos",
};

function certainty(confidence: number): string {
  if (confidence >= 0.8) return "Seguro";
  if (confidence >= 0.6) return "Probable";
  return "Revisar";
}

/** Propone a qué sección va cada hoja y columna; el usuario corrige y confirma. */
export function SmartImportPanel({
  workbook,
  state,
  onUse,
}: {
  workbook: ExcelWorkbookData;
  state: AppState;
  onUse: (results: SmartSheetResult[]) => void;
}) {
  const [analyses, setAnalyses] = useState<SheetAnalysis[]>(() => analyzeWorkbook(workbook));
  const results = useMemo(
    () => buildSmartRows(workbook, analyses, state),
    [workbook, analyses, state],
  );

  function update(sheetName: string, change: (item: SheetAnalysis) => SheetAnalysis) {
    setAnalyses((current) =>
      current.map((item) => (item.sheetName === sheetName ? change(item) : item)),
    );
  }

  function setConcept(sheetName: string, index: number, value: string) {
    update(sheetName, (item) => ({
      ...item,
      columns: item.columns.map((column) => {
        if (column.index === index)
          return {
            ...column,
            concept: (value || null) as ColumnConcept | null,
            confidence: value ? 1 : 0,
          };
        return column.concept === value ? { ...column, concept: null, confidence: 0 } : column;
      }),
    }));
  }

  return (
    <section className="excel-import-section">
      <div className="excel-import-section-heading">
        <div>
          <strong>Esto encontramos en tu archivo</strong>
          <span>Revisa la propuesta y corrige lo que no esté bien. Nada se guarda todavía.</span>
        </div>
      </div>
      {analyses.map((analysis) => {
        const result = results.find((item) => item.sheetName === analysis.sheetName);
        const unplaced = analysis.columns.filter((column) => !column.concept);
        return (
          <details key={analysis.sheetName} open={analyses.length === 1}>
            <summary>
              <strong>{analysis.sheetName}</strong>
              {" · "}
              {analysis.kind ? KIND_LABELS[analysis.kind] : "No reconocida"}
              {result &&
                ` · ${result.records} registro(s), ${result.newContacts} contacto(s) y ${result.newProducts} producto(s) nuevos`}
            </summary>
            <div className="excel-import-controls">
              <label className="field">
                <span>Esta hoja tiene</span>
                <select
                  value={analysis.kind ?? ""}
                  onChange={(event) =>
                    update(analysis.sheetName, (item) => ({
                      ...item,
                      kind: (event.target.value || null) as SheetKind | null,
                    }))
                  }
                >
                  <option value="">No importar</option>
                  {Object.entries(KIND_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {analysis.kind === "contacts" && (
                <label className="field">
                  <span>Estos contactos son</span>
                  <select
                    value={analysis.contactRole}
                    onChange={(event) =>
                      update(analysis.sheetName, (item) => ({
                        ...item,
                        contactRole: event.target.value as ContactRoleChoice,
                      }))
                    }
                  >
                    <option value="cliente">Clientes</option>
                    <option value="proveedor">Proveedores</option>
                    <option value="ambos">Clientes y proveedores</option>
                  </select>
                </label>
              )}
            </div>
            {analysis.kind === "contacts" && !analysis.roleDetected && (
              <div className="notice warning">
                No sabemos si son clientes o proveedores. Elígelo arriba.
              </div>
            )}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Columna de tu archivo</th>
                    <th>Es</th>
                    <th>Seguridad</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.columns.map((column) => (
                    <tr key={column.index}>
                      <td>{column.header}</td>
                      <td>
                        <select
                          aria-label={`Qué es ${column.header}`}
                          value={column.concept ?? ""}
                          onChange={(event) =>
                            setConcept(analysis.sheetName, column.index, event.target.value)
                          }
                        >
                          <option value="">Guardar aparte</option>
                          {Object.entries(COLUMN_CONCEPTS).map(([value, item]) => (
                            <option key={value} value={value}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{column.concept ? certainty(column.confidence) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {unplaced.length > 0 && (
              <span className="field-hint">
                Sin sección: {unplaced.map((column) => column.header).join(", ")}. Se conservan en
                la hoja Datos adicionales del Excel.
              </span>
            )}
          </details>
        );
      })}
      <div className="excel-import-actions">
        <span className="field-hint">
          Las ventas entran sin pagos y las compras con su saldo por revisar. No cambian el
          inventario ni la caja.
        </span>
        <button
          className="button button-primary"
          type="button"
          disabled={!results.some((item) => item.rows.length)}
          onClick={() => onUse(results)}
        >
          Usar esta propuesta
        </button>
      </div>
    </section>
  );
}
