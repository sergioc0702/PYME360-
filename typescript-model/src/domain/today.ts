import { outstandingBalance } from "./business";
import type { AppState } from "./types";

export type TaskTarget =
  | "company"
  | "contact"
  | "product"
  | "reading"
  | "sales"
  | "purchases"
  | "inventory"
  | "production";

export interface TodayTask {
  id: string;
  title: string;
  reason: string;
  actionLabel: string;
  target: TaskTarget;
  /** Lo que ya está atrasado o frena otros datos va primero. */
  urgent: boolean;
}

const money = (value: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(value);

const quantity = (value: number) =>
  new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(value);

const monthName = (period: string) =>
  new Intl.DateTimeFormat("es-CO", { month: "long", timeZone: "UTC" }).format(
    new Date(`${period}-15T12:00:00Z`),
  );

function previousPeriod(date: string): string {
  const [year, month] = date.split("-").map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

function unitOf(state: AppState, productId: string, amount: number): string {
  const unit = state.products.find((product) => product.id === productId)?.unit ?? "unidad";
  return unit === "unidad" && amount !== 1 ? "unidades" : unit;
}

/** Lo que la empresa debería resolver hoy, sacado de sus propios datos. */
export function buildTodayTasks(state: AppState, today: string): TodayTask[] {
  const tasks: TodayTask[] = [];
  if (!state.company)
    tasks.push({
      id: "company",
      title: "Completa los datos de tu empresa",
      reason: "Con el nombre sabrás en qué empresa estás trabajando",
      actionLabel: "Completar",
      target: "company",
      urgent: true,
    });

  const period = previousPeriod(today);
  const hasReading = (resource: "electricity" | "water") =>
    state.resourceReadings.some(
      (reading) => reading.resource === resource && reading.periodEnd.slice(0, 7) === period,
    );
  if (!hasReading("electricity"))
    tasks.push({
      id: "energy-reading",
      title: `Registra el recibo de energía de ${monthName(period)}`,
      reason: `Sin ese dato no vemos tu ahorro de ${monthName(period)}`,
      actionLabel: "Registrar",
      target: "reading",
      urgent: true,
    });
  if (!hasReading("water"))
    tasks.push({
      id: "water-reading",
      title: `Registra el recibo de agua de ${monthName(period)}`,
      reason: `Sin ese dato no vemos tu ahorro de ${monthName(period)}`,
      actionLabel: "Registrar",
      target: "reading",
      urgent: false,
    });

  for (const sale of state.sales) {
    const balance = outstandingBalance(sale, state.electronicDocuments);
    if (balance > 0 && sale.dueDate && sale.dueDate < today)
      tasks.push({
        id: `sale-${sale.id}`,
        title: `Cobra a ${sale.customerName} ${money(balance)}`,
        reason: `La venta ${sale.number} ya venció`,
        actionLabel: "Cobrar",
        target: "sales",
        urgent: true,
      });
  }

  for (const product of state.products) {
    if (product.minimumStock <= 0 || product.stock >= product.minimumStock) continue;
    const finished = product.type === "finished";
    tasks.push({
      id: `stock-${product.id}`,
      title: `${finished ? "Produce" : "Compra"} ${product.name}: quedan ${quantity(product.stock)} ${product.unit}`,
      reason: `Tu mínimo es ${quantity(product.minimumStock)} ${product.unit}`,
      actionLabel: finished ? "Producir" : "Comprar",
      target: finished ? "production" : "purchases",
      urgent: product.stock <= 0,
    });
  }

  for (const purchase of state.purchases)
    if (purchase.status === "pending")
      tasks.push({
        id: `purchase-${purchase.id}`,
        title: `Recibe la compra ${purchase.number} de ${purchase.supplierName}`,
        reason: "Al recibirla se suma a tu inventario",
        actionLabel: "Recibir",
        target: "purchases",
        urgent: false,
      });

  for (const order of state.productionOrders)
    if (order.status === "active")
      tasks.push({
        id: `order-${order.id}`,
        title: `Termina la orden de ${quantity(order.quantity)} ${unitOf(state, order.productId, order.quantity)} de ${order.productName}`,
        reason: "Al terminarla sabrás cuánto te costó",
        actionLabel: "Terminar",
        target: "production",
        urgent: false,
      });

  if (!state.products.length)
    tasks.push({
      id: "first-product",
      title: "Agrega tu primer producto",
      reason: "Lo que vendes y los materiales que usas",
      actionLabel: "Agregar",
      target: "product",
      urgent: false,
    });
  if (!state.contacts.length)
    tasks.push({
      id: "first-contact",
      title: "Agrega tu primer cliente o proveedor",
      reason: "Lo necesitas para registrar ventas y compras",
      actionLabel: "Agregar",
      target: "contact",
      urgent: false,
    });

  return tasks.sort((left, right) => Number(right.urgent) - Number(left.urgent));
}
