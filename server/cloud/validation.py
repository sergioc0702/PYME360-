"""Business invariants for the central synchronization boundary.

This module is intentionally independent of FastAPI and PostgreSQL so the
same validation can be exercised with ordinary unittest fixtures.
"""

from __future__ import annotations

import math
import re
from datetime import date
from typing import Any


class BusinessValidationError(ValueError):
    """Raised when a synchronized workspace would violate a business rule."""


def _number(record: dict, key: str, label: str, *, minimum: float | None = None, maximum: float | None = None) -> float:
    try:
        value = float(record[key])
    except (KeyError, TypeError, ValueError) as exc:
        raise BusinessValidationError(f"{label} debe ser un número válido.") from exc
    if not math.isfinite(value) or (minimum is not None and value < minimum) or (maximum is not None and value > maximum):
        raise BusinessValidationError(f"{label} está fuera del rango permitido.")
    return value


def _records(records: dict[str, dict[str, dict]], entity_type: str) -> dict[str, dict]:
    return records.get(entity_type, {})


def _date(value: Any, label: str) -> None:
    if not isinstance(value, str):
        raise BusinessValidationError(f"{label} debe ser una fecha ISO válida.")
    try:
        date.fromisoformat(value[:10])
    except ValueError as exc:
        raise BusinessValidationError(f"{label} debe ser una fecha ISO válida.") from exc


def validate_business_records(records: dict[str, dict[str, dict]]) -> None:
    """Validate the full resulting state after applying an atomic change batch."""
    products = _records(records, "products")
    contacts = _records(records, "contacts")
    sales = _records(records, "sales")
    purchases = _records(records, "purchases")
    orders = _records(records, "productionOrders")
    accounts = _records(records, "financialAccounts")
    recipes = _records(records, "recipes")

    for product_id, product in products.items():
        _number(product, "stock", f"Existencia del producto {product_id}", minimum=0)
        _number(product, "minimumStock", f"Mínimo del producto {product_id}", minimum=0)
        for key in ("unitCost", "unitPrice"):
            if key in product:
                _number(product, key, f"{key} del producto {product_id}", minimum=0)
        if "vatRate" in product:
            _number(product, "vatRate", f"IVA del producto {product_id}", minimum=0, maximum=100)

    seen_recipe_products: set[str] = set()
    for recipe in recipes.values():
        product_id = str(recipe.get("productId", ""))
        finished = products.get(product_id)
        versions = recipe.get("versions")
        if not finished or finished.get("type") != "finished" or not isinstance(versions, list) or not versions:
            raise BusinessValidationError("Una receta debe pertenecer a un producto terminado y conservar versiones.")
        if product_id in seen_recipe_products:
            raise BusinessValidationError("Un producto terminado no puede tener recetas duplicadas.")
        seen_recipe_products.add(product_id)
        version_ids: set[str] = set()
        version_numbers: set[int] = set()
        active_ids: list[str] = []
        for version in versions:
            if not isinstance(version, dict):
                raise BusinessValidationError("Una versión de receta no tiene un formato válido.")
            version_id = str(version.get("id", ""))
            try:
                raw_number = version.get("versionNumber")
                if isinstance(raw_number, bool):
                    raise ValueError
                version_number = int(raw_number)
            except (TypeError, ValueError) as exc:
                raise BusinessValidationError("El número de versión de receta no es válido.") from exc
            if not version_id or version_id in version_ids or version_number < 1 or version_number in version_numbers:
                raise BusinessValidationError("Las versiones de receta deben tener identificadores y números únicos.")
            version_ids.add(version_id)
            version_numbers.add(version_number)
            status = version.get("status")
            if status not in {"draft", "active", "archived"}:
                raise BusinessValidationError("El estado de una versión de receta no es válido.")
            if status == "active":
                active_ids.append(version_id)
            _number(version, "baseQuantity", "Cantidad base de receta", minimum=0.0000001)
            _number(version, "expectedYieldPercent", "Rendimiento esperado", minimum=0.0000001, maximum=100)
            components = version.get("components")
            if not isinstance(components, list) or not components:
                raise BusinessValidationError("Cada versión de receta debe incluir materiales.")
            component_ids: set[str] = set()
            for component in components:
                if not isinstance(component, dict):
                    raise BusinessValidationError("Un componente de receta no tiene un formato válido.")
                material_id = str(component.get("productId", ""))
                material = products.get(material_id)
                if not material or material.get("type") == "finished" or material_id == product_id:
                    raise BusinessValidationError("Una receta solo puede utilizar materiales o insumos existentes.")
                if material_id in component_ids:
                    raise BusinessValidationError("Una versión no puede repetir el mismo material.")
                component_ids.add(material_id)
                _number(component, "quantity", "Cantidad de componente", minimum=0.0000001)
        active_version_id = recipe.get("activeVersionId")
        if (active_version_id is None and active_ids) or (
            active_version_id is not None
            and (active_ids != [str(active_version_id)] or str(active_version_id) not in version_ids)
        ):
            raise BusinessValidationError("La receta debe apuntar a su única versión activa o no tener versión activa.")

    # Validate the immutable stock book in its recorded order, not just the sum.
    movement_totals = {product_id: 0.0 for product_id in products}
    for movement in _records(records, "inventoryMovements").values():
        product_id = str(movement.get("productId", ""))
        if product_id not in products:
            raise BusinessValidationError("Un movimiento de inventario refiere a un producto inexistente.")
        quantity = _number(movement, "quantity", "Cantidad de un movimiento")
        if abs(quantity) >= 1e15 or quantity == 0:
            raise BusinessValidationError("Un movimiento de inventario no puede tener cantidad cero.")
        balance_after = _number(movement, "balanceAfter", "Saldo posterior de un movimiento", minimum=0)
        if balance_after - quantity < -0.0001:
            raise BusinessValidationError("Un movimiento de inventario no puede partir de existencias negativas.")
        movement_totals[product_id] += quantity
    for product_id, product in products.items():
        stock = _number(product, "stock", f"Existencia del producto {product_id}", minimum=0)
        if abs(movement_totals[product_id] - stock) > 0.0001:
            raise BusinessValidationError("Las existencias no coinciden con el libro de movimientos de inventario.")

    for account_id, account in accounts.items():
        _number(account, "openingBalance", f"Saldo inicial de la cuenta {account_id}", minimum=0)

    for sale_id, sale in sales.items():
        customer_id = str(sale.get("customerId", ""))
        if customer_id and customer_id not in contacts:
            raise BusinessValidationError("Una venta refiere a un cliente inexistente.")
        lines = sale.get("lines")
        if not isinstance(lines, list) or not lines:
            raise BusinessValidationError("Una venta debe incluir por lo menos un producto.")
        line_total = subtotal_total = discount_total = vat_total = 0.0
        for line in lines:
            if not isinstance(line, dict) or str(line.get("productId", "")) not in products:
                raise BusinessValidationError("Una línea de venta refiere a un producto inexistente.")
            _number(line, "quantity", "Cantidad vendida", minimum=0.0000001)
            subtotal_total += _number(line, "subtotal", "Subtotal de venta", minimum=0)
            discount_total += _number(line, "discountShare", "Descuento de venta", minimum=0)
            vat_total += _number(line, "vatAmount", "IVA de venta", minimum=0)
            total = _number(line, "total", "Total de línea", minimum=0)
            if abs(total - (float(line["subtotal"]) - float(line["discountShare"]) + float(line["vatAmount"]))) > 0.02:
                raise BusinessValidationError("El total de una línea de venta no coincide con su subtotal, descuento e IVA.")
            line_total += total
        sale_subtotal = _number(sale, "subtotal", "Subtotal de venta", minimum=0)
        sale_discount = _number(sale, "discount", "Descuento de venta", minimum=0)
        sale_vat = _number(sale, "vatAmount", "IVA de venta", minimum=0)
        total = _number(sale, "total", "Total de venta", minimum=0)
        if abs(subtotal_total - sale_subtotal) > 0.02 or abs(discount_total - sale_discount) > 0.02 or abs(vat_total - sale_vat) > 0.02 or abs(line_total - total) > 0.02:
            raise BusinessValidationError(f"Los valores de la venta {sale_id} no cuadran con su detalle.")
        paid = 0.0
        payments = sale.get("payments", [])
        if not isinstance(payments, list):
            raise BusinessValidationError("Los pagos de una venta no tienen un formato válido.")
        for payment in payments:
            if not isinstance(payment, dict):
                raise BusinessValidationError("Un pago de venta no tiene un formato válido.")
            amount = _number(payment, "amount", "Valor de un abono", minimum=0.0000001)
            paid += amount
            account_id = str(payment.get("accountId", ""))
            if account_id and account_id not in accounts:
                raise BusinessValidationError("Un abono refiere a una cuenta de caja o banco inexistente.")
            if payment.get("date"):
                _date(payment["date"], "Fecha de pago")
        if paid > total + 0.0001:
            raise BusinessValidationError("Los pagos de una venta superan su valor total.")

    for purchase_id, purchase in purchases.items():
        supplier_id = str(purchase.get("supplierId", ""))
        if supplier_id and supplier_id not in contacts:
            raise BusinessValidationError("Una compra refiere a un proveedor inexistente.")
        lines = purchase.get("lines")
        if not isinstance(lines, list) or not lines:
            raise BusinessValidationError("Una compra debe incluir por lo menos un producto.")
        line_total = 0.0
        for line in lines:
            if not isinstance(line, dict) or str(line.get("productId", "")) not in products:
                raise BusinessValidationError("Una línea de compra refiere a un producto inexistente.")
            _number(line, "quantity", "Cantidad comprada", minimum=0.0000001)
            line_total += _number(line, "lineTotal", "Valor de línea de compra", minimum=0)
        total = _number(purchase, "total", "Total de compra", minimum=0)
        if abs(total - line_total) > 0.02:
            raise BusinessValidationError(f"El total de la compra {purchase_id} no coincide con sus líneas.")
        payable_amount = _number(purchase, "payableAmount", "Saldo histórico por pagar", minimum=0) if purchase.get("payableAmount") is not None else total
        paid = 0.0
        payments = purchase.get("payments", [])
        if not isinstance(payments, list):
            raise BusinessValidationError("Los pagos de una compra no tienen un formato válido.")
        for payment in payments:
            if not isinstance(payment, dict):
                raise BusinessValidationError("Un pago de compra no tiene un formato válido.")
            paid += _number(payment, "amount", "Pago de compra", minimum=0.0000001)
            account_id = str(payment.get("accountId", ""))
            if account_id and account_id not in accounts:
                raise BusinessValidationError("Un pago de compra refiere a una cuenta inexistente.")
        if paid > payable_amount + 0.0001:
            raise BusinessValidationError("Los pagos de una compra superan el saldo reconocido.")

    for movement in _records(records, "cashMovements").values():
        amount = _number(movement, "amount", "Valor de un movimiento de caja", minimum=0.0000001)
        if amount >= 1e15 or movement.get("direction") not in {"in", "out"}:
            raise BusinessValidationError("Un movimiento de caja tiene dirección o valor no válido.")
        account_id = str(movement.get("accountId", ""))
        if account_id and account_id not in accounts:
            raise BusinessValidationError("Un movimiento de caja refiere a una cuenta inexistente.")
        if movement.get("date"):
            _date(movement["date"], "Fecha del movimiento de caja")

    for order in orders.values():
        if str(order.get("productId", "")) not in products:
            raise BusinessValidationError("Una orden de producción refiere a un producto inexistente.")
        _number(order, "quantity", "Cantidad de producción", minimum=0.0000001)
        _number(order, "wasteQuantity", "Desperdicio de producción", minimum=0)
        for key, label in (
            ("estimatedMaterialCost", "Costo estimado de materiales"),
            ("materialCostPerGoodUnit", "Costo de materiales por unidad buena"),
            ("laborHours", "Horas trabajadas"),
            ("laborHourlyRate", "Costo por hora"),
            ("energyCost", "Energía asignada"),
            ("overheadCost", "Otros costos de producción"),
        ):
            if key in order and order[key] is not None:
                _number(order, key, label, minimum=0)
        for material in order.get("consumedMaterials", []):
            if not isinstance(material, dict) or str(material.get("productId", "")) not in products:
                raise BusinessValidationError("Una orden de producción refiere a un material inexistente.")
            _number(material, "quantity", "Material consumido", minimum=0.0000001)
            for key, label in (
                ("unitCostSnapshot", "Costo unitario registrado del material"),
                ("lineCostSnapshot", "Costo registrado del material consumido"),
                ("actualQuantity", "Cantidad real consumida"),
            ):
                if key in material and material[key] is not None:
                    _number(material, key, label, minimum=0)

    for reading in _records(records, "resourceReadings").values():
        quantity = _number(reading, "quantity", "Consumo ambiental", minimum=0)
        if reading.get("billedAmount") is not None:
            _number(reading, "billedAmount", "Valor pagado", minimum=0)
        if quantity >= 1e15 or not reading.get("unit"):
            raise BusinessValidationError("Una lectura ambiental requiere unidad y cantidad válida.")
        start = reading.get("periodStart")
        end = reading.get("periodEnd")
        _date(start, "Inicio del período ambiental")
        _date(end, "Fin del período ambiental")
        if end < start:
            raise BusinessValidationError("El período ambiental termina antes de iniciar.")
        if reading.get("materialProductId") and reading["materialProductId"] not in products:
            raise BusinessValidationError("Una lectura ambiental refiere a un material inexistente.")

    for record in _records(records, "environmentalRecords").values():
        for key in ("electricityKwh", "waterM3", "fuelLiters", "productionUnits", "wasteKg", "recoveredKg"):
            _number(record, key, f"{key} en el registro ambiental", minimum=0)
        if float(record["recoveredKg"]) > float(record["wasteKg"]) + 0.0001:
            raise BusinessValidationError("El residuo aprovechado no puede superar el generado.")
        if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", str(record.get("period", ""))):
            raise BusinessValidationError("El período del registro ambiental debe usar AAAA-MM.")

    for factor in _records(records, "emissionFactors").values():
        _number(factor, "kgCo2ePerUnit", "Factor de emisión", minimum=0)
        year = _number(factor, "year", "Año del factor", minimum=1900, maximum=date.today().year + 2)
        if year != int(year) or not factor.get("activityUnit") or not factor.get("version") or not factor.get("source"):
            raise BusinessValidationError("El factor de emisión requiere año entero, unidad, versión y fuente.")

    for target in _records(records, "indicatorTargets").values():
        _number(target, "baselineValue", "Línea base de meta", minimum=0)
        _number(target, "reductionPercent", "Porcentaje de meta", minimum=0, maximum=100)
        if target.get("horizonMonths") not in {6, 18, 36}:
            raise BusinessValidationError("El horizonte de una meta debe ser 6, 18 o 36 meses.")

    for receipt in _records(records, "receiptImports").values():
        extraction = receipt.get("extraction")
        if not isinstance(extraction, dict):
            raise BusinessValidationError("Un recibo requiere datos de extracción confirmados.")
        if "textPreview" in extraction:
            raise BusinessValidationError("El texto OCR temporal no puede almacenarse en la nube.")
        if extraction.get("billedAmount") is not None:
            _number(extraction, "billedAmount", "Valor facturado", minimum=0)
        if extraction.get("confidence") is not None:
            _number(extraction, "confidence", "Confianza del recibo", minimum=0, maximum=1)

    for invoice in _records(records, "supplierInvoices").values():
        if invoice.get("purchaseId") and invoice["purchaseId"] not in purchases:
            raise BusinessValidationError("Una factura de proveedor refiere a una compra inexistente.")
        if invoice.get("supplierContactId") and invoice["supplierContactId"] not in contacts:
            raise BusinessValidationError("Una factura de proveedor refiere a un contacto inexistente.")
        _number(invoice, "total", "Total de factura de proveedor", minimum=0)
        _number(invoice, "taxAmount", "IVA de factura de proveedor", minimum=0)

    for document in _records(records, "electronicDocuments").values():
        if document.get("status") != "draft" or document.get("documentNumber") or document.get("cufe"):
            raise BusinessValidationError("La sincronización aún no admite estados de facturación DIAN transmitidos.")
        if str(document.get("saleId", "")) not in sales:
            raise BusinessValidationError("Un borrador tributario refiere a una venta inexistente.")

    for extra in _records(records, "importExtras").values():
        entity_type = str(extra.get("entityType", ""))
        entity_id = str(extra.get("entityId", ""))
        if entity_id not in _records(records, entity_type):
            raise BusinessValidationError("Un campo importado adicional no pertenece a un registro existente.")
