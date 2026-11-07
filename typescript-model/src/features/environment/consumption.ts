import type { ReceiptExtraction, ReceiptImport } from "../../domain/types";

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

/** Las empresas de servicios públicos se identifican como E.S.P.; no hace falta una lista. */
export function detectProvider(text: string): string {
  for (const line of text.split(/\n/)) {
    const match =
      /([A-Za-zÁÉÍÓÚÑáéíóúñ0-9][A-Za-zÁÉÍÓÚÑáéíóúñ0-9 .&-]{2,70}?\bE\.?\s?S\.?\s?P\b\.?)/.exec(
        line,
      );
    if (match) return match[1].replace(/\s+/g, " ").trim();
  }
  return "";
}

const MONEY = String.raw`\$?\s*(\d{1,3}(?:[.,]\d{3})+|\d{4,})(?![\d.,]*\s*(?:kwh|m3|m³))`;
/** Los números que siguen a estas palabras no son valores del servicio. */
const NOT_AMOUNT = String.raw`nit\b|factura|cuenta|contrato|tel[eé]fono|tel\.|c[oó]digo|\bno\.`;
const nearby = (service: string, others: string) =>
  new RegExp(`(?:${service})(?:(?!${others}|${NOT_AMOUNT})[^\\d\\n]){0,30}?${MONEY}`, "i");

const SERVICE_WORDS = {
  water: {
    others: /alcantarillado|\baseo\b|energ[ií]a/i,
    amount: nearby("acueducto|agua", "alcantarillado|aseo|energ[ií]a|total a pagar"),
  },
  electricity: {
    others: /alumbrado|\baseo\b|acueducto/i,
    amount: nearby("energ[ií]a", "alumbrado|aseo|acueducto|total a pagar"),
  },
};

/**
 * Busca el valor del servicio. Si el recibo cobra otros servicios y no lo separa,
 * deja el valor vacío: usar el total inflaría el precio y el ahorro en pesos.
 */
export function serviceAmount(
  text: string,
  resource: "water" | "electricity",
  total: number,
): { billedAmount: number; otherServices: boolean } {
  const words = SERVICE_WORDS[resource];
  const otherServices = words.others.test(text);
  // Los PDF suelen perder los saltos de línea: se busca el valor justo después del servicio.
  const match = words.amount.exec(text);
  if (match) return { billedAmount: numberFromText(match[1]), otherServices };
  return { billedAmount: otherServices ? 0 : total, otherServices };
}

/** Proveedor del último recibo del mismo servicio, para no pedirlo cada mes. */
export function rememberedProvider(
  receipts: ReceiptImport[],
  resource: ReceiptExtraction["resource"],
): string {
  return (
    receipts.find(
      (receipt) =>
        receipt.extraction.resource === resource &&
        receipt.provider &&
        receipt.provider !== "Proveedor no identificado",
    )?.provider ?? ""
  );
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
  const resource = result.type === "water" ? "water" : "electricity";
  const invoiceNumber = (
    /(?:factura|número de factura|no\.?)\s*[:#-]?\s*([A-Z0-9-]{4,})/i.exec(text)?.[1] ?? ""
  ).trim();
  const total = firstMatch(text, [
    /(?:total a pagar|valor total|total factura)[^\d]{0,40}[$\s]*([\d.,]+)/i,
  ]);
  const { billedAmount, otherServices } = serviceAmount(text, resource, total);
  const warnings = [...result.warnings];
  return {
    fileHash: await hashFile(file),
    extraction: {
      period: result.period,
      resource,
      quantity: Number(result.consumption) || 0,
      unit: result.type === "water" ? "m³" : "kWh",
      billedAmount,
      invoiceNumber,
      provider: detectProvider(text),
      otherServicesDetected: otherServices,
      confidence: result.confidence,
      warnings,
      textPreview: text.slice(0, 1400),
    },
  };
}
