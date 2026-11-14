import { useState, type FormEvent } from "react";
import { outstandingBalance, previewSaleReturn, remainingReturnQuantity } from "../../domain/business";
import type { FinancialAccount, Sale, SaleReturnInput } from "../../domain/types";
import { Field, Modal, SelectField, errorMessage, formatMoney, formatNumber, today } from "../AppViews";

export function SaleReturnForm({
  sale, accounts, busy, blocked, onClose, onOpenInvoicing, onSave,
}: {
  sale: Sale;
  accounts: FinancialAccount[];
  busy: boolean;
  blocked?: string;
  onClose: () => void;
  onOpenInvoicing: () => void;
  onSave: (input: SaleReturnInput) => void;
}) {
  const [draft, setDraft] = useState<Record<number, { quantity: string; restock: boolean }>>({});
  const lines = Object.entries(draft)
    .filter(([, item]) => item.quantity.trim() !== "" && Number(item.quantity) !== 0)
    .map(([index, item]) => ({
      lineIndex: Number(index), quantity: Number(item.quantity), restock: item.restock,
    }));
  let estimate: ReturnType<typeof previewSaleReturn> | undefined;
  let issue = "";
  try {
    estimate = previewSaleReturn(sale, lines);
  } catch (error) {
    issue = errorMessage(error);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!estimate || !lines.length || busy || blocked) return;
    const form = new FormData(event.currentTarget);
    onSave({
      date: String(form.get("date") ?? ""), reason: String(form.get("reason") ?? ""), lines,
      refundAccountId: String(form.get("refundAccountId") ?? "") || undefined,
    });
  }
  return (
    <Modal title={`Devolver productos de ${sale.number}`} onClose={() => { if (!busy) onClose(); }} wide>
      <form className="modal-body" onSubmit={submit}>
        <p>{sale.customerName}</p>
        {blocked ? (
          <p className="notice warning">{blocked}</p>
        ) : (
          <>
            <div className="form-grid">
              <Field label="Fecha de devolución" name="date" type="date" initialValue={today()} min={sale.date} max={today()} required />
              <Field label="Motivo de la devolución" name="reason" required />
            </div>
            {sale.lines.map((line, index) => {
              const available = remainingReturnQuantity(sale, index);
              const current = draft[index] ?? { quantity: "", restock: false };
              if (available <= 0) return null;
              const label = `${line.productName} · renglón ${index + 1}`;
              return (
                <fieldset key={index} className="border-t border-line pt-3">
                  <legend className="font-bold">{label}</legend>
                  <p className="mb-2 text-muted">Puedes devolver hasta {formatNumber(available)}.</p>
                  <div className="form-grid">
                    <label className="field">
                      Cantidad a devolver
                      <input aria-label={`Cantidad a devolver de ${label}`} type="number" min="0" max={available}
                        step="0.0001" value={current.quantity}
                        onChange={(event) => setDraft({ ...draft, [index]: { ...current, quantity: event.target.value } })} />
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={current.restock}
                        onChange={(event) => setDraft({ ...draft, [index]: { ...current, restock: event.target.checked } })} />
                      Vuelve al inventario
                    </label>
                  </div>
                </fieldset>
              );
            })}
            <p className="text-muted">Marca el reintegro solo si el producto puede volver a venderse.</p>
            {issue && <p className="notice warning" role="status">{issue}</p>}
            {estimate && lines.length > 0 && (
              <dl className="grid gap-2">
                <div><dt>Valor de la devolución</dt><dd>{formatMoney(estimate.total)}</dd></div>
                <div><dt>Saldo que queda por cobrar</dt><dd>{formatMoney(Math.max(0, outstandingBalance(sale) - estimate.total))}</dd></div>
                {estimate.refund > 0 && <div><dt>Reembolso al cliente</dt><dd>{formatMoney(estimate.refund)}</dd></div>}
              </dl>
            )}
            {estimate && estimate.refund > 0 && (
              <SelectField label="Caja o banco del reembolso" name="refundAccountId" required
                options={[
                  { value: "", label: "Selecciona la cuenta" },
                  ...accounts.filter((account) => account.active).map((account) => ({ value: account.id, label: account.name })),
                ]} />
            )}
          </>
        )}
        <div className="modal-footer">
          {blocked?.includes("factura o documento") && (
            <button className="button button-secondary" type="button" onClick={onOpenInvoicing}>
              Ir a Facturas
            </button>
          )}
          <button className="button button-secondary" type="button" onClick={onClose} disabled={busy}>
            {blocked ? "Cerrar" : "Cancelar"}
          </button>
          {!blocked && (
            <button className="button button-primary" type="submit" disabled={busy || !lines.length || Boolean(issue)}>
              {busy ? "Confirmando…" : "Registrar devolución"}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
