import type { ReceiptExtraction } from "../../domain/types";

interface ReceiptReaderResult {
  type: "energy" | "water";
  period: string;
  consumption: number | string;
  unit: string;
  confidence: number;
  warnings: string[];
  textPreview: string;
  method: string;
  sourceLabel: string;
}

declare global {
  interface Window {
    Pyme360ReceiptReader?: {
      read: (
        file: File,
        onProgress?: (progress: { label: string; percent: number }) => void,
      ) => Promise<ReceiptReaderResult>;
    };
  }
}

function numberFromText(value: string): number {
  let normalized = value.replace(/\s/g, "");
  const comma = normalized.lastIndexOf(",");
  const dot = normalized.lastIndexOf(".");
  if (comma >= 0 && dot >= 0)
    normalized =
      comma > dot ? normalized.replace(/\./g, "").replace(",", ".") : normalized.replace(/,/g, "");
  else if (comma >= 0)
    normalized =
      normalized.length - comma - 1 <= 2
        ? normalized.replace(/\./g, "").replace(",", ".")
        : normalized.replace(/,/g, "");
  else if (dot >= 0 && normalized.length - dot - 1 === 3)
    normalized = normalized.replace(/\./g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function firstMatch(text: string, expressions: RegExp[]): number {
  for (const expression of expressions) {
    const match = expression.exec(text);
    if (match?.[1]) return numberFromText(match[1]);
  }
  return 0;
}

async function hashFile(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function extractReceipt(
  file: File,
  onProgress?: (label: string, percent: number) => void,
): Promise<{ extraction: ReceiptExtraction; fileHash: string }> {
  if (!window.Pyme360ReceiptReader)
    throw new Error("No se cargó el lector local de recibos. Recarga la aplicación.");
  const result = await window.Pyme360ReceiptReader.read(file, (progress) =>
    onProgress?.(progress.label, progress.percent),
  );
  const text = result.textPreview || "";
  const provider = /enel/i.test(text) ? "Enel Colombia" : "Proveedor no identificado";
  const invoiceNumber = (
    /(?:factura|número de factura|no\.?)\s*[:#-]?\s*([A-Z0-9-]{4,})/i.exec(text)?.[1] ?? ""
  ).trim();
  const billedAmount = firstMatch(text, [
    /(?:total a pagar|valor total|total factura)[^\d]{0,40}[$\s]*([\d.,]+)/i,
  ]);
  const warnings = [...result.warnings];
  if (!provider || provider === "Proveedor no identificado")
    warnings.push("No identificamos el proveedor. Revisa el nombre antes de confirmar.");
  return {
    fileHash: await hashFile(file),
    extraction: {
      period: result.period,
      resource: result.type === "water" ? "water" : "electricity",
      quantity: Number(result.consumption) || 0,
      unit: result.type === "water" ? "m³" : "kWh",
      billedAmount,
      invoiceNumber,
      provider,
      confidence: result.confidence,
      warnings,
      textPreview: text.slice(0, 1400),
    },
  };
}
