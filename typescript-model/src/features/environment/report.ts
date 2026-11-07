import { calculateMonthlyEnvironmentalMetrics } from "../../domain/environmental";
import {
  buildSavingsSuggestions,
  calculateProductFootprint,
  calculateSavings,
  type ResourceSavings,
} from "../../domain/insights";
import type { AppState } from "../../domain/types";
import { formatPeriod } from "../../shared/format";

export interface ReportSection {
  title: string;
  lines: string[];
}

export interface EnvironmentalReport {
  title: string;
  subtitle: string;
  sections: ReportSection[];
  note: string;
}

const amount = (value: number | null, unit: string, digits = 1) =>
  value === null
    ? "Sin dato"
    : `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: digits }).format(value)} ${unit}`;

const pesos = (value: number | null) =>
  value === null
    ? "Sin dato"
    : new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: "COP",
        maximumFractionDigits: 0,
      }).format(value);

function savingsLine(label: string, item: ResourceSavings | null): string {
  if (!item) return `${label}: faltan datos para comparar.`;
  const word = item.savedQuantity >= 0 ? "Ahorro" : "Aumento";
  const basis =
    item.basis === "per-unit" ? "ajustado por producción" : "sin ajustar por producción";
  return `${label}: ${word} de ${amount(Math.abs(item.savedQuantity), item.unit)} (${basis}). En pesos: ${pesos(item.savedPesos)}.`;
}

/** Arma el contenido del informe; no depende del formato en que se descargue. */
export function buildEnvironmentalReport(
  state: AppState,
  period: string,
  basePeriod: string | null,
): EnvironmentalReport {
  const metrics = calculateMonthlyEnvironmentalMetrics(state);
  const month = metrics.find((item) => item.period === period);
  const savings = basePeriod ? calculateSavings(state, basePeriod, period, metrics) : null;
  const footprint = calculateProductFootprint(state, period, metrics);
  const suggestions = buildSavingsSuggestions(state, period, basePeriod, metrics);
  const carbon =
    month && (month.scope1KgCo2e !== null || month.scope2KgCo2e !== null)
      ? (month.scope1KgCo2e ?? 0) + (month.scope2KgCo2e ?? 0)
      : null;
  const open = state.environmentalActions.filter((action) => action.status === "open");
  const extraColumns = [...new Set(state.importExtras.map((extra) => extra.fieldName))];
  const done = state.environmentalActions.filter((action) => action.status === "completed");
  return {
    title: "Informe de consumo y ahorro",
    subtitle: `${state.company?.name ?? "Empresa"} · ${formatPeriod(period)}`,
    sections: [
      {
        title: "Consumo del mes",
        lines: [
          `Energía: ${amount(month?.electricityKwh ?? null, "kWh")}`,
          `Agua: ${amount(month?.waterWithdrawalM3 ?? null, "m3")}`,
          `Unidades producidas: ${amount(month?.productionUnits ?? null, "unidades", 0)}`,
          `Energía por unidad: ${amount(month?.energyPerUnit ?? null, "kWh", 2)}`,
          `Huella de carbono: ${amount(carbon, "kg CO2e")}`,
        ],
      },
      {
        title: savings ? `Ahorro frente a ${formatPeriod(savings.basePeriod)}` : "Ahorro",
        lines: savings
          ? [
              savingsLine("Energía", savings.electricity),
              savingsLine("Agua", savings.water),
              `Total en pesos: ${pesos(savings.totalPesos)}`,
              `CO2e evitado: ${amount(savings.totalKgCo2e, "kg")}`,
            ]
          : ["Hace falta un mes base anterior a este mes para comparar."],
      },
      {
        title: "Consumo por producto",
        lines: footprint.length
          ? footprint.map(
              (row) =>
                `${row.productName}: ${amount(row.goodUnits, "unidades", 0)}, ${amount(row.electricityKwh, "kWh")}, ${amount(row.kgCo2e, "kg CO2e")}`,
            )
          : ["No hay órdenes de producción terminadas en este mes."],
      },
      {
        title: "Plan de ahorro",
        lines: [
          ...open.map((action) => `Pendiente: ${action.title} (${action.owner})`),
          ...done.map((action) => `Hecha: ${action.title} (${action.owner})`),
          ...suggestions.map((item) => `Sugerencia: ${item.title}. ${item.reason}`),
        ].concat(
          open.length || done.length || suggestions.length ? [] : ["Sin medidas registradas."],
        ),
      },
      ...(extraColumns.length
        ? [
            {
              title: "Datos importados sin sección",
              lines: [
                `Se conservaron estas columnas: ${extraColumns.join(", ")}.`,
                "Puedes verlas en la hoja Datos adicionales del Excel.",
              ],
            },
          ]
        : []),
    ],
    note: "Este informe orienta decisiones internas. No es un certificado oficial. El consumo por producto es una aproximación: se reparte según las unidades terminadas.",
  };
}

/** Descarga el informe como PDF. La librería se carga solo cuando se necesita. */
export async function downloadEnvironmentalReport(
  state: AppState,
  period: string,
  basePeriod: string | null,
): Promise<void> {
  const report = buildEnvironmentalReport(state, period, basePeriod);
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 56;
  const width = pdf.internal.pageSize.getWidth() - margin * 2;
  const bottom = pdf.internal.pageSize.getHeight() - margin;
  let y = margin;
  const write = (text: string, size: number, style: "normal" | "bold", gap: number) => {
    pdf.setFont("helvetica", style);
    pdf.setFontSize(size);
    for (const line of pdf.splitTextToSize(text, width) as string[]) {
      if (y > bottom) {
        pdf.addPage();
        y = margin;
      }
      pdf.text(line, margin, y);
      y += size * 1.35;
    }
    y += gap;
  };
  write(report.title, 18, "bold", 2);
  write(report.subtitle, 11, "normal", 14);
  for (const section of report.sections) {
    write(section.title, 12, "bold", 2);
    for (const line of section.lines) write(line, 10, "normal", 2);
    y += 10;
  }
  write(report.note, 9, "normal", 0);
  pdf.save(`pyme360-informe-${period}.pdf`);
}
