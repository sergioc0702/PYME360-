import { useState } from "react";
import type { InventoryMovement, Product, Recipe } from "../../domain/types";
import {
  EmptyState,
  ListToolbar,
  MOVEMENT_SOURCE_LABELS,
  Status,
  formatLocalDate,
  formatMoney,
  formatQuantity,
  productTypeLabel,
} from "../AppViews";

const needsRestock = (product: Product) =>
  product.minimumStock > 0 && product.stock < product.minimumStock;

/** Inventario: primero lo que hay que reponer, después la lista de productos. */
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
  const term = search.trim().toLocaleLowerCase("es-CO");
  const activeRecipe = (productId: string) => {
    const recipe = recipes.find((item) => item.productId === productId);
    return recipe?.versions.find(
      (version) => version.status === "active" && version.id === recipe.activeVersionId,
    );
  };
  const visible = products.filter(
    (product) =>
      `${product.name} ${product.sku}`.toLocaleLowerCase("es-CO").includes(term) &&
      (productType === "all" || product.type === productType) &&
      (stockFilter === "all" || needsRestock(product) === (stockFilter === "low")),
  );
  const toRestock = products
    .filter(needsRestock)
    .sort(
      (a, b) =>
        (b.minimumStock - b.stock) / b.minimumStock - (a.minimumStock - a.stock) / a.minimumStock,
    );
  const recentMovements = movements
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 100);

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>Inventario</h1>
        {canEdit && (
          <div className="screen-actions">
            <button className="action-primary" type="button" onClick={onAdd}>
              Agregar producto
            </button>
          </div>
        )}
      </header>

      {toRestock.length > 0 && (
        <section aria-labelledby="inventario-reponer">
          <h2 id="inventario-reponer">Por reponer</h2>
          <ul className="task-list">
            {toRestock.map((product) => {
              const quantity = Number((product.minimumStock - product.stock).toFixed(4));
              const finished = product.type === "finished";
              return (
                <li key={product.id}>
                  <div>
                    <strong>
                      {product.name}: faltan {formatQuantity(quantity, product.unit)}
                    </strong>
                    <span>
                      Tienes {formatQuantity(product.stock, product.unit)} y tu mínimo es{" "}
                      {formatQuantity(product.minimumStock, product.unit)}
                    </span>
                  </div>
                  {canEdit &&
                    (!finished ? (
                      <button
                        className="action-primary"
                        type="button"
                        onClick={() => onPreparePurchase(product.id, quantity)}
                      >
                        Comprar
                      </button>
                    ) : activeRecipe(product.id) ? (
                      <button
                        className="action-primary"
                        type="button"
                        onClick={() => onPrepareProduction(product.id, quantity)}
                      >
                        Producir
                      </button>
                    ) : (
                      <button
                        className="action-secondary"
                        type="button"
                        onClick={() => onOpenRecipe(product.id)}
                      >
                        Crear receta
                      </button>
                    ))}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="inventario-productos">
        <h2 id="inventario-productos">Tus productos</h2>
        <ListToolbar
          search={search}
          onSearch={setSearch}
          searchLabel="Buscar productos"
          placeholder="Buscar por nombre o código"
          count={visible.length}
          countNoun={{ singular: "producto", plural: "productos" }}
          filter={productType}
          onFilter={setProductType}
          filterLabel="Tipo"
          options={[
            { value: "all", label: "Todos" },
            { value: "finished", label: "Lo que vendo" },
            { value: "raw_material", label: "Materia prima" },
            { value: "supply", label: "Insumo" },
          ]}
        />
        <div className="screen-tabs" role="group" aria-label="Filtrar por existencias">
          {[
            { value: "all", label: "Todos" },
            { value: "low", label: "Por reponer" },
            { value: "available", label: "Disponibles" },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={stockFilter === option.value}
              onClick={() => setStockFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {visible.length ? (
          <ul className="records records-inventory">
            <li className="records-head" aria-hidden="true">
              <span>Producto</span>
              <span>Tienes</span>
              <span>Mínimo</span>
              <span>Costo</span>
              <span>Precio</span>
              <span />
            </li>
            {visible.map((product) => {
              const finished = product.type === "finished";
              return (
                <li key={product.id}>
                  <div className="records-main">
                    <strong>{product.name}</strong>
                    <span>
                      {product.sku} · {productTypeLabel(product.type)}
                      {finished && !activeRecipe(product.id) ? " · Sin receta" : ""}
                    </span>
                  </div>
                  <div data-label="Tienes">
                    <strong className={needsRestock(product) ? "is-low" : undefined}>
                      {formatQuantity(product.stock, product.unit)}
                    </strong>
                  </div>
                  <div data-label="Mínimo">
                    {formatQuantity(product.minimumStock, product.unit)}
                  </div>
                  <div data-label="Costo">{formatMoney(product.unitCost)}</div>
                  <div data-label="Precio">{formatMoney(product.unitPrice)}</div>
                  {canEdit && (
                    <div className="row-actions">
                      {finished && (
                        <button
                          className="action-link"
                          type="button"
                          onClick={() => onOpenRecipe(product.id)}
                        >
                          Receta
                        </button>
                      )}
                      <button
                        className="action-link"
                        type="button"
                        onClick={() => onAdjust(product)}
                      >
                        Contar
                      </button>
                      <button className="action-link" type="button" onClick={() => onEdit(product)}>
                        Editar
                      </button>
                      {canDelete && (
                        <button
                          className="action-link is-danger"
                          type="button"
                          onClick={() => onDelete(product)}
                          aria-label={`Eliminar ${product.name}`}
                        >
                          Eliminar
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState>
            {products.length
              ? "Ningún producto coincide con esa búsqueda."
              : "Todavía no tienes productos. Agrega los materiales que usas y lo que vendes."}
          </EmptyState>
        )}
      </section>

      <h2 className="screen-more-title">Más detalle</h2>
      <details className="environment-disclosure">
        <summary>Historial de entradas y salidas · {recentMovements.length}</summary>
        <div className="environment-disclosure-content">
          <p className="screen-note">
            Las ventas, las compras recibidas y la producción quedan aquí solas. Los conteos
            también: nada se borra.
          </p>
          {recentMovements.length ? (
            <ul className="records records-movements">
              <li className="records-head" aria-hidden="true">
                <span>Producto</span>
                <span>Cambio</span>
                <span>Quedó en</span>
                <span>Motivo</span>
              </li>
              {recentMovements.map((movement) => (
                <li key={movement.id}>
                  <div className="records-main">
                    <strong>{movement.productName}</strong>
                    <span>
                      {formatLocalDate(movement.occurredAt)} ·{" "}
                      {movement.sourceType ? MOVEMENT_SOURCE_LABELS[movement.sourceType] : "Manual"}
                    </span>
                  </div>
                  <div data-label="Cambio">
                    <Status tone={movement.quantity < 0 ? "warning" : "good"}>
                      {movement.quantity > 0 ? "+" : ""}
                      {formatQuantity(movement.quantity, movement.unit)}
                    </Status>
                  </div>
                  <div data-label="Quedó en">
                    {formatQuantity(movement.balanceAfter, movement.unit)}
                  </div>
                  <div data-label="Motivo">{movement.reason}</div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>Aquí verás cada entrada y salida de tus productos.</EmptyState>
          )}
        </div>
      </details>
    </div>
  );
}
