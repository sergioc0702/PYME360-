import { useState } from "react";
import { productionCostSummary } from "../../domain/production-cost";
import type { Product, ProductionOrder, Recipe, RecipeVersion } from "../../domain/types";
import {
  EmptyState,
  ListToolbar,
  formatDate,
  formatMoney,
  formatNumber,
  formatQuantity,
  productionStatusLabel,
} from "../AppViews";

function materialsText(order: ProductionOrder): string {
  return (
    order.consumedMaterials
      .map((item) => `${item.productName} × ${formatNumber(item.quantity)}`)
      .join(" · ") || "Sin materiales"
  );
}

function unitCost(order: ProductionOrder): string {
  if (order.status === "cancelled") return "—";
  const value =
    order.status === "completed" ? order.materialCostPerGoodUnit : order.estimatedMaterialCost;
  if (value === null || value === undefined) return "Sin dato";
  return order.status === "completed" ? `${formatMoney(value)} por unidad` : formatMoney(value);
}

function ClosedOrderCost({ order }: { order: ProductionOrder }) {
  if (
    order.status !== "completed" ||
    (!order.consumedMaterials.some((item) => item.actualQuantity !== undefined) &&
      [order.laborHours, order.laborHourlyRate, order.energyCost, order.overheadCost].every(
        (value) => value === undefined,
      ))
  )
    return unitCost(order);

  const cost = productionCostSummary(order);
  const money = (amount: number | null | undefined) =>
    amount == null ? "Sin dato" : formatMoney(amount);
  return (
    <div>
      <strong>
        {cost.unitCost != null
          ? `${formatMoney(cost.unitCost)} por unidad buena`
          : cost.total != null
            ? `${formatMoney(cost.total)} en total`
            : "Costo incompleto"}
      </strong>
      <details>
        <summary>Ver desglose</summary>
        <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
          <dt>Materiales previstos</dt>
          <dd>{money(order.estimatedMaterialCost)}</dd>
          <dt>Materiales usados</dt>
          <dd>{money(cost.actualMaterialCost)}</dd>
          <dt>Mano de obra</dt>
          <dd>{money(cost.laborCost)}</dd>
          <dt>Energía asignada</dt>
          <dd>{money(order.energyCost)}</dd>
          <dt>Otros costos</dt>
          <dd>{money(order.overheadCost)}</dd>
          <dt className="font-bold">Total de la orden</dt>
          <dd className="font-bold">{money(cost.total)}</dd>
        </dl>
      </details>
    </div>
  );
}

/** Producción: primero lo que está en proceso, después lo terminado y las recetas. */
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
  const term = search.trim().toLocaleLowerCase("es-CO");
  const active = orders.filter((order) => order.status === "active");
  const history = orders.filter(
    (order) =>
      order.status !== "active" &&
      `${order.number} ${order.productName}`.toLocaleLowerCase("es-CO").includes(term) &&
      (statusFilter === "all" || order.status === statusFilter),
  );
  const finished = products.filter((product) => product.type === "finished");
  const unitOf = (order: ProductionOrder) =>
    products.find((product) => product.id === order.productId)?.unit;

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>Producción</h1>
        {canEdit && (
          <div className="screen-actions">
            <button
              className="action-primary"
              type="button"
              onClick={section === "orders" ? onAdd : () => onCreateRecipe()}
            >
              {section === "orders" ? "Crear orden" : "Nueva receta"}
            </button>
          </div>
        )}
      </header>
      <div className="screen-tabs" role="group" aria-label="Secciones de producción">
        <button
          type="button"
          aria-pressed={section === "orders"}
          onClick={() => onSectionChange("orders")}
        >
          Órdenes
        </button>
        <button
          type="button"
          aria-pressed={section === "recipes"}
          onClick={() => onSectionChange("recipes")}
        >
          Recetas
        </button>
      </div>

      {section === "orders" ? (
        <>
          <section aria-labelledby="produccion-proceso">
            <h2 id="produccion-proceso">En proceso</h2>
            {active.length ? (
              <ul className="task-list">
                {active.map((order) => (
                  <li key={order.id}>
                    <div>
                      <strong>
                        {formatQuantity(order.quantity, unitOf(order))} de {order.productName}
                      </strong>
                      <span>
                        {order.number} · desde {formatDate(order.date)} · Materiales:{" "}
                        {materialsText(order)}
                      </span>
                    </div>
                    {canEdit && (
                      <div className="row-actions">
                        <button
                          className="action-primary"
                          type="button"
                          onClick={() => onComplete(order)}
                        >
                          Terminar
                        </button>
                        <button
                          className="action-link is-danger"
                          type="button"
                          onClick={() => onCancel(order)}
                        >
                          Cancelar
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="screen-empty">No tienes órdenes en proceso.</p>
            )}
          </section>

          <section aria-labelledby="produccion-historial">
            <h2 id="produccion-historial">Terminadas</h2>
            <ListToolbar
              search={search}
              onSearch={setSearch}
              searchLabel="Buscar órdenes"
              placeholder="Buscar por número o producto"
              count={history.length}
              countNoun={{ singular: "orden", plural: "órdenes" }}
              filter={statusFilter}
              onFilter={setStatusFilter}
              filterLabel="Mostrar"
              options={[
                { value: "all", label: "Todas" },
                { value: "completed", label: "Terminadas" },
                { value: "cancelled", label: "Canceladas" },
              ]}
            />
            {history.length ? (
              <ul className="records records-orders">
                <li className="records-head" aria-hidden="true">
                  <span>Producto</span>
                  <span>Hechas</span>
                  <span>Perdidas</span>
                  <span>Costo</span>
                </li>
                {history.map((order) => (
                  <li key={order.id}>
                    <div className="records-main self-start">
                      <strong>{order.productName}</strong>
                      <span>
                        {order.number} · {formatDate(order.date)}
                        {order.status === "cancelled"
                          ? ` · ${productionStatusLabel(order.status)}`
                          : ""}
                      </span>
                    </div>
                    <div className="self-start" data-label="Hechas">
                      {formatNumber(Math.max(0, order.quantity - order.wasteQuantity))}
                    </div>
                    <div className="self-start" data-label="Perdidas">
                      {formatNumber(order.wasteQuantity)}
                    </div>
                    <div className="self-start" data-label="Costo">
                      <ClosedOrderCost order={order} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState>
                {orders.length
                  ? "Ninguna orden coincide con esa búsqueda."
                  : "Cuando termines una orden aparecerá aquí."}
              </EmptyState>
            )}
            <p className="screen-note">
              Las órdenes anteriores muestran el costo de materiales. En los cierres nuevos, el
              costo total aparece cuando se conocen materiales, mano de obra, energía y otros costos.
            </p>
          </section>
        </>
      ) : (
        <section aria-labelledby="produccion-recetas">
          <h2 id="produccion-recetas">Tus recetas</h2>
          {finished.length ? (
            <ul className="task-list">
              {finished.map((product) => {
                const recipe = recipes.find((item) => item.productId === product.id);
                const current = recipe?.versions.find(
                  (item) => item.id === recipe.activeVersionId && item.status === "active",
                );
                const drafts = recipe?.versions.filter((item) => item.status === "draft") ?? [];
                const archived =
                  recipe?.versions.filter((item) => item.status === "archived") ?? [];
                const materials = (version: RecipeVersion) =>
                  version.components
                    .map((component) => {
                      const material = products.find((item) => item.id === component.productId);
                      return `${material?.name ?? "Material no disponible"}: ${formatNumber(component.quantity)} ${material?.unit ?? ""}`;
                    })
                    .join(" · ");
                return (
                  <li
                    id={`recipe-product-${product.id}`}
                    key={product.id}
                    className={selectedRecipeProductId === product.id ? "is-selected" : undefined}
                  >
                    <div>
                      <strong>{product.name}</strong>
                      {current ? (
                        <>
                          <span>
                            Para {formatQuantity(current.baseQuantity, product.unit)}, sale el{" "}
                            {formatNumber(current.expectedYieldPercent)} %
                          </span>
                          <span className="task-detail">{materials(current)}</span>
                        </>
                      ) : (
                        <span>
                          {drafts.length
                            ? "Tienes un borrador sin activar"
                            : "Sin receta. La necesitas para crear órdenes"}
                        </span>
                      )}
                      {archived.length > 0 && (
                        <details className="task-history">
                          <summary>Recetas anteriores ({archived.length})</summary>
                          {archived.map((version) => (
                            <span className="task-detail" key={version.id}>
                              Versión {version.versionNumber}:{" "}
                              {formatQuantity(version.baseQuantity, product.unit)},{" "}
                              {formatNumber(version.expectedYieldPercent)} % · {materials(version)}
                            </span>
                          ))}
                        </details>
                      )}
                    </div>
                    {canEdit && (
                      <div className="row-actions">
                        {drafts.map((draft) => (
                          <span className="row-actions" key={draft.id}>
                            <button
                              className="action-primary"
                              type="button"
                              onClick={() => onActivateVersion(recipe!, draft)}
                            >
                              Activar borrador
                            </button>
                            <button
                              className="action-link"
                              type="button"
                              onClick={() => onEditDraft(recipe!, draft)}
                            >
                              Editar
                            </button>
                          </span>
                        ))}
                        {!recipe && (
                          <button
                            className="action-primary"
                            type="button"
                            onClick={() => onCreateRecipe(product.id)}
                          >
                            Crear receta
                          </button>
                        )}
                        {recipe && current && (
                          <button
                            className="action-secondary"
                            type="button"
                            onClick={() => onNewVersion(recipe)}
                          >
                            Cambiar receta
                          </button>
                        )}
                        {recipe && !current && drafts.length === 0 && (
                          <button
                            className="action-secondary"
                            type="button"
                            onClick={() => onCreateRecipe(product.id)}
                          >
                            Crear receta
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState>Primero agrega en Inventario un producto que vendas.</EmptyState>
          )}
        </section>
      )}
    </div>
  );
}
