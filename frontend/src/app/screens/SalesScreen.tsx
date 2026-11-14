import { useState, type ReactNode } from "react";
import { netSalePaid, netSaleTotal, outstandingBalance } from "../../domain/business";
import type { ElectronicDocument, InvoiceFollowUpStatus, Sale } from "../../domain/types";
import {
  EmptyState,
  ListToolbar,
  Status,
  currentMonth,
  formatDate,
  formatMoney,
  formatNumber,
  today,
} from "../AppViews";

export const DOCUMENT_LABELS: Record<ElectronicDocument["status"], string> = {
  draft: "Borrador",
  queued: "En espera",
  transmitted: "Enviada",
  accepted: "Aceptada",
  rejected: "Rechazada",
  delivered: "Entregada",
  contingency_pending: "Pendiente por contingencia",
};

const FOLLOW_UP_LABELS: Record<InvoiceFollowUpStatus, string> = {
  to_review: "Por revisar",
  registered_externally: "Hecha por fuera",
  not_applicable: "No aplica",
};

export function documentTone(status: ElectronicDocument["status"]) {
  if (status === "accepted" || status === "delivered") return "good";
  return status === "rejected" ? "danger" : "warning";
}

/** Notas crédito y débito aceptadas que cambiaron el valor de la venta. */
function adjustmentText(sale: Sale, documents: ElectronicDocument[]): string {
  const accepted = documents.filter(
    (document) =>
      document.saleId === sale.id &&
      document.kind !== "invoice" &&
      (document.status === "accepted" || document.status === "delivered"),
  );
  const sum = (kind: ElectronicDocument["kind"]) =>
    accepted
      .filter((document) => document.kind === kind)
      .reduce(
        (total, document) => total + (document.adjustmentAmount ?? document.snapshot.total),
        0,
      );
  const credits = sum("credit_note");
  const debits = sum("debit_note");
  const parts = [
    credits ? `se restaron ${formatMoney(credits)}` : "",
    debits ? `se sumaron ${formatMoney(debits)}` : "",
  ].filter(Boolean);
  return parts.length ? `Ajustes: ${parts.join(" y ")}` : "";
}

/** Vender: cuánto se vendió y cuánto falta cobrar; debajo, la lista de ventas. */
export function SalesPage({
  sales,
  electronicDocuments,
  section,
  onSectionChange,
  documents,
  quotations,
  onAddQuotation,
  onAdd,
  onPrepareInvoice,
  onPayment,
  onReturn,
  onDelete,
  canEdit,
  canDelete = false,
}: {
  sales: Sale[];
  electronicDocuments: ElectronicDocument[];
  section: "sales" | "documents" | "quotations";
  onSectionChange: (section: "sales" | "documents" | "quotations") => void;
  documents: ReactNode;
  quotations: ReactNode;
  onAddQuotation: () => void;
  onAdd: () => void;
  onPrepareInvoice: (sale: Sale) => void;
  onPayment: (sale: Sale) => void;
  onReturn: (sale: Sale) => void;
  onDelete: (sale: Sale) => void;
  canEdit: boolean;
  canDelete?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const term = search.trim().toLocaleLowerCase("es-CO");
  const balanceOf = (sale: Sale) => outstandingBalance(sale, electronicDocuments);
  const month = currentMonth();
  const soldThisMonth = sales
    .filter((sale) => sale.date.startsWith(month))
    .reduce((sum, sale) => sum + sale.total, 0)
    - sales.reduce((sum, sale) => sum + (sale.returns ?? [])
      .filter((item) => item.date.startsWith(month))
      .reduce((value, item) => value + item.total, 0), 0);
  const toCollect = sales.reduce((sum, sale) => sum + balanceOf(sale), 0);
  const returnRows = sales.flatMap((sale) => (sale.returns ?? [])
    .map((record) => ({ sale, record }))).sort((a, b) => b.record.date.localeCompare(a.record.date));
  const returnedTotal = returnRows.reduce((sum, item) => sum + item.record.total, 0);
  const refundedTotal = returnRows.reduce((sum, item) => sum + item.record.refund, 0);
  const visible = sales
    .filter((sale) => {
      const text = `${sale.number} ${sale.customerName} ${sale.lines
        .map((line) => line.productName)
        .join(" ")}`.toLocaleLowerCase("es-CO");
      const open = balanceOf(sale) > 0;
      return (
        text.includes(term) && (paymentFilter === "all" || open === (paymentFilter === "open"))
      );
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>Vender</h1>
        {canEdit && section === "sales" && (
          <div className="screen-actions">
            <button className="action-primary" type="button" onClick={onAdd}>
              Registrar venta
            </button>
          </div>
        )}
        {canEdit && section === "quotations" && (
          <div className="screen-actions">
            <button className="action-primary" type="button" onClick={onAddQuotation}>
              Nueva cotización
            </button>
          </div>
        )}
      </header>
      <div className="screen-tabs" role="group" aria-label="Secciones de ventas">
        <button
          type="button"
          aria-pressed={section === "sales"}
          onClick={() => onSectionChange("sales")}
        >
          Ventas
        </button>
        <button type="button" aria-pressed={section === "quotations"} onClick={() => onSectionChange("quotations")}>
          Cotizaciones
        </button>
        <button
          type="button"
          aria-pressed={section === "documents"}
          onClick={() => onSectionChange("documents")}
        >
          Facturas
        </button>
      </div>

      {section === "quotations" ? quotations : section === "documents" ? (
        documents
      ) : (
        <>
          <dl className="screen-facts is-two">
            <div>
              <dt>Vendido este mes</dt>
              <dd>{formatMoney(soldThisMonth)}</dd>
            </div>
            <div>
              <dt>Por cobrar</dt>
              <dd>{formatMoney(toCollect)}</dd>
            </div>
          </dl>
          {returnRows.length > 0 && (
            <details className="card" aria-label="Reporte de devoluciones">
              <summary>Reporte de devoluciones · {returnRows.length} · {formatMoney(returnedTotal)}</summary>
              <p>Reembolsado a clientes: {formatMoney(refundedTotal)}</p>
              <ul className="mt-2 space-y-2">
                {returnRows.map(({ sale, record }) => (
                  <li key={record.id}>
                    {formatDate(record.date)} · {sale.number} · {sale.customerName} · {record.reason}
                    {" · "}{formatMoney(record.total)}
                    {record.refund > 0 && <> · Reembolso {formatMoney(record.refund)}</>}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <section aria-labelledby="ventas-lista">
            <h2 id="ventas-lista">Tus ventas</h2>
            <ListToolbar
              search={search}
              onSearch={setSearch}
              searchLabel="Buscar ventas"
              placeholder="Buscar por cliente, producto o número"
              count={visible.length}
              countNoun={{ singular: "venta", plural: "ventas" }}
              filter={paymentFilter}
              onFilter={setPaymentFilter}
              filterLabel="Mostrar"
              options={[
                { value: "all", label: "Todas" },
                { value: "open", label: "Por cobrar" },
                { value: "paid", label: "Pagadas" },
              ]}
            />
            {visible.length ? (
              <ul className="records records-sales">
                <li className="records-head" aria-hidden="true">
                  <span>Venta</span>
                  <span>Total</span>
                  <span>Por cobrar</span>
                  <span>Vence</span>
                  <span>Factura</span>
                  <span />
                </li>
                {visible.map((sale) => {
                  const balance = balanceOf(sale);
                  const paid = netSalePaid(sale);
                  const returns = sale.returns ?? [];
                  const overdue = balance > 0 && !!sale.dueDate && sale.dueDate < today();
                  const invoice = electronicDocuments.find(
                    (document) => document.saleId === sale.id && document.kind === "invoice",
                  );
                  const adjustments = adjustmentText(sale, electronicDocuments);
                  return (
                    <li key={sale.id}>
                      <div className="records-main">
                        <strong>{sale.customerName}</strong>
                        <span>
                          {sale.number} · {formatDate(sale.date)}
                        </span>
                        <span className="records-detail">
                          {sale.lines
                            .map((line) => `${line.productName} × ${formatNumber(line.quantity)}`)
                            .join(" · ")}
                        </span>
                        {adjustments && <span className="records-detail">{adjustments}</span>}
                        {returns.length > 0 && (
                          <details className="records-detail">
                            <summary>Devoluciones ({returns.length})</summary>
                            <ul className="mt-2 space-y-2">
                              {returns.map((record) => (
                                <li key={record.id}>
                                  <p>{formatDate(record.date)} · {record.reason} · {formatMoney(record.total)}</p>
                                  {record.lines.map((line) => (
                                    <p key={line.lineIndex}>
                                      {sale.lines[line.lineIndex].productName} × {formatNumber(line.quantity)}
                                      {line.restock ? " · Reintegrado" : " · Fuera de inventario"}
                                    </p>
                                  ))}
                                  {record.refund > 0 && <p>Reembolso {formatMoney(record.refund)}</p>}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </div>
                      <div data-label="Total">
                        {formatMoney(sale.total)}
                        {returns.length > 0 && (
                          <span className="records-detail">Tras devoluciones {formatMoney(netSaleTotal(sale))}</span>
                        )}
                      </div>
                      <div data-label="Por cobrar">
                        {balance > 0 ? <strong>{formatMoney(balance)}</strong> : returns.length ? "Sin saldo" : "Pagada"}
                        {balance > 0 && paid > 0 && (
                          <span className="records-detail">Abonó {formatMoney(paid)}</span>
                        )}
                      </div>
                      <div data-label="Vence">
                        {balance <= 0 ? (
                          "—"
                        ) : sale.dueDate ? (
                          <span className={overdue ? "is-low" : undefined}>
                            {formatDate(sale.dueDate)}
                          </span>
                        ) : (
                          "Sin fecha"
                        )}
                      </div>
                      <div data-label="Factura">
                        {invoice ? (
                          <Status tone={documentTone(invoice.status)}>
                            {DOCUMENT_LABELS[invoice.status]}
                          </Status>
                        ) : (
                          <Status>{FOLLOW_UP_LABELS[sale.invoiceFollowUpStatus]}</Status>
                        )}
                      </div>
                      {canEdit && (
                        <div className="row-actions">
                          {balance > 0 && (
                            <button
                              className="action-link"
                              type="button"
                              onClick={() => onPayment(sale)}
                            >
                              Abonar
                            </button>
                          )}
                          <button className="action-link" type="button" onClick={() => onReturn(sale)}>
                            Devolver productos
                          </button>
                          {!invoice && !returns.length && (
                            <button
                              className="action-link"
                              type="button"
                              onClick={() => onPrepareInvoice(sale)}
                            >
                              Preparar factura
                            </button>
                          )}
                          {canDelete && !returns.length && (
                            <button
                              className="action-link is-danger"
                              type="button"
                              onClick={() => onDelete(sale)}
                              aria-label={`Eliminar venta ${sale.number}`}
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
                {sales.length
                  ? "Ninguna venta coincide con esa búsqueda."
                  : "Todavía no tienes ventas. Cuando registres una aparecerá aquí."}
              </EmptyState>
            )}
            <p className="screen-note">
              El IVA es un cálculo aproximado. Preparar una factura no la envía a la DIAN: eso se
              activa cuando conectes un proveedor de facturación autorizado.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
