import { useState } from "react";
import { calculateMonthlyEnvironmentalMetrics } from "../../domain/environmental";
import {
  buildSavingsSuggestions,
  calculateProductFootprint,
  calculateSavings,
  defaultBasePeriod,
  type ResourceSavings,
  type SavingsSuggestion,
} from "../../domain/insights";
import type { AppState } from "../../domain/types";
import { downloadEnvironmentalReport } from "../../features/environment/report";
import { formatPeriod } from "../../shared/format";
import { EmptyState, Panel, formatMoney, formatNumber } from "../AppViews";

function savedLabel(item: ResourceSavings | null, name: string): string {
  if (!item) return `${name}: faltan datos`;
  const word = item.savedQuantity >= 0 ? "ahorro" : "aumento";
  return `${name}: ${word} de ${formatNumber(Math.abs(item.savedQuantity), 1)} ${item.unit}`;
}

/** Ahorro frente al mes base, consumo por producto, sugerencias e informe. */
export function SavingsPanel({
  state,
  canEdit,
  onAddAction,
  onError,
}: {
  state: AppState;
  canEdit: boolean;
  onAddAction: (suggestion: SavingsSuggestion) => void;
  onError: (message: string) => void;
}) {
  const metrics = calculateMonthlyEnvironmentalMetrics(state);
  const periods = metrics.filter((item) => item.dataCoveragePercent > 0).map((item) => item.period);
  const [chosenBase, setChosenBase] = useState<string | null>(null);
  const [chosenPeriod, setChosenPeriod] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const period = chosenPeriod ?? periods.at(-1) ?? null;
  const base = chosenBase ?? defaultBasePeriod(state, metrics);

  if (!period)
    return (
      <Panel title="Ahorro" description="Compara tus meses y mira cuánto estás ahorrando.">
        <EmptyState>Registra tu primer consumo para ver esta parte.</EmptyState>
      </Panel>
    );

  const savings = base ? calculateSavings(state, base, period, metrics) : null;
  const footprint = calculateProductFootprint(state, period, metrics);
  const suggestions = buildSavingsSuggestions(state, period, base, metrics);

  async function download() {
    setDownloading(true);
    try {
      await downloadEnvironmentalReport(state, period!, base);
    } catch {
      onError("No se pudo crear el informe.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Panel
      title="Ahorro"
      description="Compara un mes con tu mes base y mira el resultado en pesos, consumo y CO₂."
      action={
        <button
          className="button button-secondary button-small"
          disabled={downloading}
          onClick={() => void download()}
        >
          {downloading ? "Creando informe…" : "Descargar informe PDF"}
        </button>
      }
    >
      <div className="panel-body">
        <div className="form-grid">
          <div className="field">
            <label htmlFor="savings-base">Mes base</label>
            <select
              id="savings-base"
              value={base ?? ""}
              onChange={(event) => setChosenBase(event.target.value)}
            >
              {periods.map((item) => (
                <option key={item} value={item}>
                  {formatPeriod(item)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="savings-period">Mes a revisar</label>
            <select
              id="savings-period"
              value={period}
              onChange={(event) => setChosenPeriod(event.target.value)}
            >
              {periods.map((item) => (
                <option key={item} value={item}>
                  {formatPeriod(item)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {savings ? (
          <div className="environment-list">
            <article className="environment-list-item">
              <div className="environment-list-main">
                <strong>
                  {savings.totalPesos === null
                    ? "Agrega el valor pagado para ver el ahorro en pesos"
                    : `${savings.totalPesos >= 0 ? "Ahorro" : "Gasto adicional"} de ${formatMoney(Math.abs(savings.totalPesos))}`}
                </strong>
                <span>{savedLabel(savings.electricity, "Energía")}</span>
                <span>{savedLabel(savings.water, "Agua")}</span>
                {savings.totalKgCo2e !== null && (
                  <span>
                    CO₂: {savings.totalKgCo2e >= 0 ? "evitaste" : "aumentó"}{" "}
                    {formatNumber(Math.abs(savings.totalKgCo2e), 1)} kg
                  </span>
                )}
              </div>
            </article>
          </div>
        ) : (
          <div className="notice">
            Elige un mes base anterior al mes a revisar. Hacen falta datos de al menos dos meses.
          </div>
        )}

        <h3>Consumo por producto</h3>
        {footprint.length ? (
          <>
            <div className="environment-list">
              {footprint.map((row) => (
                <article className="environment-list-item" key={row.productId}>
                  <div className="environment-list-main">
                    <strong>{row.productName}</strong>
                    <span>
                      {formatNumber(row.goodUnits, 0)} unidades ·{" "}
                      {row.electricityKwh === null
                        ? "sin dato de energía"
                        : `${formatNumber(row.electricityKwh, 1)} kWh`}
                      {row.kgCo2e !== null && ` · ${formatNumber(row.kgCo2e, 1)} kg CO₂`}
                      {row.energyCost !== null && ` · ${formatMoney(row.energyCost)} de energía`}
                    </span>
                  </div>
                </article>
              ))}
            </div>
            <div className="notice">
              Es una aproximación: el consumo del mes se reparte según las unidades terminadas.
            </div>
          </>
        ) : (
          <EmptyState>Termina una orden de producción en este mes para ver esta parte.</EmptyState>
        )}

        <h3>Qué puedes hacer</h3>
        {suggestions.length ? (
          <div className="environment-list">
            {suggestions.map((item) => (
              <article className="environment-list-item" key={item.id}>
                <div className="environment-list-main">
                  <strong>{item.title}</strong>
                  <span>{item.reason}</span>
                </div>
                {canEdit && (
                  <div className="table-actions">
                    <button
                      className="button button-secondary button-small"
                      onClick={() => onAddAction(item)}
                    >
                      Agregar al plan
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState>No hay sugerencias nuevas para este mes.</EmptyState>
        )}
      </div>
    </Panel>
  );
}
