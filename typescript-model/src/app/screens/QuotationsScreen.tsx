import { useState } from "react";
import { quotationStatus } from "../../domain/business";
import type { Quotation, Sale } from "../../domain/types";
import { EmptyState, ListToolbar, formatDate, formatMoney, today } from "../AppViews";

const labels = { active: "Vigente", expired: "Vencida", converted: "Convertida" };

export function QuotationsList({
  quotations,
  sales,
  canEdit,
  onDownload,
  onDuplicate,
  onConvert,
}: {
  quotations: Quotation[];
  sales: Sale[];
  canEdit: boolean;
  onDownload: (quote: Quotation) => void;
  onDuplicate: (quote: Quotation) => void;
  onConvert: (quote: Quotation) => void;
}) {
  const [search, setSearch] = useState("");
  const date = today();
  const term = search.trim().toLocaleLowerCase("es-CO");
  const visible = quotations.filter((quote) =>
    `${quote.number} ${quote.customerName}`.toLocaleLowerCase("es-CO").includes(term),
  );
  return (
    <section aria-labelledby="quotations-title">
      <h2 id="quotations-title">Tus cotizaciones</h2>
      <ListToolbar
        search={search}
        onSearch={setSearch}
        searchLabel="Buscar cotizaciones"
        placeholder="Número o cliente"
        count={visible.length}
        countNoun={{ singular: "cotización", plural: "cotizaciones" }}
      />
      {visible.length ? (
        <ul className="task-list">
          {visible.map((quote) => {
            const status = quotationStatus(quote, date);
            const sale = sales.find((item) => item.id === quote.saleId);
            return (
              <li key={quote.id}>
                <div>
                  <strong>{quote.customerName}</strong>
                  <span>
                    {quote.number} · {formatMoney(quote.total)} · {labels[status]}
                  </span>
                  <span>
                    {quote.saleId
                      ? sale
                        ? `Venta ${sale.number}`
                        : "La venta vinculada ya no está disponible."
                      : `Válida hasta el ${formatDate(quote.validUntil)}`}
                  </span>
                </div>
                <div className="row-actions">
                  <button
                    className="action-secondary"
                    type="button"
                    onClick={() => onDownload(quote)}
                  >
                    Descargar PDF
                  </button>
                  {canEdit && status === "expired" && (
                    <button
                      className="action-primary"
                      type="button"
                      onClick={() => onDuplicate(quote)}
                    >
                      Duplicar
                    </button>
                  )}
                  {canEdit && status === "active" && (
                    <button
                      className="action-primary"
                      type="button"
                      onClick={() => onConvert(quote)}
                    >
                      Convertir en venta
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState>
          {quotations.length
            ? "No hay cotizaciones que coincidan."
            : "Aquí aparecerán las ofertas que prepares para tus clientes."}
        </EmptyState>
      )}
    </section>
  );
}
