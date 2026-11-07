import { useEffect, useState } from "react";
import { EmptyState, ListToolbar, errorMessage, formatLocalDateTime } from "../AppViews";

const VISIBLE_LIMIT = 30;

const ACTION_LABELS: Record<string, string> = {
  created: "Creó",
  updated: "Cambió",
  deleted: "Eliminó",
  login: "Inició sesión",
  logout: "Cerró sesión",
  migrated: "Actualizó el formato",
  resolved: "Resolvió",
  restored: "Restauró",
  synchronized: "Sincronizó",
};

const ENTITY_LABELS: Record<string, string> = {
  application_data: "Datos de la aplicación",
  cashMovements: "Entrada o salida de dinero",
  company: "Empresa",
  contacts: "Contacto",
  electronicDocuments: "Factura",
  electronic_document: "Factura",
  emissionFactors: "Valor para calcular el CO₂",
  environmentalActions: "Plan de ahorro",
  environmentalConfig: "Datos de consumo",
  environmentalRecords: "Registro de consumo",
  financialAccounts: "Caja o banco",
  importExtras: "Dato adicional",
  indicatorTargets: "Meta de ahorro",
  inventoryMovements: "Movimiento de inventario",
  products: "Producto",
  productionOrders: "Orden de producción",
  purchases: "Compra",
  receiptImports: "Recibo",
  recipes: "Receta",
  resourceReadings: "Consumo",
  sales: "Venta",
  session: "Sesión",
  supplierInvoices: "Factura de proveedor",
  sync_conflict: "Conflicto de sincronización",
  taxConfiguration: "Datos para facturar",
  user: "Usuario",
  users: "Usuarios",
  workspace: "Espacio de empresa",
};

const actionLabel = (action: string) => ACTION_LABELS[action] ?? action;
const entityLabel = (entity: string) => ENTITY_LABELS[entity] ?? entity;

interface AuditEvent {
  id: number;
  actorUsername: string;
  action: string;
  entityType: string;
  entityId: string;
  occurredAt: string;
  details: { fields?: string[]; [key: string]: unknown };
}

/** Historial de cambios: quién hizo qué y cuándo. */
export function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/audit", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        const payload = (await response.json()) as { events?: AuditEvent[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "No se pudo abrir el historial.");
        if (active) setEvents(payload.events ?? []);
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const sorted = [...events].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const actions = [...new Set(sorted.map((event) => event.action))].sort();
  const entities = [...new Set(sorted.map((event) => event.entityType))].sort();
  const term = search.trim().toLocaleLowerCase("es-CO");
  const filtered = sorted.filter((event) => {
    if (actionFilter !== "all" && event.action !== actionFilter) return false;
    if (entityFilter !== "all" && event.entityType !== entityFilter) return false;
    return [
      event.actorUsername,
      actionLabel(event.action),
      entityLabel(event.entityType),
      event.entityId,
      ...(event.details.fields ?? []),
    ]
      .join(" ")
      .toLocaleLowerCase("es-CO")
      .includes(term);
  });
  const visible = expanded ? filtered : filtered.slice(0, VISIBLE_LIMIT);

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>Historial de cambios</h1>
      </header>
      {error && <div className="notice warning">{error}</div>}

      <section aria-label="Cambios registrados">
        <ListToolbar
          search={search}
          onSearch={setSearch}
          searchLabel="Buscar en el historial"
          placeholder="Buscar por persona o por lo que cambió"
          count={filtered.length}
          countNoun={{ singular: "cambio", plural: "cambios" }}
          filter={actionFilter}
          onFilter={setActionFilter}
          filterLabel="Qué hizo"
          options={[
            { value: "all", label: "Todo" },
            ...actions.map((action) => ({ value: action, label: actionLabel(action) })),
          ]}
        >
          <label className="list-filter">
            <span>En qué</span>
            <select
              aria-label="En qué"
              value={entityFilter}
              onChange={(event) => setEntityFilter(event.currentTarget.value)}
            >
              <option value="all">Todo</option>
              {entities.map((entity) => (
                <option value={entity} key={entity}>
                  {entityLabel(entity)}
                </option>
              ))}
            </select>
          </label>
        </ListToolbar>

        {visible.length ? (
          <ul className="records records-audit">
            <li className="records-head" aria-hidden="true">
              <span>Qué pasó</span>
              <span>Quién</span>
              <span>Cuándo</span>
            </li>
            {visible.map((event) => (
              <li key={event.id}>
                <div className="records-main">
                  <strong>
                    {actionLabel(event.action)}
                    {event.entityType === "session" ? "" : `: ${entityLabel(event.entityType)}`}
                  </strong>
                  {event.entityId && event.entityId.length <= 20 && <span>{event.entityId}</span>}
                  {(event.details.fields?.length || event.entityId.length > 20) && (
                    <details className="task-history">
                      <summary>Datos técnicos</summary>
                      <span className="records-detail records-wrap">
                        Registro: {event.entityId}
                      </span>
                      {event.details.fields?.length ? (
                        <span className="records-detail records-wrap">
                          Campos: {event.details.fields.join(", ")}
                        </span>
                      ) : null}
                    </details>
                  )}
                </div>
                <div data-label="Quién">{event.actorUsername}</div>
                <div data-label="Cuándo">
                  <time dateTime={event.occurredAt}>{formatLocalDateTime(event.occurredAt)}</time>
                </div>
              </li>
            ))}
          </ul>
        ) : loading || error ? null : (
          <EmptyState>
            {events.length
              ? "Ningún cambio coincide con esa búsqueda."
              : "Todavía no hay cambios registrados."}
          </EmptyState>
        )}
        {filtered.length > VISIBLE_LIMIT && (
          <button
            className="action-link"
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "Ver menos" : `Ver todos (${filtered.length})`}
          </button>
        )}
        <p className="screen-note">
          Aquí ves hasta 300 cambios recientes. No se guardan contraseñas ni los valores completos
          de lo que cambió.
        </p>
      </section>
    </div>
  );
}
