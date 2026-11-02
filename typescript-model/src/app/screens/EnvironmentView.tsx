import { useEffect, useRef, useState } from "react";
import {
  loadEnvironmentalBenchmarks,
  refreshEnvironmentalBenchmarks,
} from "../../features/environment/benchmarks";
import {
  calculateMonthlyEnvironmentalMetrics,
  INDICATOR_CATALOG,
  targetProgress,
  type MonthlyEnvironmentalMetrics,
} from "../../domain/environmental";
import {
  currentMonth,
  formatDate,
  formatNumber,
  PageHeading,
  Panel,
  EmptyState,
  Status,
} from "../AppViews";
import type {
  AppState,
  EnvironmentalBenchmarkResponse,
  EmissionFactor,
  EnvironmentalAction,
  EnvironmentalRecord,
  IndicatorId,
  IndicatorTarget,
  ConsumptionSource,
  ReadingQuality,
  ResourceKind,
  ResourceReading,
} from "../../domain/types";

interface EnvironmentPageProps {
  state: AppState;
  canEdit: boolean;
  canDelete: boolean;
  isAdmin: boolean;
  onEditReading: (reading?: ResourceReading) => void;
  onDeleteReading: (readingId: string) => void;
  onImport: (file: File) => void;
  onConfigure: () => void;
  onNewTarget: () => void;
  onEditTarget: (target: IndicatorTarget) => void;
  onDeleteTarget: (targetId: string) => void;
  onNewFactor: () => void;
  onEditFactor: (factor: EmissionFactor) => void;
  onDeleteFactor: (factorId: string) => void;
  onNewAction: () => void;
  onToggleAction: (actionId: string) => void;
  onDeleteAction: (actionId: string) => void;
}

const indicatorTitles: Record<IndicatorId, string> = {
  "energy-intensity": "Intensidad de energía",
  "water-intensity": "Intensidad de agua",
  "material-intensity": "Material por unidad",
  "recycled-material-share": "Material reciclado",
  "waste-recovery": "Recuperación de residuos",
  "scope-1": "Emisiones Alcance 1",
  "scope-2": "Emisiones Alcance 2",
  "scope-3": "Emisiones Alcance 3",
  "data-coverage": "Cobertura de datos",
};

function valueForIndicator(
  metrics: MonthlyEnvironmentalMetrics | undefined,
  indicator: IndicatorId,
): number | null {
  if (!metrics) return null;
  switch (indicator) {
    case "energy-intensity":
      return metrics.energyPerUnit;
    case "water-intensity":
      return metrics.waterPerUnit;
    case "material-intensity":
      return metrics.materialPerUnit;
    case "recycled-material-share":
      return metrics.recycledMaterialPercent;
    case "waste-recovery":
      return metrics.wasteRecoveryPercent;
    case "scope-1":
      return metrics.scope1KgCo2e;
    case "scope-2":
      return metrics.scope2KgCo2e;
    case "scope-3":
      return metrics.scope3KgCo2e;
    case "data-coverage":
      return metrics.dataCoveragePercent;
  }
}

function display(value: number | null, unit = "", digits = 2): string {
  return value === null || !Number.isFinite(value)
    ? "—"
    : `${formatNumber(value, digits)}${unit ? ` ${unit}` : ""}`;
}

function latestDate(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(value),
      )
    : "Sin lecturas nuevas";
}

function resourceLabel(resource: ResourceReading["resource"]): string {
  return {
    electricity: "Energía eléctrica",
    water: "Agua",
    fuel: "Combustible",
    material: "Material",
    waste: "Residuos",
  }[resource];
}

const consumptionSourceLabels: Record<ConsumptionSource, string> = {
  manual: "Manual",
  local_receipt: "Recibo importado",
  api: "API",
  production: "Producción",
  purchase: "Compra",
  legacy: "Histórico",
};

const readingQualityLabels: Record<ReadingQuality, string> = {
  measured: "Medido",
  estimated: "Estimado",
  confirmed: "Confirmado",
};

function activityLabel(activity: ResourceReading["activity"]): string {
  return {
    consumption: "Consumo",
    withdrawal: "Retirada",
    discharge: "Descarga",
    purchase: "Compra",
    generated: "Generado",
    recovered: "Recuperado",
  }[activity];
}

function qualityLabel(reading: ResourceReading): string {
  if (reading.quality === "estimated") return "Estimado";
  if (reading.quality === "measured") return "Medido";
  return "Confirmado";
}

function sourceLabel(reading: ResourceReading): string {
  if (reading.source === "local_receipt") return reading.sourceLabel || "Recibo local";
  if (reading.source === "legacy") return reading.sourceLabel || "Dato histórico";
  return reading.sourceLabel || "Manual";
}

function formatFactor(factor: EmissionFactor): string {
  return `${formatNumber(factor.kgCo2ePerUnit, 6)} kg CO₂e/${factor.activityUnit}`;
}

function isAdjacentMonth(current: string | undefined, previous: string | undefined): boolean {
  if (!current || !previous) return false;
  const [year, month] = current.split("-").map(Number);
  const prior = new Date(Date.UTC(year, month - 2, 1));
  return (
    previous === `${prior.getUTCFullYear()}-${String(prior.getUTCMonth() + 1).padStart(2, "0")}`
  );
}

function shiftPeriod(period: string, offset: number): string {
  const [year, month] = period.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

function periodTitle(period: string): string {
  const [year, month] = period.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CO", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function periodAxisLabel(period: string): string {
  const [year, month] = period.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CO", {
    month: "short",
    timeZone: "UTC",
  })
    .format(new Date(Date.UTC(year, month - 1, 1)))
    .replace(".", "");
}

function monthChange(current: number | null, previous: number | null, adjacent: boolean): string {
  if (!adjacent || current === null || previous === null || previous === 0)
    return "Sin comparación mensual";
  const change = ((current - previous) / Math.abs(previous)) * 100;
  const prefix = change > 0 ? "+" : "";
  return `${prefix}${formatNumber(change, 1)} % frente al mes anterior`;
}

function findMissingRecentMonths(
  metrics: MonthlyEnvironmentalMetrics[],
  current: string,
): string[] {
  const available = new Set(
    metrics.filter((item) => item.dataCoveragePercent > 0).map((item) => item.period),
  );
  const [year, month] = current.split("-").map(Number);
  const missing: string[] = [];
  for (let offset = 1; offset <= 3; offset += 1) {
    const date = new Date(Date.UTC(year, month - 1 - offset, 1));
    const period = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!available.has(period)) missing.push(period);
  }
  return missing;
}

interface TrendPoint {
  period: string;
  value: number | null;
}

type TrendMetric = "electricity" | "energy-intensity" | "water" | "water-intensity";

interface TrendTarget {
  value: number;
  period: string;
  horizonMonths: number;
}

interface EnvironmentalAlert {
  id: string;
  category: string;
  title: string;
  detail: string;
  resource?: ResourceKind;
  actionLabel: string;
  action: "register" | "readings";
}

const trendMetricOptions: Array<{ value: TrendMetric; label: string; unit: string }> = [
  { value: "electricity", label: "Electricidad", unit: "kWh" },
  { value: "energy-intensity", label: "Electricidad por unidad", unit: "kWh/u" },
  { value: "water", label: "Agua retirada", unit: "m³" },
  { value: "water-intensity", label: "Agua por unidad", unit: "m³/u" },
];

function valueForTrendMetric(
  metrics: MonthlyEnvironmentalMetrics | undefined,
  metric: TrendMetric,
): number | null {
  if (!metrics) return null;
  switch (metric) {
    case "electricity":
      return metrics.electricityKwh;
    case "energy-intensity":
      return metrics.energyPerUnit;
    case "water":
      return metrics.waterWithdrawalM3;
    case "water-intensity":
      return metrics.waterPerUnit;
  }
}

function indicatorTargetValue(target: IndicatorTarget): number {
  const percentagePointIndicator = [
    "recycled-material-share",
    "waste-recovery",
    "data-coverage",
  ].includes(target.indicatorId);
  if (target.direction === "decrease")
    return target.baselineValue * (1 - target.reductionPercent / 100);
  return percentagePointIndicator
    ? target.baselineValue + target.reductionPercent
    : target.baselineValue * (1 + target.reductionPercent / 100);
}

function getApprovedTrendTarget(
  targets: IndicatorTarget[],
  metric: TrendMetric,
): TrendTarget | undefined {
  const indicatorId =
    metric === "energy-intensity"
      ? "energy-intensity"
      : metric === "water-intensity"
        ? "water-intensity"
        : null;
  if (!indicatorId) return undefined;

  const target = targets
    .filter((candidate) => candidate.indicatorId === indicatorId && candidate.approvedAt)
    .sort(
      (left, right) =>
        left.horizonMonths - right.horizonMonths ||
        right.baselinePeriod.localeCompare(left.baselinePeriod),
    )[0];
  if (!target) return undefined;

  const value = indicatorTargetValue(target);
  if (!Number.isFinite(value) || value < 0) return undefined;

  return {
    value,
    period: shiftPeriod(target.baselinePeriod, target.horizonMonths),
    horizonMonths: target.horizonMonths,
  };
}

function EnvironmentalTrendChart({
  points,
  title,
  unit,
  periodLabel,
  target,
}: {
  points: TrendPoint[];
  title: string;
  unit: string;
  periodLabel: string;
  target?: TrendTarget;
}) {
  const width = 360;
  const height = 190;
  const padding = { top: 18, right: 8, bottom: 36, left: 52 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const values = points.map((point) => point.value);
  const availableValues = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  if (!availableValues.length) {
    return (
      <div className="environment-trend-empty">
        <strong>{title}</strong>
        <p>Sin lecturas disponibles para mostrar una tendencia.</p>
      </div>
    );
  }

  const maximum = Math.max(...availableValues, target?.value ?? 0, 1);
  const targetY = target
    ? padding.top + chartHeight - (target.value / maximum) * chartHeight
    : null;
  const coordinates = points.map((point, index) => {
    const value = point.value;
    return value === null || !Number.isFinite(value)
      ? null
      : {
          x: padding.left + (points.length > 1 ? (index / (points.length - 1)) * chartWidth : chartWidth / 2),
          y: padding.top + chartHeight - (value / maximum) * chartHeight,
          period: point.period,
          value,
        };
  });
  const segments: string[] = [];
  let segment: string[] = [];
  coordinates.forEach((coordinate, index) => {
    if (!coordinate) {
      if (segment.length) segments.push(segment.join(" "));
      segment = [];
      return;
    }
    const previousCoordinate = coordinates[index - 1];
    const canConnect =
      previousCoordinate !== null &&
      previousCoordinate !== undefined &&
      isAdjacentMonth(coordinate.period, previousCoordinate.period);
    if (!canConnect) {
      if (segment.length) segments.push(segment.join(" "));
      segment = [`M ${coordinate.x} ${coordinate.y}`];
    } else {
      segment.push(`L ${coordinate.x} ${coordinate.y}`);
    }
  });
  if (segment.length) segments.push(segment.join(" "));

  return (
    <figure className="environment-trend-figure">
      <figcaption>
        <strong>{title}</strong>
        <span>{periodLabel}</span>
      </figcaption>
      <div className="environment-chart-scroll">
        <svg
          className="environment-trend-svg"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${title}, valores en ${unit}, por mes${target ? `; meta aprobada de ${formatNumber(target.value)} ${unit} para ${periodTitle(target.period)}` : ""}`}
        >
          {[0, 0.5, 1].map((ratio) => {
            const y = padding.top + ratio * chartHeight;
            const value = maximum * (1 - ratio);
            return (
              <g key={ratio}>
                <line
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={y}
                  y2={y}
                  className="environment-chart-gridline"
                />
                <text x={padding.left - 8} y={y + 4} textAnchor="end" className="environment-chart-label">
                  {formatNumber(value, 1)}
                </text>
              </g>
            );
          })}
          {target && targetY !== null && (
            <g className="environment-trend-target">
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={targetY}
                y2={targetY}
                className="environment-trend-target-line"
              />
              <text
                x={width - padding.right - 2}
                y={Math.max(padding.top + 12, targetY - 6)}
                textAnchor="end"
                className="environment-trend-target-label"
              >
                Meta {target.horizonMonths} m
              </text>
            </g>
          )}
          {segments.map((path, index) => (
            <path className="environment-trend-line" d={path} key={`${path}-${index}`} />
          ))}
          {coordinates.map(
            (coordinate) =>
              coordinate && (
                <circle
                  className="environment-trend-point"
                  cx={coordinate.x}
                  cy={coordinate.y}
                  r="4"
                  key={coordinate.period}
                >
                  <title>{`${coordinate.period}: ${formatNumber(coordinate.value)} ${unit}`}</title>
                </circle>
              ),
          )}
          {points.map((point, index) => (
            <text
              x={padding.left + (points.length > 1 ? (index / (points.length - 1)) * chartWidth : chartWidth / 2)}
              y={height - 10}
              textAnchor="middle"
              className="environment-chart-label"
              key={point.period}
            >
              {periodAxisLabel(point.period)}
              <title>{periodTitle(point.period)}</title>
            </text>
          ))}
        </svg>
      </div>
      {target && (
        <p className="environment-trend-target-note">
          Meta aprobada: {display(target.value, unit)} · horizonte {target.horizonMonths} meses ·
          vence {periodTitle(target.period)}
        </p>
      )}
    </figure>
  );
}

function ScopeEmissions({ period }: { period?: MonthlyEnvironmentalMetrics }) {
  const scopes = [
    { label: "Alcance 1", value: period?.scope1KgCo2e ?? null, className: "scope-one" },
    { label: "Alcance 2", value: period?.scope2KgCo2e ?? null, className: "scope-two" },
    { label: "Alcance 3", value: period?.scope3KgCo2e ?? null, className: "scope-three" },
  ];
  const available = scopes.flatMap((scope) =>
    scope.value !== null && Number.isFinite(scope.value) ? [scope.value] : [],
  );
  const maximum = Math.max(...available, 1);

  return (
    <div className="environment-scope-panel">
      <div className="environment-scope-heading">
        <div>
          <strong>Emisiones por alcance</strong>
          <span>{period ? `Periodo ${period.period} · kg CO₂e` : "Sin periodo disponible"}</span>
        </div>
      </div>
      <svg
        className="environment-scope-svg"
        viewBox="0 0 360 150"
        role="img"
        aria-label={`Emisiones por alcance para ${period?.period ?? "el último periodo"}, valores en kg de CO₂ equivalente`}
      >
        {scopes.map((scope, index) => {
          const y = 28 + index * 42;
          const barWidth =
            scope.value === null || !Number.isFinite(scope.value)
              ? 0
              : Math.max(0, (scope.value / maximum) * 180);
          return (
            <g key={scope.label}>
              <text x="0" y={y + 4} className="environment-scope-svg-label">
                {scope.label}
              </text>
              {scope.value === null || !Number.isFinite(scope.value) ? (
                <text x="98" y={y + 4} className="environment-scope-svg-unavailable">
                  No disponible
                </text>
              ) : (
                <>
                  <rect
                    x="88"
                    y={y - 7}
                    width="180"
                    height="14"
                    rx="7"
                    className="environment-scope-svg-track"
                  />
                  <rect
                    x="88"
                    y={y - 7}
                    width={barWidth}
                    height="14"
                    rx="7"
                    className={`environment-scope-svg-bar ${scope.className}`}
                  />
                  <text x="280" y={y + 4} className="environment-scope-svg-value">
                    {formatNumber(scope.value)}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
      {!available.length && (
        <p className="environment-scope-note">
          Registra actividades y factores compatibles para calcular emisiones. Los datos faltantes no
          se interpretan como cero.
        </p>
      )}
    </div>
  );
}

function benchmarkStatusLabel(
  status: EnvironmentalBenchmarkResponse["sources"][number]["status"],
): string {
  return {
    ready: "Actualizada",
    stale: "Caché desactualizada",
    error: "Error de consulta",
    not_configured: "Pendiente de consulta",
  }[status];
}

function benchmarkComparabilityLabel(
  status: EnvironmentalBenchmarkResponse["comparisons"][number]["comparability"],
): string {
  return {
    direct: "Directa",
    contextual: "Contexto",
    incomplete: "Incompleta",
    unavailable: "No disponible",
  }[status];
}

function benchmarkDate(value: string | null | undefined): string {
  if (!value) return "Sin fecha";
  if (/^\d{4}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" }).format(date);
}

type BenchmarkResourceFilter =
  "all" | "water" | "energy" | "fuel" | "material" | "waste" | "emissions";

function benchmarkResourceKey(
  resource: EnvironmentalBenchmarkResponse["comparisons"][number]["reference"]["resource"],
): Exclude<BenchmarkResourceFilter, "all"> {
  return resource === "electricity" ? "energy" : resource;
}

const benchmarkResourceNames: Record<Exclude<BenchmarkResourceFilter, "all">, string> = {
  water: "Agua",
  energy: "Energía",
  fuel: "Combustible",
  material: "Materiales",
  waste: "Residuos",
  emissions: "Emisiones",
};

function BenchmarkPanel({ canRefresh }: { canRefresh: boolean }) {
  const [response, setResponse] = useState<EnvironmentalBenchmarkResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [resourceFilter, setResourceFilter] = useState<BenchmarkResourceFilter>("all");

  useEffect(() => {
    let active = true;
    void loadEnvironmentalBenchmarks()
      .then((value) => {
        if (active) setResponse(value);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : "No se cargaron las referencias.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function refresh(): Promise<void> {
    setRefreshing(true);
    setError("");
    try {
      setResponse(await refreshEnvironmentalBenchmarks());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "No se pudieron actualizar las referencias.",
      );
      try {
        setResponse(await loadEnvironmentalBenchmarks());
      } catch {
        // Mantiene en pantalla la última respuesta que ya hubiera cargado.
      }
    } finally {
      setRefreshing(false);
    }
  }

  const preferredSources = response?.profile.preferredSources ?? [];
  const sourcePriority = (sourceId: string) => {
    const index = preferredSources.indexOf(sourceId);
    return index < 0 ? preferredSources.length : index;
  };
  const sortedComparisons = [...(response?.comparisons ?? [])].sort(
    (left, right) =>
      sourcePriority(left.reference.sourceId) - sourcePriority(right.reference.sourceId) ||
      left.reference.resource.localeCompare(right.reference.resource) ||
      left.reference.sourceName.localeCompare(right.reference.sourceName),
  );
  const sortedSources = [...(response?.sources ?? [])].sort(
    (left, right) =>
      sourcePriority(left.id) - sourcePriority(right.id) || left.name.localeCompare(right.name),
  );
  const resourceOptions = [
    ...new Set(sortedComparisons.map((item) => benchmarkResourceKey(item.reference.resource))),
  ];
  const filteredComparisons = sortedComparisons.filter(
    (item) =>
      resourceFilter === "all" || benchmarkResourceKey(item.reference.resource) === resourceFilter,
  );

  // En el resumen se conserva la observación más reciente de cada serie, en vez de
  // repetir una tarjeta por cada año publicado por una fuente.
  const latestBySeries = new Map<string, (typeof filteredComparisons)[number]>();
  for (const comparison of filteredComparisons) {
    const reference = comparison.reference;
    const key = [
      reference.sourceId,
      benchmarkResourceKey(reference.resource),
      reference.indicator,
      reference.countryCode,
      reference.region ?? "",
      reference.sectorCode ?? "",
    ].join("|");
    const existing = latestBySeries.get(key);
    if (!existing || reference.periodEnd > existing.reference.periodEnd) {
      latestBySeries.set(key, comparison);
    }
  }
  const featuredCandidates = [...latestBySeries.values()].sort((left, right) => {
    const leftReference = left.reference;
    const rightReference = right.reference;
    const companyPriority =
      Number(rightReference.sourceId === "company-public") -
      Number(leftReference.sourceId === "company-public");
    const leftLocal = leftReference.countryCode === response?.profile.countryCode;
    const rightLocal = rightReference.countryCode === response?.profile.countryCode;
    return (
      companyPriority ||
      Number(rightLocal) - Number(leftLocal) ||
      Number(rightReference.comparability === "direct") -
        Number(leftReference.comparability === "direct") ||
      sourcePriority(leftReference.sourceId) - sourcePriority(rightReference.sourceId) ||
      rightReference.periodEnd.localeCompare(leftReference.periodEnd)
    );
  });
  const featuredComparisons: typeof featuredCandidates = [];
  const addFeatured = (comparison: (typeof featuredCandidates)[number] | undefined) => {
    if (
      comparison &&
      !featuredComparisons.some((item) => item.reference.id === comparison.reference.id)
    ) {
      featuredComparisons.push(comparison);
    }
  };
  const latestSeries = (resource: "water" | "energy", sourceId: string) =>
    featuredCandidates.find(
      (item) =>
        item.reference.sourceId === sourceId &&
        benchmarkResourceKey(item.reference.resource) === resource,
    );
  if (resourceFilter === "all" || resourceFilter === "water") {
    addFeatured(latestSeries("water", "company-public"));
    addFeatured(latestSeries("water", "unsd"));
  }
  if (resourceFilter === "all" || resourceFilter === "energy") {
    addFeatured(latestSeries("energy", "unsd"));
  }
  for (const comparison of featuredCandidates) {
    if (featuredComparisons.length >= 3) break;
    addFeatured(comparison);
  }
  const readySourceCount = sortedSources.filter((source) => source.status === "ready").length;

  return (
    <Panel
      title="Referencias externas"
      description="Una vista breve de las referencias más útiles; el histórico completo queda bajo demanda."
      action={
        canRefresh ? (
          <button
            className="button button-secondary button-small"
            onClick={() => void refresh()}
            disabled={loading || refreshing}
          >
            {refreshing ? "Actualizando…" : "Actualizar datos"}
          </button>
        ) : undefined
      }
    >
      <div className="panel-body">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="field-hint m-0">
            Perfil {response?.profile.countryCode ?? "CO"} ·{" "}
            {response?.profile.region ?? "Antioquia"} · CIIU{" "}
            {response?.profile.sectorCode ?? "1104"}
            <span className="mx-1.5 text-line">·</span>
            Supuesto: {formatNumber(response?.profile.assumedMonthlyOutput ?? 100000)} L/mes; no se
            usa como producción medida.
          </p>
          {response?.refreshedAt && (
            <span className="text-xs text-muted">
              Actualizado {benchmarkDate(response.refreshedAt)}
            </span>
          )}
        </div>
        {error && (
          <div className="notice warning" role="status">
            {error}
          </div>
        )}
        {loading && !response ? (
          <EmptyState>Consultando la caché local de referencias…</EmptyState>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line-soft bg-surface-muted px-3.5 py-2.5">
              <span className="text-xs text-muted">
                {filteredComparisons.length} referencia(s)
                {resourceFilter === "all"
                  ? " disponibles"
                  : ` de ${benchmarkResourceNames[resourceFilter]}`}
                {featuredComparisons.length > 0 && ` · ${featuredComparisons.length} destacada(s)`}
              </span>
              <label className="flex items-center gap-2 text-[0.875rem] font-semibold text-label">
                <span>Recurso</span>
                <select
                  aria-label="Filtrar referencias por recurso"
                  value={resourceFilter}
                  onChange={(event) =>
                    setResourceFilter(event.target.value as BenchmarkResourceFilter)
                  }
                  className="min-h-9 rounded-lg border border-control bg-surface px-2.5 text-xs text-ink outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
                >
                  <option value="all">Todos</option>
                  {resourceOptions.map((resource) => (
                    <option value={resource} key={resource}>
                      {benchmarkResourceNames[resource]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {featuredComparisons.length ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {featuredComparisons.map((comparison) => {
                  const reference = comparison.reference;
                  const comparisonNote =
                    comparison.gapPercent !== null && comparison.companyValue !== null
                      ? `Tu dato: ${formatNumber(comparison.companyValue, 3)} ${comparison.companyUnit ?? ""} · brecha ${comparison.gapPercent > 0 ? "+" : ""}${formatNumber(comparison.gapPercent, 1)} %`
                      : comparison.comparability === "contextual"
                        ? "Dato agregado de contexto; no mide el consumo de una planta."
                        : comparison.note ||
                          "Aún faltan datos propios comparables para calcular una brecha.";
                  return (
                    <article
                      className="min-w-0 rounded-xl border border-line-soft bg-surface p-3.5"
                      key={reference.id}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-semibold text-label">
                          {benchmarkResourceNames[benchmarkResourceKey(reference.resource)]}
                        </span>
                        <Status
                          tone={
                            comparison.comparability === "direct"
                              ? "good"
                              : comparison.comparability === "incomplete" ||
                                  comparison.comparability === "unavailable"
                                ? "warning"
                                : ""
                          }
                        >
                          {benchmarkComparabilityLabel(comparison.comparability)}
                        </Status>
                      </div>
                      <h3 className="mb-1 mt-2 text-sm font-semibold leading-snug text-ink">
                        {reference.indicator}
                      </h3>
                      <div className="text-xl font-bold tracking-tight text-ink">
                        {formatNumber(reference.value, 3)}{" "}
                        <span className="text-sm font-medium text-muted">{reference.unit}</span>
                      </div>
                      <p className="mb-0 mt-2 text-xs text-muted">
                        <a
                          href={reference.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-brand underline-offset-2 hover:underline"
                        >
                          {reference.sourceName}
                        </a>
                        {" · "}
                        {benchmarkDate(reference.publishedAt ?? reference.periodEnd)}
                      </p>
                      <p className="mb-0 mt-1.5 text-xs leading-relaxed text-muted">
                        {comparisonNote}
                      </p>
                    </article>
                  );
                })}
              </div>
            ) : (
              <EmptyState>
                No hay referencias para este recurso. Consulta otro filtro o revisa las fuentes
                configuradas.
              </EmptyState>
            )}

            {filteredComparisons.length > 0 && (
              <details className="mt-3 rounded-xl border border-line-soft bg-surface">
                <summary className="cursor-pointer px-3.5 py-3 text-xs font-semibold text-ink hover:bg-surface-hover">
                  Ver histórico completo ({filteredComparisons.length})
                </summary>
                <div className="max-h-[55vh] overflow-auto border-t border-line-soft">
                  <table>
                    <thead className="sticky top-0 z-10 bg-surface-muted">
                      <tr>
                        <th>Indicador</th>
                        <th>Fuente y período</th>
                        <th>Referencia</th>
                        <th>Empresa</th>
                        <th>Brecha</th>
                        <th>Comparabilidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredComparisons.map((comparison) => {
                        const reference = comparison.reference;
                        return (
                          <tr key={reference.id}>
                            <td>{reference.indicator}</td>
                            <td>
                              <a href={reference.sourceUrl} target="_blank" rel="noreferrer">
                                {reference.sourceName}
                              </a>
                              <div>
                                {reference.periodStart} – {reference.periodEnd}
                              </div>
                              <div>
                                Dato consultado:{" "}
                                {benchmarkDate(reference.publishedAt ?? reference.retrievedAt)} ·{" "}
                                {reference.quality}
                              </div>
                            </td>
                            <td>
                              {formatNumber(reference.value, 3)} {reference.unit}
                            </td>
                            <td>
                              {comparison.companyValue === null || !comparison.companyUnit
                                ? "No disponible"
                                : `${formatNumber(comparison.companyValue, 3)} ${comparison.companyUnit}`}
                            </td>
                            <td>
                              {comparison.gapPercent === null
                                ? "—"
                                : `${comparison.gapPercent > 0 ? "+" : ""}${formatNumber(comparison.gapPercent, 1)} %`}
                            </td>
                            <td>
                              <Status
                                tone={
                                  comparison.comparability === "direct"
                                    ? "good"
                                    : comparison.comparability === "incomplete" ||
                                        comparison.comparability === "unavailable"
                                      ? "warning"
                                      : ""
                                }
                              >
                                {benchmarkComparabilityLabel(comparison.comparability)}
                              </Status>
                              {comparison.note && (
                                <div className="field-hint">{comparison.note}</div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </>
        )}

        {sortedSources.length > 0 && (
          <details className="mt-3 rounded-xl border border-line-soft bg-surface">
            <summary className="cursor-pointer px-3.5 py-3 text-xs font-semibold text-ink hover:bg-surface-hover">
              Estado de fuentes · {readySourceCount} disponible(s) ·{" "}
              {sortedSources.length - readySourceCount} por configurar o revisar
            </summary>
            <div className="environment-list border-t border-line-soft px-3.5">
              {sortedSources.map((source) => (
                <article className="environment-list-item" key={source.id}>
                  <div className="environment-list-main">
                    <strong>
                      {source.url ? (
                        <a href={source.url} target="_blank" rel="noreferrer">
                          {source.name}
                        </a>
                      ) : (
                        source.name
                      )}
                    </strong>
                    <span>
                      {source.recordCount} registro(s) · última actualización:{" "}
                      {benchmarkDate(source.lastUpdatedAt)}
                    </span>
                    {source.error && <span>{source.error}</span>}
                  </div>
                  <Status
                    tone={
                      source.status === "ready"
                        ? "good"
                        : source.status === "stale" || source.status === "error"
                          ? "warning"
                          : ""
                    }
                  >
                    {benchmarkStatusLabel(source.status)}
                  </Status>
                </article>
              ))}
            </div>
          </details>
        )}
        <p className="field-hint mb-0 mt-3">
          ONU y XM aportan contexto agregado; la brecha solo aparece con periodos y unidades
          compatibles. El histórico conserva los registros completos.
        </p>
      </div>
    </Panel>
  );
}

function LegacyRecords({ records }: { records: EnvironmentalRecord[] }) {
  return (
    <details className="legacy-environment-records">
      <summary>Registros mensuales anteriores a la migración ({records.length})</summary>
      <p className="field-hint">
        Se conservan como referencia. Solo los valores mayores que cero se migraron a lecturas; los
        ceros históricos se interpretan como datos no disponibles.
      </p>
      {records.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Mes</th>
                <th>Energía kWh</th>
                <th>Agua m³</th>
                <th>Combustible L</th>
                <th>Producción</th>
                <th>Residuos kg</th>
                <th>Recuperado kg</th>
              </tr>
            </thead>
            <tbody>
              {records
                .slice()
                .sort((a, b) => b.period.localeCompare(a.period))
                .map((record) => (
                  <tr key={record.id}>
                    <td>{record.period}</td>
                    <td>{formatNumber(record.electricityKwh)}</td>
                    <td>{formatNumber(record.waterM3, 3)}</td>
                    <td>{formatNumber(record.fuelLiters)}</td>
                    <td>{formatNumber(record.productionUnits)}</td>
                    <td>{formatNumber(record.wasteKg)}</td>
                    <td>{formatNumber(record.recoveredKg)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="field-hint">No hay datos mensuales heredados.</p>
      )}
    </details>
  );
}

function TargetList({
  state,
  current,
  onEdit,
  onDelete,
  canEdit,
}: {
  state: AppState;
  current?: MonthlyEnvironmentalMetrics;
  onEdit: (target: IndicatorTarget) => void;
  onDelete: (id: string) => void;
  canEdit: boolean;
}) {
  if (!state.indicatorTargets.length)
    return (
      <EmptyState>
        Aún no hay metas. Las sugerencias iniciales son 4 % a 6 meses, 10 % a 18 meses y 17 % a 36
        meses; ajústalas después de validar la línea base.
      </EmptyState>
    );
  return (
    <div className="environment-list">
      {state.indicatorTargets.map((target) => {
        const currentValue =
          current && current.period >= target.baselinePeriod
            ? valueForIndicator(current, target.indicatorId)
            : null;
        const progress = targetProgress(target, currentValue);
        const targetValue = indicatorTargetValue(target);
        const unit =
          INDICATOR_CATALOG.find((definition) => definition.id === target.indicatorId)?.unit ?? "";
        return (
          <article className="environment-list-item" key={target.id}>
            <div className="environment-list-main">
              <strong>
                {indicatorTitles[target.indicatorId]} · {target.horizonMonths} meses
              </strong>
              <span>
                Línea base {target.baselinePeriod}: {display(target.baselineValue, unit)} →{" "}
                {target.direction === "decrease" ? "≤" : "≥"} {display(targetValue, unit)}
              </span>
              <span>
                {target.approvedAt
                  ? "Línea base aprobada"
                  : "Meta provisional, pendiente de aprobar"}
              </span>
              {target.approvedAt && (
                <div className="environment-progress">
                  <i style={{ width: `${progress ?? 0}%` }} />
                </div>
              )}
              {target.approvedAt && (
                <small>
                  {progress === null
                    ? "Sin lectura comparable"
                    : `${formatNumber(progress, 0)} % de avance estimado`}
                </small>
              )}
            </div>
            {canEdit && (
              <div className="table-actions">
                <button
                  className="button button-secondary button-small"
                  onClick={() => onEdit(target)}
                >
                  Editar
                </button>
                <button
                  className="icon-button"
                  onClick={() => onDelete(target.id)}
                  aria-label="Eliminar meta"
                >
                  ×
                </button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function ActionList({
  actions,
  onToggle,
  onDelete,
  canEdit,
  canDelete,
}: {
  actions: EnvironmentalAction[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  canEdit: boolean;
  canDelete: boolean;
}) {
  if (!actions.length)
    return (
      <EmptyState>
        Registra una acción con responsable y fecha límite para convertir un indicador en una mejora
        operativa.
      </EmptyState>
    );
  return (
    <div className="environment-list">
      {actions.map((action) => (
        <article className="environment-list-item" key={action.id}>
          <div className="environment-list-main">
            <strong>{action.title}</strong>
            <span>
              {indicatorTitles[action.indicatorId]} · Responsable: {action.owner} · Vence:{" "}
              {formatDate(action.dueDate)}
            </span>
            {action.notes && <span>{action.notes}</span>}
          </div>
          <div className="table-actions">
            <Status tone={action.status === "completed" ? "good" : "warning"}>
              {action.status === "completed" ? "Completada" : "Abierta"}
            </Status>
            {canEdit && (
              <button
                className="button button-secondary button-small"
                onClick={() => onToggle(action.id)}
              >
                {action.status === "completed" ? "Reabrir" : "Completar"}
              </button>
            )}
            {canDelete && (
              <button
                className="icon-button"
                onClick={() => onDelete(action.id)}
                aria-label="Eliminar acción"
              >
                ×
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

export function EnvironmentPage({
  state,
  canEdit,
  canDelete,
  isAdmin,
  onEditReading,
  onDeleteReading,
  onImport,
  onConfigure,
  onNewTarget,
  onEditTarget,
  onDeleteTarget,
  onNewFactor,
  onEditFactor,
  onDeleteFactor,
  onNewAction,
  onToggleAction,
  onDeleteAction,
}: EnvironmentPageProps) {
  const [trendMonths, setTrendMonths] = useState<3 | 6 | 12>(6);
  const [trendMetric, setTrendMetric] = useState<TrendMetric>("electricity");
  const [readingResource, setReadingResource] = useState<ResourceKind | "all">("all");
  const [readingSource, setReadingSource] = useState<ConsumptionSource | "all">("all");
  const [readingQuality, setReadingQuality] = useState<ReadingQuality | "all">("all");
  const [readingPeriod, setReadingPeriod] = useState("all");
  const readingsDetailsRef = useRef<HTMLDetailsElement>(null);
  const metrics = calculateMonthlyEnvironmentalMetrics(state);
  const currentPeriod = currentMonth();
  const periodsWithData = metrics.filter((item) => item.dataCoveragePercent > 0);
  const latest = periodsWithData[periodsWithData.length - 1];
  const previous =
    periodsWithData.length > 1 ? periodsWithData[periodsWithData.length - 2] : undefined;
  const recentMonthsMissing = findMissingRecentMonths(metrics, currentPeriod);
  const latestDateValue =
    state.resourceReadings
      .map((reading) => reading.capturedAt)
      .sort()
      .at(-1) ?? null;
  const trendEndPeriod = latest?.period ?? currentPeriod;
  const trendStartPeriod = shiftPeriod(trendEndPeriod, 1 - trendMonths);
  const trendPeriodSlots = Array.from({ length: trendMonths }, (_, index) =>
    shiftPeriod(trendStartPeriod, index),
  );
  const selectedTrendMetric = trendMetricOptions.find((option) => option.value === trendMetric)!;
  const trendPoints: TrendPoint[] = trendPeriodSlots.map((period) => ({
    period,
    value: valueForTrendMetric(metrics.find((item) => item.period === period), trendMetric),
  }));
  const trendTarget = getApprovedTrendTarget(state.indicatorTargets, trendMetric);
  const trendPeriodLabel = `${trendMonths} meses · ${periodTitle(trendStartPeriod)} – ${periodTitle(trendEndPeriod)}`;
  const sortedReadings = state.resourceReadings
    .slice()
    .sort(
      (a, b) =>
        b.periodEnd.localeCompare(a.periodEnd) || b.capturedAt.localeCompare(a.capturedAt),
    );
  const readingPeriods = [...new Set(sortedReadings.map((reading) => reading.periodEnd.slice(0, 7)))];
  const filteredReadings = sortedReadings.filter(
    (reading) =>
      (readingResource === "all" || reading.resource === readingResource) &&
      (readingSource === "all" || reading.source === readingSource) &&
      (readingQuality === "all" || reading.quality === readingQuality) &&
      (readingPeriod === "all" || reading.periodEnd.slice(0, 7) === readingPeriod),
  );
  const hasActiveReadingFilters =
    readingResource !== "all" ||
    readingSource !== "all" ||
    readingQuality !== "all" ||
    readingPeriod !== "all";
  const clearReadingFilters = () => {
    setReadingResource("all");
    setReadingSource("all");
    setReadingQuality("all");
    setReadingPeriod("all");
  };
  const targetCurrent = latest;
  const factorButton = isAdmin ? (
    <button className="button button-secondary button-small" onClick={onNewFactor}>
      Agregar factor
    </button>
  ) : undefined;
  const factorActivities = {
    electricity: "Electricidad",
    fuel: "Combustible",
    material_purchase: "Compra de materiales",
    waste: "Residuos",
    transport: "Transporte",
  };
  const metricCards: Array<{ label: string; value: string; note: string }> = [
    {
      label: "Electricidad",
      value: display(latest?.electricityKwh ?? null, "kWh"),
      note: latest
        ? monthChange(
            latest.electricityKwh,
            previous?.electricityKwh ?? null,
            isAdjacentMonth(latest.period, previous?.period),
          )
        : "Sin lecturas",
    },
    {
      label: "Agua retirada",
      value: display(latest?.waterWithdrawalM3 ?? null, "m³"),
      note: latest
        ? latest.waterConsumptionM3 === null
          ? "Agua neta no disponible sin retirada y descarga compatibles"
          : `Agua neta ${display(latest.waterConsumptionM3, "m³")}`
        : "Sin lecturas",
    },
    {
      label: "Intensidad por unidad",
      value: display(latest?.energyPerUnit ?? null, "kWh/u"),
      note: latest
        ? `Agua neta ${display(latest.waterPerUnit, "m³/u", 3)} · producción del periodo`
        : "Requiere lecturas y producción del periodo",
    },
    {
      label: "Recuperación de residuos",
      value: display(latest?.wasteRecoveryPercent ?? null, "%", 1),
      note: latest
        ? `${display(latest.wasteRecoveredKg, "kg")} recuperados de ${display(latest.wasteGeneratedKg, "kg")} generados`
        : "Sin pesajes registrados",
    },
  ];
  const environmentalAlerts: EnvironmentalAlert[] = [];
  if (
    latest &&
    latest.waterWithdrawalM3 !== null &&
    latest.waterDischargeM3 !== null &&
    latest.waterDischargeM3 > latest.waterWithdrawalM3
  ) {
    environmentalAlerts.push({
      id: "water-balance",
      category: "Revisar medición",
      title: "La descarga supera el agua retirada",
      detail: `Periodo ${latest.period}. El consumo neto queda no disponible; revisa periodos y medidores.`,
      resource: "water",
      actionLabel: "Revisar lecturas",
      action: "readings",
    });
  }
  if (latest && latest.wasteRecoveryPercent !== null && latest.wasteRecoveryPercent > 100) {
    environmentalAlerts.push({
      id: "waste-balance",
      category: "Revisar medición",
      title: "Los residuos recuperados superan los generados",
      detail: `Periodo ${latest.period}. Revisa unidades, pesajes y periodos.`,
      resource: "waste",
      actionLabel: "Revisar lecturas",
      action: "readings",
    });
  }
  if (
    latest &&
    previous &&
    isAdjacentMonth(latest.period, previous.period) &&
    ((latest.energyPerUnit !== null &&
      previous.energyPerUnit !== null &&
      previous.energyPerUnit > 0 &&
      latest.energyPerUnit > previous.energyPerUnit * 1.1) ||
      (latest.waterPerUnit !== null &&
        previous.waterPerUnit !== null &&
        previous.waterPerUnit > 0 &&
        latest.waterPerUnit > previous.waterPerUnit * 1.1))
  ) {
    environmentalAlerts.push({
      id: "intensity-increase",
      category: "Variación mensual",
      title: "Aumentó la intensidad de energía o agua",
      detail: `Más de 10 % frente al periodo anterior (${previous.period} → ${latest.period}). Verifica mezcla de productos, producción y calidad de las lecturas.`,
      actionLabel: "Revisar lecturas",
      action: "readings",
    });
  }
  if (recentMonthsMissing.length > 0) {
    environmentalAlerts.push({
      id: "missing-months",
      category: "Dato faltante",
      title: "Faltan lecturas recientes",
      detail: `${recentMonthsMissing.map(periodTitle).join(", ")}. Las comparaciones pueden estar incompletas.`,
      actionLabel: canEdit ? "Registrar lectura" : "Ver lecturas",
      action: canEdit ? "register" : "readings",
    });
  }

  function handleEnvironmentalAlert(alert: EnvironmentalAlert): void {
    if (alert.action === "register" && canEdit) {
      onEditReading();
      return;
    }
    setReadingResource(alert.resource ?? "all");
    setReadingSource("all");
    setReadingQuality("all");
    setReadingPeriod("all");
    if (readingsDetailsRef.current) {
      readingsDetailsRef.current.open = true;
      window.requestAnimationFrame(() =>
        readingsDetailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    }
  }
  return (
    <>
      <PageHeading
        title="Impacto ambiental"
        description="Lecturas trazables, indicadores por producción y acciones de reducción."
        action={canEdit ? () => onEditReading() : undefined}
        actionLabel="Registrar lectura"
      />
      <div className="environment-data-summary" aria-label="Estado de los datos ambientales">
        <div className="environment-data-summary-item">
          <span>Cobertura de datos{latest ? ` · ${periodTitle(latest.period)}` : ""}</span>
          <strong>{latest ? display(latest.dataCoveragePercent, "%", 0) : "No disponible"}</strong>
        </div>
        <div className="environment-data-summary-item">
          <span>Última lectura capturada</span>
          <strong>{latestDate(latestDateValue)}</strong>
        </div>
      </div>
      <div className="notice">
        Los datos se actualizan al registrar una lectura o confirmar un recibo procesado en este
        dispositivo. Las referencias públicas se actualizan desde sus fuentes al solicitarlo; no
        representan telemetría ni el consumo real de esta planta.
      </div>

      <Panel
        title="Fuente de consumo"
        description="Importa el recibo descargado desde el portal del proveedor."
        action={
          isAdmin ? (
            <button className="button button-secondary button-small" onClick={onConfigure}>
              Configurar
            </button>
          ) : undefined
        }
      >
        <div className="panel-body environment-source-row">
          <div>
            <strong>{state.environmentalConfig?.providerName ?? "Enel Colombia"}</strong>
            <span>
              {state.environmentalConfig?.accountNumber
                ? `Cuenta ${state.environmentalConfig.accountNumber}`
                : "Sin número de cuenta guardado"}
              {state.environmentalConfig?.businessUnit
                ? ` · ${state.environmentalConfig.businessUnit}`
                : ""}
            </span>
            <span>
              Ubicación para factores de emisión:{" "}
              {state.environmentalConfig?.geography ?? "Colombia SIN"}
            </span>
          </div>
          <div>
            <Status tone="warning">Recibos manuales</Status>
            <small>Último dato: {latestDate(latestDateValue)}</small>
          </div>
        </div>
        {canEdit && (
          <details className="environment-secondary-details environment-receipt-details">
            <summary>Capturar desde un recibo</summary>
            <div className="panel-body environment-source-actions">
              <label className="button button-secondary">
                Importar recibo PDF/JPG/PNG
                <input
                  type="file"
                  hidden
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) onImport(file);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              <span className="field-hint">
                La vista previa se procesa localmente; no se guarda el archivo ni el texto OCR.
              </span>
            </div>
          </details>
        )}
      </Panel>

      <Panel
        title="Alertas ambientales"
        description="Revisa primero inconsistencias y variaciones; después completa los datos faltantes."
        action={
          <Status tone={environmentalAlerts.length ? "warning" : periodsWithData.length ? "good" : ""}>
            {periodsWithData.length
              ? environmentalAlerts.length
                ? `${environmentalAlerts.length} ${environmentalAlerts.length === 1 ? "pendiente" : "pendientes"}`
                : "Sin alertas"
              : "Sin datos suficientes"}
          </Status>
        }
      >
        {periodsWithData.length === 0 ? (
          <div className="environment-alert-empty">
            <span aria-hidden="true">i</span>
            <p>Aún no hay datos suficientes para generar alertas. Registra una lectura para iniciar el seguimiento.</p>
            {canEdit && (
              <button className="button button-secondary button-small" onClick={() => onEditReading()}>
                Registrar lectura
              </button>
            )}
          </div>
        ) : environmentalAlerts.length ? (
          <div className="environment-alert-list" role="list" aria-label="Alertas por prioridad">
            {environmentalAlerts.map((alert) => (
              <article className="environment-alert-item" role="listitem" key={alert.id}>
                <div className="environment-alert-copy">
                  <Status tone="warning">{alert.category}</Status>
                  <strong>{alert.title}</strong>
                  <p>{alert.detail}</p>
                </div>
                <button
                  className="button button-secondary button-small environment-alert-action"
                  type="button"
                  onClick={() => handleEnvironmentalAlert(alert)}
                >
                  {alert.actionLabel}
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="environment-alert-empty is-clear" role="status">
            <span aria-hidden="true">✓</span>
            <p>No hay alertas en los periodos con datos registrados.</p>
          </div>
        )}
      </Panel>

      <div className="metric-grid environment-kpi-grid">
        {metricCards.map((metric) => (
          <article className="metric-card" key={metric.label}>
            <div className="metric-label">{metric.label}</div>
            <div className="metric-value">{metric.value}</div>
            <div className="metric-note">{metric.note}</div>
          </article>
        ))}
      </div>

      <div className="environment-visual-summary">
        <Panel
          title="Tendencias mensuales"
          description="Compara consumos absolutos e intensidades. La línea de meta solo aparece con una línea base aprobada."
          action={
            <div className="environment-trend-controls">
              <label className="environment-trend-select">
                <span>Métrica</span>
                <select
                  value={trendMetric}
                  onChange={(event) => setTrendMetric(event.currentTarget.value as TrendMetric)}
                >
                  {trendMetricOptions.map((option) => (
                    <option value={option.value} key={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="environment-period-controls" role="group" aria-label="Ventana de tendencia">
                {([3, 6, 12] as const).map((months) => (
                  <button
                    className={trendMonths === months ? "active" : ""}
                    type="button"
                    aria-pressed={trendMonths === months}
                    key={months}
                    onClick={() => setTrendMonths(months)}
                  >
                    {months} meses
                  </button>
                ))}
              </div>
            </div>
          }
        >
          <div className="environment-trend-grid">
            <EnvironmentalTrendChart
              points={trendPoints}
              title={selectedTrendMetric.label}
              unit={selectedTrendMetric.unit}
              periodLabel={trendPeriodLabel}
              target={trendTarget}
            />
            {(trendMetric === "energy-intensity" || trendMetric === "water-intensity") &&
              !trendTarget && (
                <p className="environment-trend-target-unavailable">
                  No hay una meta aprobada para esta intensidad. Aprueba una línea base en “Metas graduales” para mostrarla aquí.
                </p>
              )}
          </div>
        </Panel>
        <Panel
          title="Emisiones"
          description="Por alcance, en el último periodo con lecturas."
        >
          <div className="panel-body">
            <ScopeEmissions period={latest} />
          </div>
        </Panel>
      </div>

      <details className="environment-disclosure">
        <summary>Explorar historial e indicadores · {metrics.length} periodo(s)</summary>
        <div className="environment-disclosure-content">
      <Panel
        title="Historial e indicadores mensuales"
        description="Se muestran cantidades absolutas e intensidades; emisiones sin factor compatible quedan como no disponibles."
      >
        {metrics.length ? (
          <>
            <div className="table-wrap desktop-record-table">
              <table className="environment-metrics-table">
                <thead>
                  <tr>
                    <th>Mes</th>
                    <th>Energía kWh</th>
                    <th>kWh/unidad</th>
                    <th>Agua retirada m³</th>
                    <th>Agua neta m³</th>
                    <th>m³/unidad</th>
                    <th>Material consumido kg</th>
                    <th>Material kg/unidad</th>
                    <th>Reciclado %</th>
                    <th>Residuos kg</th>
                    <th>Recuperado %</th>
                    <th>GEI A1/A2/A3 kg CO₂e</th>
                    <th>Cobertura</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics
                    .slice()
                    .reverse()
                    .map((row) => (
                      <tr key={row.period}>
                        <td>{row.period}</td>
                        <td>{display(row.electricityKwh)}</td>
                        <td>{display(row.energyPerUnit)}</td>
                        <td>{display(row.waterWithdrawalM3, "", 3)}</td>
                        <td>{display(row.waterConsumptionM3, "", 3)}</td>
                        <td>{display(row.waterPerUnit, "", 3)}</td>
                        <td>{display(row.materialConsumedKg)}</td>
                        <td>{display(row.materialPerUnit)}</td>
                        <td>{display(row.recycledMaterialPercent, "", 1)}</td>
                        <td>{display(row.wasteGeneratedKg)}</td>
                        <td>{display(row.wasteRecoveryPercent, "", 1)}</td>
                        <td>
                          {display(row.scope1KgCo2e)} / {display(row.scope2KgCo2e)} /{" "}
                          {display(row.scope3KgCo2e)}
                        </td>
                        <td>{display(row.dataCoveragePercent, "%", 0)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-record-list">
              {metrics
                .slice()
                .reverse()
                .map((row) => (
                  <article className="mobile-record-card" key={row.period}>
                    <div className="mobile-record-card-heading">
                      <div className="mobile-record-main">
                        <strong>{row.period}</strong>
                        <span>Indicadores ambientales del período</span>
                      </div>
                      <Status tone={row.dataCoveragePercent >= 80 ? "good" : "warning"}>
                        {display(row.dataCoveragePercent, "%", 0)} datos
                      </Status>
                    </div>
                    <div className="mobile-record-stat-grid">
                      <div>
                        <span>Electricidad</span>
                        <strong>{display(row.electricityKwh, "kWh")}</strong>
                      </div>
                      <div>
                        <span>Agua retirada</span>
                        <strong>{display(row.waterWithdrawalM3, "m³", 3)}</strong>
                      </div>
                    </div>
                    <details className="mobile-metric-details">
                      <summary>Ver todos los indicadores</summary>
                      <div className="mobile-record-stat-grid">
                        <div>
                          <span>Energía por unidad</span>
                          <strong>{display(row.energyPerUnit, "kWh/u")}</strong>
                        </div>
                        <div>
                          <span>Agua neta</span>
                          <strong>{display(row.waterConsumptionM3, "m³", 3)}</strong>
                        </div>
                        <div>
                          <span>Agua por unidad</span>
                          <strong>{display(row.waterPerUnit, "m³/u", 3)}</strong>
                        </div>
                        <div>
                          <span>Material consumido</span>
                          <strong>{display(row.materialConsumedKg, "kg")}</strong>
                        </div>
                        <div>
                          <span>Material por unidad</span>
                          <strong>{display(row.materialPerUnit, "kg/u")}</strong>
                        </div>
                        <div>
                          <span>Material reciclado</span>
                          <strong>{display(row.recycledMaterialPercent, "%", 1)}</strong>
                        </div>
                        <div>
                          <span>Residuos</span>
                          <strong>{display(row.wasteGeneratedKg, "kg")}</strong>
                        </div>
                        <div>
                          <span>Residuos recuperados</span>
                          <strong>{display(row.wasteRecoveryPercent, "%", 1)}</strong>
                        </div>
                        <div className="col-span-2">
                          <span>GEI Alcances 1 / 2 / 3</span>
                          <strong>
                            {display(row.scope1KgCo2e)} / {display(row.scope2KgCo2e)} /{" "}
                            {display(row.scope3KgCo2e)} kg CO₂e
                          </strong>
                        </div>
                      </div>
                    </details>
                  </article>
                ))}
            </div>
          </>
        ) : (
          <EmptyState>
            No hay lecturas aún. Registra una lectura manual o confirma un recibo para iniciar la
            línea base.
          </EmptyState>
        )}
      </Panel>
        </div>
      </details>

      <div className="environment-planning-grid">
      <Panel
        title="Metas graduales"
        description="Las metas son editables. Aprueba la línea base cuando haya datos comparables; no se calcula avance mientras sea provisional."
        action={
          isAdmin ? (
            <button className="button button-secondary button-small" onClick={onNewTarget}>
              ＋ Nueva meta
            </button>
          ) : undefined
        }
      >
        <div className="panel-body">
          <TargetList
            state={state}
            current={targetCurrent}
            onEdit={onEditTarget}
            onDelete={onDeleteTarget}
            canEdit={isAdmin}
          />
        </div>
      </Panel>

      <Panel
        title="Acciones de mejora"
        description="Asigna una intervención a una persona y verifica su fecha límite."
        action={
          canEdit ? (
            <button className="button button-secondary button-small" onClick={onNewAction}>
              ＋ Registrar acción
            </button>
          ) : undefined
        }
      >
        <div className="panel-body">
          <ActionList
            actions={state.environmentalActions}
            onToggle={onToggleAction}
            onDelete={onDeleteAction}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        </div>
      </Panel>
      </div>

      <BenchmarkPanel canRefresh={canEdit} />

      <details className="environment-disclosure">
        <summary>Factores de emisión · {state.emissionFactors.length}</summary>
        <div className="environment-disclosure-content">
      <Panel
        title="Factores de emisión"
        description="Factores explícitos y versionados. Solo se aplican al año, actividad, unidad y ubicación que coinciden."
        action={factorButton}
      >
        {state.emissionFactors.length ? (
          <>
            <div className="table-wrap desktop-record-table">
              <table>
                <thead>
                  <tr>
                    <th>Alcance</th>
                    <th>Actividad</th>
                    <th>Factor</th>
                    <th>Ubicación</th>
                    <th>Año</th>
                    <th>Versión y método</th>
                    <th>Fuente</th>
                    {isAdmin && <th>Acciones</th>}
                  </tr>
                </thead>
                <tbody>
                  {state.emissionFactors.map((factor) => (
                    <tr key={factor.id}>
                      <td>{factor.scope}</td>
                      <td>{factorActivities[factor.activity]}</td>
                      <td>{formatFactor(factor)}</td>
                      <td>{factor.geography}</td>
                      <td>{factor.year}</td>
                      <td>
                        {factor.version} · {factor.method}
                      </td>
                      <td>{factor.source}</td>
                      {isAdmin && (
                        <td>
                          <div className="table-actions">
                            <button
                              className="button button-secondary button-small"
                              onClick={() => onEditFactor(factor)}
                            >
                              Editar
                            </button>
                            {factor.id !== "factor-upme-sin-2024" && (
                              <button
                                className="icon-button"
                                onClick={() => onDeleteFactor(factor.id)}
                                aria-label="Eliminar factor"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-record-list">
              {state.emissionFactors.map((factor) => (
                <article className="mobile-record-card" key={factor.id}>
                  <div className="mobile-record-card-heading">
                    <div className="mobile-record-main">
                      <strong>{factorActivities[factor.activity]}</strong>
                      <span>
                        {factor.scope} · {factor.geography}
                      </span>
                    </div>
                    <Status>{factor.year}</Status>
                  </div>
                  <div className="mobile-record-stat-grid">
                    <div>
                      <span>Factor</span>
                      <strong>{formatFactor(factor)}</strong>
                    </div>
                    <div>
                      <span>Versión</span>
                      <strong>{factor.version}</strong>
                    </div>
                  </div>
                  <p className="mobile-record-description">
                    {factor.method} · {factor.source}
                  </p>
                  {isAdmin && (
                    <div className="mobile-record-actions">
                      <button
                        className="button button-secondary"
                        onClick={() => onEditFactor(factor)}
                      >
                        Editar
                      </button>
                      {factor.id !== "factor-upme-sin-2024" && (
                        <button
                          className="button button-danger"
                          onClick={() => onDeleteFactor(factor.id)}
                        >
                          Eliminar
                        </button>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </>
        ) : (
          <EmptyState>
            Agrega un factor con fuente y versión para poder calcular emisiones.
          </EmptyState>
        )}
        <div className="panel-body">
          <p className="field-hint">
            El factor UPME de 0,22 kg CO₂e/kWh corresponde al SIN para el inventario de 2024; no se
            extrapola automáticamente a otros años. Las categorías sin factor compatible se muestran
            como —.
          </p>
        </div>
      </Panel>
        </div>
      </details>

      <details ref={readingsDetailsRef} className="environment-disclosure">
        <summary>Lecturas registradas · {state.resourceReadings.length}</summary>
        <div className="environment-disclosure-content">
      <Panel
        title="Lecturas registradas"
        description="Cada recibo o captura queda como una lectura independiente; los recursos del mismo mes no se reemplazan."
      >
        {state.resourceReadings.length ? (
          <>
            <div className="environment-reading-filter-bar">
              <label>
                <span>Recurso</span>
                <select
                  value={readingResource}
                  onChange={(event) =>
                    setReadingResource(event.currentTarget.value as ResourceKind | "all")
                  }
                >
                  <option value="all">Todos</option>
                  {[...new Set(state.resourceReadings.map((reading) => reading.resource))]
                    .sort((a, b) => resourceLabel(a).localeCompare(resourceLabel(b), "es-CO"))
                    .map((resource) => (
                      <option value={resource} key={resource}>
                        {resourceLabel(resource)}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                <span>Periodo</span>
                <select value={readingPeriod} onChange={(event) => setReadingPeriod(event.currentTarget.value)}>
                  <option value="all">Todos</option>
                  {readingPeriods.map((period) => (
                    <option value={period} key={period}>
                      {periodTitle(period)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Fuente</span>
                <select
                  value={readingSource}
                  onChange={(event) =>
                    setReadingSource(event.currentTarget.value as ConsumptionSource | "all")
                  }
                >
                  <option value="all">Todas</option>
                  {[...new Set(state.resourceReadings.map((reading) => reading.source))]
                    .sort((a, b) => consumptionSourceLabels[a].localeCompare(consumptionSourceLabels[b], "es-CO"))
                    .map((source) => (
                      <option value={source} key={source}>
                        {consumptionSourceLabels[source]}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                <span>Calidad</span>
                <select
                  value={readingQuality}
                  onChange={(event) =>
                    setReadingQuality(event.currentTarget.value as ReadingQuality | "all")
                  }
                >
                  <option value="all">Todas</option>
                  {[...new Set(state.resourceReadings.map((reading) => reading.quality))]
                    .sort((a, b) => readingQualityLabels[a].localeCompare(readingQualityLabels[b], "es-CO"))
                    .map((quality) => (
                      <option value={quality} key={quality}>
                        {readingQualityLabels[quality]}
                      </option>
                    ))}
                </select>
              </label>
              <div className="environment-reading-filter-result" role="status" aria-live="polite">
                {filteredReadings.length} de {state.resourceReadings.length} lecturas
              </div>
              {hasActiveReadingFilters && (
                <button
                  className="button button-secondary button-small environment-filter-reset"
                  type="button"
                  onClick={clearReadingFilters}
                >
                  Limpiar filtros
                </button>
              )}
            </div>
            {filteredReadings.length ? (
              <>
            <div className="table-wrap desktop-record-table">
              <table>
                <thead>
                  <tr>
                    <th>Recurso</th>
                    <th>Actividad</th>
                    <th>Periodo</th>
                    <th>Cantidad</th>
                    <th>Fuente / calidad</th>
                    <th>Capturada</th>
                    {canEdit && <th>Acciones</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredReadings.map((reading) => (
                      <tr key={reading.id}>
                        <td>{resourceLabel(reading.resource)}</td>
                        <td>{activityLabel(reading.activity)}</td>
                        <td>
                          {reading.periodStart} → {reading.periodEnd}
                        </td>
                        <td>
                          {formatNumber(reading.quantity)} {reading.unit}
                        </td>
                        <td>
                          <Status
                            tone={
                              reading.quality === "estimated"
                                ? "warning"
                                : reading.quality === "measured"
                                  ? "good"
                                  : ""
                            }
                          >
                            {sourceLabel(reading)} · {qualityLabel(reading)}
                          </Status>
                        </td>
                        <td>{latestDate(reading.capturedAt)}</td>
                        {canEdit && (
                          <td>
                            <div className="table-actions">
                              <button
                                className="button button-secondary button-small"
                                onClick={() => onEditReading(reading)}
                              >
                                Editar
                              </button>
                              {canDelete && (
                                <button
                                  className="icon-button"
                                  onClick={() => onDeleteReading(reading.id)}
                                  aria-label="Eliminar lectura"
                                >
                                  ×
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-record-list">
              {filteredReadings.map((reading) => (
                  <article className="mobile-record-card" key={reading.id}>
                    <div className="mobile-record-card-heading">
                      <div className="mobile-record-main">
                        <strong>
                          {resourceLabel(reading.resource)} · {activityLabel(reading.activity)}
                        </strong>
                        <span>
                          {reading.periodStart} → {reading.periodEnd}
                        </span>
                      </div>
                      <Status
                        tone={
                          reading.quality === "estimated"
                            ? "warning"
                            : reading.quality === "measured"
                              ? "good"
                              : ""
                        }
                      >
                        {qualityLabel(reading)}
                      </Status>
                    </div>
                    <div className="mobile-record-stat-grid">
                      <div>
                        <span>Consumo</span>
                        <strong>
                          {formatNumber(reading.quantity)} {reading.unit}
                        </strong>
                      </div>
                      <div>
                        <span>Capturado</span>
                        <strong>{latestDate(reading.capturedAt)}</strong>
                      </div>
                    </div>
                    <p className="mobile-record-description">Fuente: {sourceLabel(reading)}</p>
                    {canEdit && (
                      <div className="mobile-record-actions">
                        <button
                          className="button button-secondary"
                          onClick={() => onEditReading(reading)}
                        >
                          Editar
                        </button>
                        {canDelete && (
                          <button
                            className="button button-danger"
                            onClick={() => onDeleteReading(reading.id)}
                          >
                            Eliminar
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                ))}
            </div>
              </>
            ) : (
              <EmptyState>No hay lecturas que coincidan con los filtros seleccionados.</EmptyState>
            )}
          </>
        ) : (
          <EmptyState>Aún no hay lecturas guardadas.</EmptyState>
        )}
      </Panel>
        </div>
      </details>

      <details className="environment-disclosure">
        <summary>Catálogo de indicadores · {INDICATOR_CATALOG.length}</summary>
        <div className="environment-disclosure-content">
      <Panel
        title="Indicadores disponibles"
        description="Cálculos separados de la interfaz para poder ampliar el catálogo sin rehacer el tablero."
      >
        <div className="panel-body indicator-catalog-grid">
          {INDICATOR_CATALOG.map((indicator) => (
            <article className="indicator-definition" key={indicator.id}>
              <strong>{indicator.label}</strong>
              <span>{indicator.formula}</span>
              <small>
                Unidad: {indicator.unit} · Frecuencia sugerida: {indicator.cadence}
              </small>
            </article>
          ))}
        </div>
      </Panel>
        </div>
      </details>

      <LegacyRecords records={state.environmentalRecords} />
    </>
  );
}
