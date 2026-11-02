const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/**
 * Devuelve una etiqueta con el número y la forma correcta del sustantivo.
 * Se exige el plural explícito porque en español no siempre se forma con "s".
 */
export function pluralize(count: number, singular: string, plural: string): string {
  const formatted = new Intl.NumberFormat("es-CO").format(count);
  return `${formatted} ${count === 1 ? singular : plural}`;
}

/** Convierte un periodo ISO "AAAA-MM" en una etiqueta como "octubre de 2026". */
export function formatPeriod(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period.trim());
  if (!match) return period;
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return period;
  return `${MONTH_NAMES[monthIndex]} de ${match[1]}`;
}
