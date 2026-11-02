import type { SupplierInvoiceLine, TaxEnvironment } from "../../domain/types";

export interface SupplierInvoicePreview {
  fileName: string;
  documentNumber: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  supplierTaxId: string;
  supplierName: string;
  buyerTaxId: string;
  taxAmount: number;
  total: number;
  lines: SupplierInvoiceLine[];
}

export interface EInvoicingProviderStatus {
  configured: boolean;
  providerId: string | null;
  environment: TaxEnvironment | null;
  message: string;
}

export interface ElectronicDocumentStatusResult {
  documentId: string;
  status: string;
  documentNumber?: string;
  providerReference?: string;
  cufe?: string;
  environment?: TaxEnvironment;
  checkedAt: string;
  providerQueried: boolean;
  revision?: number;
  message: string;
}

export interface ElectronicDocumentSubmissionResult {
  transmitted: boolean;
  documentId: string;
  status: string;
  documentNumber?: string;
  providerReference?: string;
  cufe?: string;
  message: string;
  revision: number;
}

function responseError(payload: unknown, fallback: string): string {
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string") return error;
  }
  return fallback;
}

export async function fetchEInvoicingProviderStatus(): Promise<EInvoicingProviderStatus> {
  const response = await fetch("/api/v1/e-invoicing/provider-status", { cache: "no-store" });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(responseError(payload, "No se pudo consultar el estado del proveedor."));
  return payload as EInvoicingProviderStatus;
}

export async function fetchElectronicDocumentStatus(
  documentId: string,
): Promise<ElectronicDocumentStatusResult> {
  const response = await fetch(
    `/api/v1/e-invoicing/documents/${encodeURIComponent(documentId)}/status`,
    { cache: "no-store" },
  );
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(responseError(payload, "No se pudo consultar el estado del documento."));
  return payload as ElectronicDocumentStatusResult;
}

/** Sends the selected XML only to the loopback server for a preview; it is not persisted. */
export async function previewSupplierInvoice(file: File): Promise<SupplierInvoicePreview> {
  if (!file.name.toLowerCase().endsWith(".xml")) throw new Error("Selecciona un archivo .xml.");
  if (file.size < 1 || file.size > 2 * 1024 * 1024)
    throw new Error("El XML debe pesar menos de 2 MB.");
  const xml = await file.text();
  const response = await fetch("/api/v1/e-invoicing/supplier-invoices/preview", {
    method: "POST",
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "X-File-Name": encodeURIComponent(file.name),
    },
    body: xml,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(responseError(payload, "No se pudo leer la factura del proveedor."));
  return payload as SupplierInvoicePreview;
}

export async function requestElectronicDocumentSubmission(
  documentId: string,
): Promise<ElectronicDocumentSubmissionResult> {
  const response = await fetch(
    `/api/v1/e-invoicing/documents/${encodeURIComponent(documentId)}/submit`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
  );
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseError(payload, "No se pudo transmitir el documento."));
  return payload as ElectronicDocumentSubmissionResult;
}
