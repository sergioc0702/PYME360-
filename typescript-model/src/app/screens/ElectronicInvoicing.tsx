import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  formatDate,
  formatMoney,
  formatNumber,
  readString,
  Field,
  Modal,
  Panel,
  SelectField,
  Status,
} from "../AppViews";
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
        {canEdit && ["draft", "rejected"].includes(document.status) && (
          <button
            className="button button-secondary button-small"
            type="button"
            disabled={
              !connected ||
              providerMismatch ||
              document.validationIssues.length > 0 ||
              checkingDocumentId === document.id
            }
            title={
              !connected
                ? "Configura un proveedor tecnológico autorizado para solicitar el envío."
                : providerMismatch
                  ? "El identificador del proveedor en la empresa no coincide con el conector del servidor."
                  : document.validationIssues.join(" ")
            }
            onClick={() => void submitElectronicDocument(document)}
          >
            Solicitar emisión
          </button>
        )}
        {isAdmin && isUnsentElectronicDraft(document) && (
          <button
            className="button button-secondary button-small"
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
              className="button button-secondary button-small"
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
      setError(reason instanceof Error ? reason.message : "No se pudo solicitar la emisión.");
    } finally {
      setCheckingDocumentId("");
    }
  }

  return (
    <>
      <Panel
        title="Facturación electrónica y documentos de proveedores"
        description="Prepara información tributaria, conserva borradores y revisa facturas XML localmente."
        action={
          <div className="flex flex-wrap gap-2">
            {isAdmin && (
              <button
                className="button button-secondary button-small"
                onClick={() => setConfigurationOpen(true)}
              >
                Configuración tributaria
              </button>
            )}
            {canEdit && (
              <label className="button button-primary button-small cursor-pointer">
                {parsing ? "Leyendo XML…" : "Importar XML proveedor"}
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
        }
      >
        <div className="panel-body grid gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Status tone={providerMismatch ? "danger" : connected ? "good" : "warning"}>
              {providerMismatch
                ? `Proveedor distinto · conector: ${providerStatus?.providerId}`
                : connected
                  ? `Proveedor conectado${providerStatus?.providerId ? ` · ${providerStatus.providerId}` : ""}`
                  : "Sin proveedor tecnológico conectado"}
            </Status>
            <Status>{config.environment === "production" ? "Producción" : "Pruebas"}</Status>
            <Status tone={numberingExpired ? "danger" : numberingReady ? "good" : "warning"}>
              {numberingExpired
                ? "Numeración vencida"
                : numberingReady
                  ? "Numeración configurada"
                  : "Numeración pendiente"}
            </Status>
            {providerStatusError && (
              <span className="text-xs text-muted">{providerStatusError}</span>
            )}
            <button
              className="button button-secondary button-small"
              type="button"
              disabled={providerLoading}
              onClick={() => void loadProviderStatus()}
            >
              {providerLoading ? "Consultando…" : "Revisar conexión"}
            </button>
          </div>
          <div className="notice warning">
            {providerStatus?.message ??
              "Pyme360 prepara borradores, pero no transmite a la DIAN hasta configurar un conector autorizado."}
            {config.providerId && !connected
              ? ` ID de proveedor guardado: ${config.providerId}; aún no hay adaptador habilitado.`
              : ""}
            {providerMismatch
              ? ` El conector del servidor está registrado como ${providerStatus?.providerId}, pero la empresa configuró ${config.providerId}. Ajusta uno de los dos identificadores.`
              : ""}
          </div>
          {state.electronicDocuments.length > 0 && (
            <>
            <div className="table-wrap desktop-record-table">
              <table>
                <thead>
                  <tr>
                    <th>Documento</th>
                    <th>Venta</th>
                    <th>Fecha preparada</th>
                    <th>Estado</th>
                    <th>Validaciones pendientes</th>
                    {canEdit && <th>Acciones</th>}
                  </tr>
                </thead>
                <tbody>
                  {orderedElectronicDocuments.map((document) => (
                    <tr key={document.id}>
                      <td>
                        <strong>{document.documentNumber || "Borrador sin numerar"}</strong>
                        <small>
                          {document.kind === "invoice"
                            ? "Factura de venta"
                            : document.kind === "credit_note"
                              ? "Nota crédito"
                              : "Nota débito"}
                        </small>
                      </td>
                      <td>
                        {state.sales.find((sale) => sale.id === document.saleId)?.number ??
                          "Venta histórica"}
                      </td>
                      <td>{formatDate(document.createdAt.slice(0, 10))}</td>
                      <td>
                        <Status
                          tone={
                            document.status === "accepted" || document.status === "delivered"
                              ? "good"
                              : document.status === "rejected"
                                ? "danger"
                                : "warning"
                          }
                        >
                          {documentStatusLabel(document.status)}
                        </Status>
                        <button
                          className="button button-secondary button-small mt-2"
                          type="button"
                          disabled={checkingDocumentId === document.id}
                          onClick={() => void checkDocumentStatus(document)}
                        >
                          {checkingDocumentId === document.id ? "Consultando…" : "Consultar estado"}
                        </button>
                        {documentStatusMessages[document.id] && (
                          <small>{documentStatusMessages[document.id]}</small>
                        )}
                        {document.providerReference && (
                          <small>Referencia del proveedor: {document.providerReference}</small>
                        )}
                        {document.cufe && <small>CUFE: {document.cufe}</small>}
                        {document.validationMessage && (
                          <small>{document.validationMessage}</small>
                        )}
                      </td>
                      <td>
                        {document.validationIssues.length
                          ? document.validationIssues.join(" ")
                          : "Sin alertas locales"}
                      </td>
                      {canEdit && <td>{electronicDocumentActionButtons(document)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-record-list">
              {orderedElectronicDocuments.map((document) => {
                const saleNumber =
                  state.sales.find((sale) => sale.id === document.saleId)?.number ??
                  "Venta histórica";
                const kindLabel =
                  document.kind === "invoice"
                    ? "Factura de venta"
                    : document.kind === "credit_note"
                      ? "Nota crédito"
                      : "Nota débito";

                return (
                  <article className="mobile-record-card" key={document.id}>
                    <div className="mobile-record-card-heading">
                      <div className="mobile-record-main">
                        <strong>{document.documentNumber || "Borrador sin numerar"}</strong>
                        <span>{kindLabel} · {saleNumber}</span>
                        <span>Preparada el {formatDate(document.createdAt.slice(0, 10))}</span>
                      </div>
                      <Status
                        tone={
                          document.status === "accepted" || document.status === "delivered"
                            ? "good"
                            : document.status === "rejected"
                              ? "danger"
                              : "warning"
                        }
                      >
                        {documentStatusLabel(document.status)}
                      </Status>
                    </div>
                    <div className="mobile-record-details">
                      {document.providerReference && (
                        <span>Referencia del proveedor: {document.providerReference}</span>
                      )}
                      {document.cufe && <span className="break-all">CUFE: {document.cufe}</span>}
                      {document.validationMessage && <span>{document.validationMessage}</span>}
                    </div>
                    <details className="mobile-metric-details">
                      <summary>
                        {document.validationIssues.length
                          ? `Validaciones pendientes (${document.validationIssues.length})`
                          : "Validaciones locales"}
                      </summary>
                      <p className="mobile-record-description">
                        {document.validationIssues.length
                          ? document.validationIssues.join(" ")
                          : "Sin alertas locales"}
                      </p>
                    </details>
                    <div className="mobile-record-actions">
                      <button
                        className="button button-secondary"
                        type="button"
                        disabled={checkingDocumentId === document.id}
                        onClick={() => void checkDocumentStatus(document)}
                      >
                        {checkingDocumentId === document.id ? "Consultando…" : "Consultar estado"}
                      </button>
                      {electronicDocumentActionButtons(document)}
                    </div>
                    {documentStatusMessages[document.id] && (
                      <p className="mobile-record-description" role="status">
                        {documentStatusMessages[document.id]}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
            </>
          )}
          <div>
            <h3 className="mb-2 text-sm font-semibold">Facturas de proveedores importadas</h3>
            {state.supplierInvoices.length ? (
              <>
              <div className="table-wrap desktop-record-table">
                <table>
                  <thead>
                    <tr>
                      <th>Factura</th>
                      <th>Proveedor</th>
                      <th>Fecha</th>
                      <th>Moneda / total</th>
                      <th>Compra relacionada</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.supplierInvoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td>
                          <strong>{invoice.documentNumber}</strong>
                          <small>{invoice.fileName}</small>
                        </td>
                        <td>
                          {invoice.supplierName}
                          <small>{invoice.supplierTaxId}</small>
                        </td>
                        <td>{formatDate(invoice.issueDate)}</td>
                        <td>
                          {invoice.currency} {formatNumber(invoice.total)}
                          <small>Impuestos: {formatNumber(invoice.taxAmount)}</small>
                        </td>
                        <td>
                          {state.purchases.find((purchase) => purchase.id === invoice.purchaseId)
                            ?.number ?? "Sin vincular"}
                        </td>
                        <td>
                          <Status tone={invoice.status === "linked" ? "good" : "warning"}>
                            {invoice.status === "linked" ? "Vinculada" : "Pendiente de revisión"}
                          </Status>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mobile-record-list">
                {state.supplierInvoices.map((invoice) => {
                  const relatedPurchase = state.purchases.find(
                    (purchase) => purchase.id === invoice.purchaseId,
                  );
                  return (
                    <article className="mobile-record-card" key={invoice.id}>
                      <div className="mobile-record-card-heading">
                        <div className="mobile-record-main">
                          <strong>{invoice.documentNumber}</strong>
                          <span>{invoice.supplierName}</span>
                          <span>{invoice.supplierTaxId}</span>
                        </div>
                        <Status tone={invoice.status === "linked" ? "good" : "warning"}>
                          {invoice.status === "linked" ? "Vinculada" : "Pendiente de revisión"}
                        </Status>
                      </div>
                      <div className="mobile-record-stat-grid">
                        <div>
                          <span>Total · {invoice.currency}</span>
                          <strong>{formatNumber(invoice.total)}</strong>
                        </div>
                        <div>
                          <span>Impuestos</span>
                          <strong>{formatNumber(invoice.taxAmount)}</strong>
                        </div>
                      </div>
                      <div className="mobile-record-details">
                        <span>Fecha: {formatDate(invoice.issueDate)}</span>
                        <span>Compra: {relatedPurchase?.number ?? "Sin vincular"}</span>
                        <span className="break-all">Archivo: {invoice.fileName}</span>
                      </div>
                    </article>
                  );
                })}
              </div>
              </>
            ) : (
              <p className="m-0 text-sm text-muted">
                No se han importado facturas XML de proveedores.
              </p>
            )}
          </div>
          <p className="m-0 text-xs leading-relaxed text-muted">
            El XML se procesa en el servidor de este computador y se descarta después de la vista
            previa. Al confirmar se guardan los datos normalizados; no se crean movimientos de
            inventario, pagos ni obligaciones automáticamente.
          </p>
        </div>
      </Panel>

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
        <Modal title="Revisar factura XML del proveedor" onClose={() => setPreview(null)} wide>
          <div className="modal-body grid gap-4">
            {error && <div className="notice warning">{error}</div>}
            {preview.buyerTaxId.trim().toLowerCase() !==
              (state.company?.taxId ?? "").trim().toLowerCase() && (
              <div className="notice warning">
                El NIT del adquirente del XML no coincide con el de la empresa configurada. Puedes
                guardarlo pendiente de revisión, pero no vincularlo a una compra.
              </div>
            )}
            {preview.currency !== "COP" && (
              <div className="notice warning">
                La factura está en {preview.currency}. Pyme360 no convierte moneda; guárdala sin
                vincularla a una compra hasta revisar el valor y la conversión aplicable.
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
                  label="Vincular a compra existente (opcional)"
                  name="supplier-invoice-purchase"
                  value={selectedPurchaseId}
                  onChange={setSelectedPurchaseId}
                  options={[
                    { value: "", label: "Guardar pendiente de revisión" },
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
                {saving ? "Guardando…" : "Confirmar importación"}
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
      {error && !preview && <div className="notice warning mt-3">{error}</div>}
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
          La nota queda como borrador. Solo el proveedor conectado podrá transmitirla y actualizar
          su estado. Los ajustes aceptados modificarán el saldo por cobrar; no cambian inventario
          automáticamente.
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
                <th>Línea de factura</th>
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
  const labels: Record<string, string> = {
    draft: "Borrador",
    queued: "En cola",
    transmitted: "Enviado",
    accepted: "Aceptado",
    rejected: "Rechazado",
    delivered: "Entregado",
    contingency_pending: "Contingencia pendiente",
  };
  return labels[status] ?? status;
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
    <Modal title="Configuración tributaria y numeración" onClose={onClose} wide>
      <form className="modal-body" onSubmit={(event) => void submit(event)}>
        {(error || formError) && <div className="notice warning">{error || formError}</div>}
        <div className="notice warning">
          Ingresa únicamente los datos confirmados en el RUT y en la autorización de numeración. El
          conector se configura fuera de esta pantalla, en <code>server/.env</code>; aquí no se
          guardan credenciales ni certificados.
        </div>
        <div className="form-grid">
          <Field
            label="Dirección fiscal"
            name="legalAddress"
            initialValue={configuration.legalAddress}
            required
          />
          <Field
            label="Correo de recepción de facturas"
            name="invoiceEmail"
            type="email"
            initialValue={configuration.invoiceEmail}
          />
          <Field
            label="Régimen / perfil tributario (según RUT)"
            name="taxRegime"
            initialValue={configuration.taxRegime}
          />
          <Field
            label="Responsabilidades del RUT (separadas por coma)"
            name="taxResponsibilities"
            initialValue={configuration.taxResponsibilities.join(", ")}
          />
          <Field
            label="ID del proveedor tecnológico (debe coincidir con server/.env)"
            name="providerId"
            initialValue={configuration.providerId}
          />
          <SelectField
            label="Ambiente"
            name="environment"
            initialValue={configuration.environment}
            options={[
              { value: "test", label: "Pruebas" },
              { value: "production", label: "Producción" },
            ]}
          />
          <Field
            label="Número de resolución"
            name="resolutionNumber"
            initialValue={configuration.resolutionNumber}
          />
          <Field label="Prefijo" name="prefix" initialValue={configuration.prefix} />
          <Field
            label="Rango autorizado · desde"
            name="rangeFrom"
            type="number"
            initialValue={configuration.rangeFrom ?? ""}
            min="1"
            step="1"
          />
          <Field
            label="Rango autorizado · hasta"
            name="rangeTo"
            type="number"
            initialValue={configuration.rangeTo ?? ""}
            min="1"
            step="1"
          />
          <Field
            label="Vigencia desde"
            name="validFrom"
            type="date"
            initialValue={configuration.validFrom}
          />
          <Field
            label="Vigencia hasta"
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
            label="Rango de contingencia · desde"
            name="contingencyRangeFrom"
            type="number"
            initialValue={configuration.contingencyRangeFrom ?? ""}
            min="1"
            step="1"
          />
          <Field
            label="Rango de contingencia · hasta"
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
            Guardar configuración
          </button>
        </div>
      </form>
    </Modal>
  );
}
