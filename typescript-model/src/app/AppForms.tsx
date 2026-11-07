import { useState, type FormEvent } from "react";
import {
  currentMonth,
  formatMoney,
  formatNumber,
  formatQuantity,
  readNumber,
  readString,
  today,
} from "./AppViews";
import { Field, Modal, SelectField } from "./AppViews";
import { calculateRecipeRequirements, estimateMaterialCost } from "../domain/costing";
import type {
  AppState,
  Company,
  Contact,
  ContactRole,
  EnvironmentalConfig,
  EnvironmentalActionInput,
  EmissionFactorInput,
  IndicatorId,
  IndicatorTarget,
  IndicatorTargetInput,
  ResourceKind,
  ResourceReading,
  ResourceReadingInput,
  ReadingActivity,
  InvoiceFollowUpStatus,
  Product,
  ProductType,
  ProductTaxCategory,
  ProductionOrder,
  Purchase,
  PurchaseInput,
  PurchaseStatus,
  ReceiptExtraction,
  Recipe,
  RecipeComponent,
  RecipeVersion,
  RecipeVersionInput,
  Sale,
  SaleInput,
  SaleLineInput,
  FinancialAccount,
  CashMovementDirection,
} from "../domain/types";

// Selectores reutilizados por los formularios de operaciones
function ContactSelect({
  contacts,
  name,
  role,
  value = "",
  onChange,
}: {
  contacts: Contact[];
  name: string;
  role: "customer" | "supplier";
  value?: string;
  onChange?: (value: string) => void;
}) {
  const filtered = contacts.filter((contact) => contact.role === role || contact.role === "both");
  return (
    <SelectField
      label={role === "customer" ? "Cliente" : "Proveedor"}
      name={name}
      required
      initialValue={value}
      onChange={onChange}
      options={[
        {
          value: "",
          label: role === "customer" ? "Selecciona un cliente" : "Selecciona un proveedor",
        },
        ...filtered.map((contact) => ({ value: contact.id, label: contact.name })),
      ]}
    />
  );
}

// Empresa, contactos, catálogo y operaciones
export function CompanyForm({
  company,
  onSave,
  onClose,
}: {
  company: Company | null;
  onSave: (input: Company) => void;
  onClose: () => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    onSave({
      name: readString(form, "name"),
      taxId: readString(form, "taxId"),
      city: readString(form, "city"),
      activity: readString(form, "activity"),
    });
  }
  return (
    <Modal title="Configurar empresa" onClose={onClose}>
      <form className="modal-body" onSubmit={submit}>
        <div className="form-grid">
          <Field
            label="Nombre o razón social"
            name="name"
            initialValue={company?.name ?? ""}
            required
          />
          <Field label="NIT" name="taxId" initialValue={company?.taxId ?? ""} />
          <Field label="Ciudad" name="city" initialValue={company?.city ?? ""} />
          <Field label="Actividad" name="activity" initialValue={company?.activity ?? ""} />
        </div>
        <ModalFooter onClose={onClose} submitLabel="Guardar empresa" />
      </form>
    </Modal>
  );
}

export function ContactForm({
  contact,
  onSave,
  onClose,
}: {
  contact?: Contact;
  onSave: (input: Omit<Contact, "id">) => void;
  onClose: () => void;
}) {
  const [role, setRole] = useState<ContactRole>(contact?.role ?? "customer");
  const [ordinary, setOrdinary] = useState(contact?.ordinaryCustomer ?? false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    onSave({
      name: readString(form, "name"),
      role,
      ordinaryCustomer: ordinary,
      taxId: readString(form, "taxId"),
      email: readString(form, "email"),
      phone: readString(form, "phone"),
      identificationType: readString(form, "identificationType") as Contact["identificationType"],
    });
  }
  return (
    <Modal title={contact ? "Editar contacto" : "Nuevo contacto"} onClose={onClose}>
      <form className="modal-body" onSubmit={submit}>
        <div className="form-grid">
          <SelectField
            label="Tipo de contacto"
            name="role"
            initialValue={role}
            onChange={(value) => {
              if (value === "customer" || value === "supplier" || value === "both") {
                setRole(value);
                if (value === "supplier") setOrdinary(false);
              }
            }}
            options={[
              { value: "customer", label: "Cliente" },
              { value: "supplier", label: "Proveedor" },
              { value: "both", label: "Cliente y proveedor" },
            ]}
          />
          <Field
            label="Nombre o razón social"
            name="name"
            initialValue={contact?.name ?? ""}
            required={!ordinary}
            disabled={ordinary}
          />
          <Field label="NIT o cédula" name="taxId" initialValue={contact?.taxId ?? ""} />
          <SelectField
            label="Tipo de identificación"
            name="identificationType"
            initialValue={contact?.identificationType ?? ""}
            options={[
              { value: "", label: "Sin clasificar" },
              { value: "NIT", label: "NIT" },
              { value: "CC", label: "Cédula de ciudadanía" },
              { value: "CE", label: "Cédula de extranjería" },
              { value: "PASSPORT", label: "Pasaporte" },
              { value: "OTHER", label: "Otro" },
            ]}
          />
          <Field label="Correo" name="email" type="email" initialValue={contact?.email ?? ""} />
          <Field label="Teléfono" name="phone" initialValue={contact?.phone ?? ""} />
          <div className="field full">
            <label className="check-field">
              <input
                type="checkbox"
                checked={ordinary}
                disabled={role === "supplier"}
                onChange={(event) => setOrdinary(event.target.checked)}
              />{" "}
              Cliente de mostrador sin datos personales
            </label>
            <span className="field-hint">
              Esta opción aplica a clientes y evita guardar un nombre individual.
            </span>
          </div>
        </div>
        <ModalFooter onClose={onClose} submitLabel="Guardar contacto" />
      </form>
    </Modal>
  );
}

export function ProductForm({
  product,
  onSave,
  onClose,
}: {
  product?: Product;
  onSave: (input: Omit<Product, "id" | "sku">) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState<ProductType>(product?.type ?? "raw_material");
  const inferredConversion = (unit: string): { base: string; factor: number } | null => {
    const normalized = unit.trim().toLowerCase();
    if (["kg", "kilogramo", "kilogramos"].includes(normalized)) return { base: "kg", factor: 1 };
    if (["g", "gramo", "gramos"].includes(normalized)) return { base: "kg", factor: 0.001 };
    if (["t", "ton", "tonelada", "toneladas"].includes(normalized))
      return { base: "kg", factor: 1000 };
    if (["l", "litro", "litros"].includes(normalized)) return { base: "L", factor: 1 };
    if (["ml", "mililitro", "mililitros"].includes(normalized)) return { base: "L", factor: 0.001 };
    return null;
  };
  const inferred = inferredConversion(product?.unit ?? "unidad");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const stockUnit = readString(form, "unit");
    const chosenEnvironmentalUnit =
      readString(form, "environmentalUnit") || inferredConversion(stockUnit)?.base;
    const conversionText = readString(form, "environmentalConversionFactor");
    const benchmarkFactorText = readString(form, "benchmarkOutputFactor");
    onSave({
      name: readString(form, "name"),
      type,
      unit: stockUnit,
      environmentalUnit: chosenEnvironmentalUnit || undefined,
      environmentalConversionFactor: conversionText
        ? readNumber(form, "environmentalConversionFactor")
        : inferredConversion(stockUnit)?.factor,
      benchmarkOutputUnit: type === "finished" && benchmarkFactorText ? "L" : undefined,
      benchmarkOutputFactor:
        type === "finished" && benchmarkFactorText
          ? readNumber(form, "benchmarkOutputFactor")
          : undefined,
      recycledContentPercent:
        type === "finished" || !readString(form, "recycledContentPercent")
          ? undefined
          : readNumber(form, "recycledContentPercent"),
      stock: product?.stock ?? readNumber(form, "stock"),
      minimumStock: readNumber(form, "minimumStock"),
      unitCost: readNumber(form, "unitCost"),
      unitPrice: readNumber(form, "unitPrice"),
      vatRate: readNumber(form, "vatRate"),
      taxCategory: readString(form, "taxCategory") as ProductTaxCategory,
    });
  }
  return (
    <Modal title={product ? "Editar producto" : "Agregar producto"} onClose={onClose} wide>
      <form className="modal-body" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Nombre" name="name" initialValue={product?.name ?? ""} required />
          <SelectField
            label="Tipo"
            name="type"
            initialValue={type}
            onChange={(value) => {
              if (value === "raw_material" || value === "supply" || value === "finished")
                setType(value);
            }}
            options={[
              { value: "raw_material", label: "Materia prima" },
              { value: "supply", label: "Insumo" },
              { value: "finished", label: "Producto terminado" },
            ]}
          />
          <Field
            label="Unidad (kg, unidad, L…)"
            name="unit"
            initialValue={product?.unit ?? "unidad"}
            required
          />
          {type !== "finished" && (
            <>
              <Field
                label="Unidad ambiental base (opcional)"
                name="environmentalUnit"
                initialValue={product?.environmentalUnit ?? inferred?.base ?? ""}
              />
              <Field
                label="Conversión a unidad base"
                name="environmentalConversionFactor"
                type="number"
                initialValue={product?.environmentalConversionFactor ?? inferred?.factor ?? ""}
                min="0.000001"
                step="any"
              />
              <Field
                label="Contenido reciclado del material (%)"
                name="recycledContentPercent"
                type="number"
                initialValue={product?.recycledContentPercent ?? ""}
                min="0"
                max="100"
                step="0.1"
              />
              <div className="field full">
                <span className="field-hint">
                  Convierte una unidad de inventario a kg o L (por ejemplo, 1 g = 0,001 kg). Sin
                  conversión, el material se conserva en su unidad de inventario y no se suma a
                  indicadores en kg.
                </span>
              </div>
            </>
          )}
          {product ? (
            <div className="field">
              <span>Existencia actual</span>
              <strong>
                {formatQuantity(product.stock, product.unit)}
              </strong>
              <span className="field-hint">
                Para conciliarla, registra un conteo físico y el motivo. La diferencia quedará en el historial de movimientos.
              </span>
            </div>
          ) : (
            <Field
              label="Existencia inicial"
              name="stock"
              type="number"
              initialValue={0}
              min="0"
              step="0.0001"
              required
            />
          )}
          {type === "finished" && (
            <>
              <Field
                label="Litros de producto terminado por unidad"
                name="benchmarkOutputFactor"
                type="number"
                initialValue={product?.benchmarkOutputFactor ?? ""}
                min="0.000001"
                step="any"
              />
              <div className="field full">
                <span className="field-hint">
                  Para comparar consumos por litro, indica cuántos litros contiene una unidad de
                  inventario (por ejemplo, una botella de 0,5 L). Sin conversión, no se calcula la
                  intensidad por litro.
                </span>
              </div>
            </>
          )}
          <Field
            label="Inventario mínimo"
            name="minimumStock"
            type="number"
            initialValue={product?.minimumStock ?? 0}
            min="0"
            step="0.0001"
            required
          />
          <Field
            label="Costo unitario COP"
            name="unitCost"
            type="number"
            initialValue={product?.unitCost ?? 0}
            min="0"
            step="1"
            required
          />
          <Field
            label="Precio de venta COP"
            name="unitPrice"
            type="number"
            initialValue={product?.unitPrice ?? 0}
            min="0"
            step="1"
            required
          />
          <Field
            label="IVA estimado (%)"
            name="vatRate"
            type="number"
            initialValue={product?.vatRate ?? 0}
            min="0"
            max="100"
            step="0.1"
            required
          />
          <SelectField
            label="Clasificación tributaria"
            name="taxCategory"
            initialValue={product?.taxCategory ?? "unclassified"}
            options={[
              { value: "unclassified", label: "Por clasificar (no se puede emitir)" },
              { value: "taxable", label: "Gravado con IVA" },
              { value: "exempt", label: "Exento" },
              { value: "excluded", label: "Excluido" },
              { value: "not_applicable", label: "No aplica" },
            ]}
          />
        </div>
        <ModalFooter onClose={onClose} submitLabel="Guardar producto" />
      </form>
    </Modal>
  );
}

export function RecipeForm({
  products,
  recipes,
  recipe,
  version,
  productId,
  onSave,
  onClose,
}: {
  products: Product[];
  recipes: Recipe[];
  recipe?: Recipe;
  version?: RecipeVersion;
  productId?: string;
  onSave: (input: RecipeVersionInput) => void;
  onClose: () => void;
}) {
  const materials = products.filter((product) => product.type !== "finished");
  const existingVersion =
    version ?? recipe?.versions.find((item) => item.id === recipe.activeVersionId);
  const eligibleFinishedProducts = products.filter(
    (product) =>
      product.type === "finished" &&
      (product.id === recipe?.productId ||
        product.id === productId ||
        !recipes.some((item) => item.productId === product.id)),
  );
  const [selectedProductId, setSelectedProductId] = useState(
    recipe?.productId ?? productId ?? eligibleFinishedProducts[0]?.id ?? "",
  );
  const [components, setComponents] = useState<RecipeComponent[]>(
    existingVersion?.components.length
      ? existingVersion.components.map((component) => ({ ...component }))
      : [{ productId: materials[0]?.id ?? "", quantity: 1 }],
  );
  function updateComponent(index: number, partial: Partial<RecipeComponent>) {
    setComponents((current) =>
      current.map((component, componentIndex) =>
        componentIndex === index ? { ...component, ...partial } : component,
      ),
    );
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    onSave({
      productId: selectedProductId,
      baseQuantity: readNumber(form, "baseQuantity"),
      expectedYieldPercent: readNumber(form, "expectedYieldPercent"),
      components: components.filter((component) => component.productId && component.quantity > 0),
      ...(version?.status === "draft" ? { versionId: version.id } : {}),
    });
  }
  const selectedProduct = products.find((product) => product.id === selectedProductId);
  return (
    <Modal title={version ? `Editar borrador v${version.versionNumber}` : recipe ? "Nueva versión de receta" : "Crear receta"} onClose={onClose} wide>
      <form className="modal-body" onSubmit={submit}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="recipe-product">Producto terminado</label>
            <select
              id="recipe-product"
              value={selectedProductId}
              onChange={(event) => setSelectedProductId(event.target.value)}
              required
              disabled={Boolean(recipe)}
            >
              <option value="">Selecciona un producto</option>
              {eligibleFinishedProducts.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} · {product.sku}
                </option>
              ))}
            </select>
          </div>
          <Field
            label={`Cantidad base del lote (${selectedProduct?.unit ?? "unidad"})`}
            name="baseQuantity"
            type="number"
            initialValue={existingVersion?.baseQuantity ?? 1}
            min="0.0001"
            step="0.0001"
            required
          />
          <Field
            label="Rendimiento esperado (%)"
            name="expectedYieldPercent"
            type="number"
            initialValue={existingVersion?.expectedYieldPercent ?? 100}
            min="0.01"
            max="100"
            step="0.01"
            required
          />
        </div>
        <div className="line-section">
          <div className="line-section-header">
            <strong>Materiales por lote base</strong>
            <button
              className="button button-secondary button-small"
              type="button"
              disabled={!materials.length}
              onClick={() =>
                setComponents((current) => [
                  ...current,
                  { productId: materials[0]?.id ?? "", quantity: 1 },
                ])
              }
            >
              ＋ Material
            </button>
          </div>
          {materials.length ? (
            components.map((component, index) => {
              const material = materials.find((item) => item.id === component.productId);
              return (
                <div className="line-row recipe-row" key={index}>
                  <select
                    aria-label="Material de receta"
                    value={component.productId}
                    onChange={(event) => updateComponent(index, { productId: event.target.value })}
                    required
                  >
                    <option value="">Selecciona un material</option>
                    {materials.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {item.unit}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label={`Cantidad de ${material?.name ?? "material"} por lote`}
                    type="number"
                    min="0.0001"
                    step="0.0001"
                    value={component.quantity}
                    onChange={(event) => updateComponent(index, { quantity: Number(event.target.value) })}
                    required
                  />
                  <span className="field-hint">{material?.unit ?? "unidad"}</span>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="Quitar material"
                    disabled={components.length <= 1}
                    onClick={() => setComponents((current) => current.filter((_, i) => i !== index))}
                  >
                    ×
                  </button>
                </div>
              );
            })
          ) : (
            <p className="field-hint">Registra materias primas o insumos antes de crear una receta.</p>
          )}
          <p className="field-hint">
            Las cantidades usan la unidad de inventario del material. El rendimiento estima la salida buena; la merma real se confirma al cerrar la orden.
          </p>
        </div>
        <ModalFooter onClose={onClose} submitLabel="Guardar borrador" disabled={!materials.length || !selectedProductId} />
      </form>
    </Modal>
  );
}

export function SaleForm({
  state,
  onSave,
  onClose,
}: {
  state: AppState;
  onSave: (input: SaleInput) => void;
  onClose: () => void;
}) {
  const customers = state.contacts.filter((contact) => contact.role !== "supplier");
  const products = state.products.filter((product) => product.type === "finished");
  const [lines, setLines] = useState<SaleLineInput[]>([
    { productId: "", quantity: 1, unitPrice: 0 },
  ]);
  const [discount, setDiscount] = useState(0);
  const [customerId, setCustomerId] = useState("");
  const [invoiceStatus, setInvoiceStatus] = useState<InvoiceFollowUpStatus>("to_review");
  const subtotal = lines.reduce((sum, line) => sum + line.quantity * (line.unitPrice ?? 0), 0);
  const rawVat = lines.reduce((sum, line) => {
    const product = products.find((item) => item.id === line.productId);
    return sum + (line.quantity * (line.unitPrice ?? 0) * (product?.vatRate ?? 0)) / 100;
  }, 0);
  const estimatedTotal = Math.round(
    Math.max(0, subtotal - discount) +
      (subtotal ? (rawVat * Math.max(0, subtotal - discount)) / subtotal : 0),
  );
  function updateLine(index: number, partial: Partial<SaleLineInput>) {
    setLines((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...partial } : line)),
    );
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    onSave({
      date: readString(form, "date"),
      customerId,
      lines: lines.filter((line) => line.productId),
      discount,
      initialPayment: readNumber(form, "initialPayment"),
      initialPaymentMethod: readString(form, "initialPaymentMethod"),
      initialPaymentAccountId: readString(form, "initialPaymentAccountId") || undefined,
      invoiceFollowUpStatus: invoiceStatus,
      externalInvoiceNumber: readString(form, "externalInvoiceNumber"),
      externalInvoiceDate: readString(form, "externalInvoiceDate"),
      dueDate: readString(form, "dueDate") || undefined,
    });
  }
  return (
    <Modal title="Registrar venta" onClose={onClose} wide>
      <form className="modal-body" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Fecha" name="date" type="date" initialValue={today()} required />
          <Field label="Vencimiento de saldo" name="dueDate" type="date" />
          <ContactSelect
            contacts={customers}
            role="customer"
            name="customerId"
            onChange={setCustomerId}
          />
          <div className="field full">
            <div className="line-section">
              <div className="line-section-header">
                <strong>Productos de esta venta</strong>
                <button
                  className="button button-secondary button-small"
                  type="button"
                  onClick={() =>
                    setLines((current) => [
                      ...current,
                      { productId: "", quantity: 1, unitPrice: 0 },
                    ])
                  }
                >
                  ＋ Producto
                </button>
              </div>
              {lines.map((line, index) => (
                <div className="line-row sale-line-row" key={index}>
                  <label className="sale-line-field sale-line-product">
                    <span>Producto</span>
                    <select
                      aria-label="Producto"
                      required
                      value={line.productId}
                      onChange={(event) => {
                        const product = products.find((item) => item.id === event.target.value);
                        updateLine(index, {
                          productId: event.target.value,
                          unitPrice: product?.unitPrice ?? 0,
                        });
                      }}
                    >
                      <option value="">Selecciona un producto</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name} ({formatQuantity(product.stock, product.unit)})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="sale-line-field">
                    <span>Cantidad</span>
                    <input
                      aria-label="Cantidad"
                      type="number"
                      min="0.0001"
                      step="0.0001"
                      value={line.quantity}
                      onChange={(event) =>
                        updateLine(index, { quantity: Number(event.target.value) })
                      }
                    />
                  </label>
                  <label className="sale-line-field">
                    <span>Precio unitario (COP)</span>
                    <input
                      aria-label="Precio unitario COP"
                      type="number"
                      min="0"
                      step="1"
                      value={line.unitPrice ?? 0}
                      onChange={(event) =>
                        updateLine(index, { unitPrice: Number(event.target.value) })
                      }
                    />
                  </label>
                  <button
                    className="icon-button sale-line-remove"
                    type="button"
                    aria-label="Quitar producto"
                    onClick={() =>
                      setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              <span className="field-hint">
                El precio y el IVA se proponen desde la ficha del producto.
              </span>
            </div>
          </div>
          <div className="field">
            <label htmlFor="sale-discount">Descuento COP</label>
            <input
              id="sale-discount"
              name="discount"
              type="number"
              min="0"
              step="1"
              value={discount}
              onChange={(event) => setDiscount(Number(event.target.value))}
            />
          </div>
          <Field
            label="Abono inicial COP"
            name="initialPayment"
            type="number"
            initialValue="0"
            min="0"
            step="1"
            required
          />
          <SelectField
            label="Medio del abono"
            name="initialPaymentMethod"
            options={["Efectivo", "Transferencia", "Tarjeta", "Otro"].map((value) => ({
              value,
              label: value,
            }))}
          />
          <SelectField
            label="Cuenta de caja o banco"
            name="initialPaymentAccountId"
            options={[
              { value: "", label: "Sin asignar" },
              ...state.financialAccounts
                .filter((account) => account.active)
                .map((account) => ({ value: account.id, label: account.name })),
            ]}
          />
          <SelectField
            label="Seguimiento de factura"
            name="invoiceFollowUpStatus"
            initialValue={invoiceStatus}
            onChange={(value) => {
              if (
                value === "to_review" ||
                value === "registered_externally" ||
                value === "not_applicable"
              )
                setInvoiceStatus(value);
            }}
            options={[
              { value: "to_review", label: "Por revisar" },
              { value: "registered_externally", label: "Registrada por fuera de Pyme360" },
              { value: "not_applicable", label: "No aplica, según revisión" },
            ]}
          />
          <Field label="Número externo (opcional)" name="externalInvoiceNumber" />
          <Field label="Fecha externa (opcional)" name="externalInvoiceDate" type="date" />
          <div className="field full">
            <div className="summary-total">
              <span>Estimación con descuento e IVA configurado</span>
              <strong>{formatMoney(estimatedTotal)}</strong>
            </div>
          </div>
        </div>
        <div className="notice">
          El IVA es una estimación configurable. El seguimiento de factura es manual y no transmite
          documentos.
        </div>
        <ModalFooter onClose={onClose} submitLabel="Guardar venta" />
      </form>
    </Modal>
  );
}

export function PurchaseForm({
  state,
  purchase,
  initialProductId,
  initialQuantity,
  initialStatus,
  onSave,
  onClose,
}: {
  state: AppState;
  purchase?: Purchase;
  initialProductId?: string;
  initialQuantity?: number;
  initialStatus?: PurchaseStatus;
  onSave: (input: PurchaseInput) => void;
  onClose: () => void;
}) {
  const suppliers = state.contacts.filter((contact) => contact.role !== "customer");
  const materials = state.products.filter((product) => product.type !== "finished");
  const [supplierId, setSupplierId] = useState(purchase?.supplierId ?? "");
  const [status, setStatus] = useState<PurchaseStatus>(purchase?.status ?? initialStatus ?? "received");
  const suggestedProduct = materials.find((product) => product.id === initialProductId);
  const suggestedQuantity = initialQuantity ?? 1;
  const [lines, setLines] = useState(
    purchase?.lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      lineTotal: line.lineTotal,
    })) ?? [{
      productId: suggestedProduct?.id ?? "",
      quantity: suggestedQuantity,
      lineTotal: Math.round(suggestedQuantity * (suggestedProduct?.unitCost ?? 0)),
    }],
  );
  const total = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  function changeLine(index: number, partial: Partial<(typeof lines)[number]>) {
    setLines((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...partial } : line)),
    );
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    onSave({
      date: readString(form, "date"),
      dueDate: readString(form, "dueDate") || undefined,
      supplierId,
      status,
      lines: lines.filter((line) => line.productId),
    });
  }
  return (
    <Modal
      title={purchase ? `Editar compra ${purchase.number}` : "Registrar compra"}
      onClose={onClose}
      wide
    >
      <form className="modal-body" onSubmit={submit}>
        <div className="form-grid">
          <Field
            label="Fecha"
            name="date"
            type="date"
            initialValue={purchase?.date ?? today()}
            required
          />
          <Field
            label="Vencimiento del pago"
            name="dueDate"
            type="date"
            initialValue={purchase?.dueDate ?? ""}
          />
          <ContactSelect
            contacts={suppliers}
            role="supplier"
            name="supplierId"
            value={supplierId}
            onChange={setSupplierId}
          />
          <SelectField
            label="Estado"
            name="status"
            initialValue={status}
            onChange={(value) => {
              if (value === "received" || value === "pending") setStatus(value);
            }}
            options={[
              { value: "received", label: "Recibida" },
              { value: "pending", label: "Por recibir" },
            ]}
          />
          <div className="field full">
            <div className="line-section">
              <div className="line-section-header">
                <strong>Materiales comprados</strong>
                <button
                  className="button button-secondary button-small"
                  type="button"
                  onClick={() =>
                    setLines((current) => [
                      ...current,
                      { productId: "", quantity: 1, lineTotal: 0 },
                    ])
                  }
                >
                  ＋ Material
                </button>
              </div>
              {lines.map((line, index) => (
                <div className="line-row" key={index}>
                  <select
                    aria-label="Material"
                    required
                    value={line.productId}
                    onChange={(event) => {
                      const product = materials.find((item) => item.id === event.target.value);
                      const lineTotal = Math.round(line.quantity * (product?.unitCost ?? 0));
                      changeLine(index, { productId: event.target.value, lineTotal });
                    }}
                  >
                    <option value="">Selecciona un material</option>
                    {materials.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name} · {product.sku} ({formatQuantity(product.stock, product.unit)}
                        )
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Cantidad"
                    type="number"
                    min="0.0001"
                    step="0.0001"
                    value={line.quantity}
                    onChange={(event) => {
                      const quantity = Number(event.target.value);
                      const product = materials.find((item) => item.id === line.productId);
                      changeLine(index, {
                        quantity,
                        lineTotal: Math.round(quantity * (product?.unitCost ?? 0)),
                      });
                    }}
                  />
                  <input
                    aria-label="Costo total COP"
                    type="number"
                    min="0"
                    step="1"
                    value={line.lineTotal}
                    onChange={(event) =>
                      changeLine(index, { lineTotal: Number(event.target.value) })
                    }
                  />
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="Quitar material"
                    onClick={() =>
                      setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              <span className="field-hint">
                El costo se registra por renglón. El costo sugerido del catálogo es una referencia: reemplázalo por el valor cotizado por el proveedor. Las compras por recibir no cambian las existencias.
              </span>
            </div>
          </div>
          <div className="field full">
            <div className="summary-total">
              <span>Total de compra</span>
              <strong>{formatMoney(total)}</strong>
            </div>
          </div>
        </div>
        <ModalFooter onClose={onClose} submitLabel="Guardar compra" />
      </form>
    </Modal>
  );
}

export function ProductionForm({
  products,
  recipes,
  initialProductId,
  initialQuantity,
  onSave,
  onClose,
}: {
  products: Product[];
  recipes: Recipe[];
  initialProductId?: string;
  initialQuantity?: number;
  onSave: (productId: string, quantity: number, date: string) => void;
  onClose: () => void;
}) {
  const available = products.filter((product) =>
    Boolean(
      recipes.find((recipe) => recipe.productId === product.id)?.versions.find(
        (version) => version.id === recipes.find((recipe) => recipe.productId === product.id)?.activeVersionId && version.status === "active",
      ),
    ),
  );
  const [selectedProductId, setSelectedProductId] = useState(
    available.find((product) => product.id === initialProductId)?.id ?? available[0]?.id ?? "",
  );
  const [quantity, setQuantity] = useState(initialQuantity ?? 1);
  const selectedProduct = available.find((product) => product.id === selectedProductId);
  const recipe = recipes.find((item) => item.productId === selectedProductId);
  const activeVersion = recipe?.versions.find(
    (version) => version.id === recipe.activeVersionId && version.status === "active",
  );
  const requirements = activeVersion ? calculateRecipeRequirements(activeVersion, quantity) : [];
  const estimate = estimateMaterialCost(
    products,
    requirements,
    activeVersion ? quantity * (activeVersion.expectedYieldPercent / 100) : undefined,
  );
  const shortageLines = requirements.flatMap((requirement) => {
    const material = products.find((product) => product.id === requirement.productId);
    if (!material || material.stock >= requirement.quantity) return [];
    return [{ material, quantity: requirement.quantity, shortfall: requirement.quantity - material.stock }];
  });
  const expectedGoodOutput = activeVersion
    ? Number((quantity * (activeVersion.expectedYieldPercent / 100)).toFixed(4))
    : 0;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    onSave(readString(form, "productId"), readNumber(form, "quantity"), readString(form, "date"));
  }
  return (
    <Modal title="Crear orden de producción" onClose={onClose}>
      <form className="modal-body" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Fecha" name="date" type="date" initialValue={today()} required />
          <div className="field">
            <label htmlFor="production-product">Producto terminado</label>
            <select
              id="production-product"
              name="productId"
              required
              value={selectedProductId}
              onChange={(event) => setSelectedProductId(event.target.value)}
            >
              <option value="">Selecciona un producto</option>
              {available.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} · {product.sku}
                </option>
              ))}
            </select>
          </div>
          <div className="grid min-w-0 gap-1.5">
            <label className="text-[0.875rem] font-semibold text-label" htmlFor="production-quantity">
              Unidades a producir
            </label>
            <input
              id="production-quantity"
              name="quantity"
              type="number"
              value={quantity}
              onChange={(event) => setQuantity(Number(event.target.value))}
              min="0.0001"
              step="0.0001"
              required
              className="min-h-10 w-full rounded-xl border border-control bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
            />
          </div>
        </div>
        {activeVersion && (
          <div className="panel-body">
            <p className="field-hint">
              Fórmula v{activeVersion.versionNumber}: lote base {formatQuantity(activeVersion.baseQuantity, selectedProduct?.unit)} · rendimiento esperado {formatNumber(activeVersion.expectedYieldPercent)} %.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Material</th><th>Requerido</th><th>Disponible</th><th>Estado</th></tr>
                </thead>
                <tbody>
                  {requirements.map((requirement) => {
                    const material = products.find((product) => product.id === requirement.productId);
                    if (!material) return null;
                    const shortfall = Math.max(0, requirement.quantity - material.stock);
                    return (
                      <tr key={requirement.productId}>
                        <td>{material.name}</td>
                        <td>{formatQuantity(requirement.quantity, material.unit)}</td>
                        <td>{formatQuantity(material.stock, material.unit)}</td>
                        <td>{shortfall > 0 ? `Faltan ${formatQuantity(shortfall, material.unit)}` : "Disponible"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <div className="notice production-cost-preview" aria-live="polite">
          <strong>Salida buena esperada</strong>
          <span>{activeVersion ? `${formatQuantity(expectedGoodOutput, selectedProduct?.unit)}` : "Sin receta activa"}</span>
        </div>
        <div className="notice production-cost-preview" aria-live="polite">
          <strong>Estimado directo de materiales</strong>
          {estimate.totalCost === null ? (
            <span>
              No disponible. Configura un costo unitario mayor que cero para: {estimate.missingCostProducts.join(", ") || "los materiales de la receta"}.
            </span>
          ) : (
            <span>
              {formatMoney(estimate.totalCost)} total · {estimate.costPerOutputUnit === null ? "costo por unidad no disponible" : `${formatMoney(estimate.costPerOutputUnit)} por unidad planeada`}
            </span>
          )}
          <span>Es un estimado basado en costos de catálogo; no incluye mano de obra, energía ni costos indirectos.</span>
        </div>
        <div className="notice">
          Al guardar la orden se descuentan los materiales de la receta. Al completarla, se registra
          el desperdicio y se suman las unidades buenas.
        </div>
        {shortageLines.length > 0 && (
          <div className="notice" role="alert">
            No se puede crear la orden: falta {shortageLines.map((line) => `${line.material.name} (${formatQuantity(line.shortfall, line.material.unit)})`).join(", ")}.
          </div>
        )}
        <ModalFooter onClose={onClose} submitLabel="Crear orden" disabled={!activeVersion || shortageLines.length > 0 || quantity <= 0} />
      </form>
    </Modal>
  );
}

// Lecturas y configuración ambiental
export function ResourceReadingForm({
  reading,
  products,
  onSave,
  onClose,
}: {
  reading?: ResourceReading;
  products: Product[];
  onSave: (input: ResourceReadingInput) => void;
  onClose: () => void;
}) {
  const [resource, setResource] = useState<ResourceKind>(reading?.resource ?? "electricity");
  const activities: Record<ResourceKind, Array<{ value: ReadingActivity; label: string }>> = {
    electricity: [{ value: "consumption", label: "Consumo" }],
    water: [
      { value: "withdrawal", label: "Retirada" },
      { value: "discharge", label: "Descarga" },
    ],
    fuel: [{ value: "consumption", label: "Consumo" }],
    material: [{ value: "consumption", label: "Consumido" }],
    waste: [
      { value: "generated", label: "Generado" },
      { value: "recovered", label: "Recuperado" },
    ],
  };
  const units: Record<ResourceKind, string> = {
    electricity: "kWh",
    water: "m³",
    fuel: "L",
    material: "kg",
    waste: "kg",
  };
  const currentMonthStart = `${currentMonth()}-01`;
  const currentMonthEnd = new Date(
    Date.UTC(Number(currentMonth().slice(0, 4)), Number(currentMonth().slice(5, 7)), 0),
  )
    .toISOString()
    .slice(0, 10);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const rawActivity = readString(form, "activity") as ReadingActivity;
    onSave({
      resource,
      activity: rawActivity,
      quantity: readNumber(form, "quantity"),
      unit: readString(form, "unit"),
      billedAmount: readString(form, "billedAmount")
        ? readNumber(form, "billedAmount")
        : undefined,
      periodStart: readString(form, "periodStart"),
      periodEnd: readString(form, "periodEnd"),
      siteId: "site-main",
      source: reading?.source ?? "manual",
      quality: readString(form, "quality") as ResourceReading["quality"],
      sourceLabel: readString(form, "sourceLabel") || "Registro manual",
      materialProductId: readString(form, "materialProductId") || undefined,
      receiptImportId: reading?.receiptImportId,
      externalReference: reading?.externalReference,
    });
  }
  return (
    <Modal
      title={reading ? "Editar lectura ambiental" : "Registrar lectura ambiental"}
      onClose={onClose}
    >
      <form className="modal-body" onSubmit={submit}>
        <div className="form-grid">
          <SelectField
            label="Recurso"
            name="resource"
            initialValue={resource}
            onChange={(value) => {
              if (["electricity", "water", "fuel", "material", "waste"].includes(value))
                setResource(value as ResourceKind);
            }}
            options={[
              { value: "electricity", label: "Energía eléctrica" },
              { value: "water", label: "Agua" },
              { value: "fuel", label: "Combustible" },
              { value: "material", label: "Material" },
              { value: "waste", label: "Residuo" },
            ]}
          />
          <SelectField
            key={`activity-${resource}`}
            label="Actividad"
            name="activity"
            initialValue={
              reading?.resource === resource ? reading.activity : activities[resource][0].value
            }
            options={activities[resource]}
          />
          <Field
            label="Cantidad"
            name="quantity"
            type="number"
            initialValue={reading?.quantity ?? 0}
            min="0"
            step="any"
            required
          />
          <Field
            key={`unit-${resource}`}
            label="Unidad"
            name="unit"
            initialValue={reading?.resource === resource ? reading.unit : units[resource]}
            required
          />
          {(resource === "electricity" || resource === "water") && (
            <Field
              label="Valor pagado en pesos (opcional)"
              name="billedAmount"
              type="number"
              initialValue={reading?.billedAmount ?? ""}
              min="0"
              step="any"
            />
          )}
          <Field
            label="Desde"
            name="periodStart"
            type="date"
            initialValue={reading?.periodStart ?? currentMonthStart}
            required
          />
          <Field
            label="Hasta"
            name="periodEnd"
            type="date"
            initialValue={reading?.periodEnd ?? currentMonthEnd}
            required
          />
          {resource === "material" && (
            <div className="field">
              <label htmlFor="materialProductId">Material del inventario (opcional)</label>
              <select
                id="materialProductId"
                name="materialProductId"
                defaultValue={reading?.materialProductId ?? ""}
              >
                <option value="">Sin asociar</option>
                {products
                  .filter((product) => product.type !== "finished")
                  .map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} · {product.unit}
                    </option>
                  ))}
              </select>
            </div>
          )}
          <SelectField
            label="Calidad del dato"
            name="quality"
            initialValue={reading?.quality ?? "confirmed"}
            options={[
              { value: "measured", label: "Medido por equipo" },
              { value: "confirmed", label: "Confirmado manualmente" },
              { value: "estimated", label: "Estimado" },
            ]}
          />
          <Field
            label="Fuente o documento"
            name="sourceLabel"
            initialValue={reading?.sourceLabel ?? "Registro manual"}
            required
          />
        </div>
        <div className="notice">
          Cada lectura queda separada por recurso y período. Para cambios en la factura, registra
          los días exactos del ciclo.
        </div>
        <ModalFooter
          onClose={onClose}
          submitLabel={reading ? "Guardar cambios" : "Guardar lectura"}
        />
      </form>
    </Modal>
  );
}

export function ReceiptReviewForm({
  extraction,
  fileName,
  onSave,
  onClose,
}: {
  extraction: ReceiptExtraction;
  fileName: string;
  onSave: (extraction: ReceiptExtraction) => void;
  onClose: () => void;
}) {
  const [resource, setResource] = useState<"electricity" | "water" | "fuel">(
    extraction.resource ?? "electricity",
  );
  const defaultUnits = { electricity: "kWh", water: "m³", fuel: "L" };
  const amountLabels = {
    electricity: "Valor de la energía (COP)",
    water: "Valor del agua (COP)",
    fuel: "Valor del combustible (COP)",
  };
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    onSave({
      ...extraction,
      period: readString(form, "period"),
      resource: readString(form, "resource") as "electricity" | "water" | "fuel",
      quantity: readNumber(form, "quantity"),
      unit: readString(form, "unit"),
      provider: readString(form, "provider"),
      invoiceNumber: readString(form, "invoiceNumber"),
      billedAmount: readNumber(form, "billedAmount"),
    });
  }
  return (
    <Modal title="Revisar recibo ambiental" onClose={onClose} wide>
      <form className="modal-body" onSubmit={submit}>
        <div className={`notice${extraction.warnings.length ? " warning" : ""}`}>
          <strong>
            {extraction.warnings.length
              ? "Revisa los datos antes de confirmar"
              : "Lectura local completada"}
          </strong>
          <p>
            Archivo: {fileName} · Confianza estimada: {formatNumber(extraction.confidence * 100, 0)}
            %. El archivo original no se guardará.
          </p>
          {extraction.warnings.length > 0 && (
            <ul>
              {extraction.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </div>
        {extraction.otherServicesDetected && (
          <div className="notice warning">
            Este recibo también cobra otros servicios. En el valor escribe solo lo de este servicio,
            sin aseo, alcantarillado ni otros cobros.
          </div>
        )}
        <div className="form-grid">
          <Field
            label="Período"
            name="period"
            type="month"
            initialValue={extraction.period || currentMonth()}
            required
          />
          <Field label="Proveedor" name="provider" initialValue={extraction.provider} required />
          <SelectField
            label="Recurso leído"
            name="resource"
            initialValue={resource}
            onChange={(value) => {
              if (value === "electricity" || value === "water" || value === "fuel")
                setResource(value);
            }}
            options={[
              { value: "electricity", label: "Energía eléctrica" },
              { value: "water", label: "Agua" },
              { value: "fuel", label: "Combustible" },
            ]}
          />
          <Field
            label="Consumo"
            name="quantity"
            type="number"
            initialValue={extraction.quantity ?? 0}
            min="0"
            step="any"
            required
          />
          <Field
            key={resource}
            label="Unidad"
            name="unit"
            initialValue={
              resource === extraction.resource
                ? (extraction.unit ?? defaultUnits[resource])
                : defaultUnits[resource]
            }
            required
          />
          <Field
            key={`amount-${resource}`}
            label={amountLabels[resource]}
            name="billedAmount"
            type="number"
            initialValue={extraction.billedAmount}
            min="0"
            step="1"
            required
          />
          <Field
            label="Número de factura"
            name="invoiceNumber"
            initialValue={extraction.invoiceNumber}
          />
        </div>
        <details>
          <summary>Ver texto leído</summary>
          <pre className="receipt-text-preview">
            {extraction.textPreview || "No se pudo extraer texto."}
          </pre>
        </details>
        <ModalFooter onClose={onClose} submitLabel="Confirmar y guardar" />
      </form>
    </Modal>
  );
}

const indicatorOptions: Array<{ value: IndicatorId; label: string }> = [
  { value: "energy-intensity", label: "Intensidad de energía" },
  { value: "water-intensity", label: "Intensidad de agua" },
  { value: "material-intensity", label: "Material por unidad" },
  { value: "recycled-material-share", label: "Material reciclado" },
  { value: "waste-recovery", label: "Recuperación de residuos" },
  { value: "scope-1", label: "Emisiones Alcance 1" },
  { value: "scope-2", label: "Emisiones Alcance 2" },
  { value: "scope-3", label: "Emisiones Alcance 3" },
  { value: "data-coverage", label: "Cobertura de datos" },
];

export function IndicatorTargetForm({
  target,
  onSave,
  onClose,
}: {
  target?: IndicatorTarget;
  onSave: (input: IndicatorTargetInput) => void;
  onClose: () => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    onSave({
      indicatorId: readString(form, "indicatorId") as IndicatorId,
      direction: readString(form, "direction") as "decrease" | "increase",
      horizonMonths: Number(readString(form, "horizonMonths")) as 6 | 18 | 36,
      baselinePeriod: readString(form, "baselinePeriod"),
      baselineValue: readNumber(form, "baselineValue"),
      reductionPercent: readNumber(form, "reductionPercent"),
      approvedAt:
        new FormData(form).get("approved") === "on" ? new Date().toISOString() : undefined,
    });
  }
  return (
    <Modal title={target ? "Editar meta ambiental" : "Nueva meta ambiental"} onClose={onClose}>
      <form className="modal-body" onSubmit={submit}>
        <div className="form-grid">
          <SelectField
            label="Indicador"
            name="indicatorId"
            initialValue={target?.indicatorId ?? "energy-intensity"}
            options={indicatorOptions}
          />
          <SelectField
            label="Horizonte"
            name="horizonMonths"
            initialValue={String(target?.horizonMonths ?? 6)}
            options={[
              { value: "6", label: "6 meses" },
              { value: "18", label: "18 meses" },
              { value: "36", label: "36 meses" },
            ]}
          />
          <Field
            label="Período de línea base"
            name="baselinePeriod"
            type="month"
            initialValue={target?.baselinePeriod ?? currentMonth()}
            required
          />
          <SelectField
            label="Dirección de la meta"
            name="direction"
            initialValue={
              target?.direction ??
              (["recycled-material-share", "waste-recovery", "data-coverage"].includes(
                target?.indicatorId ?? "",
              )
                ? "increase"
                : "decrease")
            }
            options={[
              { value: "decrease", label: "Reducir" },
              { value: "increase", label: "Aumentar" },
            ]}
          />
          <Field
            label="Valor de línea base"
            name="baselineValue"
            type="number"
            initialValue={target?.baselineValue ?? 0}
            min="0"
            step="any"
            required
          />
          <Field
            label="Cambio objetivo (% o puntos porcentuales)"
            name="reductionPercent"
            type="number"
            initialValue={
              target?.reductionPercent ??
              (target?.horizonMonths === 36 ? 17 : target?.horizonMonths === 18 ? 10 : 4)
            }
            min="0"
            max="99.9"
            step="0.1"
            required
          />
          <div className="field full">
            <label className="check-field">
              <input name="approved" type="checkbox" defaultChecked={Boolean(target?.approvedAt)} />{" "}
              Línea base validada y aprobada
            </label>
            <span className="field-hint">
              Sin aprobación, la meta se muestra como provisional y no calcula avance.
            </span>
          </div>
        </div>
        <ModalFooter onClose={onClose} submitLabel="Guardar meta" />
      </form>
    </Modal>
  );
}

export function EmissionFactorForm({
  factor,
  onSave,
  onClose,
}: {
  factor?: import("../domain/types").EmissionFactor;
  onSave: (input: EmissionFactorInput) => void;
  onClose: () => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    onSave({
      scope: Number(readString(form, "scope")) as 1 | 2 | 3,
      activity: readString(form, "activity") as
        "electricity" | "fuel" | "material_purchase" | "waste" | "transport",
      kgCo2ePerUnit: readNumber(form, "kgCo2ePerUnit"),
      activityUnit: readString(form, "activityUnit"),
      geography: readString(form, "geography"),
      year: readNumber(form, "year"),
      version: readString(form, "version"),
      source: readString(form, "source"),
      method: readString(form, "method"),
    });
  }
  return (
    <Modal
      title={factor ? "Editar factor de emisión" : "Agregar factor de emisión"}
      onClose={onClose}
    >
      <form className="modal-body" onSubmit={submit}>
        <div className="form-grid">
          <SelectField
            label="Alcance"
            name="scope"
            initialValue={String(factor?.scope ?? 2)}
            options={[
              { value: "1", label: "Alcance 1 · directo" },
              { value: "2", label: "Alcance 2 · electricidad" },
              { value: "3", label: "Alcance 3 · cadena de valor" },
            ]}
          />
          <SelectField
            label="Actividad"
            name="activity"
            initialValue={factor?.activity ?? "electricity"}
            options={[
              { value: "electricity", label: "Electricidad" },
              { value: "fuel", label: "Combustible" },
              { value: "material_purchase", label: "Compra de materiales" },
              { value: "waste", label: "Residuos" },
              { value: "transport", label: "Transporte" },
            ]}
          />
          <Field
            label="kg CO₂e por unidad"
            name="kgCo2ePerUnit"
            type="number"
            initialValue={factor?.kgCo2ePerUnit ?? 0}
            min="0"
            step="any"
            required
          />
          <Field
            label="Unidad de actividad"
            name="activityUnit"
            initialValue={factor?.activityUnit ?? "kWh"}
            required
          />
          <Field
            label="Ubicación"
            name="geography"
            initialValue={factor?.geography ?? "Colombia SIN"}
            required
          />
          <Field
            label="Año del factor"
            name="year"
            type="number"
            initialValue={factor?.year ?? new Date().getFullYear()}
            min="2000"
            max="2200"
            required
          />
          <Field label="Versión" name="version" initialValue={factor?.version ?? "v1"} required />
          <Field
            label="Fuente documental"
            name="source"
            initialValue={factor?.source ?? ""}
            required
          />
          <Field label="Método" name="method" initialValue={factor?.method ?? ""} required />
        </div>
        <div className="notice">
          Pyme360 usa un factor solo si coinciden año, unidad y ubicación. Registra la fuente y
          versión para hacer los cálculos reproducibles.
        </div>
        <ModalFooter onClose={onClose} submitLabel="Guardar factor" />
      </form>
    </Modal>
  );
}

export function EnvironmentalActionForm({
  initial,
  onSave,
  onClose,
}: {
  initial?: { title: string; indicatorId: IndicatorId; notes: string };
  onSave: (input: EnvironmentalActionInput) => void;
  onClose: () => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    onSave({
      indicatorId: readString(form, "indicatorId") as IndicatorId,
      title: readString(form, "title"),
      owner: readString(form, "owner"),
      dueDate: readString(form, "dueDate"),
      notes: readString(form, "notes"),
    });
  }
  return (
    <Modal title="Nueva acción ambiental" onClose={onClose}>
      <form className="modal-body" onSubmit={submit}>
        <div className="form-grid">
          <SelectField
            label="Indicador asociado"
            name="indicatorId"
            initialValue={initial?.indicatorId}
            options={indicatorOptions}
          />
          <Field label="Acción" name="title" initialValue={initial?.title} required />
          <Field label="Responsable" name="owner" required />
          <Field label="Fecha límite" name="dueDate" type="date" required />
          <Field label="Notas" name="notes" initialValue={initial?.notes} />
        </div>
        <ModalFooter onClose={onClose} submitLabel="Crear acción" />
      </form>
    </Modal>
  );
}

export function EnvironmentalConfigForm({
  config,
  onSave,
  onClose,
}: {
  config?: EnvironmentalConfig;
  onSave: (config: EnvironmentalConfig) => void;
  onClose: () => void;
}) {
  const defaultProfile = {
    countryCode: "CO",
    region: "Antioquia",
    sectorCode: "1104",
    outputUnit: "L",
    assumedMonthlyOutput: 100000,
    preferredSources: ["dane-eai", "xm", "unsd", "eia-mecs", "company-public"],
  };
  const profile = config?.benchmarking ?? defaultProfile;
  const [preferredSources, setPreferredSources] = useState(profile.preferredSources);
  const sourceOptions = [
    ["dane-eai", "DANE · Encuesta Ambiental Industrial"],
    ["sui-energy", "Superservicios · SUI energía"],
    ["xm", "XM/Sinergox"],
    ["unsd", "ONU · Indicadores ODS"],
    ["eia-mecs", "EIA · MECS manufactura"],
    ["company-public", "Referencia empresarial pública"],
  ];
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    onSave({
      providerId: "local-receipt",
      providerName: readString(form, "providerName"),
      accountNumber: readString(form, "accountNumber"),
      businessUnit: readString(form, "businessUnit"),
      geography: readString(form, "geography") || "Colombia SIN",
      benchmarking: {
        countryCode: readString(form, "benchmarkCountry") || "CO",
        region: readString(form, "benchmarkRegion") || "Antioquia",
        sectorCode: readString(form, "benchmarkSector") || "1104",
        outputUnit: "L",
        assumedMonthlyOutput: readNumber(form, "assumedMonthlyOutput"),
        preferredSources,
      },
    });
  }
  return (
    <Modal title="Configuración de consumo" onClose={onClose}>
      <form className="modal-body" onSubmit={submit}>
        <div className="form-grid">
          <Field
            label="Proveedor"
            name="providerName"
            initialValue={config?.providerName ?? "Enel Colombia"}
            required
          />
          <Field
            label="Número de cuenta (opcional)"
            name="accountNumber"
            initialValue={config?.accountNumber ?? ""}
          />
          <Field
            label="Unidad de negocio"
            name="businessUnit"
            initialValue={config?.businessUnit ?? ""}
          />
          <Field
            label="Ubicación del factor"
            name="geography"
            initialValue={config?.geography ?? "Colombia SIN"}
            required
          />
          <Field
            label="País para referencias"
            name="benchmarkCountry"
            initialValue={profile.countryCode}
            required
          />
          <Field
            label="Región para referencias"
            name="benchmarkRegion"
            initialValue={profile.region}
            required
          />
          <Field
            label="Sector CIIU"
            name="benchmarkSector"
            initialValue={profile.sectorCode}
            required
          />
          <Field
            label="Producción mensual ilustrativa (L)"
            name="assumedMonthlyOutput"
            type="number"
            initialValue={profile.assumedMonthlyOutput}
            min="0"
            step="1"
            required
          />
        </div>
        <div className="field full">
          <span>Fuentes preferidas para mostrar primero</span>
          <div className="form-grid">
            {sourceOptions.map(([sourceId, label]) => (
              <label className="check-field" key={sourceId}>
                <input
                  type="checkbox"
                  checked={preferredSources.includes(sourceId)}
                  onChange={(event) =>
                    setPreferredSources((current) =>
                      event.target.checked
                        ? [...current, sourceId]
                        : current.filter((item) => item !== sourceId),
                    )
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <span className="field-hint">
            El volumen mensual es solo un supuesto de demostración; nunca reemplaza la producción
            registrada ni se usa en los indicadores.
          </span>
        </div>
        <div className="notice">
          La cuenta solo sirve como referencia local. Pyme360 no inicia sesión ni consulta
          credenciales del proveedor.
        </div>
        <ModalFooter onClose={onClose} submitLabel="Guardar configuración" />
      </form>
    </Modal>
  );
}

// Pagos, caja y ajustes de inventario
export function PaymentForm({
  sale,
  balance,
  accounts,
  onSave,
  onClose,
}: {
  sale: Sale;
  balance: number;
  accounts: FinancialAccount[];
  onSave: (amount: number, date: string, method: string, accountId?: string) => void;
  onClose: () => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    onSave(
      readNumber(form, "amount"),
      readString(form, "date"),
      readString(form, "method"),
      readString(form, "accountId") || undefined,
    );
  }
  return (
    <Modal title={`Registrar abono · ${sale.number}`} onClose={onClose}>
      <form className="modal-body" onSubmit={submit}>
        <div className="notice">
          Saldo pendiente: <strong>{formatMoney(balance)}</strong>
        </div>
        <div className="form-grid">
          <Field label="Fecha" name="date" type="date" initialValue={today()} required />
          <Field
            label="Valor del abono COP"
            name="amount"
            type="number"
            initialValue={balance}
            min="1"
            max={balance}
            step="1"
            required
          />
          <SelectField
            label="Medio de pago"
            name="method"
            options={["Efectivo", "Transferencia", "Tarjeta", "Otro"].map((value) => ({
              value,
              label: value,
            }))}
          />
          <SelectField
            label="Cuenta de caja o banco"
            name="accountId"
            options={[
              { value: "", label: "Sin asignar" },
              ...accounts
                .filter((account) => account.active)
                .map((account) => ({ value: account.id, label: account.name })),
            ]}
          />
        </div>
        <ModalFooter onClose={onClose} submitLabel="Guardar abono" />
      </form>
    </Modal>
  );
}

export function PurchasePaymentForm({
  purchase,
  accounts,
  balance,
  onSave,
  onClose,
}: {
  purchase: Purchase;
  accounts: FinancialAccount[];
  balance: number;
  onSave: (amount: number, date: string, method: string, accountId?: string) => void;
  onClose: () => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    onSave(
      readNumber(form, "amount"),
      readString(form, "date"),
      readString(form, "method"),
      readString(form, "accountId") || undefined,
    );
  }
  return (
    <Modal title={`Registrar pago · ${purchase.number}`} onClose={onClose}>
      <form className="modal-body" onSubmit={submit}>
        <div className="notice">
          Saldo pendiente: <strong>{formatMoney(balance)}</strong>
        </div>
        <div className="form-grid">
          <Field label="Fecha" name="date" type="date" initialValue={today()} required />
          <Field
            label="Valor del pago COP"
            name="amount"
            type="number"
            initialValue={balance}
            min="1"
            max={balance}
            step="1"
            required
          />
          <SelectField
            label="Medio de pago"
            name="method"
            options={["Efectivo", "Transferencia", "Tarjeta", "Otro"].map((value) => ({
              value,
              label: value,
            }))}
          />
          <SelectField
            label="Cuenta de caja o banco"
            name="accountId"
            options={[
              { value: "", label: "Sin asignar" },
              ...accounts
                .filter((account) => account.active)
                .map((account) => ({ value: account.id, label: account.name })),
            ]}
          />
        </div>
        <ModalFooter onClose={onClose} submitLabel="Guardar pago" />
      </form>
    </Modal>
  );
}

export function FinancialAccountForm({
  onSave,
  onClose,
}: {
  onSave: (name: string, type: FinancialAccount["type"], openingBalance: number) => void;
  onClose: () => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    onSave(
      readString(form, "name"),
      readString(form, "type") as FinancialAccount["type"],
      readNumber(form, "openingBalance"),
    );
  }
  return (
    <Modal title="Nueva cuenta de caja o banco" onClose={onClose}>
      <form className="modal-body" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Nombre de la cuenta" name="name" required />
          <SelectField
            label="Tipo"
            name="type"
            options={[
              { value: "cash", label: "Caja" },
              { value: "bank", label: "Banco" },
            ]}
          />
          <Field
            label="Saldo inicial COP"
            name="openingBalance"
            type="number"
            initialValue="0"
            min="0"
            step="1"
            required
          />
        </div>
        <div className="notice">
          Este saldo es el punto de partida del control interno; no se concilia automáticamente con
          el extracto bancario.
        </div>
        <ModalFooter onClose={onClose} submitLabel="Crear cuenta" />
      </form>
    </Modal>
  );
}

export function ManualCashMovementForm({
  accounts,
  onSave,
  onClose,
}: {
  accounts: FinancialAccount[];
  onSave: (input: {
    accountId?: string;
    direction: CashMovementDirection;
    amount: number;
    date: string;
    method: string;
    category: string;
    description: string;
  }) => void;
  onClose: () => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    onSave({
      accountId: readString(form, "accountId") || undefined,
      direction: readString(form, "direction") as CashMovementDirection,
      amount: readNumber(form, "amount"),
      date: readString(form, "date"),
      method: readString(form, "method"),
      category: readString(form, "category"),
      description: readString(form, "description"),
    });
  }
  return (
    <Modal title="Registrar movimiento de dinero" onClose={onClose}>
      <form className="modal-body" onSubmit={submit}>
        <div className="form-grid">
          <SelectField
            label="Tipo de movimiento"
            name="direction"
            options={[
              { value: "in", label: "Ingreso" },
              { value: "out", label: "Egreso" },
            ]}
          />
          <SelectField
            label="Cuenta"
            name="accountId"
            required
            options={accounts
              .filter((account) => account.active)
              .map((account) => ({ value: account.id, label: account.name }))}
          />
          <Field label="Fecha" name="date" type="date" initialValue={today()} required />
          <Field label="Valor COP" name="amount" type="number" min="1" step="1" required />
          <Field label="Categoría" name="category" required />
          <SelectField
            label="Medio"
            name="method"
            options={["Efectivo", "Transferencia", "Tarjeta", "Otro"].map((value) => ({
              value,
              label: value,
            }))}
          />
          <Field label="Descripción" name="description" required />
        </div>
        <ModalFooter onClose={onClose} submitLabel="Guardar movimiento" />
      </form>
    </Modal>
  );
}

export function LegacyPayableReviewForm({
  purchase,
  onSave,
  onClose,
}: {
  purchase: Purchase;
  onSave: (amount: number, dueDate: string) => void;
  onClose: () => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    onSave(readNumber(form, "amount"), readString(form, "dueDate"));
  }
  return (
    <Modal title={`Conciliar compra ${purchase.number}`} onClose={onClose}>
      <form className="modal-body" onSubmit={submit}>
        <div className="notice warning">
          No se registraron pagos históricos. Indica el saldo realmente pendiente al iniciar el
          control financiero.
        </div>
        <div className="form-grid">
          <Field
            label="Saldo pendiente confirmado COP"
            name="amount"
            type="number"
            initialValue={purchase.total}
            min="0"
            max={purchase.total}
            step="1"
            required
          />
          <Field
            label="Fecha de vencimiento (opcional)"
            name="dueDate"
            type="date"
            initialValue={purchase.dueDate ?? ""}
          />
        </div>
        <ModalFooter onClose={onClose} submitLabel="Confirmar saldo" />
      </form>
    </Modal>
  );
}

export function StockForm({
  product,
  onSave,
  onClose,
}: {
  product: Product;
  onSave: (countedQuantity: number, reason: string) => void;
  onClose: () => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(readNumber(event.currentTarget, "countedQuantity"), readString(event.currentTarget, "reason"));
  }
  return (
    <Modal title={`Conteo físico · ${product.name}`} onClose={onClose}>
      <form className="modal-body" onSubmit={submit}>
        <div className="notice">
          Saldo en sistema:{" "}
          <strong>
            {formatQuantity(product.stock, product.unit)}
          </strong>
          . Registra la cantidad que encontraste físicamente.
        </div>
        <div className="form-grid">
          <Field
            label={`Cantidad contada (${product.unit})`}
            name="countedQuantity"
            type="number"
            initialValue={product.stock}
            min="0"
            step="0.0001"
            required
          />
          <Field label="Motivo o referencia del conteo" name="reason" initialValue="Conteo físico" required />
        </div>
        <ModalFooter onClose={onClose} submitLabel="Conciliar existencia" />
      </form>
    </Modal>
  );
}

export function CompleteProductionForm({
  order,
  onSave,
  onClose,
}: {
  order: ProductionOrder;
  onSave: (wasteQuantity: number, date: string) => void;
  onClose: () => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(
      readNumber(event.currentTarget, "wasteQuantity"),
      readString(event.currentTarget, "completedAt"),
    );
  }
  return (
    <Modal title={`Completar orden ${order.number}`} onClose={onClose}>
      <form className="modal-body" onSubmit={submit}>
        <div className="notice">
          Se procesaron {formatNumber(order.quantity)} unidades de {order.productName}.
        </div>
        <div className="form-grid">
          <Field
            label="Unidades de desperdicio"
            name="wasteQuantity"
            type="number"
            initialValue="0"
            min="0"
            max={order.quantity}
            step="0.0001"
            required
          />
          <Field
            label="Fecha de finalización"
            name="completedAt"
            type="date"
            initialValue={today()}
            required
          />
        </div>
        <ModalFooter onClose={onClose} submitLabel="Completar y sumar al inventario" />
      </form>
    </Modal>
  );
}

function ModalFooter({
  onClose,
  submitLabel,
  disabled = false,
}: {
  onClose: () => void;
  submitLabel: string;
  disabled?: boolean;
}) {
  return (
    <div className="modal-footer">
      <button className="button button-secondary" type="button" onClick={onClose}>
        Cancelar
      </button>
      <button className="button button-primary" type="submit" disabled={disabled}>
        {submitLabel}
      </button>
    </div>
  );
}
