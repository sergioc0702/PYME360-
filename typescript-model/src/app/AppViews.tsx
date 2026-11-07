import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { BusinessError } from "../domain/business";
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
import { BrandLogo } from "../shared/BrandLogo";
import type {
  Contact,
  ReceiptExtraction,
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
  IndicatorId,
  IndicatorTarget,
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
  | {
      type: "purchase";
      purchase?: Purchase;
      initialProductId?: string;
      initialQuantity?: number;
      initialStatus?: PurchaseStatus;
    }
  | { type: "production"; initialProductId?: string; initialQuantity?: number }
  | { type: "reading"; reading?: ResourceReading }
  | { type: "target"; target?: IndicatorTarget }
  | { type: "factor"; factor?: EmissionFactor }
  | {
      type: "environmental-action";
      initial?: { title: string; indicatorId: IndicatorId; notes: string };
    }
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

export const MOVEMENT_SOURCE_LABELS: Record<
  "sale" | "purchase" | "production" | "adjustment",
  string
> = {
  sale: "Venta",
  purchase: "Compra",
  production: "Producción",
  adjustment: "Ajuste",
};

export const PAGE_TITLES: Record<Page, string> = {
  overview: "Inicio",
  sales: "Vender",
  purchases: "Comprar",
  inventory: "Inventario",
  production: "Producción",
  environment: "Consumo y ahorro",
  contacts: "Clientes y proveedores",
  finance: "Dinero",
  data: "Datos y respaldo",
  audit: "Historial de cambios",
};

export const NAV_GROUPS: Array<{ title: string; pages: Page[] }> = (
  [
    "overview",
    "sales",
    "purchases",
    "inventory",
    "production",
    "environment",
    "contacts",
    "finance",
    "data",
    "audit",
  ] as Page[]
).map((page) => ({ title: page, pages: [page] }));

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

export function formatLocalDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("es-CO", { dateStyle: "short" }).format(date);
}

export function formatLocalDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("es-CO", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export function productTypeLabel(type: ProductType): string {
  if (type === "raw_material") return "Materia prima";
  if (type === "supply") return "Insumo";
  return "Producto terminado";
}

export function productionStatusLabel(status: ProductionOrder["status"]): string {
  if (status === "completed") return "Terminada";
  if (status === "cancelled") return "Cancelada";
  return "En proceso";
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
          "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary",
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

export function ListToolbar({
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
  children,
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
  children?: ReactNode;
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
        {children}
        <span className="list-result-count" aria-live="polite">
          <strong>{count}</strong>
          <span>{count === 1 ? countNoun.singular : countNoun.plural}</span>
        </span>
      </div>
    </div>
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
    <section className="overflow-hidden rounded-lg border border-line bg-surface">
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
