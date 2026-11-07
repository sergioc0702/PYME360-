import { useState } from "react";
import { outstandingBalance } from "../../domain/business";
import { calculateMonthlyEnvironmentalMetrics } from "../../domain/environmental";
import {
  calculateSavings,
  defaultBasePeriod,
  latestConsumptionPeriod,
} from "../../domain/insights";
import { buildTodayTasks, type TaskTarget } from "../../domain/today";
import type { AppState } from "../../domain/types";
import { formatPeriod, pluralize } from "../../shared/format";
import { ParcelMap } from "./ParcelMap";
import { currentMonth, formatDate, formatMoney, formatNumber, today } from "../AppViews";

const VISIBLE_TASKS = 6;

function longDate(date: string): string {
  const text = new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Pantalla de inicio: primero qué hacer hoy, después cómo va el ahorro y el negocio. */
export function HomePage({
  state,
  canEdit,
  isAdmin,
  onTask,
}: {
  state: AppState;
  canEdit: boolean;
  isAdmin: boolean;
  onTask: (target: TaskTarget) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const date = today();
  const tasks = buildTodayTasks(state, date);
  const metrics = calculateMonthlyEnvironmentalMetrics(state);
  const withData = metrics.filter((item) => item.dataCoveragePercent > 0);
  const latest = latestConsumptionPeriod(metrics) ?? withData.at(-1)?.period ?? null;
  const base = defaultBasePeriod(state, metrics);
  const savings = base && latest ? calculateSavings(state, base, latest, metrics) : null;
  const month = currentMonth();
  const monthSales = state.sales
    .filter((sale) => sale.date.startsWith(month))
    .reduce((sum, sale) => sum + sale.total, 0);
  const receivable = state.sales.reduce(
    (sum, sale) => sum + outstandingBalance(sale, state.electronicDocuments),
    0,
  );
  const toRestock = state.products.filter(
    (product) => product.minimumStock > 0 && product.stock < product.minimumStock,
  ).length;
  const recentSales = state.sales.slice(0, 5);
  const saved = savings?.totalPesos ?? null;

  return (
    <div className="screen home">
      <section className="home-main" aria-labelledby="home-title">
        <h1 id="home-title">
          {tasks.length
            ? `Hoy te ${tasks.length === 1 ? "falta 1 cosa" : `faltan ${tasks.length} cosas`}`
            : "Hoy estás al día"}
        </h1>
        <p className="home-date">
          {longDate(date)}
          {state.company ? ` · ${state.company.name}` : ""}
        </p>
        {tasks.length > 0 ? (
          <ul className="task-list">
            {(showAll ? tasks : tasks.slice(0, VISIBLE_TASKS)).map((task) => (
              <li key={task.id}>
                <div>
                  <strong>{task.title}</strong>
                  <span>{task.reason}</span>
                </div>
                {(task.target === "company" ? isAdmin : canEdit) && (
                  <button
                    className={`action-primary${task.urgent ? " is-urgent" : ""}`}
                    type="button"
                    onClick={() => onTask(task.target)}
                  >
                    {task.actionLabel}
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="screen-empty">No tienes nada pendiente. Buen trabajo.</p>
        )}
        {tasks.length > VISIBLE_TASKS && (
          <button className="home-more" type="button" onClick={() => setShowAll(!showAll)}>
            {showAll ? "Ver menos" : `Ver ${tasks.length - VISIBLE_TASKS} más`}
          </button>
        )}

        <div className="home-business">
          <h2>Cómo va el negocio</h2>
          <dl className="screen-facts">
            <div>
              <dt>Vendido este mes</dt>
              <dd>{formatMoney(monthSales)}</dd>
            </div>
            <div>
              <dt>Por cobrar</dt>
              <dd>{formatMoney(receivable)}</dd>
            </div>
            <div>
              <dt>Por reponer</dt>
              <dd>{pluralize(toRestock, "producto", "productos")}</dd>
            </div>
          </dl>
          {recentSales.length > 0 && (
            <>
              <h2>Últimas ventas</h2>
              <ul className="home-sales">
                {recentSales.map((sale) => (
                  <li key={sale.id}>
                    <span>
                      {sale.customerName}
                      <small>
                        {sale.number} · {formatDate(sale.date)}
                      </small>
                    </span>
                    <strong>{formatMoney(sale.total)}</strong>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>

      <aside className="home-side" aria-label="Tu ahorro">
        <h2>Tu ahorro</h2>
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
              {savings.electricity &&
                ` Energía: ${formatNumber(Math.abs(savings.electricity.savedQuantity), 0)} kWh ${savings.electricity.savedQuantity >= 0 ? "menos" : "más"}.`}
              {savings.totalKgCo2e !== null &&
                ` CO₂: ${formatNumber(Math.abs(savings.totalKgCo2e), 0)} kg ${savings.totalKgCo2e >= 0 ? "menos" : "más"}.`}
            </p>
          </>
        ) : (
          <p className="screen-empty">
            Registra los recibos de dos meses para ver cuánto estás ahorrando.
          </p>
        )}
        <h2>En qué se va tu consumo</h2>
        {latest ? (
          <ParcelMap state={state} period={latest} />
        ) : (
          <p className="screen-empty">
            Cuando registres tus recibos y tu producción, aquí verás en qué se va tu consumo.
          </p>
        )}
      </aside>
    </div>
  );
}
