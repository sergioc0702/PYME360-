import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  outstandingBalance,
  payableBalance,
  financialAccountBalance,
  BusinessError,
} from "../domain/business";
import {
  createFirstAdmin,
  createUser,
  deleteUser,
  listUsers,
  login,
  setUserActive,
  updateUserRole,
  type AuthUser,
  type UserRole,
} from "../infrastructure/auth";
import { serializeBackup } from "../infrastructure/storage";
import { formatPeriod, pluralize } from "../shared/format";
import { ExcelImportWizard } from "./screens/ExcelImport";
import { BrandLogo } from "../shared/BrandLogo";
import type {
  AppState,
  Contact,
  ElectronicDocument,
  ReceiptExtraction,
  InvoiceFollowUpStatus,
  Product,
  ProductType,
  Recipe,
  RecipeVersion,
  ProductionOrder,
  Purchase,
  PurchaseStatus,
  Sale,
  ResourceReading,
  EmissionFactor,
  IndicatorTarget,
  InventoryMovement,
} from "../domain/types";

export type Page =
  | "overview"
  | "contacts"
  | "inventory"
  | "finance"
  | "sales"
  | "purchases"
  | "production"
  | "environment"
  | "data"
  | "audit";
export type Theme = "system" | "light" | "dark";
export type ResolvedTheme = Exclude<Theme, "system">;

export const THEME_STORAGE_KEY = "pyme360.theme";

// Preferencias, formato y componentes de presentación compartidos
export function getInitialTheme(): Theme {
  try {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
  } catch {
    return "system";
  }
  return "system";
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme !== "system") return theme;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

let themeTransitionTimer = 0;

export function applyTheme(theme: Theme, animate = false): void {
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  const changed = root.dataset.theme !== resolved;
  if (animate && changed) {
    window.clearTimeout(themeTransitionTimer);
    root.classList.add("theme-transition");
  }
  root.dataset.theme = resolved;
  if (animate && changed) {
    themeTransitionTimer = window.setTimeout(() => root.classList.remove("theme-transition"), 220);
  }
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", resolved === "dark" ? "#151a18" : "#f4f6f4");
  document
    .querySelector<HTMLLinkElement>('link[rel="icon"]')
    ?.setAttribute("href", `${import.meta.env.BASE_URL}pyme360-mark-${resolved}.png`);
}

export type ModalState =
  | { type: "company" }
  | { type: "contact"; contact?: Contact }
  | { type: "product"; product?: Product }
  | { type: "recipe"; recipe?: Recipe; version?: RecipeVersion; productId?: string }
  | { type: "sale" }
  | { type: "purchase"; purchase?: Purchase; initialProductId?: string; initialQuantity?: number; initialStatus?: PurchaseStatus }
  | { type: "production"; initialProductId?: string; initialQuantity?: number }
  | { type: "reading"; reading?: ResourceReading }
  | { type: "target"; target?: IndicatorTarget }
  | { type: "factor"; factor?: EmissionFactor }
  | { type: "environmental-action" }
  | { type: "payment"; sale: Sale }
  | { type: "purchase-payment"; purchase: Purchase }
  | { type: "review-payable"; purchase: Purchase }
  | { type: "financial-account" }
  | { type: "cash-movement" }
  | { type: "stock"; product: Product }
  | { type: "complete-production"; order: ProductionOrder }
  | { type: "users" }
  | { type: "receipt"; extraction: ReceiptExtraction; fileName: string; fileHash: string }
  | { type: "environment-config" }
  | null;

const MOVEMENT_SOURCE_LABELS: Record<"sale" | "purchase" | "production" | "adjustment", string> = {
  sale: "Venta",
  purchase: "Compra",
  production: "Producción",
  adjustment: "Ajuste",
};

const AUDIT_ACTION_LABELS: Record<string, string> = {
  created: "Creó",
  updated: "Actualizó",
  deleted: "Eliminó",
  login: "Inició sesión",
  logout: "Cerró sesión",
  migrated: "Migró",
  resolved: "Resolvió",
  restored: "Restauró",
  synchronized: "Sincronizó",
};

const AUDIT_ENTITY_LABELS: Record<string, string> = {
  application_data: "Datos de la aplicación",
  cashMovements: "Movimiento de dinero",
  company: "Empresa",
  contacts: "Contacto",
  electronicDocuments: "Documento electrónico",
  electronic_document: "Documento electrónico",
  emissionFactors: "Factor de emisión",
  environmentalActions: "Acción ambiental",
  environmentalConfig: "Configuración ambiental",
  environmentalRecords: "Registro ambiental",
  financialAccounts: "Cuenta de caja o banco",
  importExtras: "Campo adicional",
  indicatorTargets: "Meta ambiental",
  inventoryMovements: "Movimiento de inventario",
  products: "Producto",
  productionOrders: "Orden de producción",
  purchases: "Compra",
  receiptImports: "Recibo ambiental",
  recipes: "Receta",
  resourceReadings: "Lectura ambiental",
  sales: "Venta",
  session: "Sesión",
  supplierInvoices: "Factura de proveedor",
  sync_conflict: "Conflicto de sincronización",
  taxConfiguration: "Configuración tributaria",
  user: "Usuario",
  users: "Usuarios",
  workspace: "Espacio de empresa",
};

const auditActionLabel = (action: string) => AUDIT_ACTION_LABELS[action] ?? action;
const auditEntityLabel = (entity: string) => AUDIT_ENTITY_LABELS[entity] ?? entity;

export const PAGE_TITLES: Record<Page, string> = {
  overview: "Resumen",
  contacts: "Contactos",
  inventory: "Inventario",
  finance: "Finanzas",
  sales: "Ventas",
  purchases: "Compras",
  production: "Producción",
  environment: "Impacto ambiental",
  data: "Datos y respaldo",
  audit: "Auditoría",
};

export const NAV_GROUPS: Array<{ title: string; pages: Page[] }> = [
  { title: "Inicio", pages: ["overview"] },
  { title: "Operación", pages: ["sales", "purchases", "inventory", "production"] },
  { title: "Gestión", pages: ["contacts", "finance"] },
  { title: "Sostenibilidad", pages: ["environment"] },
  { title: "Administración", pages: ["data", "audit"] },
];

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Ocurrió un error inesperado.";
}

export function formatMoney(value: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: digits }).format(value);
}

export function formatQuantity(value: number, unit: string | undefined): string {
  const label = unit === "unidad" && Math.abs(value) !== 1 ? "unidades" : (unit ?? "");
  return `${formatNumber(value)} ${label}`.trim();
}

export function today(): string {
  const date = new Date();
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

export function currentMonth(): string {
  return today().slice(0, 7);
}

export function formatDate(value: string): string {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("es-CO").format(date);
}

function formatLocalDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("es-CO", { dateStyle: "short" }).format(date);
}

function formatLocalDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("es-CO", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function productTypeLabel(type: ProductType): string {
  if (type === "raw_material") return "Materia prima";
  if (type === "supply") return "Insumo";
  return "Producto terminado";
}

function contactRoleLabel(contact: Contact): string {
  if (contact.ordinaryCustomer) return "Cliente de mostrador";
  if (contact.role === "both") return "Cliente y proveedor";
  return contact.role === "supplier" ? "Proveedor" : "Cliente";
}

function invoiceStatusLabel(status: InvoiceFollowUpStatus): string {
  if (status === "registered_externally") return "Registrada por fuera";
  if (status === "not_applicable") return "No aplica";
  return "Por revisar";
}

function purchaseStatusLabel(status: PurchaseStatus): string {
  return status === "received" ? "Recibida" : "Por recibir";
}

function productionStatusLabel(status: ProductionOrder["status"]): string {
  if (status === "completed") return "Completada";
  if (status === "cancelled") return "Cancelada";
  return "En proceso";
}

function productionCostBasis(order: ProductionOrder): string {
  if (order.status === "cancelled") return "Orden cancelada";
  return order.status === "completed" ? "Por unidad buena" : "Estimado por orden";
}

function productionCostValue(order: ProductionOrder): string {
  if (order.status === "cancelled") return "No aplica";
  const value =
    order.status === "completed" ? order.materialCostPerGoodUnit : order.estimatedMaterialCost;
  if (value === null || value === undefined) return "No disponible";
  return order.status === "completed" ? `${formatMoney(value)} / unidad buena` : formatMoney(value);
}

export function readString(form: HTMLFormElement, name: string): string {
  return String(new FormData(form).get(name) ?? "").trim();
}

export function readNumber(form: HTMLFormElement, name: string): number {
  const result = Number(new FormData(form).get(name));
  if (!Number.isFinite(result)) throw new BusinessError(`El campo ${name} debe ser numérico.`);
  return result;
}

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const hasChanges = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Esc y el fondo son fáciles de pulsar sin querer; los botones Cerrar y Cancelar son explícitos.
  function requestClose() {
    if (hasChanges.current && !window.confirm("¿Descartar los cambios sin guardar?")) return;
    closeRef.current();
  }

  useEffect(() => {
    const returnFocusTo =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();

    function manageKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", manageKeyboard);
    return () => {
      window.removeEventListener("keydown", manageKeyboard);
      returnFocusTo?.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-emerald-950/55 p-3 backdrop-blur-[2px] sm:p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        onChange={() => {
          hasChanges.current = true;
        }}
        className={`outline-none max-h-[calc(100dvh-1.5rem)] w-full max-w-[620px] overflow-y-auto rounded-2xl border border-line bg-surface shadow-panel sm:max-h-[calc(100dvh-3rem)]${wide ? " max-w-[760px]" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-surface/95 px-4 py-4 backdrop-blur sm:px-6">
          <div>
            <h2 id="modal-title" className="m-0 text-lg font-bold tracking-tight">
              {title}
            </h2>
          </div>
          <button
            className="grid size-9 place-items-center rounded-xl border border-line bg-surface text-muted transition hover:border-danger-line hover:bg-danger-soft hover:text-danger"
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
          >
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function Field({
  label,
  name,
  initialValue = "",
  type = "text",
  required = false,
  min,
  max,
  step,
  disabled = false,
}: {
  label: string;
  name: string;
  initialValue?: string | number;
  type?: string;
  required?: boolean;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  disabled?: boolean;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <label className="text-[0.875rem] font-semibold text-label" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={initialValue}
        required={required}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className="min-h-10 w-full rounded-xl border border-control bg-surface px-3 py-2 text-sm text-ink outline-none transition placeholder:text-muted/70 focus:border-brand focus:ring-4 focus:ring-brand/10 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-60"
      />
    </div>
  );
}

export function SelectField({
  label,
  name,
  options,
  initialValue = "",
  value,
  required = false,
  onChange,
}: {
  label: string;
  name: string;
  options: Array<{ value: string; label: string }>;
  initialValue?: string;
  value?: string;
  required?: boolean;
  onChange?: (value: string) => void;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <label className="text-[0.875rem] font-semibold text-label" htmlFor={name}>
        {label}
      </label>
      <select
        id={name}
        name={name}
        {...(value !== undefined ? { value } : { defaultValue: initialValue })}
        required={required}
        onChange={(event) => onChange?.(event.target.value)}
        className="min-h-10 w-full rounded-xl border border-control bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
      >
        {options.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function PageHeading({
  title,
  description,
  action,
  actionLabel,
  className = "",
}: {
  title: string;
  description: string;
  action?: () => void;
  actionLabel?: string;
  className?: string;
}) {
  return (
    <div className={`page-heading${className ? ` ${className}` : ""}`}>
      <div>
        <h2 className="m-0 text-xl font-bold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      {action && actionLabel && (
        <button
          className="page-heading-action inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-transparent bg-brand px-4 text-sm font-semibold text-[var(--on-primary)] shadow-sm shadow-brand/15 transition duration-150 hover:-translate-y-px hover:bg-brand-strong active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-55"
          onClick={action}
        >
          <svg aria-hidden="true" className="size-4 shrink-0" viewBox="0 0 20 20" fill="none">
            <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span>{actionLabel}</span>
        </button>
      )}
    </div>
  );
}

function ListToolbar({
  search,
  onSearch,
  searchLabel,
  placeholder,
  count,
  countNoun = { singular: "registro", plural: "registros" },
  filter,
  onFilter,
  filterLabel,
  options,
}: {
  search: string;
  onSearch: (value: string) => void;
  searchLabel: string;
  placeholder: string;
  count: number;
  countNoun?: { singular: string; plural: string };
  filter?: string;
  onFilter?: (value: string) => void;
  filterLabel?: string;
  options?: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="list-toolbar">
      <label className="list-search">
        <span className="sr-only">{searchLabel}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <circle cx="10.8" cy="10.8" r="6.8" />
          <path d="m16 16 4.5 4.5" />
        </svg>
        <input
          type="search"
          value={search}
          onChange={(event) => onSearch(event.currentTarget.value)}
          placeholder={placeholder}
          aria-label={searchLabel}
        />
      </label>
      <div className="list-toolbar-meta">
        {options && filter !== undefined && onFilter && (
          <label className="list-filter">
            <span>{filterLabel ?? "Filtrar"}</span>
            <select
              aria-label={filterLabel ?? "Filtrar"}
              value={filter}
              onChange={(event) => onFilter(event.currentTarget.value)}
            >
              {options.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="list-result-count" aria-live="polite">
          <strong>{count}</strong>
          <span>{count === 1 ? countNoun.singular : countNoun.plural}</span>
        </span>
      </div>
    </div>
  );
}

export function Metric({
  label,
  value,
  note,
  tone = "neutral",
}: {
  label: string;
  value: string;
  note: string;
  tone?: "neutral" | "brand" | "info" | "warning" | "success" | "danger" | "violet";
}) {
  return (
    <article
      className="metric-card rounded-2xl border border-line bg-surface p-4 shadow-sm shadow-emerald-950/[0.035] sm:p-5"
      data-tone={tone}
    >
      <div className="metric-label text-xs font-medium text-muted">{label}</div>
      <div className="metric-value mt-2 text-2xl font-bold tracking-tight text-ink">{value}</div>
      <div className="metric-note mt-1 text-xs leading-relaxed text-muted">{note}</div>
    </article>
  );
}

export function Panel({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm shadow-emerald-950/[0.035]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-muted/70 px-5 py-4">
        <div className="min-w-0">
          <h2 className="m-0 text-sm font-bold tracking-tight text-ink">{title}</h2>
          {description && <p className="mt-1 text-xs text-muted">{description}</p>}
        </div>
        {action && (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{action}</div>
        )}
      </header>
      {children}
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="px-4 py-8 text-center text-sm text-muted">{children}</div>;
}

export function Status({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: "" | "good" | "warning" | "danger";
}) {
  const toneClass = {
    "": "bg-surface-muted text-subtle",
    good: "bg-brand-soft text-brand-strong",
    warning: "bg-warning-soft text-warning",
    danger: "bg-danger-soft text-danger",
  }[tone];
  return (
    <span
      className={`inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-bold ${toneClass}`}
    >
      {children}
    </span>
  );
}

// Páginas operativas
export function OverviewPage({
  state,
  openPage,
  openCompany,
  openContact,
  openProduct,
}: {
  state: AppState;
  openPage: (page: Page) => void;
  openCompany: () => void;
  openContact: () => void;
  openProduct: () => void;
}) {
  const period = currentMonth();
  const monthSales = state.sales
    .filter((sale) => sale.date.startsWith(period))
    .reduce((sum, sale) => sum + sale.total, 0);
  const balance = state.sales.reduce(
    (sum, sale) => sum + outstandingBalance(sale, state.electronicDocuments),
    0,
  );
  const lowStock = state.products.filter((product) => product.stock <= product.minimumStock);
  const pendingPurchases = state.purchases.filter((purchase) => purchase.status === "pending");
  const activeOrders = state.productionOrders.filter((order) => order.status === "active");
  const missingEnvironment =
    !state.environmentalRecords.some((record) => record.period === period) &&
    !state.resourceReadings.some((reading) => reading.periodEnd.slice(0, 7) === period);
  const todayDate = new Date(`${today()}T12:00:00`);
  const weeklySales = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(todayDate);
    date.setDate(todayDate.getDate() - (6 - index));
    const dateKey = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 10);
    return {
      dateKey,
      label: new Intl.DateTimeFormat("es-CO", { weekday: "short" })
        .format(date)
        .replace(/\.$/, ""),
      total: state.sales
        .filter((sale) => sale.date === dateKey)
        .reduce((sum, sale) => sum + sale.total, 0),
    };
  });
  const maxDailySales = Math.max(0, ...weeklySales.map((day) => day.total));
  const hasRecentSales = weeklySales.some((day) => day.total > 0);
  const alerts: ReactNode[] = [];
  if (!state.company)
    alerts.push(
      <Alert
        key="company"
        title="Configura los datos de tu empresa"
        detail="Registra el nombre para identificar este espacio."
        action="Configurar"
        onClick={openCompany}
        tone="warning"
      />,
    );
  if (lowStock.length)
    alerts.push(
      <Alert
        key="stock"
        title={pluralize(
          lowStock.length,
          "producto con inventario bajo",
          "productos con inventario bajo",
        )}
        detail={lowStock
          .slice(0, 4)
          .map((product) => `${product.name} (${formatQuantity(product.stock, product.unit)})`)
          .join(" · ")}
        action="Ver inventario"
        onClick={() => openPage("inventory")}
        tone="critical"
      />,
    );
  if (pendingPurchases.length)
    alerts.push(
      <Alert
        key="purchase"
        title={pluralize(pendingPurchases.length, "compra por recibir", "compras por recibir")}
        detail="Las unidades pendientes aún no se suman al inventario."
        action="Revisar"
        onClick={() => openPage("purchases")}
        tone="warning"
      />,
    );
  if (activeOrders.length)
    alerts.push(
      <Alert
        key="production"
        title={pluralize(activeOrders.length, "orden en proceso", "órdenes en proceso")}
        detail="Los materiales ya fueron descontados; completa la orden al terminar."
        action="Revisar"
        onClick={() => openPage("production")}
      />,
    );
  if (missingEnvironment)
    alerts.push(
      <Alert
        key="environment"
        title={`Sin registro ambiental para ${formatPeriod(period)}`}
        detail="Agrega los consumos y la producción del mes."
        action="Registrar"
        onClick={() => openPage("environment")}
      />,
    );
  const recentSales = state.sales.slice(0, 5);

  return (
    <>
      {!state.company && (
        <div className="notice">
          Los datos se guardan en SQLite en este equipo. Descarga respaldos desde{" "}
          <strong>Datos y respaldo</strong> para conservar una copia fuera del computador.
        </div>
      )}
      <div className="metric-grid">
        <Metric
          label="Ventas del mes"
          value={formatMoney(monthSales)}
          note="Total de ventas registradas en el período"
          tone="brand"
        />
        <Metric
          label="Cuentas por cobrar"
          value={formatMoney(balance)}
          note={pluralize(
            state.sales.filter((sale) => outstandingBalance(sale, state.electronicDocuments) > 0)
              .length,
            "venta con saldo pendiente",
            "ventas con saldo pendiente",
          )}
          tone="warning"
        />
        <Metric
          label="Productos en inventario"
          value={String(state.products.length)}
          note={`${lowStock.length} en el mínimo o por debajo`}
          tone="info"
        />
        <Metric
          label="Órdenes activas"
          value={String(activeOrders.length)}
          note="Órdenes de producción que siguen en proceso"
          tone="violet"
        />
      </div>
      <div className="overview-dashboard-grid">
        <Panel
          title="Ventas de los últimos 7 días"
          description="Total registrado por día · COP"
        >
          {hasRecentSales ? (
            <div
              className="overview-sales-chart"
              role="img"
              aria-label={`Ventas registradas en los últimos siete días: ${weeklySales.map((day) => `${day.label} ${formatMoney(day.total)}`).join(", ")}`}
            >
              {weeklySales.map((day) => (
                <div
                  className="overview-sales-day"
                  key={day.dateKey}
                  title={`${formatDate(day.dateKey)} · ${formatMoney(day.total)}`}
                >
                  <strong>
                    {day.total > 0
                      ? `$${new Intl.NumberFormat("es-CO", {
                          notation: "compact",
                          maximumFractionDigits: 1,
                        }).format(day.total)}`
                      : "—"}
                  </strong>
                  <div className="overview-sales-track" aria-hidden="true">
                    <i
                      style={{
                        height: day.total
                          ? `${Math.max(8, (day.total / maxDailySales) * 100)}%`
                          : "0%",
                      }}
                    />
                  </div>
                  <span>{day.label}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState>
              {state.sales.length
                ? "No hay ventas registradas en los últimos siete días."
                : "El gráfico aparecerá cuando registres ventas."}
            </EmptyState>
          )}
        </Panel>
        <Panel
          title="Pendientes"
          description="Alertas para el trabajo del negocio"
          action={
            <Status tone={alerts.length ? "warning" : "good"}>
              {pluralize(alerts.length, "pendiente", "pendientes")}
            </Status>
          }
        >
          <div className="panel-body alert-list">
            {alerts.length ? (
              alerts
            ) : (
              <EmptyState>No hay pendientes por revisar en este momento.</EmptyState>
            )}
          </div>
        </Panel>
      </div>
      <Panel
        title="Ventas recientes"
        description="Actividad más reciente"
        action={
          <button
            className="button button-secondary button-small"
            onClick={() => openPage("sales")}
          >
            Ver ventas
          </button>
        }
      >
        {recentSales.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Cliente</th>
                  <th>Fecha</th>
                  <th>Total</th>
                  <th>Saldo</th>
                </tr>
              </thead>
              <tbody>
                {recentSales.map((sale) => (
                  <tr key={sale.id}>
                    <td>
                      <strong>{sale.number}</strong>
                    </td>
                    <td>{sale.customerName}</td>
                    <td>{formatDate(sale.date)}</td>
                    <td>{formatMoney(sale.total)}</td>
                    <td>{formatMoney(outstandingBalance(sale, state.electronicDocuments))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>Todavía no hay ventas registradas.</EmptyState>
        )}
      </Panel>
      <div className="two-column">
        <Panel title="Comenzar" description="Registra los datos iniciales">
          <div className="panel-body alert-list">
            <Alert
              title={pluralize(state.contacts.length, "contacto", "contactos")}
              detail="Clientes, proveedores o ambos."
              action="Agregar"
              onClick={openContact}
            />
            <Alert
              title={pluralize(state.products.length, "producto", "productos")}
              detail="Materias primas, insumos y productos terminados."
              action="Agregar"
              onClick={openProduct}
            />
          </div>
        </Panel>
        <Panel title="Alcance de Pyme360" description="Operación local para una empresa">
          <div className="panel-body">
            <p className="field-hint">
              Los valores de IVA son configurables para estimación. Pyme360 no reemplaza el sistema
              contable, y la emisión electrónica requiere un proveedor tecnológico autorizado.
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}

function Alert({
  title,
  detail,
  action,
  onClick,
  tone = "",
}: {
  title: string;
  detail: string;
  action?: string;
  onClick?: () => void;
  tone?: "" | "warning" | "critical";
}) {
  return (
    <div className={`alert-item${tone ? ` ${tone}` : ""}`}>
      <span className="alert-icon">{tone === "critical" ? "▦" : "•"}</span>
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      {action && onClick && (
        <button className="button button-secondary button-small" onClick={onClick}>
          {action}
        </button>
      )}
    </div>
  );
}

export function ContactsPage({
  contacts,
  onAdd,
  onEdit,
  onDelete,
  canEdit,
  canDelete = false,
}: {
  contacts: Contact[];
  onAdd: () => void;
  onEdit: (contact: Contact) => void;
  onDelete: (contact: Contact) => void;
  canEdit: boolean;
  canDelete?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const normalizedSearch = search.trim().toLocaleLowerCase("es-CO");
  const visibleContacts = contacts.filter((contact) => {
    const matchesSearch = [contact.name, contact.taxId, contact.email, contact.phone]
      .join(" ")
      .toLocaleLowerCase("es-CO")
      .includes(normalizedSearch);
    return matchesSearch && (roleFilter === "all" || contact.role === roleFilter);
  });
  return (
    <>
      <PageHeading
        title="Contactos"
        description="Registra clientes y proveedores para asociarlos a las operaciones."
        action={canEdit ? onAdd : undefined}
        actionLabel="Nuevo contacto"
      />
      <Panel title="Contactos" description="Clientes y proveedores de tu operación.">
        <ListToolbar
          search={search}
          onSearch={setSearch}
          searchLabel="Buscar contactos"
          placeholder="Buscar por nombre, NIT, correo o teléfono"
          count={visibleContacts.length}
          filter={roleFilter}
          onFilter={setRoleFilter}
          filterLabel="Tipo de contacto"
          options={[
            { value: "all", label: "Todos los tipos" },
            { value: "customer", label: "Clientes" },
            { value: "supplier", label: "Proveedores" },
            { value: "both", label: "Clientes y proveedores" },
          ]}
        />
        {visibleContacts.length ? (
          <>
            <div className="table-wrap desktop-record-table">
              <table>
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Tipo</th>
                    <th>NIT o cédula</th>
                    <th>Correo</th>
                    <th>Teléfono</th>
                    {canEdit && <th>Acciones</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleContacts.map((contact) => (
                    <tr key={contact.id}>
                      <td>
                        <strong>{contact.name}</strong>
                      </td>
                      <td>
                        <Status>{contactRoleLabel(contact)}</Status>
                      </td>
                      <td>{contact.taxId || "—"}</td>
                      <td>{contact.email || "—"}</td>
                      <td>{contact.phone || "—"}</td>
                      {canEdit && (
                        <td>
                          <div className="table-actions">
                            <button
                              className="button button-secondary button-small"
                              onClick={() => onEdit(contact)}
                            >
                              Editar
                            </button>
                            {canDelete && (
                              <button
                                className="icon-button"
                                onClick={() => onDelete(contact)}
                                aria-label="Eliminar contacto"
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
              {visibleContacts.map((contact) => (
                <article className="mobile-record-card" key={contact.id}>
                  <div className="mobile-record-card-heading">
                    <div className="mobile-record-main">
                      <strong>{contact.name}</strong>
                      <span>{contact.taxId || "Sin identificación"}</span>
                    </div>
                    <Status>{contactRoleLabel(contact)}</Status>
                  </div>
                  <div className="mobile-record-details">
                    {contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
                    {contact.phone && <a href={`tel:${contact.phone}`}>{contact.phone}</a>}
                  </div>
                  {canEdit && (
                    <div className="mobile-record-actions">
                      <button className="button button-secondary" onClick={() => onEdit(contact)}>
                        Editar
                      </button>
                      {canDelete && (
                        <button className="button button-danger" onClick={() => onDelete(contact)}>
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
            {contacts.length
              ? "No hay contactos que coincidan con la búsqueda. Prueba otros términos o filtros."
              : "Aún no hay contactos. Agrega un cliente o proveedor para registrar operaciones."}
          </EmptyState>
        )}
      </Panel>
    </>
  );
}

export function InventoryPage({
  products,
  recipes,
  movements,
  onAdd,
  onAdjust,
  onPreparePurchase,
  onPrepareProduction,
  onEdit,
  onOpenRecipe,
  onDelete,
  canEdit,
  canDelete = false,
}: {
  products: Product[];
  recipes: Recipe[];
  movements: InventoryMovement[];
  onAdd: () => void;
  onAdjust: (product: Product) => void;
  onPreparePurchase: (productId: string, quantity: number) => void;
  onPrepareProduction: (productId: string, quantity: number) => void;
  onEdit: (product: Product) => void;
  onOpenRecipe: (productId: string) => void;
  onDelete: (product: Product) => void;
  canEdit: boolean;
  canDelete?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [productType, setProductType] = useState("all");
  const [stockFilter, setStockFilter] = useState("all");
  const normalizedSearch = search.trim().toLocaleLowerCase("es-CO");
  const visibleProducts = products.filter((product) => {
    const matchesSearch = `${product.name} ${product.sku}`
      .toLocaleLowerCase("es-CO")
      .includes(normalizedSearch);
    const matchesType = productType === "all" || product.type === productType;
    const matchesStock =
      stockFilter === "all" ||
      (stockFilter === "low"
        ? product.stock <= product.minimumStock
        : product.stock > product.minimumStock);
    return matchesSearch && matchesType && matchesStock;
  });
  const recentMovements = movements
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 100);
  const replenishmentSuggestions = products
    .filter((product) => product.minimumStock > 0 && product.stock < product.minimumStock)
    .sort(
      (a, b) =>
        (b.minimumStock - b.stock) / b.minimumStock -
        (a.minimumStock - a.stock) / a.minimumStock,
    );
  return (
    <>
      <PageHeading
        title="Inventario"
        description="Controla existencias y consulta el historial trazable de entradas y salidas."
        action={canEdit ? onAdd : undefined}
        actionLabel="Agregar producto"
      />
      <Panel
        title="Reposición sugerida"
        description="Calculada como la diferencia entre la existencia actual y el mínimo configurado. Revisa y confirma cada operación."
      >
        {replenishmentSuggestions.length ? (
          <div className="grid gap-3 p-4 sm:grid-cols-2 2xl:grid-cols-3">
            {replenishmentSuggestions.map((product) => {
              const quantity = Number((product.minimumStock - product.stock).toFixed(4));
              const recipe = recipes.find((candidate) => candidate.productId === product.id);
              const activeRecipe = recipe?.versions.find(
                (version) => version.status === "active" && version.id === recipe.activeVersionId,
              );
              return (
                <article key={product.id} className="rounded-2xl border border-line bg-surface-muted p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <strong className="block truncate">{product.name}</strong>
                      <span className="text-sm text-subtle">{product.sku} · {productTypeLabel(product.type)}</span>
                    </div>
                    <Status tone="warning">Bajo mínimo</Status>
                  </div>
                  <p className="my-3 text-sm text-subtle">
                    Faltan <strong className="text-ink">{formatQuantity(quantity, product.unit)}</strong> para alcanzar el mínimo de {formatQuantity(product.minimumStock, product.unit)}.
                  </p>
                  {canEdit && (
                    product.type === "finished" ? activeRecipe ? (
                      <button className="button button-primary button-small" onClick={() => onPrepareProduction(product.id, quantity)}>
                        Preparar orden de producción
                      </button>
                    ) : (
                      <button className="button button-secondary button-small" onClick={() => onOpenRecipe(product.id)}>
                        Configurar receta
                      </button>
                    ) : (
                      <button className="button button-primary button-small" onClick={() => onPreparePurchase(product.id, quantity)}>
                        Preparar compra pendiente
                      </button>
                    )
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState>Todos los productos con mínimo configurado están en el nivel requerido.</EmptyState>
        )}
      </Panel>
      <Panel title="Productos" description="Existencias actuales y señales de reposición.">
        <ListToolbar
          search={search}
          onSearch={setSearch}
          searchLabel="Buscar productos"
          placeholder="Buscar por nombre o SKU"
          count={visibleProducts.length}
          countNoun={{ singular: "producto", plural: "productos" }}
          filter={productType}
          onFilter={setProductType}
          filterLabel="Tipo de producto"
          options={[
            { value: "all", label: "Todos los tipos" },
            { value: "finished", label: "Producto terminado" },
            { value: "raw_material", label: "Materia prima" },
            { value: "supply", label: "Insumo" },
          ]}
        />
        <div
          className="inventory-filter-row"
          role="group"
          aria-label="Filtrar por nivel de inventario"
        >
          <span className="inventory-filter-label" aria-hidden="true">
            Nivel de existencias
          </span>
          {[
            { value: "all", label: "Todos" },
            { value: "low", label: "Reponer" },
            { value: "available", label: "Disponibles" },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              className={`filter-chip${stockFilter === option.value ? " active" : ""}`}
              aria-pressed={stockFilter === option.value}
              onClick={() => setStockFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {visibleProducts.length ? (
          <>
            <div className="table-wrap desktop-record-table">
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Tipo</th>
                    <th>Existencia</th>
                    <th>Mínimo</th>
                    <th>Costo / precio</th>
                    <th>Estado</th>
                    {canEdit && <th>Acciones</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleProducts.map((product) => {
                    const low = product.stock <= product.minimumStock;
                    const recipe = recipes.find((item) => item.productId === product.id);
                    const activeVersion = recipe?.versions.find(
                      (version) => version.id === recipe.activeVersionId,
                    );
                    return (
                      <tr key={product.id}>
                        <td>
                          <strong>{product.name}</strong>
                          <small>
                            {product.sku}
                            {product.type === "finished" && (
                              <> · {activeVersion ? `Receta v${activeVersion.versionNumber}` : "Sin receta activa"}</>
                            )}
                          </small>
                        </td>
                        <td>{productTypeLabel(product.type)}</td>
                        <td>
                          {formatQuantity(product.stock, product.unit)}
                        </td>
                        <td>
                          {formatQuantity(product.minimumStock, product.unit)}
                        </td>
                        <td>
                          {formatMoney(product.unitCost)}
                          <small>
                            Venta: {formatMoney(product.unitPrice)} · IVA{" "}
                            {formatNumber(product.vatRate, 1)}%
                          </small>
                        </td>
                        <td>
                          <Status tone={low ? "warning" : "good"}>
                            {low ? "Reponer" : "Disponible"}
                          </Status>
                        </td>
                        {canEdit && (
                          <td>
                            <div className="table-actions">
                              {product.type === "finished" && (
                                <button
                                  className="button button-secondary button-small"
                                  onClick={() => onOpenRecipe(product.id)}
                                >
                                  Receta
                                </button>
                              )}
                              <button
                                className="button button-secondary button-small"
                                onClick={() => onAdjust(product)}
                              >
                                Conteo
                              </button>
                              <button
                                className="button button-secondary button-small"
                                onClick={() => onEdit(product)}
                              >
                                Editar
                              </button>
                              {canDelete && (
                                <button
                                  className="icon-button"
                                  onClick={() => onDelete(product)}
                                  aria-label="Eliminar producto"
                                >
                                  ×
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mobile-record-list">
              {visibleProducts.map((product) => {
                const low = product.stock <= product.minimumStock;
                return (
                  <article className="mobile-record-card" key={product.id}>
                    <div className="mobile-record-card-heading">
                      <div className="mobile-record-main">
                        <strong>{product.name}</strong>
                        <span>
                          {product.sku} · {productTypeLabel(product.type)}
                        </span>
                      </div>
                      <Status tone={low ? "warning" : "good"}>
                        {low ? "Reponer" : "Disponible"}
                      </Status>
                    </div>
                    <div className="mobile-record-stat-grid">
                      <div>
                        <span>Existencia</span>
                        <strong>
                          {formatQuantity(product.stock, product.unit)}
                        </strong>
                      </div>
                      <div>
                        <span>Mínimo</span>
                        <strong>
                          {formatQuantity(product.minimumStock, product.unit)}
                        </strong>
                      </div>
                      <div>
                        <span>Costo</span>
                        <strong>{formatMoney(product.unitCost)}</strong>
                      </div>
                      <div>
                        <span>Precio de venta</span>
                        <strong>{formatMoney(product.unitPrice)}</strong>
                      </div>
                    </div>
                    {product.type === "finished" && canEdit && (
                      <button
                        className="button button-secondary"
                        onClick={() => onOpenRecipe(product.id)}
                      >
                        Gestionar receta
                      </button>
                    )}
                    {canEdit && (
                      <div className="mobile-record-actions">
                        <button
                          className="button button-secondary"
                          onClick={() => onAdjust(product)}
                        >
                          Conteo
                        </button>
                        <button className="button button-secondary" onClick={() => onEdit(product)}>
                          Editar
                        </button>
                        {canDelete && (
                          <button
                            className="button button-danger"
                            onClick={() => onDelete(product)}
                          >
                            Eliminar
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <EmptyState>
            {products.length
              ? "No hay productos que coincidan con esos filtros."
              : "El inventario está vacío. Registra primero los materiales e insumos que utilizas."}
          </EmptyState>
        )}
      </Panel>
      <div className="notice">
        Las ventas, las compras recibidas y las órdenes de producción generan movimientos. Las
        diferencias de conteo y correcciones se guardan como movimientos trazables, sin borrar el historial.
      </div>
      <Panel
        title="Libro de movimientos"
        description="Saldo inicial y cambios desde que se activó el historial."
      >
        {recentMovements.length ? (
          <>
            <div className="table-wrap desktop-record-table">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Producto</th>
                    <th>Cambio</th>
                    <th>Saldo posterior</th>
                    <th>Motivo</th>
                    <th>Referencia</th>
                  </tr>
                </thead>
                <tbody>
                  {recentMovements.map((movement) => (
                    <tr key={movement.id}>
                      <td>{formatLocalDate(movement.occurredAt)}</td>
                      <td>
                        <strong>{movement.productName}</strong>
                        <small>{movement.sku}</small>
                      </td>
                      <td>
                        <Status tone={movement.quantity < 0 ? "warning" : "good"}>
                          {movement.quantity > 0 ? "+" : ""}
                          {formatQuantity(movement.quantity, movement.unit)}
                        </Status>
                      </td>
                      <td>
                        {formatQuantity(movement.balanceAfter, movement.unit)}
                      </td>
                      <td>{movement.reason}</td>
                      <td>
                        {movement.sourceType ? MOVEMENT_SOURCE_LABELS[movement.sourceType] : "Manual"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-record-list">
              {recentMovements.slice(0, 30).map((movement) => (
                <article className="mobile-record-card" key={movement.id}>
                  <div className="mobile-record-card-heading">
                    <div className="mobile-record-main">
                      <strong>{movement.productName}</strong>
                      <span>
                        {formatLocalDate(movement.occurredAt)} · {movement.sku}
                      </span>
                    </div>
                    <Status tone={movement.quantity < 0 ? "warning" : "good"}>
                      {movement.quantity > 0 ? "+" : ""}
                      {formatQuantity(movement.quantity, movement.unit)}
                    </Status>
                  </div>
                  <div className="mobile-record-details">
                    <span>
                      Saldo: {formatQuantity(movement.balanceAfter, movement.unit)}
                    </span>
                    <span>{movement.reason}</span>
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : (
          <EmptyState>El historial comenzará al registrar productos o saldos iniciales.</EmptyState>
        )}
      </Panel>
    </>
  );
}

export function SalesPage({
  sales,
  electronicDocuments,
  onAdd,
  onPrepareInvoice,
  onPayment,
  onDelete,
  canEdit,
  canDelete = false,
}: {
  sales: Sale[];
  electronicDocuments: ElectronicDocument[];
  onAdd: () => void;
  onPrepareInvoice: (sale: Sale) => void;
  onPayment: (sale: Sale) => void;
  onDelete: (sale: Sale) => void;
  canEdit: boolean;
  canDelete?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const normalizedSearch = search.trim().toLocaleLowerCase("es-CO");
  const visibleSales = sales.filter((sale) => {
    const searchable =
      `${sale.number} ${sale.customerName} ${sale.lines.map((line) => line.productName).join(" ")}`.toLocaleLowerCase(
        "es-CO",
      );
    const balance = outstandingBalance(sale, electronicDocuments);
    return (
      searchable.includes(normalizedSearch) &&
      (paymentFilter === "all" ||
        (paymentFilter === "open" && balance > 0) ||
        (paymentFilter === "paid" && balance <= 0))
    );
  });
  return (
    <>
      <PageHeading
        className="sales-page-heading"
        title="Registro de ventas"
        description="Registra operaciones y controla pagos, vencimientos y seguimiento de factura."
        action={canEdit ? onAdd : undefined}
        actionLabel="Registrar venta"
      />
      <Panel
        title="Operaciones"
        description="Busca por documento, cliente o producto; filtra por estado de pago."
      >
        <ListToolbar
          search={search}
          onSearch={setSearch}
          searchLabel="Buscar ventas"
          placeholder="Documento, cliente o producto"
          count={visibleSales.length}
          countNoun={{ singular: "venta", plural: "ventas" }}
          filter={paymentFilter}
          onFilter={setPaymentFilter}
          filterLabel="Estado de pago"
          options={[
            { value: "all", label: "Todos los estados" },
            { value: "open", label: "Con saldo pendiente" },
            { value: "paid", label: "Pagadas" },
          ]}
        />
        {visibleSales.length ? (
          <>
            <div className="table-wrap desktop-record-table sales-desktop-table">
              <table>
                <thead>
                  <tr>
                    <th>Documento</th>
                    <th>Cliente / productos</th>
                    <th>Fecha</th>
                    <th>Vencimiento</th>
                    <th>Total</th>
                    <th>Pagado</th>
                    <th>Ajustes DIAN</th>
                    <th>Saldo</th>
                    <th>Factura</th>
                    {canEdit && <th>Acciones</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleSales.map((sale) => (
                    <tr key={sale.id}>
                      <td>
                        <strong>{sale.number}</strong>
                      </td>
                      <td>
                        <strong>{sale.customerName}</strong>
                        <small>
                          {sale.lines
                            .map((line) => `${line.productName} × ${formatNumber(line.quantity)}`)
                            .join(" · ")}
                        </small>
                      </td>
                      <td>{formatDate(sale.date)}</td>
                      <td>{sale.dueDate ? formatDate(sale.dueDate) : "Sin fecha"}</td>
                      <td>{formatMoney(sale.total)}</td>
                      <td>
                        {formatMoney(
                          sale.payments.reduce((sum, payment) => sum + payment.amount, 0),
                        )}
                      </td>
                      <td>
                        {saleAdjustmentSummary(sale, electronicDocuments)}
                      </td>
                      <td>
                        <Status
                          tone={
                            outstandingBalance(sale, electronicDocuments) > 0 ? "warning" : "good"
                          }
                        >
                          {formatMoney(outstandingBalance(sale, electronicDocuments))}
                        </Status>
                      </td>
                      <td>
                        {(() => {
                          const document = electronicDocuments.find(
                            (item) => item.saleId === sale.id && item.kind === "invoice",
                          );
                          return document ? (
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
                          ) : (
                            <Status>{invoiceStatusLabel(sale.invoiceFollowUpStatus)}</Status>
                          );
                        })()}
                      </td>
                      {canEdit && (
                        <td>
                          <div className="table-actions">
                            {outstandingBalance(sale, electronicDocuments) > 0 && (
                              <button
                                className="button button-secondary button-small"
                                onClick={() => onPayment(sale)}
                              >
                                Abonar
                              </button>
                            )}
                            {!electronicDocuments.some(
                              (item) => item.saleId === sale.id && item.kind === "invoice",
                            ) && (
                              <button
                                className="button button-secondary button-small"
                                type="button"
                                onClick={() => onPrepareInvoice(sale)}
                              >
                                Preparar factura
                              </button>
                            )}
                            {canDelete && (
                              <button
                                className="icon-button"
                                onClick={() => onDelete(sale)}
                                aria-label="Eliminar venta"
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
            <div className="mobile-record-list sales-record-list">
              {visibleSales.map((sale) => {
                const balance = outstandingBalance(sale, electronicDocuments);
                const paid = sale.payments.reduce((sum, payment) => sum + payment.amount, 0);
                const invoice = electronicDocuments.find(
                  (document) => document.saleId === sale.id && document.kind === "invoice",
                );
                return (
                  <article className="mobile-record-card sales-record-card" key={sale.id}>
                    <div className="mobile-record-card-heading">
                      <div className="mobile-record-main">
                        <strong>{sale.customerName}</strong>
                        <span>
                          {sale.number} · {formatDate(sale.date)}
                        </span>
                      </div>
                      <Status tone={balance > 0 ? "warning" : "good"}>
                        {balance > 0 ? "Por cobrar" : "Pagada"}
                      </Status>
                    </div>
                    <p className="mobile-record-description">
                      {sale.lines
                        .map((line) => `${line.productName} × ${formatNumber(line.quantity)}`)
                        .join(" · ")}
                    </p>
                    <div className="mobile-record-stat-grid">
                      <div>
                        <span>Total</span>
                        <strong>{formatMoney(sale.total)}</strong>
                      </div>
                      <div>
                        <span>Pagado</span>
                        <strong>{formatMoney(paid)}</strong>
                      </div>
                      <div>
                        <span>Saldo</span>
                        <strong>{formatMoney(balance)}</strong>
                      </div>
                      <div>
                        <span>Vencimiento</span>
                        <strong>{sale.dueDate ? formatDate(sale.dueDate) : "Sin fecha"}</strong>
                      </div>
                      <div>
                        <span>Ajustes DIAN</span>
                        <strong>{saleAdjustmentSummary(sale, electronicDocuments)}</strong>
                      </div>
                    </div>
                    <div className="mobile-record-meta">
                      Factura:{" "}
                      {invoice
                        ? documentStatusLabel(invoice.status)
                        : invoiceStatusLabel(sale.invoiceFollowUpStatus)}
                    </div>
                    {canEdit && (
                      <div className="mobile-record-actions">
                        {balance > 0 && (
                          <button className="button button-primary" onClick={() => onPayment(sale)}>
                            Registrar abono
                          </button>
                        )}
                        {!invoice && (
                          <button
                            className="button button-secondary"
                            onClick={() => onPrepareInvoice(sale)}
                          >
                            Preparar factura
                          </button>
                        )}
                        {canDelete && (
                          <button className="button button-danger" onClick={() => onDelete(sale)}>
                            Eliminar
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <EmptyState>
            {sales.length
              ? "No hay ventas que coincidan con la búsqueda o el filtro."
              : "Todavía no hay ventas registradas."}
          </EmptyState>
        )}
      </Panel>
      <div className="notice">
        El IVA mostrado se estima desde el catálogo. Preparar un borrador no lo transmite: la
        emisión se habilita cuando se configura un proveedor tecnológico autorizado.
      </div>
    </>
  );
}

function saleAdjustmentSummary(
  sale: Sale,
  electronicDocuments: ElectronicDocument[],
): string {
  const acceptedNotes = electronicDocuments.filter(
    (document) =>
      document.saleId === sale.id &&
      document.kind !== "invoice" &&
      (document.status === "accepted" || document.status === "delivered"),
  );
  const credits = acceptedNotes
    .filter((document) => document.kind === "credit_note")
    .reduce((sum, document) => sum + (document.adjustmentAmount ?? document.snapshot.total), 0);
  const debits = acceptedNotes
    .filter((document) => document.kind === "debit_note")
    .reduce((sum, document) => sum + (document.adjustmentAmount ?? document.snapshot.total), 0);

  if (!credits && !debits) return "—";
  return `${credits ? `−${formatMoney(credits)}` : ""}${credits && debits ? " · " : ""}${debits ? `+${formatMoney(debits)}` : ""}`;
}

function documentStatusLabel(status: ElectronicDocument["status"]): string {
  const labels: Record<ElectronicDocument["status"], string> = {
    draft: "Borrador DIAN",
    queued: "En cola",
    transmitted: "Enviado",
    accepted: "Aceptado",
    rejected: "Rechazado",
    delivered: "Entregado",
    contingency_pending: "Contingencia pendiente",
  };
  return labels[status];
}

export function PurchasesPage({
  purchases,
  onAdd,
  onEdit,
  onDelete,
  canEdit,
  canDelete = false,
}: {
  purchases: Purchase[];
  onAdd: () => void;
  onEdit: (purchase: Purchase) => void;
  onDelete: (purchase: Purchase) => void;
  canEdit: boolean;
  canDelete?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const normalizedSearch = search.trim().toLocaleLowerCase("es-CO");
  const visiblePurchases = purchases.filter((purchase) => {
    const searchable =
      `${purchase.number} ${purchase.supplierName} ${purchase.lines.map((line) => line.productName).join(" ")}`.toLocaleLowerCase(
        "es-CO",
      );
    return (
      searchable.includes(normalizedSearch) &&
      (statusFilter === "all" || purchase.status === statusFilter)
    );
  });
  return (
    <>
      <PageHeading
        title="Compras"
        description="Registra materiales recibidos, vencimientos y pagos a proveedores."
        action={canEdit ? onAdd : undefined}
        actionLabel="Registrar compra"
      />
      <Panel
        title="Compras"
        description="Revisa recepciones, vencimientos y documentos de proveedores."
      >
        <ListToolbar
          search={search}
          onSearch={setSearch}
          searchLabel="Buscar compras"
          placeholder="Buscar por documento, proveedor o producto"
          count={visiblePurchases.length}
          filter={statusFilter}
          onFilter={setStatusFilter}
          filterLabel="Estado de compra"
          options={[
            { value: "all", label: "Todos los estados" },
            { value: "pending", label: "Por recibir" },
            { value: "received", label: "Recibidas" },
          ]}
        />
        {visiblePurchases.length ? (
          <>
            <div className="table-wrap desktop-record-table">
              <table>
                <thead>
                  <tr>
                    <th>Documento</th>
                    <th>Proveedor / materiales</th>
                    <th>Fecha</th>
                    <th>Vencimiento</th>
                    <th>Total</th>
                    <th>Estado</th>
                    {canEdit && <th>Acciones</th>}
                  </tr>
                </thead>
                <tbody>
                  {visiblePurchases.map((purchase) => (
                    <tr key={purchase.id}>
                      <td>
                        <strong>{purchase.number}</strong>
                      </td>
                      <td>
                        <strong>{purchase.supplierName}</strong>
                        <small>
                          {purchase.lines
                            .map((line) => `${line.productName} × ${formatNumber(line.quantity)}`)
                            .join(" · ")}
                        </small>
                      </td>
                      <td>{formatDate(purchase.date)}</td>
                      <td>{purchase.dueDate ? formatDate(purchase.dueDate) : "Sin fecha"}</td>
                      <td>{formatMoney(purchase.total)}</td>
                      <td>
                        <Status tone={purchase.status === "received" ? "good" : "warning"}>
                          {purchaseStatusLabel(purchase.status)}
                        </Status>
                      </td>
                      {canEdit && (
                        <td>
                          <div className="table-actions">
                            <button
                              className="button button-secondary button-small"
                              onClick={() => onEdit(purchase)}
                            >
                              Editar
                            </button>
                            {canDelete && (
                              <button
                                className="icon-button"
                                onClick={() => onDelete(purchase)}
                                aria-label="Eliminar compra"
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
              {visiblePurchases.map((purchase) => (
                <article className="mobile-record-card" key={purchase.id}>
                  <div className="mobile-record-card-heading">
                    <div className="mobile-record-main">
                      <strong>{purchase.supplierName}</strong>
                      <span>
                        {purchase.number} · {formatDate(purchase.date)}
                      </span>
                    </div>
                    <Status tone={purchase.status === "received" ? "good" : "warning"}>
                      {purchaseStatusLabel(purchase.status)}
                    </Status>
                  </div>
                  <p className="mobile-record-description">
                    {purchase.lines
                      .map((line) => `${line.productName} × ${formatNumber(line.quantity)}`)
                      .join(" · ")}
                  </p>
                  <div className="mobile-record-stat-grid">
                    <div>
                      <span>Total</span>
                      <strong>{formatMoney(purchase.total)}</strong>
                    </div>
                    <div>
                      <span>Vencimiento</span>
                      <strong>
                        {purchase.dueDate ? formatDate(purchase.dueDate) : "Sin fecha"}
                      </strong>
                    </div>
                  </div>
                  {canEdit && (
                    <div className="mobile-record-actions">
                      <button className="button button-secondary" onClick={() => onEdit(purchase)}>
                        Editar compra
                      </button>
                      {canDelete && (
                        <button className="button button-danger" onClick={() => onDelete(purchase)}>
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
            {purchases.length
              ? "No hay compras que coincidan con la búsqueda o el filtro."
              : "Todavía no hay compras registradas."}
          </EmptyState>
        )}
      </Panel>
      <div className="notice">
        Solo las compras recibidas afectan las existencias y generan cuenta por pagar. Las
        correcciones agregan movimientos de reversión.
      </div>
    </>
  );
}

export function FinancePage({
  state,
  canEdit,
  isAdmin,
  onAddAccount,
  onAddMovement,
  onCollectSale,
  onPayPurchase,
  onReviewPurchase,
}: {
  state: AppState;
  canEdit: boolean;
  isAdmin: boolean;
  onAddAccount: () => void;
  onAddMovement: () => void;
  onCollectSale: (sale: Sale) => void;
  onPayPurchase: (purchase: Purchase) => void;
  onReviewPurchase: (purchase: Purchase) => void;
}) {
  const receivables = state.sales
    .map((sale) => ({ sale, balance: outstandingBalance(sale, state.electronicDocuments) }))
    .filter((item) => item.balance > 0);
  const payables = state.purchases.filter((purchase) => purchase.status === "received");
  const pendingPayables = payables.reduce((sum, purchase) => sum + payableBalance(purchase), 0);
  const reviewCount = payables.filter(
    (purchase) => purchase.payableReviewStatus === "review_required",
  ).length;
  const accountTotal = state.financialAccounts.reduce(
    (sum, account) => sum + financialAccountBalance(state, account),
    0,
  );
  const currentPeriod = currentMonth();
  const monthMovements = state.cashMovements.filter((movement) =>
    movement.date.startsWith(currentPeriod),
  );
  const monthIn = monthMovements
    .filter((movement) => movement.direction === "in")
    .reduce((sum, movement) => sum + movement.amount, 0);
  const monthOut = monthMovements
    .filter((movement) => movement.direction === "out")
    .reduce((sum, movement) => sum + movement.amount, 0);
  const overdueReceivables = receivables
    .filter(({ sale }) => sale.dueDate && sale.dueDate < today())
    .reduce((sum, item) => sum + item.balance, 0);
  const overduePayables = payables
    .filter(
      (purchase) =>
        purchase.payableReviewStatus === "confirmed" &&
        purchase.dueDate &&
        purchase.dueDate < today(),
    )
    .reduce((sum, purchase) => sum + payableBalance(purchase), 0);
  const recentCash = state.cashMovements
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
    .slice(0, 100);

  return (
    <>
      <PageHeading
        title="Finanzas"
        description="Consulta saldos operativos, pagos y movimientos de caja y banco."
        action={canEdit ? onAddMovement : undefined}
        actionLabel="Registrar ingreso o egreso"
      />
      <div className="notice">
        Control financiero interno en COP. No es contabilidad de partida doble ni conciliación
        bancaria. Los pagos heredados sin cuenta asignada aparecen en el flujo, pero no afectan el
        saldo de una cuenta específica.
      </div>
      <div className="metric-grid">
        <Metric
          label="Por cobrar"
          value={formatMoney(receivables.reduce((sum, item) => sum + item.balance, 0))}
          note={`${pluralize(receivables.length, "venta con saldo", "ventas con saldo")} · vencido ${formatMoney(overdueReceivables)}`}
          tone="warning"
        />
        <Metric
          label="Por pagar"
          value={formatMoney(pendingPayables)}
          note={`${pluralize(payables.length - reviewCount, "compra confirmada", "compras confirmadas")} · vencido ${formatMoney(overduePayables)}`}
          tone="danger"
        />
        <Metric
          label="Caja y bancos"
          value={formatMoney(accountTotal)}
          note={pluralize(
            state.financialAccounts.filter((account) => account.active).length,
            "cuenta activa",
            "cuentas activas",
          )}
          tone="success"
        />
        <Metric
          label={`Flujo de ${formatPeriod(currentPeriod)}`}
          value={formatMoney(monthIn - monthOut)}
          note={`Ingresos ${formatMoney(monthIn)} · egresos ${formatMoney(monthOut)}`}
          tone="info"
        />
      </div>

      <Panel
        title="Cuentas de caja y banco"
        description="El saldo se calcula desde el saldo inicial y los movimientos asignados a cada cuenta."
        action={
          isAdmin ? (
            <button className="button button-secondary button-small" onClick={onAddAccount}>
              ＋ Nueva cuenta
            </button>
          ) : undefined
        }
      >
        {state.financialAccounts.length ? (
          <div className="metric-grid">
            {state.financialAccounts.map((account) => (
              <Metric
                key={account.id}
                label={`${account.name} · ${account.type === "cash" ? "Caja" : "Banco"}`}
                value={formatMoney(financialAccountBalance(state, account))}
                note={
                  account.active
                    ? `Saldo inicial ${formatMoney(account.openingBalance)}`
                    : "Cuenta inactiva; se conserva el historial"
                }
              />
            ))}
          </div>
        ) : (
          <EmptyState>
            Agrega una cuenta para empezar a controlar caja o bancos. Los pagos pueden registrarse
            como “sin asignar” hasta ese momento.
          </EmptyState>
        )}
      </Panel>

      <Panel
        title="Cuentas por cobrar"
        description="Saldo de cada venta: total menos los abonos registrados."
      >
        {receivables.length ? (
          <>
            <div className="table-wrap desktop-record-table">
              <table>
                <thead>
                  <tr>
                    <th>Documento</th>
                    <th>Cliente</th>
                    <th>Fecha / vencimiento</th>
                    <th>Saldo COP</th>
                    {canEdit && <th>Acción</th>}
                  </tr>
                </thead>
                <tbody>
                  {receivables.map(({ sale, balance }) => (
                    <tr key={sale.id}>
                      <td>
                        <strong>{sale.number}</strong>
                      </td>
                      <td>{sale.customerName}</td>
                      <td>
                        {formatDate(sale.date)} /{" "}
                        {sale.dueDate ? formatDate(sale.dueDate) : "Sin fecha"}
                      </td>
                      <td>
                        <Status
                          tone={sale.dueDate && sale.dueDate < today() ? "danger" : "warning"}
                        >
                          {formatMoney(balance)}
                        </Status>
                      </td>
                      {canEdit && (
                        <td>
                          <button
                            className="button button-secondary button-small"
                            onClick={() => onCollectSale(sale)}
                          >
                            Registrar abono
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-record-list">
              {receivables.map(({ sale, balance }) => (
                <article className="mobile-record-card" key={sale.id}>
                  <div className="mobile-record-card-heading">
                    <div className="mobile-record-main">
                      <strong>{sale.number}</strong>
                      <span>{sale.customerName}</span>
                    </div>
                    <Status tone={sale.dueDate && sale.dueDate < today() ? "danger" : "warning"}>
                      {sale.dueDate && sale.dueDate < today() ? "Vencida" : "Pendiente"}
                    </Status>
                  </div>
                  <div className="mobile-record-stat-grid">
                    <div>
                      <span>Saldo pendiente</span>
                      <strong>{formatMoney(balance)}</strong>
                    </div>
                    <div>
                      <span>Vencimiento</span>
                      <strong>{sale.dueDate ? formatDate(sale.dueDate) : "Sin fecha"}</strong>
                    </div>
                  </div>
                  {canEdit && (
                    <div className="mobile-record-actions">
                      <button
                        className="button button-secondary"
                        onClick={() => onCollectSale(sale)}
                      >
                        Registrar abono
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </>
        ) : (
          <EmptyState>No hay cuentas por cobrar pendientes.</EmptyState>
        )}
      </Panel>

      <Panel
        title="Cuentas por pagar"
        description="Las compras recibidas generan saldos. Los registros heredados requieren conciliación antes de sumarse."
      >
        {payables.length ? (
          <>
            <div className="table-wrap desktop-record-table">
              <table>
                <thead>
                  <tr>
                    <th>Documento</th>
                    <th>Proveedor</th>
                    <th>Vencimiento</th>
                    <th>Saldo COP</th>
                    <th>Estado</th>
                    {canEdit && <th>Acción</th>}
                  </tr>
                </thead>
                <tbody>
                  {payables.map((purchase) => {
                    const balance = payableBalance(purchase);
                    return (
                      <tr key={purchase.id}>
                        <td>
                          <strong>{purchase.number}</strong>
                        </td>
                        <td>{purchase.supplierName}</td>
                        <td>{purchase.dueDate ? formatDate(purchase.dueDate) : "Sin fecha"}</td>
                        <td>
                          {purchase.payableReviewStatus === "review_required"
                            ? "—"
                            : formatMoney(balance)}
                        </td>
                        <td>
                          {purchase.payableReviewStatus === "review_required" ? (
                            <Status tone="warning">Por revisar</Status>
                          ) : (
                            <Status
                              tone={
                                balance === 0
                                  ? "good"
                                  : purchase.dueDate && purchase.dueDate < today()
                                    ? "danger"
                                    : "warning"
                              }
                            >
                              {balance === 0 ? "Pagada" : "Pendiente"}
                            </Status>
                          )}
                        </td>
                        {canEdit && (
                          <td className="table-actions">
                            {purchase.payableReviewStatus === "review_required" && isAdmin ? (
                              <button
                                className="button button-secondary button-small"
                                onClick={() => onReviewPurchase(purchase)}
                              >
                                Confirmar saldo
                              </button>
                            ) : (
                              balance > 0 && (
                                <button
                                  className="button button-secondary button-small"
                                  onClick={() => onPayPurchase(purchase)}
                                >
                                  Registrar pago
                                </button>
                              )
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mobile-record-list">
              {payables.map((purchase) => {
                const balance = payableBalance(purchase);
                const needsReview = purchase.payableReviewStatus === "review_required";
                return (
                  <article className="mobile-record-card" key={purchase.id}>
                    <div className="mobile-record-card-heading">
                      <div className="mobile-record-main">
                        <strong>{purchase.number}</strong>
                        <span>{purchase.supplierName}</span>
                      </div>
                      <Status
                        tone={
                          needsReview
                            ? "warning"
                            : balance === 0
                              ? "good"
                              : purchase.dueDate && purchase.dueDate < today()
                                ? "danger"
                                : "warning"
                        }
                      >
                        {needsReview ? "Por revisar" : balance === 0 ? "Pagada" : "Pendiente"}
                      </Status>
                    </div>
                    <div className="mobile-record-stat-grid">
                      <div>
                        <span>Saldo pendiente</span>
                        <strong>{needsReview ? "Por confirmar" : formatMoney(balance)}</strong>
                      </div>
                      <div>
                        <span>Vencimiento</span>
                        <strong>
                          {purchase.dueDate ? formatDate(purchase.dueDate) : "Sin fecha"}
                        </strong>
                      </div>
                    </div>
                    {canEdit && (needsReview ? isAdmin : balance > 0) && (
                      <div className="mobile-record-actions">
                        {needsReview && isAdmin ? (
                          <button
                            className="button button-secondary"
                            onClick={() => onReviewPurchase(purchase)}
                          >
                            Confirmar saldo
                          </button>
                        ) : balance > 0 ? (
                          <button
                            className="button button-secondary"
                            onClick={() => onPayPurchase(purchase)}
                          >
                            Registrar pago
                          </button>
                        ) : null}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <EmptyState>No hay compras recibidas con saldos pendientes.</EmptyState>
        )}
        {reviewCount > 0 && (
          <p className="field-hint">
            {reviewCount === 1
              ? "1 compra antigua está excluida del saldo"
              : `${reviewCount} compras antiguas están excluidas del saldo`}{" "}
            hasta que un administrador confirme cuánto falta por pagar.
          </p>
        )}
      </Panel>

      <Panel
        title="Movimientos de dinero"
        description="Hasta 100 movimientos recientes; las reversiones se conservan como operaciones nuevas."
      >
        {recentCash.length ? (
          <>
            <div className="table-wrap desktop-record-table">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tipo / categoría</th>
                    <th>Descripción</th>
                    <th>Cuenta</th>
                    <th>Medio</th>
                    <th>Valor COP</th>
                  </tr>
                </thead>
                <tbody>
                  {recentCash.map((movement) => (
                    <tr key={movement.id}>
                      <td>{formatDate(movement.date)}</td>
                      <td>
                        <Status tone={movement.direction === "in" ? "good" : "warning"}>
                          {movement.direction === "in" ? "Ingreso" : "Egreso"} · {movement.category}
                        </Status>
                      </td>
                      <td>
                        {movement.description}
                        {movement.legacyUnassigned && (
                          <small>Pago histórico pendiente de asignar a cuenta</small>
                        )}
                      </td>
                      <td>
                        {state.financialAccounts.find(
                          (account) => account.id === movement.accountId,
                        )?.name ?? "Sin asignar"}
                      </td>
                      <td>{movement.method}</td>
                      <td>
                        {movement.direction === "in" ? "+" : "−"}
                        {formatMoney(movement.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-record-list">
              {recentCash.map((movement) => (
                <article className="mobile-record-card" key={movement.id}>
                  <div className="mobile-record-card-heading">
                    <div className="mobile-record-main">
                      <strong>{formatDate(movement.date)}</strong>
                      <span>{movement.description || movement.category}</span>
                    </div>
                    <Status tone={movement.direction === "in" ? "good" : "warning"}>
                      {movement.direction === "in" ? "Ingreso" : "Egreso"}
                    </Status>
                  </div>
                  <div className="mobile-record-stat-grid">
                    <div>
                      <span>Valor</span>
                      <strong>
                        {movement.direction === "in" ? "+" : "−"}
                        {formatMoney(movement.amount)}
                      </strong>
                    </div>
                    <div>
                      <span>Cuenta</span>
                      <strong>
                        {state.financialAccounts.find(
                          (account) => account.id === movement.accountId,
                        )?.name ?? "Sin asignar"}
                      </strong>
                    </div>
                  </div>
                  <p className="mobile-record-description">
                    {movement.category} · {movement.method}
                    {movement.legacyUnassigned
                      ? " · Pago histórico pendiente de asignar a cuenta"
                      : ""}
                  </p>
                </article>
              ))}
            </div>
          </>
        ) : (
          <EmptyState>Aún no hay movimientos de dinero.</EmptyState>
        )}
      </Panel>
    </>
  );
}

interface AuditEvent {
  id: number;
  actorUsername: string;
  action: string;
  entityType: string;
  entityId: string;
  occurredAt: string;
  details: { fields?: string[]; [key: string]: unknown };
}

export function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  useEffect(() => {
    let active = true;
    void fetch("/api/v1/audit", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        const payload = (await response.json()) as { events?: AuditEvent[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "No se pudo consultar la auditoría.");
        if (active) setEvents(payload.events ?? []);
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason));
      });
    return () => {
      active = false;
    };
  }, []);
  const sortedEvents = [...events].sort((left, right) =>
    right.occurredAt.localeCompare(left.occurredAt),
  );
  const actions = [...new Set(sortedEvents.map((event) => event.action))].sort();
  const entities = [...new Set(sortedEvents.map((event) => event.entityType))].sort();
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredEvents = sortedEvents.filter((event) => {
    if (actionFilter !== "all" && event.action !== actionFilter) return false;
    if (entityFilter !== "all" && event.entityType !== entityFilter) return false;
    if (!normalizedSearch) return true;
    const searchableText = [
      event.actorUsername,
      event.action,
      auditActionLabel(event.action),
      event.entityType,
      auditEntityLabel(event.entityType),
      event.entityId,
      ...(event.details.fields ?? []),
    ]
      .join(" ")
      .toLocaleLowerCase();
    return searchableText.includes(normalizedSearch);
  });
  const recentEvents = filteredEvents.slice(0, 3);
  const actorCount = new Set(events.map((event) => event.actorUsername)).size;
  const latestEvent = sortedEvents[0];
  const hasFilters = Boolean(normalizedSearch) || actionFilter !== "all" || entityFilter !== "all";
  return (
    <>
      <PageHeading
        title="Auditoría"
        description="Registro local de cambios de datos y administración de usuarios."
      />
      {error && <div className="notice warning">{error}</div>}
      <Panel
        title="Actividad reciente"
        description="Resumen breve y filtros; el detalle completo permanece disponible bajo demanda."
      >
        <div className="panel-body">
          {!error && events.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line-soft bg-surface-muted px-3.5 py-2.5">
              <span className="text-xs text-muted">
                {filteredEvents.length} de {events.length} eventos ·{" "}
                {pluralize(actorCount, "usuario", "usuarios")}
              </span>
              <span className="text-xs text-muted">
                Último evento:{" "}
                {latestEvent
                  ? formatLocalDateTime(latestEvent.occurredAt)
                  : "—"}
              </span>
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-[minmax(12rem,1.5fr)_minmax(8rem,1fr)_minmax(8rem,1fr)]">
            <input
              aria-label="Buscar en la auditoría"
              placeholder="Buscar usuario, acción, entidad o registro"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="min-h-10 min-w-0 rounded-xl border border-control bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-muted/70 focus:border-brand focus:ring-4 focus:ring-brand/10"
            />
            <select
              aria-label="Filtrar por acción"
              value={actionFilter}
              onChange={(event) => setActionFilter(event.target.value)}
              className="min-h-10 min-w-0 rounded-xl border border-control bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
            >
              <option value="all">Todas las acciones</option>
              {actions.map((action) => (
                <option key={action} value={action}>
                  {auditActionLabel(action)}
                </option>
              ))}
            </select>
            <select
              aria-label="Filtrar por entidad"
              value={entityFilter}
              onChange={(event) => setEntityFilter(event.target.value)}
              className="min-h-10 min-w-0 rounded-xl border border-control bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
            >
              <option value="all">Todas las entidades</option>
              {entities.map((entity) => (
                <option key={entity} value={entity}>
                  {auditEntityLabel(entity)}
                </option>
              ))}
            </select>
          </div>
          {hasFilters && (
            <button
              className="mt-2 text-xs font-semibold text-brand underline-offset-2 hover:underline"
              onClick={() => {
                setSearch("");
                setActionFilter("all");
                setEntityFilter("all");
              }}
            >
              Limpiar filtros
            </button>
          )}
          {filteredEvents.length ? (
            <>
              <div className="mt-3 grid gap-2">
                {recentEvents.map((event) => (
                  <article
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-line-soft bg-surface p-3"
                    key={event.id}
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <strong className="text-xs font-semibold text-ink">
                        {event.actorUsername}
                      </strong>
                      <Status>{auditActionLabel(event.action)}</Status>
                      <span className="text-xs text-muted">
                        {auditEntityLabel(event.entityType)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted">
                      <span>
                        {event.details.fields?.length
                          ? `${event.details.fields.length} campo(s)`
                          : "Sin campos asociados"}
                      </span>
                      <time dateTime={event.occurredAt}>
                        {formatLocalDateTime(event.occurredAt)}
                      </time>
                    </div>
                  </article>
                ))}
              </div>
              <details className="mt-3 rounded-xl border border-line-soft bg-surface">
                <summary className="cursor-pointer px-3.5 py-3 text-xs font-semibold text-ink hover:bg-surface-hover">
                  Ver registro completo ({filteredEvents.length})
                </summary>
                <div className="max-h-[55vh] overflow-auto border-t border-line-soft">
                  <table>
                    <thead className="sticky top-0 z-10 bg-surface-muted">
                      <tr>
                        <th>Fecha</th>
                        <th>Usuario</th>
                        <th>Acción</th>
                        <th>Entidad</th>
                        <th>Registro</th>
                        <th>Campos afectados</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEvents.map((event) => (
                        <tr key={event.id}>
                          <td>
                            {formatLocalDateTime(event.occurredAt)}
                          </td>
                          <td>{event.actorUsername}</td>
                          <td>{auditActionLabel(event.action)}</td>
                          <td>{auditEntityLabel(event.entityType)}</td>
                          <td>{event.entityId}</td>
                          <td>{event.details.fields?.join(", ") || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          ) : !error ? (
            <EmptyState>
              {events.length
                ? "No hay eventos que coincidan con esos filtros."
                : "Aún no hay eventos de auditoría."}
            </EmptyState>
          ) : null}
          <p className="field-hint mb-0 mt-3">
            Se muestran hasta 300 eventos recientes. El registro no contiene contraseñas ni valores
            completos de los campos modificados.
          </p>
        </div>
      </Panel>
    </>
  );
}

export function ProductionPage({
  orders,
  products,
  recipes,
  section,
  selectedRecipeProductId,
  onSectionChange,
  onAdd,
  onCreateRecipe,
  onEditDraft,
  onNewVersion,
  onActivateVersion,
  onComplete,
  onCancel,
  canEdit,
}: {
  orders: ProductionOrder[];
  products: Product[];
  recipes: Recipe[];
  section: "orders" | "recipes";
  selectedRecipeProductId?: string;
  onSectionChange: (section: "orders" | "recipes") => void;
  onAdd: () => void;
  onCreateRecipe: (productId?: string) => void;
  onEditDraft: (recipe: Recipe, version: RecipeVersion) => void;
  onNewVersion: (recipe: Recipe) => void;
  onActivateVersion: (recipe: Recipe, version: RecipeVersion) => void;
  onComplete: (order: ProductionOrder) => void;
  onCancel: (order: ProductionOrder) => void;
  canEdit: boolean;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const normalizedSearch = search.trim().toLocaleLowerCase("es-CO");
  const visibleOrders = orders.filter(
    (order) =>
      `${order.number} ${order.productName}`
        .toLocaleLowerCase("es-CO")
        .includes(normalizedSearch) &&
      (statusFilter === "all" || order.status === statusFilter),
  );
  return (
    <>
      <PageHeading
        title="Producción"
        description="Gestiona las fórmulas por lote y controla las órdenes de fabricación."
        action={
          canEdit
            ? section === "orders"
              ? onAdd
              : () => onCreateRecipe()
            : undefined
        }
        actionLabel={section === "orders" ? "Crear orden" : "Nueva receta"}
      />
      <div className="module-segmented" role="group" aria-label="Secciones de producción">
        <button type="button" aria-pressed={section === "orders"} className={section === "orders" ? "active" : ""} onClick={() => onSectionChange("orders")}>Órdenes</button>
        <button type="button" aria-pressed={section === "recipes"} className={section === "recipes" ? "active" : ""} onClick={() => onSectionChange("recipes")}>Recetas</button>
      </div>
      {section === "orders" ? (
      <>
      <Panel
        title="Órdenes de producción"
        description="Las órdenes activas aparecen primero para facilitar su cierre."
      >
        <ListToolbar
          search={search}
          onSearch={setSearch}
          searchLabel="Buscar órdenes de producción"
          placeholder="Buscar por número o producto"
          count={visibleOrders.length}
          filter={statusFilter}
          onFilter={setStatusFilter}
          filterLabel="Estado de producción"
          options={[
            { value: "all", label: "Todos los estados" },
            { value: "active", label: "En proceso" },
            { value: "completed", label: "Completadas" },
            { value: "cancelled", label: "Canceladas" },
          ]}
        />
        {visibleOrders.length ? (
          <>
            <div className="table-wrap desktop-record-table">
              <table>
                <thead>
                  <tr>
                    <th>Orden</th>
                    <th>Producto</th>
                    <th>Fecha</th>
                    <th>Unidades</th>
                    <th>Materiales</th>
                    <th>Costo directo materiales</th>
                    <th>Estado</th>
                    {canEdit && <th>Acciones</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleOrders.map((order) => (
                    <tr key={order.id}>
                      <td>
                        <strong>{order.number}</strong>
                        {order.recipeVersionNumber !== undefined && (
                          <small>Receta v{order.recipeVersionNumber}</small>
                        )}
                      </td>
                      <td>{order.productName}</td>
                      <td>{formatDate(order.date)}</td>
                      <td>
                        {formatNumber(order.quantity)}
                        {order.status === "completed" && (
                          <small>Desperdicio: {formatNumber(order.wasteQuantity)}</small>
                        )}
                      </td>
                      <td>
                        <small>
                          {order.consumedMaterials
                            .map((item) => `${item.productName} × ${formatNumber(item.quantity)}`)
                            .join(" · ")}
                        </small>
                      </td>
                      <td>
                        <small>{productionCostBasis(order)}</small>
                        {productionCostValue(order)}
                      </td>
                      <td>
                        <Status
                          tone={
                            order.status === "completed"
                              ? "good"
                              : order.status === "active"
                                ? "warning"
                                : ""
                          }
                        >
                          {productionStatusLabel(order.status)}
                        </Status>
                      </td>
                      {canEdit && (
                        <td>
                          {order.status === "active" ? (
                            <div className="table-actions">
                              <button
                                className="button button-primary button-small"
                                onClick={() => onComplete(order)}
                              >
                                Completar
                              </button>
                              <button
                                className="icon-button"
                                onClick={() => onCancel(order)}
                                aria-label="Cancelar orden"
                              >
                                ×
                              </button>
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-record-list">
              {visibleOrders.map((order) => (
                <article className="mobile-record-card" key={order.id}>
                  <div className="mobile-record-card-heading">
                    <div className="mobile-record-main">
                      <strong>{order.productName}</strong>
                      <span>
                        {order.number} · {formatDate(order.date)}
                      </span>
                    </div>
                    <Status
                      tone={
                        order.status === "completed"
                          ? "good"
                          : order.status === "active"
                            ? "warning"
                            : ""
                      }
                    >
                      {productionStatusLabel(order.status)}
                    </Status>
                  </div>
                  <div className="mobile-record-stat-grid">
                    <div>
                      <span>Unidades</span>
                      <strong>{formatNumber(order.quantity)}</strong>
                    </div>
                    <div>
                      <span>Desperdicio</span>
                      <strong>{formatNumber(order.wasteQuantity)}</strong>
                    </div>
                    {order.expectedGoodOutputQuantity !== undefined && (
                      <div>
                        <span>Salida esperada</span>
                        <strong>{formatNumber(order.expectedGoodOutputQuantity)}</strong>
                      </div>
                    )}
                    <div>
                      <span>{productionCostBasis(order)}</span>
                      <strong>{productionCostValue(order)}</strong>
                    </div>
                  </div>
                  <p className="mobile-record-description">
                    Materiales:{" "}
                    {order.consumedMaterials
                      .map((item) => `${item.productName} × ${formatNumber(item.quantity)}`)
                      .join(" · ") || "Sin materiales"}
                  </p>
                  {canEdit && order.status === "active" && (
                    <div className="mobile-record-actions">
                      <button className="button button-primary" onClick={() => onComplete(order)}>
                        Completar orden
                      </button>
                      <button className="button button-danger" onClick={() => onCancel(order)}>
                        Cancelar
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </>
        ) : (
          <EmptyState>
            {orders.length
              ? "No hay órdenes que coincidan con la búsqueda o el filtro."
              : "Aún no hay órdenes de producción."}
          </EmptyState>
        )}
      </Panel>
      <div className="notice">
        Al crear una orden se descuentan los materiales de la receta. Al completarla, las unidades
        buenas ingresan al inventario terminado y el desperdicio queda registrado. El costo mostrado
        corresponde solo a materiales directos, según el costo unitario registrado en cada insumo;
        no incluye mano de obra, energía ni costos indirectos.
      </div>
      </>
      ) : (
        <Panel title="Recetas de producción" description="Versiones, rendimiento esperado y consumo estándar por lote.">
          {products.filter((product) => product.type === "finished").length ? (
            <div className="grid gap-3 p-4 sm:grid-cols-2 2xl:grid-cols-3">
              {products.filter((product) => product.type === "finished").map((product) => {
                const recipe = recipes.find((item) => item.productId === product.id);
                const activeVersion = recipe?.versions.find((item) => item.id === recipe.activeVersionId && item.status === "active");
                const drafts = recipe?.versions.filter((item) => item.status === "draft") ?? [];
                return (
                  <article
                    id={`recipe-product-${product.id}`}
                    key={product.id}
                    className={`mobile-record-card rounded-2xl border p-4 ${selectedRecipeProductId === product.id ? "border-brand ring-2 ring-brand/20" : "border-line"}`}
                  >
                    <div className="mobile-record-card-heading">
                      <div className="mobile-record-main">
                        <strong>{product.name}</strong>
                        <span>{product.sku} · {product.unit}</span>
                      </div>
                      <Status tone={activeVersion ? "good" : drafts.length ? "warning" : ""}>
                        {activeVersion ? `Activa v${activeVersion.versionNumber}` : drafts.length ? "Borrador" : "Sin receta"}
                      </Status>
                    </div>
                    {activeVersion ? (
                      <div className="mt-3 grid gap-2 text-sm">
                        <p className="m-0 text-subtle">
                          Lote base: <strong>{formatQuantity(activeVersion.baseQuantity, product.unit)}</strong> · Rendimiento: <strong>{formatNumber(activeVersion.expectedYieldPercent)}%</strong>
                        </p>
                        <ul className="m-0 grid gap-1 pl-5 text-subtle">
                          {activeVersion.components.map((component) => {
                            const material = products.find((item) => item.id === component.productId);
                            return <li key={component.productId}>{material?.name ?? "Material no disponible"}: {formatNumber(component.quantity)} {material?.unit ?? ""}</li>;
                          })}
                        </ul>
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-muted">Configura materiales, lote base y rendimiento para habilitar órdenes.</p>
                    )}
                    {drafts.length > 0 && (
                      <div className="mt-3 grid gap-2 border-t border-line-soft pt-3">
                        {drafts.map((draft) => (
                          <div key={draft.id} className="flex flex-wrap items-center gap-2">
                            <Status tone="warning">Borrador v{draft.versionNumber}</Status>
                            {canEdit && <button className="button button-secondary button-small" onClick={() => onEditDraft(recipe!, draft)}>Editar</button>}
                            {canEdit && <button className="button button-primary button-small" onClick={() => onActivateVersion(recipe!, draft)}>Activar</button>}
                          </div>
                        ))}
                      </div>
                    )}
                    {(recipe?.versions.filter((item) => item.status === "archived").length ?? 0) > 0 && (
                      <details className="mt-3 border-t border-line-soft pt-3">
                        <summary className="cursor-pointer text-sm font-semibold text-subtle">
                          Versiones archivadas ({recipe?.versions.filter((item) => item.status === "archived").length})
                        </summary>
                        <div className="mt-2 grid gap-2">
                          {recipe?.versions.filter((item) => item.status === "archived").map((archived) => (
                            <div key={archived.id} className="rounded-xl border border-line-soft bg-surface-muted p-3 text-sm">
                              <strong>Versión {archived.versionNumber}</strong>
                              <p className="m-0 mt-1 text-subtle">
                                Lote base {formatQuantity(archived.baseQuantity, product.unit)} · rendimiento {formatNumber(archived.expectedYieldPercent)} %
                              </p>
                              <p className="m-0 mt-1 text-subtle">
                                {archived.components.map((component) => {
                                  const material = products.find((item) => item.id === component.productId);
                                  return `${material?.name ?? "Material no disponible"}: ${formatNumber(component.quantity)} ${material?.unit ?? ""}`;
                                }).join(" · ")}
                              </p>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                    {canEdit && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {!recipe ? (
                          <button className="button button-primary button-small" onClick={() => onCreateRecipe(product.id)}>Crear receta</button>
                        ) : activeVersion ? (
                          <button className="button button-secondary button-small" onClick={() => onNewVersion(recipe)}>Nueva versión</button>
                        ) : drafts.length === 0 ? (
                          <button className="button button-secondary button-small" onClick={() => onCreateRecipe(product.id)}>Configurar receta</button>
                        ) : null}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState>Registra primero un producto terminado para configurar su receta.</EmptyState>
          )}
        </Panel>
      )}
    </>
  );
}

export function DataPage({
  state,
  onRestore,
  onExportExcel,
  onImportWorkbook,
  role = "viewer",
  readOnly = false,
  canRestore = false,
  canImport = false,
}: {
  state: AppState;
  onRestore: (file: File) => void;
  onExportExcel: () => Promise<void>;
  onImportWorkbook?: (state: AppState) => Promise<boolean>;
  role?: UserRole;
  readOnly?: boolean;
  canRestore?: boolean;
  canImport?: boolean;
}) {
  const [exportingExcel, setExportingExcel] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const counts = [
    ["Contactos", state.contacts.length],
    ["Productos", state.products.length],
    ["Movimientos de inventario", state.inventoryMovements.length],
    ["Ventas", state.sales.length],
    ["Borradores y documentos electrónicos", state.electronicDocuments.length],
    ["Facturas de proveedores importadas", state.supplierInvoices.length],
    ["Compras", state.purchases.length],
    ["Cuentas financieras", state.financialAccounts.length],
    ["Movimientos de dinero", state.cashMovements.length],
    ["Órdenes de producción", state.productionOrders.length],
    ["Lecturas ambientales", state.resourceReadings.length],
    ["Metas ambientales", state.indicatorTargets.length],
    ["Acciones ambientales", state.environmentalActions.length],
    ["Recibos ambientales", state.receiptImports.length],
    ["Campos adicionales importados", state.importExtras.length],
  ] as const;

  async function exportWorkbook() {
    setExportingExcel(true);
    try {
      await onExportExcel();
    } finally {
      setExportingExcel(false);
    }
  }

  return (
    <>
      <PageHeading
        title="Datos y respaldo"
        description="Tus datos se guardan en la base SQLite local de este computador."
      />
      {readOnly && (
        <div className="notice warning">
          Esta sesión es de solo consulta. Puedes descargar los datos; las modificaciones están
          reservadas para usuarios autorizados.
        </div>
      )}
      <div className="notice warning">
        SQLite conserva los datos después de cerrar Pyme360 y crea copias diarias en este
        computador. Descarga además un respaldo JSON para guardarlo en otro lugar.
      </div>
      <div className="two-column">
        <Panel
          title="Respaldo JSON"
          description="Descarga o restaura todos los datos del negocio."
        >
          <div className="panel-body alert-list">
            <button className="button button-primary" onClick={() => downloadBackup(state)}>
              Descargar respaldo JSON
            </button>
            {canRestore ? (
              <>
                <label className="button button-secondary">
                  Restaurar desde archivo JSON
                  <input
                    type="file"
                    hidden
                    accept="application/json,.json"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) onRestore(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <span className="field-hint">
                  Al restaurar un respaldo, reemplazará los datos actuales. Las cuentas y la
                  auditoría se conservarán.
                </span>
              </>
            ) : (
              <span className="field-hint">Solo un administrador puede restaurar un respaldo.</span>
            )}
          </div>
        </Panel>
        <Panel
          title="Exportar a Excel"
          description="Descarga un libro .xlsx con hojas organizadas por módulo."
        >
          <div className="panel-body alert-list">
            <button
              className="button button-secondary"
              disabled={exportingExcel}
              aria-busy={exportingExcel}
              onClick={() => void exportWorkbook()}
            >
              {exportingExcel ? "Generando libro…" : "Descargar archivo Excel (.xlsx)"}
            </button>
            <span className="field-hint">
              Incluye módulos comerciales, movimientos de inventario y dinero, cuentas por cobrar y
              pagar, producción e indicadores ambientales.
            </span>
          </div>
        </Panel>
        <Panel
          title="Importar desde Excel"
          description="Relaciona columnas, revisa duplicados y errores, y agrega filas válidas a SQLite."
        >
          <div className="panel-body alert-list">
            <a
              className="button button-secondary"
              href={`${import.meta.env.BASE_URL}sample-data/catalogo-uci-online-retail-pyme360.xlsx`}
              download="catalogo-uci-online-retail-pyme360.xlsx"
            >
              Descargar catálogo de muestra adaptado
            </a>
            <span className="field-hint">
              Incluye 12 referencias del catálogo UCI para relacionar sus columnas. Los valores de
              COP, existencias e IVA son ilustrativos; las columnas de procedencia se conservan en
              Datos adicionales.
            </span>
            {canImport && onImportWorkbook ? (
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setImportOpen(true)}
              >
                Importar archivo Excel (.xlsx o .xls)
              </button>
            ) : (
              <span className="field-hint">
                La importación está disponible para Administrador y Operador cuando SQLite está
                conectado.
              </span>
            )}
            <span className="field-hint">
              Los datos se procesan localmente. La importación es aditiva: omite duplicados y no
              reemplaza registros existentes.
            </span>
          </div>
        </Panel>
      </div>
      <Panel title="Datos actuales" description="Registros guardados en este equipo.">
        <div className="panel-body alert-list">
          {counts.map(([label, count]) => (
            <div className="alert-item" key={label}>
              <div>
                <strong>{label}</strong>
                <span>{count} registro(s)</span>
              </div>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Alcance" description="Operación local de Pyme360">
        <div className="panel-body">
          <p className="field-hint">
            Esta versión está pensada para una empresa en un solo computador. Los recibos se leen
            localmente; no se automatiza el acceso al portal de Enel ni se conectan credenciales
            externas.
          </p>
        </div>
      </Panel>
      {importOpen && onImportWorkbook && (
        <ExcelImportWizard
          state={state}
          role={role}
          onCommit={onImportWorkbook}
          onClose={() => setImportOpen(false)}
        />
      )}
    </>
  );
}

function downloadBackup(state: AppState): void {
  const file = new Blob([serializeBackup(state)], { type: "application/json" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = `pyme360-respaldo-${today()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

// Autenticación y administración de usuarios
export function LoginScreen({
  onAuthenticated,
  setup,
}: {
  onAuthenticated: (user: AuthUser) => void;
  setup: boolean;
}) {
  const [username, setUsername] = useState(setup ? "admin" : "");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (setup && password !== confirmation) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    try {
      onAuthenticated(
        setup ? await createFirstAdmin(username, password) : await login(username, password),
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-shell">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand auth-brand">
          <BrandLogo variant="full" />
        </div>
        <h1>{setup ? "Crear administrador" : "Iniciar sesión"}</h1>
        <p>
          {setup
            ? "Configura la primera cuenta. Después podrás crear usuarios con distintos permisos."
            : "Accede para consultar o administrar los datos locales."}
        </p>
        <label className="field">
          <span>Usuario</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label className="field">
          <span>Contraseña</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={setup ? "new-password" : "current-password"}
            minLength={8}
            required
          />
        </label>
        {setup && (
          <label className="field">
            <span>Repetir contraseña</span>
            <input
              type="password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
        )}
        {error && <div className="notice warning">{error}</div>}
        <button className="button button-primary" disabled={busy}>
          {busy ? "Validando…" : setup ? "Crear cuenta administradora" : "Entrar"}
        </button>
      </form>
    </main>
  );
}

export function UsersModal({
  currentUser,
  onClose,
}: {
  currentUser: AuthUser;
  onClose: () => void;
}) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    void listUsers()
      .then(setUsers)
      .catch((reason: unknown) => setError(errorMessage(reason)));
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const user = await createUser(
        readString(form, "username"),
        String(new FormData(form).get("password") ?? ""),
        readString(form, "role") as UserRole,
        readString(form, "displayName"),
      );
      setUsers((current) => [...current, user]);
      form.reset();
      setError("");
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }
  async function remove(user: AuthUser) {
    if (user.id === currentUser.id || !window.confirm(`¿Eliminar al usuario ${user.username}?`))
      return;
    try {
      await deleteUser(user.id);
      setUsers(await listUsers());
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }
  return (
    <Modal title="Usuarios y permisos" onClose={onClose}>
      <div className="modal-body">
        <p className="field-hint">
          Administrador: configuración, usuarios, eliminaciones y respaldos. Operador: registra
          operaciones. Consulta: solo ve y exporta.
        </p>
        <form className="form-grid" onSubmit={submit}>
          <Field label="Nombre visible" name="displayName" required />
          <Field label="Usuario" name="username" required />
          <Field label="Contraseña" name="password" type="password" min={8} required />
          <SelectField
            label="Rol"
            name="role"
            initialValue="operator"
            options={[
              { value: "operator", label: "Operador" },
              { value: "viewer", label: "Consulta" },
              { value: "admin", label: "Administrador" },
            ]}
          />
          <div className="field full">
            <button className="button button-primary" type="submit">
              Crear usuario
            </button>
          </div>
        </form>
        {error && <div className="notice warning">{error}</div>}
        <div className="alert-list">
          {users.map((user) => (
            <div className="alert-item" key={user.id}>
              <div>
                <strong>{user.displayName || user.username}</strong>
                <span>
                  {user.username} ·{" "}
                  {user.role === "admin"
                    ? "Administrador"
                    : user.role === "operator"
                      ? "Operador"
                      : "Solo consulta"}{" "}
                  · {user.active ? "Activo" : "Bloqueado"}
                </span>
              </div>
              {user.id !== currentUser.id && (
                <>
                  <SelectField
                    label="Rol"
                    name={`role-${user.id}`}
                    initialValue={user.role}
                    options={[
                      { value: "operator", label: "Operador" },
                      { value: "viewer", label: "Consulta" },
                      { value: "admin", label: "Administrador" },
                    ]}
                    onChange={(value) => {
                      if (value === "admin" || value === "operator" || value === "viewer") {
                        if (!window.confirm(`¿Cambiar el rol de ${user.username}?`)) return;
                        void updateUserRole(user.id, value)
                          .then(() => listUsers())
                          .then(setUsers)
                          .catch((reason: unknown) => setError(errorMessage(reason)));
                      }
                    }}
                  />
                  <button
                    className="button button-secondary button-small"
                    type="button"
                    onClick={() => {
                      if (
                        !window.confirm(
                          `¿${user.active ? "Bloquear" : "Activar"} a ${user.username}?`,
                        )
                      )
                        return;
                      void setUserActive(user.id, !user.active)
                        .then(() => listUsers())
                        .then(setUsers)
                        .catch((reason: unknown) => setError(errorMessage(reason)));
                    }}
                  >
                    {user.active ? "Bloquear" : "Activar"}
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => void remove(user)}
                    aria-label={`Eliminar ${user.username}`}
                  >
                    ×
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export function NavIcon({ page }: { page: Page }) {
  const icons: Record<Page, string[]> = {
    overview: ["M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"],
    contacts: [
      "M16 20v-1.5a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4V20",
      "M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
      "M16 3.2a4 4 0 0 1 0 7.6M20 20v-1.5a4 4 0 0 0-3-3.9",
    ],
    inventory: ["m12 3 8.5 4.5L12 12 3.5 7.5 12 3Z", "M3.5 7.5v9L12 21l8.5-4.5v-9M12 12v9"],
    finance: [
      "M4 6.5A2.5 2.5 0 0 1 6.5 4H20v15H6.5A2.5 2.5 0 0 1 4 16.5v-10Z",
      "M4 7h16M16 12h4",
      "M7.5 15h.01",
    ],
    sales: ["M4 17.5 9 12l4 4 7-8", "M14 8h6v6", "M4 4v16h16"],
    purchases: ["M3 4h2l2.2 11h11.3L21 8H6", "M9 19h.01M17 19h.01", "M8 15h10"],
    production: ["M3 20V10l6 3.5V10l6 3.5V5h5v15H3Z", "M17 8h.01M17 11h.01M7 17h.01M11 17h.01"],
    environment: ["M20 4c-8 0-13 4-13 10a6 6 0 0 0 6 6c6 0 10-5 7-16ZM3 21c2-5 6-9 12-12"],
    data: [
      "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Z",
      "M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6",
      "M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
    ],
    audit: ["M9 4h6l1 2h3v14H5V6h3l1-2Z", "M9 12l2 2 4-4M9 17h6"],
  };
  return (
    <span className="nav-icon" aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {icons[page].map((path) => (
          <path key={path} d={path} />
        ))}
      </svg>
    </span>
  );
}
