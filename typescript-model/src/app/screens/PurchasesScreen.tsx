import { useState } from "react";
import { payableBalance } from "../../domain/business";
import type { Purchase } from "../../domain/types";
import {
  EmptyState,
  ListToolbar,
  Status,
  formatDate,
  formatMoney,
  formatNumber,
  today,
} from "../AppViews";

const needsReview = (purchase: Purchase) =>
  purchase.status === "received" && purchase.payableReviewStatus === "review_required";

/** Comprar: qué falta recibir y cuánto se debe; debajo, la lista de compras. */
export function PurchasesPage({
  purchases,
  onAdd,
  onReceive,
  onPay,
  onReview,
  onEdit,
  onDelete,
  canEdit,
  canDelete = false,
}: {
  purchases: Purchase[];
  onAdd: () => void;
  onReceive: (purchase: Purchase) => void;
  onPay: (purchase: Purchase) => void;
  onReview: (purchase: Purchase) => void;
  onEdit: (purchase: Purchase) => void;
  onDelete: (purchase: Purchase) => void;
  canEdit: boolean;
  canDelete?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const term = search.trim().toLocaleLowerCase("es-CO");
  const toReceive = purchases
    .filter((purchase) => purchase.status === "pending")
    .reduce((sum, purchase) => sum + purchase.total, 0);
  const toPay = purchases.reduce((sum, purchase) => sum + payableBalance(purchase), 0);
  const toReview = purchases.filter(needsReview).length;
  const visible = purchases
    .filter((purchase) => {
      const text = `${purchase.number} ${purchase.supplierName} ${purchase.lines
        .map((line) => line.productName)
        .join(" ")}`.toLocaleLowerCase("es-CO");
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "unpaid"
          ? payableBalance(purchase) > 0
          : purchase.status === statusFilter);
      return text.includes(term) && matchesStatus;
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>Comprar</h1>
        {canEdit && (
          <div className="screen-actions">
            <button className="action-primary" type="button" onClick={onAdd}>
              Registrar compra
            </button>
          </div>
        )}
      </header>

      <dl className="screen-facts is-two">
        <div>
          <dt>Por recibir</dt>
          <dd>{formatMoney(toReceive)}</dd>
        </div>
        <div>
          <dt>Por pagar</dt>
          <dd>{formatMoney(toPay)}</dd>
        </div>
      </dl>
      {toReview > 0 && (
        <p className="screen-note">
          {toReview === 1
            ? "Una compra antigua necesita que revises su saldo. No está sumada en Por pagar."
            : `${toReview} compras antiguas necesitan que revises su saldo. No están sumadas en Por pagar.`}
        </p>
      )}

      <section aria-labelledby="compras-lista">
        <h2 id="compras-lista">Tus compras</h2>
        <ListToolbar
          search={search}
          onSearch={setSearch}
          searchLabel="Buscar compras"
          placeholder="Buscar por proveedor, material o número"
          count={visible.length}
          countNoun={{ singular: "compra", plural: "compras" }}
          filter={statusFilter}
          onFilter={setStatusFilter}
          filterLabel="Mostrar"
          options={[
            { value: "all", label: "Todas" },
            { value: "pending", label: "Por recibir" },
            { value: "received", label: "Recibidas" },
            { value: "unpaid", label: "Por pagar" },
          ]}
        />
        {visible.length ? (
          <ul className="records records-purchases">
            <li className="records-head" aria-hidden="true">
              <span>Compra</span>
              <span>Total</span>
              <span>Por pagar</span>
              <span>Vence</span>
              <span>Estado</span>
              <span />
            </li>
            {visible.map((purchase) => {
              const balance = payableBalance(purchase);
              const received = purchase.status === "received";
              const review = needsReview(purchase);
              const overdue = balance > 0 && !!purchase.dueDate && purchase.dueDate < today();
              return (
                <li key={purchase.id}>
                  <div className="records-main">
                    <strong>{purchase.supplierName}</strong>
                    <span>
                      {purchase.number} · {formatDate(purchase.date)}
                    </span>
                    <span className="records-detail">
                      {purchase.lines
                        .map((line) => `${line.productName} × ${formatNumber(line.quantity)}`)
                        .join(" · ")}
                    </span>
                  </div>
                  <div data-label="Total">{formatMoney(purchase.total)}</div>
                  <div data-label="Por pagar">
                    {balance > 0 ? (
                      <strong>{formatMoney(balance)}</strong>
                    ) : review ? (
                      "Por revisar"
                    ) : received ? (
                      "Pagada"
                    ) : (
                      "—"
                    )}
                  </div>
                  <div data-label="Vence">
                    {balance <= 0 ? (
                      "—"
                    ) : purchase.dueDate ? (
                      <span className={overdue ? "is-low" : undefined}>
                        {formatDate(purchase.dueDate)}
                      </span>
                    ) : (
                      "Sin fecha"
                    )}
                  </div>
                  <div data-label="Estado">
                    <Status tone={received ? "good" : "warning"}>
                      {received ? "Recibida" : "Por recibir"}
                    </Status>
                  </div>
                  {canEdit && (
                    <div className="row-actions">
                      {!received && (
                        <button
                          className="action-link"
                          type="button"
                          onClick={() => onReceive(purchase)}
                        >
                          Recibir
                        </button>
                      )}
                      {balance > 0 && (
                        <button
                          className="action-link"
                          type="button"
                          onClick={() => onPay(purchase)}
                        >
                          Pagar
                        </button>
                      )}
                      {review && canDelete && (
                        <button
                          className="action-link"
                          type="button"
                          onClick={() => onReview(purchase)}
                        >
                          Revisar
                        </button>
                      )}
                      <button
                        className="action-link"
                        type="button"
                        onClick={() => onEdit(purchase)}
                      >
                        Editar
                      </button>
                      {canDelete && (
                        <button
                          className="action-link is-danger"
                          type="button"
                          onClick={() => onDelete(purchase)}
                          aria-label={`Eliminar compra ${purchase.number}`}
                        >
                          Eliminar
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState>
            {purchases.length
              ? "Ninguna compra coincide con esa búsqueda."
              : "Todavía no tienes compras. Cuando registres una aparecerá aquí."}
          </EmptyState>
        )}
        <p className="screen-note">
          Solo las compras recibidas suben el inventario y quedan por pagar. Si corriges una, el
          cambio queda en el historial de Inventario.
        </p>
      </section>
    </div>
  );
}
