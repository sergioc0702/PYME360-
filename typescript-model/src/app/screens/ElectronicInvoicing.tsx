import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  formatDate,
  formatMoney,
  formatNumber,
  readString,
  Field,
  Modal,
  SelectField,
  Status,
} from "../AppViews";
import { DOCUMENT_LABELS, documentTone } from "./SalesScreen";
import {
  fetchElectronicDocumentStatus,
  fetchEInvoicingProviderStatus,
  previewSupplierInvoice,
  requestElectronicDocumentSubmission,
  type EInvoicingProviderStatus,
  type SupplierInvoicePreview,
} from "../../features/invoicing/electronic-invoicing";
import { isUnsentElectronicDraft } from "../../domain/business";
import type {
  AppState,
  ElectronicDocument,
  InvoiceDocumentKind,
  SupplierInvoiceDocument,
  TaxConfiguration,
} from "../../domain/types";

const DOCUMENT_KIND_LABELS: Record<ElectronicDocument["kind"], string> = {
  invoice: "Factura de venta",
  credit_note: "Nota crédito",
  debit_note: "Nota débito",
};

type SupplierInvoiceInput = Omit<
  SupplierInvoiceDocument,
  "id" | "importedAt" | "status" | "supplierContactId"
> & { supplierContactId?: string };

export function ElectronicInvoicingPanel({
  state,
  canEdit,
  isAdmin,
  onSaveTaxConfiguration,
  onSaveSupplierInvoice,
  onSaveAdjustment,
  onRefreshState,
  onDeleteDraft,
}: {
  state: AppState;
  canEdit: boolean;
  isAdmin: boolean;
  onDeleteDraft: (document: ElectronicDocument) => void;
  onSaveTaxConfiguration: (config: TaxConfiguration) => Promise<boolean>;
  onSaveSupplierInvoice: (input: SupplierInvoiceInput) => Promise<boolean>;
  onSaveAdjustment: (
    originalDocumentId: string,
    kind: Extract<InvoiceDocumentKind, "credit_note" | "debit_note">,
    reason: string,
    changes: Array<{ originalLineIndex: number; quantity: number }>,
  ) => Promise<boolean>;
  onRefreshState: () => Promise<void>;
}) {
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [selectedOriginal, setSelectedOriginal] = useState<ElectronicDocument | null>(null);
  const [providerStatus, setProviderStatus] = useState<EInvoicingProviderStatus | null>(null);
  const [providerStatusError, setProviderStatusError] = useState("");
  const [providerLoading, setProviderLoading] = useState(true);
  const [documentStatusMessages, setDocumentStatusMessages] = useState<Record<string, string>>({});
  const [checkingDocumentId, setCheckingDocumentId] = useState("");
  const [configurationError, setConfigurationError] = useState("");
  const [preview, setPreview] = useState<SupplierInvoicePreview | null>(null);
  const [selectedPurchaseId, setSelectedPurchaseId] = useState("");
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadProviderStatus(): Promise<void> {
    setProviderLoading(true);
    setProviderStatusError("");
    try {
      setProviderStatus(await fetchEInvoicingProviderStatus());
    } catch (reason) {
      setProviderStatusError(
        reason instanceof Error ? reason.message : "No se consultó el proveedor.",
      );
    } finally {
      setProviderLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void fetchEInvoicingProviderStatus()
      .then((status) => {
        if (active) setProviderStatus(status);
      })
      .catch((reason: unknown) => {
        if (active)
          setProviderStatusError(
            reason instanceof Error ? reason.message : "No se consultó el proveedor.",
          );
      })
      .finally(() => {
        if (active) setProviderLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const matchingPurchases = useMemo(() => {
    if (
      !preview ||
      preview.currency !== "COP" ||
      preview.buyerTaxId.trim().toLowerCase() !== (state.company?.taxId ?? "").trim().toLowerCase()
    )
      return [];
    return state.purchases.filter((purchase) => {
      const supplier = state.contacts.find((contact) => contact.id === purchase.supplierId);
      return supplier?.taxId.trim().toLowerCase() === preview.supplierTaxId.trim().toLowerCase();
    });
  }, [preview, state.contacts, state.purchases]);

  async function handleXmlFile(file?: File) {
    if (!file) return;
    setParsing(true);
    setError("");
    try {
      const result = await previewSupplierInvoice(file);
      const duplicate = state.supplierInvoices.some(
        (invoice) =>
          invoice.documentNumber.trim().toLowerCase() ===
            result.documentNumber.trim().toLowerCase() &&
          invoice.supplierTaxId.trim().toLowerCase() === result.supplierTaxId.trim().toLowerCase(),
      );
      if (duplicate) throw new Error("Esta factura ya está registrada para ese proveedor.");
      setPreview(result);
      setSelectedPurchaseId("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo procesar el XML.");
    } finally {
      setParsing(false);
    }
  }

  async function saveSupplierInvoice() {
    if (!preview) return;
    setSaving(true);
    const ok = await onSaveSupplierInvoice({
      fileName: preview.fileName,
      documentNumber: preview.documentNumber,
      issueDate: preview.issueDate,
      dueDate: preview.dueDate || undefined,
      currency: preview.currency,
      supplierTaxId: preview.supplierTaxId,
      supplierName: preview.supplierName,
      buyerTaxId: preview.buyerTaxId,
      taxAmount: preview.taxAmount,
      total: preview.total,
      purchaseId: selectedPurchaseId || undefined,
      lines: preview.lines,
    });
    setSaving(false);
    if (ok) {
      setPreview(null);
      setError("");
    }
  }

  const config = state.taxConfiguration;
  const connected = providerStatus?.configured ?? false;
  const providerMismatch = Boolean(
    connected &&
    config.providerId.trim() &&
    providerStatus?.providerId &&
    config.providerId.trim().toLowerCase() !== providerStatus.providerId.toLowerCase(),
  );
  const today = new Date().toISOString().slice(0, 10);
  const numberingReady = Boolean(
    config.resolutionNumber &&
    config.prefix &&
    config.rangeFrom !== null &&
    config.rangeTo !== null &&
    config.validFrom &&
    config.validTo,
  );
  const numberingExpired = Boolean(config.validTo && config.validTo < today);
  const orderedElectronicDocuments = [...state.electronicDocuments].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );

  function electronicDocumentActionButtons(document: ElectronicDocument) {
    return (
      <>
        {canEdit && connected && ["draft", "rejected"].includes(document.status) && (
          <button
            className="action-link"
            type="button"
            disabled={
              providerMismatch ||
              document.validationIssues.length > 0 ||
              checkingDocumentId === document.id
            }
            title={
              providerMismatch
                ? "El código del proveedor guardado no coincide con la conexión."
                : document.validationIssues.join(" ")
            }
            onClick={() => void submitElectronicDocument(document)}
          >
            Enviar a la DIAN
          </button>
        )}
        {isAdmin && isUnsentElectronicDraft(document) && (
          <button
            className="action-link is-danger"
            type="button"
            onClick={() => onDeleteDraft(document)}
          >
            Eliminar borrador
          </button>
        )}
        {canEdit &&
          document.kind === "invoice" &&
          ["accepted", "delivered"].includes(document.status) && (
            <button
              className="action-link"
              type="button"
              onClick={() => setSelectedOriginal(document)}
            >
              Crear nota
            </button>
          )}
      </>
    );
  }

  async function checkDocumentStatus(document: ElectronicDocument) {
    setCheckingDocumentId(document.id);
    setError("");
    try {
      const result = await fetchElectronicDocumentStatus(document.id);
      if (result.revision !== undefined) await onRefreshState();
      setDocumentStatusMessages((current) => ({ ...current, [document.id]: result.message }));
    } catch (reason) {
      setDocumentStatusMessages((current) => ({
        ...current,
        [document.id]: reason instanceof Error ? reason.message : "No se pudo consultar el estado.",
      }));
    } finally {
      setCheckingDocumentId("");
    }
  }

  async function submitElectronicDocument(document: ElectronicDocument) {
    setCheckingDocumentId(document.id);
    setError("");
    try {
      const result = await requestElectronicDocumentSubmission(document.id);
      if (!result.transmitted) {
        throw new Error(result.message || "El proveedor no confirmó la transmisión.");
      }
      await onRefreshState();
      setDocumentStatusMessages((current) => ({
        ...current,
        [document.id]:
          result.message ||
          `El proveedor recibió el documento (${documentStatusLabel(result.status)}).`,
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo enviar la factura.");
    } finally {
      setCheckingDocumentId("");
    }
  }

  return (
    <>
      {error && !preview && <div className="notice warning">{error}</div>}
      <section aria-labelledby="facturas-venta">
        <div className="screen-section-heading">
          <h2 id="facturas-venta">Facturas de venta</h2>
          {isAdmin && (
            <button
              className="action-secondary"
              type="button"
              onClick={() => setConfigurationOpen(true)}
            >
              Datos para facturar
            </button>
          )}
        </div>
        <dl className="screen-facts">
          <div>
            <dt>Envío a la DIAN</dt>
            <dd>{providerMismatch ? "Por revisar" : connected ? "Conectado" : "Sin conectar"}</dd>
          </div>
          <div>
            <dt>Modo</dt>
            <dd>{config.environment === "production" ? "Real" : "Pruebas"}</dd>
          </div>
          <div>
            <dt>Numeración</dt>
            <dd className={numberingExpired ? "is-low" : undefined}>
              {numberingExpired ? "Vencida" : numberingReady ? "Lista" : "Pendiente"}
            </dd>
          </div>
        </dl>
        <p className="screen-note">
          {providerMismatch
            ? "El código del proveedor de facturación guardado no coincide con la conexión. Revísalo en Datos para facturar."
            : connected
              ? "Tus facturas se envían a la DIAN por medio de tu proveedor de facturación."
              : "Por ahora Pyme360 prepara tus facturas, pero no las envía a la DIAN. Para enviarlas necesitas un proveedor de facturación autorizado."}
        </p>
        {orderedElectronicDocuments.length ? (
          <ul className="records records-documents">
            <li className="records-head" aria-hidden="true">
              <span>Factura</span>
              <span>Estado</span>
              <span>Qué falta</span>
              <span />
            </li>
            {orderedElectronicDocuments.map((document) => (
              <li key={document.id}>
                <div className="records-main">
                  <strong>{document.documentNumber || "Borrador sin numerar"}</strong>
                  <span>
                    {DOCUMENT_KIND_LABELS[document.kind]} ·{" "}
                    {state.sales.find((sale) => sale.id === document.saleId)?.number ??
                      "Venta antigua"}{" "}
                    · {formatDate(document.createdAt.slice(0, 10))}
                  </span>
                  {document.providerReference && (
                    <span className="records-detail records-wrap">
                      Referencia del proveedor: {document.providerReference}
                    </span>
                  )}
                  {document.cufe && (
                    <span className="records-detail records-wrap">CUFE: {document.cufe}</span>
                  )}
                </div>
                <div data-label="Estado">
                  <Status tone={documentTone(document.status)}>
                    {documentStatusLabel(document.status)}
                  </Status>
                  {document.validationMessage && (
                    <span className="records-detail">{document.validationMessage}</span>
                  )}
                  {documentStatusMessages[document.id] && (
                    <span className="records-detail" role="status">
                      {documentStatusMessages[document.id]}
                    </span>
                  )}
                </div>
                <div data-label="Qué falta">
                  {document.validationIssues.length ? (
                    <details className="task-history">
                      <summary>
                        {document.validationIssues.length === 1
                          ? "Falta 1 dato"
                          : `Faltan ${document.validationIssues.length} datos`}
                      </summary>
                      <ul className="records-issues">
                        {document.validationIssues.map((issue) => (
                          <li key={issue}>{issue}</li>
                        ))}
                      </ul>
                    </details>
                  ) : (
                    "Nada por ahora"
                  )}
                </div>
                <div className="row-actions">
                  {(connected || document.status !== "draft") && (
                    <button
                      className="action-link"
                      type="button"
                      disabled={checkingDocumentId === document.id}
                      onClick={() => void checkDocumentStatus(document)}
                    >
                      {checkingDocumentId === document.id ? "Consultando…" : "Consultar estado"}
                    </button>
                  )}
                  {electronicDocumentActionButtons(document)}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="screen-empty">
            Todavía no tienes facturas. Prepara una desde la pestaña Ventas.
          </p>
        )}
      </section>

      <section aria-labelledby="facturas-proveedores">
        <div className="screen-section-heading">
          <h2 id="facturas-proveedores">Facturas de proveedores</h2>
          {canEdit && (
            <label className="action-secondary action-file">
              {parsing ? "Leyendo archivo…" : "Subir factura XML"}
              <input
                className="sr-only"
                type="file"
                accept=".xml,application/xml,text/xml"
                disabled={parsing}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  void handleXmlFile(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          )}
        </div>
        {state.supplierInvoices.length ? (
          <ul className="records records-supplier-invoices">
            <li className="records-head" aria-hidden="true">
              <span>Factura</span>
              <span>Fecha</span>
              <span>Total</span>
              <span>Compra</span>
              <span>Estado</span>
            </li>
            {state.supplierInvoices.map((invoice) => (
              <li key={invoice.id}>
                <div className="records-main">
                  <strong>{invoice.documentNumber}</strong>
                  <span>
                    {invoice.supplierName} · {invoice.supplierTaxId}
                  </span>
                  <span className="records-detail records-wrap">{invoice.fileName}</span>
                </div>
                <div data-label="Fecha">{formatDate(invoice.issueDate)}</div>
                <div data-label="Total">
                  {invoice.currency} {formatNumber(invoice.total)}
                  <span className="records-detail">
                    Impuestos: {formatNumber(invoice.taxAmount)}
                  </span>
                </div>
                <div data-label="Compra">
                  {state.purchases.find((purchase) => purchase.id === invoice.purchaseId)?.number ??
                    "Sin relacionar"}
                </div>
                <div data-label="Estado">
                  <Status tone={invoice.status === "linked" ? "good" : "warning"}>
                    {invoice.status === "linked" ? "Relacionada" : "Por revisar"}
                  </Status>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="screen-empty">Todavía no has subido facturas de proveedores.</p>
        )}
        <p className="screen-note">
          El archivo XML se lee en este computador y no se conserva. Al confirmar se guardan sus
          datos, pero no cambia el inventario ni se crean pagos.
        </p>
      </section>

      {isAdmin && (
        <>
          <h2 className="screen-more-title">Más detalle</h2>
          <details className="environment-disclosure">
            <summary>Conexión con el proveedor de facturación</summary>
            <div className="environment-disclosure-content">
              {providerStatusError && <p className="screen-note">{providerStatusError}</p>}
              {providerStatus?.message && <p className="screen-note">{providerStatus.message}</p>}
              {config.providerId && (
                <p className="screen-note">
                  Código guardado: {config.providerId}
                  {providerMismatch ? `. La conexión usa: ${providerStatus?.providerId}.` : ""}
                </p>
              )}
              <p className="screen-note">
                La conexión se configura en el archivo server/.env del servidor. Aquí no se guardan
                claves ni certificados.
              </p>
              <button
                className="action-link"
                type="button"
                disabled={providerLoading}
                onClick={() => void loadProviderStatus()}
              >
                {providerLoading ? "Consultando…" : "Revisar conexión"}
              </button>
            </div>
          </details>
        </>
      )}
      {configurationOpen && (
        <TaxConfigurationForm
          configuration={config}
          onClose={() => setConfigurationOpen(false)}
          onSave={async (value) => {
            try {
              const ok = await onSaveTaxConfiguration(value);
              if (ok) setConfigurationOpen(false);
            } catch (reason) {
              setConfigurationError(
                reason instanceof Error ? reason.message : "No se pudo guardar la configuración.",
              );
            }
          }}
          error={configurationError}
        />
      )}
      {preview && (
        <Modal title="Revisar factura del proveedor" onClose={() => setPreview(null)} wide>
          <div className="modal-body grid gap-4">
            {error && <div className="notice warning">{error}</div>}
            {preview.buyerTaxId.trim().toLowerCase() !==
              (state.company?.taxId ?? "").trim().toLowerCase() && (
              <div className="notice warning">
                El NIT del comprador en la factura no es el de tu empresa. Puedes guardarla para
                revisarla después, pero no relacionarla con una compra.
              </div>
            )}
            {preview.currency !== "COP" && (
              <div className="notice warning">
                La factura está en {preview.currency} y Pyme360 no convierte monedas. Guárdala sin
                relacionarla con una compra hasta revisar el valor en pesos.
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 text-sm max-sm:grid-cols-1">
              <div>
                <span className="text-muted">Factura</span>
                <strong className="block">{preview.documentNumber}</strong>
              </div>
              <div>
                <span className="text-muted">Proveedor</span>
                <strong className="block">
                  {preview.supplierName} · {preview.supplierTaxId}
                </strong>
              </div>
              <div>
                <span className="text-muted">Fecha de emisión</span>
                <strong className="block">{formatDate(preview.issueDate)}</strong>
              </div>
              <div>
                <span className="text-muted">Vencimiento</span>
                <strong className="block">
                  {preview.dueDate ? formatDate(preview.dueDate) : "No indicado"}
                </strong>
              </div>
              <div>
                <span className="text-muted">Total</span>
                <strong className="block">
                  {preview.currency} {formatNumber(preview.total)}
                </strong>
              </div>
              <div>
                <span className="text-muted">Impuestos</span>
                <strong className="block">
                  {preview.currency} {formatNumber(preview.taxAmount)}
                </strong>
              </div>
            </div>
            {matchingPurchases.length > 0 &&
              preview.buyerTaxId.trim().toLowerCase() ===
                (state.company?.taxId ?? "").trim().toLowerCase() && (
                <SelectField
                  label="Relacionar con una compra (opcional)"
                  name="supplier-invoice-purchase"
                  value={selectedPurchaseId}
                  onChange={setSelectedPurchaseId}
                  options={[
                    { value: "", label: "Guardar para revisar después" },
                    ...matchingPurchases.map((purchase) => ({
                      value: purchase.id,
                      label: `${purchase.number} · ${purchase.supplierName} · ${formatMoney(purchase.total)}`,
                    })),
                  ]}
                />
              )}
            <div className="table-wrap max-h-64 overflow-auto">
              <table>
                <thead>
                  <tr>
                    <th>Descripción</th>
                    <th>Cantidad</th>
                    <th>Valor unitario</th>
                    <th>Impuesto</th>
                    <th>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.lines.map((line, index) => (
                    <tr key={`${line.description}-${index}`}>
                      <td>{line.description}</td>
                      <td>
                        {formatNumber(line.quantity)} {line.unitCode}
                      </td>
                      <td>{formatMoney(line.unitPrice)}</td>
                      <td>{formatMoney(line.taxAmount)}</td>
                      <td>{formatMoney(line.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-footer">
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setPreview(null)}
              >
                Descartar
              </button>
              <button
                className="button button-primary"
                type="button"
                disabled={saving}
                onClick={() => void saveSupplierInvoice()}
              >
                {saving ? "Guardando…" : "Guardar factura"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {selectedOriginal && (
        <AdjustmentNoteForm
          original={selectedOriginal}
          state={state}
          onClose={() => setSelectedOriginal(null)}
          onSave={async (kind, reason, changes) => {
            const ok = await onSaveAdjustment(selectedOriginal.id, kind, reason, changes);
            if (ok) setSelectedOriginal(null);
          }}
        />
      )}
    </>
  );
}

function AdjustmentNoteForm({
  original,
  state,
  onClose,
  onSave,
}: {
  original: ElectronicDocument;
  state: AppState;
  onClose: () => void;
  onSave: (
    kind: Extract<InvoiceDocumentKind, "credit_note" | "debit_note">,
    reason: string,
    changes: Array<{ originalLineIndex: number; quantity: number }>,
  ) => Promise<void>;
}) {
  const [kind, setKind] =
    useState<Extract<InvoiceDocumentKind, "credit_note" | "debit_note">>("credit_note");
  const [quantities, setQuantities] = useState<number[]>(original.snapshot.lines.map(() => 0));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  function remainingCredit(lineIndex: number): number {
    const credited = state.electronicDocuments
      .filter(
        (document) =>
          document.relatedDocumentId === original.id &&
          document.kind === "credit_note" &&
          ["draft", "queued", "transmitted", "accepted", "delivered"].includes(document.status),
      )
      .flatMap((document) => document.snapshot.lines)
      .filter((line) => line.originalLineIndex === lineIndex)
      .reduce((sum, line) => sum + line.quantity, 0);
    return Math.max(0, original.snapshot.lines[lineIndex].quantity - credited);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const changes = quantities.flatMap((quantity, originalLineIndex) =>
      quantity > 0 ? [{ originalLineIndex, quantity }] : [],
    );
    if (!reason.trim() || !changes.length) {
      setError("Indica un motivo y al menos una cantidad mayor que cero.");
      return;
    }
    setSaving(true);
    try {
      await onSave(kind, reason, changes);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo preparar la nota.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={kind === "credit_note" ? "Preparar nota crédito" : "Preparar nota débito"}
      onClose={onClose}
      wide
    >
      <form className="modal-body grid gap-4" onSubmit={(event) => void submit(event)}>
        <div className="notice warning">
          La nota queda como borrador hasta que tu proveedor de facturación la envíe. Cuando la
          acepten, cambia lo que te deben, pero no cambia el inventario.
        </div>
        {error && <div className="notice warning">{error}</div>}
        <SelectField
          label="Tipo de nota"
          name="adjustment-kind"
          value={kind}
          onChange={(value) => {
            if (value === "credit_note" || value === "debit_note") setKind(value);
          }}
          options={[
            { value: "credit_note", label: "Nota crédito · disminuye el saldo" },
            { value: "debit_note", label: "Nota débito · aumenta el saldo" },
          ]}
        />
        <label className="grid gap-1.5 text-[0.875rem] font-semibold text-label">
          Motivo de la nota
          <textarea
            className="min-h-20 rounded-xl border border-control bg-surface px-3 py-2 text-sm font-normal text-ink"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            maxLength={300}
          />
        </label>
        <div className="table-wrap max-h-72 overflow-auto">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Valor unitario</th>
                <th>IVA</th>
                <th>Cantidad a ajustar</th>
              </tr>
            </thead>
            <tbody>
              {original.snapshot.lines.map((line, index) => {
                const maxCredit = remainingCredit(index);
                return (
                  <tr key={`${line.productId}-${index}`}>
                    <td>
                      {line.description}
                      <small>Facturado: {formatNumber(line.quantity)}</small>
                    </td>
                    <td>{formatMoney(line.unitPrice)}</td>
                    <td>{formatNumber(line.vatRate)}%</td>
                    <td>
                      <input
                        className="w-28 rounded-lg border border-control bg-surface px-2 py-1.5"
                        type="number"
                        min="0"
                        max={kind === "credit_note" ? maxCredit : undefined}
                        step="0.0001"
                        value={quantities[index]}
                        onChange={(event) =>
                          setQuantities((current) =>
                            current.map((quantity, lineIndex) =>
                              lineIndex === index ? Number(event.target.value) : quantity,
                            ),
                          )
                        }
                      />
                      <small>
                        {kind === "credit_note"
                          ? `Disponible: ${formatNumber(maxCredit)}`
                          : "Cantidad adicional"}
                      </small>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="modal-footer">
          <button className="button button-secondary" type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="button button-primary" type="submit" disabled={saving}>
            {saving ? "Guardando…" : "Guardar borrador de nota"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function documentStatusLabel(status: string): string {
  return DOCUMENT_LABELS[status as ElectronicDocument["status"]] ?? status;
}

function TaxConfigurationForm({
  configuration,
  onClose,
  onSave,
  error,
}: {
  configuration: TaxConfiguration;
  onClose: () => void;
  onSave: (configuration: TaxConfiguration) => Promise<void>;
  error: string;
}) {
  const [formError, setFormError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const optionalInteger = (name: string): number | null => {
      const value = readString(form, name);
      if (!value) return null;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1)
        throw new Error("Los rangos deben ser enteros positivos.");
      return parsed;
    };
    try {
      setFormError("");
      await onSave({
        ...configuration,
        legalAddress: readString(form, "legalAddress"),
        invoiceEmail: readString(form, "invoiceEmail"),
        taxRegime: readString(form, "taxRegime"),
        taxResponsibilities: readString(form, "taxResponsibilities")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        providerId: readString(form, "providerId"),
        environment: readString(form, "environment") as TaxConfiguration["environment"],
        resolutionNumber: readString(form, "resolutionNumber"),
        prefix: readString(form, "prefix"),
        rangeFrom: optionalInteger("rangeFrom"),
        rangeTo: optionalInteger("rangeTo"),
        validFrom: readString(form, "validFrom"),
        validTo: readString(form, "validTo"),
        contingencyPrefix: readString(form, "contingencyPrefix"),
        contingencyRangeFrom: optionalInteger("contingencyRangeFrom"),
        contingencyRangeTo: optionalInteger("contingencyRangeTo"),
      });
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "No se pudo guardar la configuración.");
    }
  }
  return (
    <Modal title="Datos para facturar" onClose={onClose} wide>
      <form className="modal-body" onSubmit={(event) => void submit(event)}>
        {(error || formError) && <div className="notice warning">{error || formError}</div>}
        <div className="notice warning">
          Escribe solo lo que aparece en tu RUT y en la autorización de numeración de la DIAN. Aquí
          no se guardan claves ni certificados.
        </div>
        <div className="form-grid">
          <Field
            label="Dirección del RUT"
            name="legalAddress"
            initialValue={configuration.legalAddress}
            required
          />
          <Field
            label="Correo para recibir facturas"
            name="invoiceEmail"
            type="email"
            initialValue={configuration.invoiceEmail}
          />
          <Field
            label="Régimen (según el RUT)"
            name="taxRegime"
            initialValue={configuration.taxRegime}
          />
          <Field
            label="Responsabilidades del RUT (separadas por coma)"
            name="taxResponsibilities"
            initialValue={configuration.taxResponsibilities.join(", ")}
          />
          <Field
            label="Código del proveedor de facturación"
            name="providerId"
            initialValue={configuration.providerId}
          />
          <SelectField
            label="Modo"
            name="environment"
            initialValue={configuration.environment}
            options={[
              { value: "test", label: "Pruebas" },
              { value: "production", label: "Real" },
            ]}
          />
          <Field
            label="Número de resolución"
            name="resolutionNumber"
            initialValue={configuration.resolutionNumber}
          />
          <Field label="Prefijo" name="prefix" initialValue={configuration.prefix} />
          <Field
            label="Autorizada desde el número"
            name="rangeFrom"
            type="number"
            initialValue={configuration.rangeFrom ?? ""}
            min="1"
            step="1"
          />
          <Field
            label="Autorizada hasta el número"
            name="rangeTo"
            type="number"
            initialValue={configuration.rangeTo ?? ""}
            min="1"
            step="1"
          />
          <Field
            label="Autorización válida desde"
            name="validFrom"
            type="date"
            initialValue={configuration.validFrom}
          />
          <Field
            label="Autorización válida hasta"
            name="validTo"
            type="date"
            initialValue={configuration.validTo}
          />
          <Field
            label="Prefijo de contingencia"
            name="contingencyPrefix"
            initialValue={configuration.contingencyPrefix}
          />
          <Field
            label="Contingencia desde el número"
            name="contingencyRangeFrom"
            type="number"
            initialValue={configuration.contingencyRangeFrom ?? ""}
            min="1"
            step="1"
          />
          <Field
            label="Contingencia hasta el número"
            name="contingencyRangeTo"
            type="number"
            initialValue={configuration.contingencyRangeTo ?? ""}
            min="1"
            step="1"
          />
        </div>
        <div className="modal-footer">
          <button className="button button-secondary" type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="button button-primary" type="submit">
            Guardar
          </button>
        </div>
      </form>
    </Modal>
  );
}
