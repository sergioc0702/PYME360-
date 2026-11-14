import { useState, type ReactNode } from "react";
import { financialAccountBalance, outstandingBalance, payableBalance } from "../../domain/business";
import type { AppState, Purchase, Sale } from "../../domain/types";
import { EmptyState, currentMonth, formatDate, formatMoney, today } from "../AppViews";

const LIST_LIMIT = 5;

/** Primero lo vencido; lo que no tiene fecha va al final. */
function byDueDate(a?: string, b?: string): number {
  return (a ?? "9999").localeCompare(b ?? "9999");
}

function dueText(number: string, dueDate?: string): ReactNode {
  if (!dueDate) return `${number} · sin fecha`;
  if (dueDate < today())
    return (
      <>
        {number} · <span className="is-low">venció el {formatDate(dueDate)}</span>
      </>
    );
  return `${number} · vence el ${formatDate(dueDate)}`;
}

function ShortList({ items, empty }: { items: ReactNode[]; empty: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!items.length) return <p className="screen-empty">{empty}</p>;
  return (
    <>
      <ul className="task-list">{expanded ? items : items.slice(0, LIST_LIMIT)}</ul>
      {items.length > LIST_LIMIT && (
        <button
          className="action-link"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Ver menos" : `Ver todas (${items.length})`}
        </button>
      )}
    </>
  );
}

/** Dinero: qué entró, qué salió, quién te debe y a quién le debes. */
export function FinancePage({
  state,
  canEdit,
  isAdmin,
  onAddAccount,
  onAddMovement,
  onCollectSale,
  onPayPurchase,
  onReviewPurchase,
}: {
  state: AppState;
  canEdit: boolean;
  isAdmin: boolean;
  onAddAccount: () => void;
  onAddMovement: () => void;
  onCollectSale: (sale: Sale) => void;
  onPayPurchase: (purchase: Purchase) => void;
  onReviewPurchase: (purchase: Purchase) => void;
}) {
  const receivables = state.sales
    .map((sale) => ({ sale, balance: outstandingBalance(sale, state.electronicDocuments) }))
    .filter((item) => item.balance > 0)
    .sort((a, b) => byDueDate(a.sale.dueDate, b.sale.dueDate));
  const payables = state.purchases
    .map((purchase) => ({
      purchase,
      balance: payableBalance(purchase),
      review: purchase.status === "received" && purchase.payableReviewStatus === "review_required",
    }))
    .filter((item) => item.balance > 0 || item.review)
    .sort((a, b) => byDueDate(a.purchase.dueDate, b.purchase.dueDate));
  const month = currentMonth();
  const monthTotal = (direction: "in" | "out") =>
    state.cashMovements
      .filter((movement) => movement.date.startsWith(month) && movement.direction === direction)
      .reduce((sum, movement) => sum + movement.amount, 0);
  const accountsTotal = state.financialAccounts.reduce(
    (sum, account) => sum + financialAccountBalance(state, account),
    0,
  );
  const hasActiveAccount = state.financialAccounts.some((account) => account.active);
  const recentCash = state.cashMovements
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
    .slice(0, 100);
  const accountName = (accountId?: string) =>
    state.financialAccounts.find((account) => account.id === accountId)?.name ?? "Sin asignar";

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>Dinero</h1>
        <div className="screen-actions">
          {canEdit && hasActiveAccount && (
            <button className="action-primary" type="button" onClick={onAddMovement}>
              Registrar entrada o salida
            </button>
          )}
          {isAdmin && !hasActiveAccount && (
            <button className="action-primary" type="button" onClick={onAddAccount}>
              Agregar caja o banco
            </button>
          )}
        </div>
      </header>

      <dl className="screen-facts is-four">
        <div>
          <dt>Entró este mes</dt>
          <dd>{formatMoney(monthTotal("in"))}</dd>
        </div>
        <div>
          <dt>Salió este mes</dt>
          <dd>{formatMoney(monthTotal("out"))}</dd>
        </div>
        <div>
          <dt>Te deben</dt>
          <dd>{formatMoney(receivables.reduce((sum, item) => sum + item.balance, 0))}</dd>
        </div>
        <div>
          <dt>Debes</dt>
          <dd>{formatMoney(payables.reduce((sum, item) => sum + item.balance, 0))}</dd>
        </div>
      </dl>

      <div className="dinero-grid">
        <section aria-labelledby="dinero-cobrar">
          <h2 id="dinero-cobrar">Te deben</h2>
          <ShortList
            empty="Nadie te debe en este momento."
            items={receivables.map(({ sale, balance }) => (
              <li key={sale.id}>
                <div>
                  <strong>
                    {sale.customerName}: {formatMoney(balance)}
                  </strong>
                  <span>{dueText(sale.number, sale.dueDate)}</span>
                </div>
                {canEdit && (
                  <button
                    className="action-secondary"
                    type="button"
                    onClick={() => onCollectSale(sale)}
                  >
                    Abonar
                  </button>
                )}
              </li>
            ))}
          />
        </section>

        <section aria-labelledby="dinero-pagar">
          <h2 id="dinero-pagar">Debes</h2>
          <ShortList
            empty="No le debes a ningún proveedor."
            items={payables.map(({ purchase, balance, review }) => (
              <li key={purchase.id}>
                <div>
                  <strong>
                    {purchase.supplierName}: {review ? "saldo por revisar" : formatMoney(balance)}
                  </strong>
                  <span>
                    {review
                      ? `${purchase.number} · compra antigua, no está sumada en lo que debes`
                      : dueText(purchase.number, purchase.dueDate)}
                  </span>
                </div>
                {review
                  ? isAdmin && (
                      <button
                        className="action-secondary"
                        type="button"
                        onClick={() => onReviewPurchase(purchase)}
                      >
                        Confirmar saldo
                      </button>
                    )
                  : canEdit && (
                      <button
                        className="action-secondary"
                        type="button"
                        onClick={() => onPayPurchase(purchase)}
                      >
                        Pagar
                      </button>
                    )}
              </li>
            ))}
          />
        </section>
      </div>

      <section aria-labelledby="dinero-cuentas">
        <div className="screen-section-heading">
          <h2 id="dinero-cuentas">
            Caja y bancos
            {state.financialAccounts.length > 0 && `: ${formatMoney(accountsTotal)}`}
          </h2>
          {isAdmin && hasActiveAccount && (
            <button className="action-link" type="button" onClick={onAddAccount}>
              Agregar caja o banco
            </button>
          )}
        </div>
        {state.financialAccounts.length ? (
          <ul className="records records-accounts">
            <li className="records-head" aria-hidden="true">
              <span>Nombre</span>
              <span>Saldo inicial</span>
              <span>Saldo de hoy</span>
            </li>
            {state.financialAccounts.map((account) => (
              <li key={account.id}>
                <div className="records-main">
                  <strong>{account.name}</strong>
                  <span>
                    {account.type === "cash" ? "Caja" : "Banco"}
                    {account.active ? "" : " · Ya no se usa"}
                  </span>
                </div>
                <div data-label="Saldo inicial">{formatMoney(account.openingBalance)}</div>
                <div data-label="Saldo de hoy">
                  <strong>{formatMoney(financialAccountBalance(state, account))}</strong>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>
            {isAdmin
              ? "Agrega tu caja o tu banco para saber cuánto dinero tienes."
              : "Un administrador debe agregar la caja o el banco para saber cuánto dinero tienes."}
          </EmptyState>
        )}
      </section>

      <h2 className="screen-more-title">Más detalle</h2>
      <details className="environment-disclosure">
        <summary>Entradas y salidas · {recentCash.length}</summary>
        <div className="environment-disclosure-content">
          <p className="screen-note">
            Aquí ves las últimas 100. Nada se borra: si algo se corrige, queda como un movimiento
            nuevo.
          </p>
          {recentCash.length ? (
            <ul className="records records-cash">
              <li className="records-head" aria-hidden="true">
                <span>Detalle</span>
                <span>Caja o banco</span>
                <span>Valor</span>
              </li>
              {recentCash.map((movement) => (
                <li key={movement.id}>
                  <div className="records-main">
                    <strong>{movement.description || movement.category}</strong>
                    <span>
                      {formatDate(movement.date)} · {movement.category} · {movement.method}
                    </span>
                    {movement.legacyUnassigned && (
                      <span className="records-detail">Pago antiguo sin caja o banco asignado</span>
                    )}
                  </div>
                  <div data-label="Caja o banco">{accountName(movement.accountId)}</div>
                  <div data-label={movement.direction === "in" ? "Entró" : "Salió"}>
                    <strong>
                      {movement.direction === "in" ? "+" : "−"}
                      {formatMoney(movement.amount)}
                    </strong>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>Aquí verás cada entrada y salida de dinero.</EmptyState>
          )}
        </div>
      </details>

      <p className="screen-note">
        Esto es un control interno en pesos. No reemplaza la contabilidad ni la revisión del
        extracto del banco. Los pagos sin caja o banco asignado cuentan en lo que entró y salió,
        pero no en el saldo de hoy.
      </p>
    </div>
  );
}
