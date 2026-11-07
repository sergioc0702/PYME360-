import { useState, type ReactNode } from "react";
import {
  calculateMonthlyEnvironmentalMetrics,
  type MonthlyEnvironmentalMetrics,
} from "../../domain/environmental";
import {
  buildSavingsSuggestions,
  calculateSavings,
  defaultBasePeriod,
  latestConsumptionPeriod,
  type ResourceSavings,
  type SavingsSuggestion,
} from "../../domain/insights";
import type { AppState } from "../../domain/types";
import { downloadEnvironmentalReport } from "../../features/environment/report";
import { formatPeriod } from "../../shared/format";
import { formatMoney, formatNumber } from "../AppViews";
import { ParcelMap } from "./ParcelMap";

const MONTHS_SHOWN = 6;
const SHORT_MONTHS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

function shift(period: string, months: number): string {
  const [year, month] = period.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  return date.toISOString().slice(0, 7);
}

function savedPhrase(item: ResourceSavings | null, name: string): string {
  if (!item) return `${name}: faltan datos de uno de los dos meses.`;
  const amount = `${formatNumber(Math.abs(item.savedQuantity), 1)} ${item.unit}`;
  const adjusted = item.basis === "per-unit" ? " para lo que produjiste" : "";
  return `${name}: ${amount} ${item.savedQuantity >= 0 ? "menos" : "más"}${adjusted}.`;
}

function MonthBars({
  metrics,
  period,
  base,
}: {
  metrics: MonthlyEnvironmentalMetrics[];
  period: string;
  base: string | null;
}) {
  const [resource, setResource] = useState<"energy" | "water">("energy");
  const unit = resource === "energy" ? "kWh" : "m³";
  const months = Array.from({ length: MONTHS_SHOWN }, (_, index) => {
    const key = shift(period, index - MONTHS_SHOWN + 1);
    const row = metrics.find((item) => item.period === key);
    return {
      key,
      value: (resource === "energy" ? row?.electricityKwh : row?.waterWithdrawalM3) ?? null,
    };
  });
  const highest = Math.max(1, ...months.map((item) => item.value ?? 0));
  return (
    <>
      <div className="screen-tabs" role="group" aria-label="Qué consumo ver">
        {(
          [
            ["energy", "Energía"],
            ["water", "Agua"],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            aria-pressed={resource === value}
            onClick={() => setResource(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <ul className="consumo-bars">
        {months.map((item) => (
          <li
            key={item.key}
            className={
              item.key === period ? "is-current" : item.key === base ? "is-base" : undefined
            }
          >
            <span className="consumo-bar-value">
              {item.value === null ? "Sin dato" : formatNumber(item.value, 0)}
            </span>
            <i style={{ height: `${((item.value ?? 0) / highest) * 100}%` }} aria-hidden="true" />
            <span className="consumo-bar-month">
              {SHORT_MONTHS[Number(item.key.slice(5)) - 1]}
              {item.key === base ? " (base)" : ""}
            </span>
          </li>
        ))}
      </ul>
      <p className="screen-note">Consumo en {unit} de los últimos meses, como en tu recibo.</p>
    </>
  );
}

/** Panel de la pantalla: cuánto ahorras, cómo cambia cada mes y qué puedes hacer. */
export function ConsumptionDashboard({
  state,
  canEdit,
  alerts,
  plan,
  onNewReading,
  onImport,
  onAddAction,
  onNewAction,
  onError,
}: {
  state: AppState;
  canEdit: boolean;
  alerts: ReactNode;
  plan: ReactNode;
  onNewReading: () => void;
  onImport: (file: File) => void;
  onAddAction: (suggestion: SavingsSuggestion) => void;
  onNewAction: () => void;
  onError: (message: string) => void;
}) {
  const metrics = calculateMonthlyEnvironmentalMetrics(state);
  const periods = metrics.filter((item) => item.dataCoveragePercent > 0).map((item) => item.period);
  const [chosenBase, setChosenBase] = useState<string | null>(null);
  const [chosenPeriod, setChosenPeriod] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const period = chosenPeriod ?? latestConsumptionPeriod(metrics) ?? periods.at(-1) ?? null;
  const base = chosenBase ?? defaultBasePeriod(state, metrics);
  const month = metrics.find((item) => item.period === period);
  const savings = base && period ? calculateSavings(state, base, period, metrics) : null;
  const suggestions = period ? buildSavingsSuggestions(state, period, base, metrics) : [];
  const saved = savings?.totalPesos ?? null;
  const carbon =
    month && (month.scope1KgCo2e !== null || month.scope2KgCo2e !== null)
      ? (month.scope1KgCo2e ?? 0) + (month.scope2KgCo2e ?? 0)
      : null;
  const waterPerUnit =
    month?.waterWithdrawalM3 != null && month.productionUnits
      ? month.waterWithdrawalM3 / month.productionUnits
      : null;

  async function download() {
    if (!period) return;
    setDownloading(true);
    try {
      await downloadEnvironmentalReport(state, period, base);
    } catch {
      onError("No se pudo crear el informe.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="screen consumo">
      <header className="screen-header">
        <h1>Consumo y ahorro</h1>
        <div className="screen-actions">
          {canEdit && (
            <>
              <button className="action-primary" type="button" onClick={onNewReading}>
                Registrar consumo
              </button>
              <label className="action-secondary">
                Subir recibo
                <input
                  type="file"
                  hidden
                  accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) onImport(file);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </>
          )}
          {period && (
            <button
              className="action-secondary"
              type="button"
              disabled={downloading}
              onClick={() => void download()}
            >
              {downloading ? "Creando informe…" : "Descargar informe"}
            </button>
          )}
        </div>
      </header>

      {!period ? (
        <p className="screen-empty">
          Registra tu primer recibo de energía o de agua. Con dos meses ya podrás ver cuánto
          ahorras.
        </p>
      ) : (
        <>
          <div className="consumo-months">
            <label>
              <span>Mes a revisar</span>
              <select value={period} onChange={(event) => setChosenPeriod(event.target.value)}>
                {periods.map((item) => (
                  <option key={item} value={item}>
                    {formatPeriod(item)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Comparar con</span>
              <select value={base ?? ""} onChange={(event) => setChosenBase(event.target.value)}>
                {periods.map((item) => (
                  <option key={item} value={item}>
                    {formatPeriod(item)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="consumo-grid">
            <section aria-labelledby="consumo-ahorro">
              <h2 id="consumo-ahorro">Tu ahorro</h2>
              {savings ? (
                <>
                  <p className={`home-saved${saved !== null && saved < 0 ? " is-loss" : ""}`}>
                    {saved === null
                      ? "Falta el valor pagado"
                      : `${saved < 0 ? "− " : ""}${formatMoney(Math.abs(saved))}`}
                  </p>
                  <p className="screen-note">
                    {saved === null
                      ? "Agrégalo a tus recibos para verlo en pesos."
                      : saved < 0
                        ? `Gastaste más en ${formatPeriod(savings.period)} que en ${formatPeriod(savings.basePeriod)}.`
                        : `En ${formatPeriod(savings.period)} frente a ${formatPeriod(savings.basePeriod)}.`}
                  </p>
                  <ul className="consumo-phrases">
                    <li>{savedPhrase(savings.electricity, "Energía")}</li>
                    <li>{savedPhrase(savings.water, "Agua")}</li>
                    {savings.totalKgCo2e !== null && (
                      <li>
                        CO₂: {formatNumber(Math.abs(savings.totalKgCo2e), 0)} kg{" "}
                        {savings.totalKgCo2e >= 0 ? "menos" : "más"}.
                      </li>
                    )}
                  </ul>
                </>
              ) : (
                <p className="screen-empty">
                  Elige en "Comparar con" un mes anterior al mes a revisar. Si tienes un solo mes,
                  registra otro para comparar.
                </p>
              )}

              <h2>Mes a mes</h2>
              <MonthBars metrics={metrics} period={period} base={base} />

              <h2>Cuánto gastas por unidad</h2>
              {month?.productionUnits ? (
                <dl className="home-facts">
                  <div>
                    <dt>Energía</dt>
                    <dd>
                      {month.energyPerUnit === null
                        ? "Sin dato"
                        : `${formatNumber(month.energyPerUnit, 2)} kWh`}
                    </dd>
                  </div>
                  <div>
                    <dt>Agua</dt>
                    <dd>
                      {waterPerUnit === null ? "Sin dato" : `${formatNumber(waterPerUnit, 2)} m³`}
                    </dd>
                  </div>
                  <div>
                    <dt>Unidades hechas</dt>
                    <dd>{formatNumber(month.productionUnits, 0)}</dd>
                  </div>
                </dl>
              ) : (
                <p className="screen-empty">
                  Termina órdenes de producción en este mes para verlo.
                </p>
              )}
            </section>

            <aside aria-labelledby="consumo-parcelas">
              <h2 id="consumo-parcelas">En qué se va tu consumo</h2>
              <ParcelMap state={state} period={period} />
              {carbon !== null && (
                <>
                  <h2>Tu huella de carbono</h2>
                  <p className="consumo-carbon">{formatNumber(carbon, 0)} kg de CO₂</p>
                  <p className="screen-note">
                    En {formatPeriod(period)}, por energía y combustibles.
                  </p>
                </>
              )}
            </aside>
          </div>
        </>
      )}

      {alerts}

      <section aria-labelledby="consumo-plan">
        <div className="screen-section-heading">
          <h2 id="consumo-plan">Tu plan de ahorro</h2>
          {canEdit && (
            <button className="action-secondary" type="button" onClick={onNewAction}>
              Agregar medida
            </button>
          )}
        </div>
        {suggestions.length > 0 && (
          <ul className="task-list">
            {suggestions.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.reason}</span>
                </div>
                {canEdit && (
                  <button
                    className="action-secondary"
                    type="button"
                    onClick={() => onAddAction(item)}
                  >
                    Agregar al plan
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {plan}
      </section>
    </div>
  );
}
