"""Validation of proposed changes to Pyme360 local state."""

from __future__ import annotations

import math

from cloud.quotation_validation import colombian_date, quotation_state_error, quoted_quantities
from cloud.sale_returns import sale_returns_error

TYPESCRIPT_MODEL_SCHEMA_VERSION = 7


def operator_change_error(previous: dict, updated: dict) -> str | None:
    editable_sections = {
        "contacts", "products", "recipes", "sales", "quotations", "purchases", "productionOrders",
        "environmentalRecords", "resourceReadings", "environmentalActions",
        "receiptImports", "inventoryMovements", "cashMovements", "importExtras",
        "electronicDocuments", "supplierInvoices",
    }
    for key in set(previous) | set(updated):
        migration_default = (
            int(previous.get("schemaVersion", 0) or 0) < TYPESCRIPT_MODEL_SCHEMA_VERSION
            and key in {"environmentalConfig", "inventoryMovements", "financialAccounts", "cashMovements", "taxConfiguration", "electronicDocuments", "supplierInvoices"}
            and key not in previous
        )
        if key == "environmentalConfig" and int(previous.get("schemaVersion", 0) or 0) < 5:
            old_config = previous.get("environmentalConfig")
            new_config = updated.get("environmentalConfig")
            if isinstance(old_config, dict) and isinstance(new_config, dict):
                migrated_config = dict(new_config)
                migrated_config.pop("benchmarking", None)
                migration_default = migrated_config == old_config
        if previous.get(key) != updated.get(key) and key not in editable_sections and key not in {"schemaVersion"} and not migration_default:
            return f"El rol operador no puede modificar la sección {key}."

    for section in editable_sections:
        before_rows = previous.get(section, [])
        after_rows = updated.get(section, [])
        if not isinstance(before_rows, list) or not isinstance(after_rows, list):
            continue
        before_ids = {str(row.get("id")) for row in before_rows if isinstance(row, dict) and row.get("id") is not None}
        after_by_id = {str(row.get("id")): row for row in after_rows if isinstance(row, dict) and row.get("id") is not None}
        if before_ids - after_by_id.keys():
            return f"Solo el administrador puede eliminar registros de {section}."

    before_extras = {
        str(extra.get("id")): extra
        for extra in previous.get("importExtras", [])
        if isinstance(extra, dict) and extra.get("id") is not None
    }
    for extra in updated.get("importExtras", []):
        if not isinstance(extra, dict):
            return "Los campos adicionales deben ser registros válidos."
        if before_extras.get(str(extra.get("id"))) == extra:
            continue
        owner_section = extra.get("entityType")
        if owner_section not in editable_sections or owner_section == "importExtras":
            return "El rol operador no puede importar campos adicionales de esta sección."
        owner_rows = updated.get(owner_section, [])
        if not any(isinstance(row, dict) and str(row.get("id")) == str(extra.get("entityId")) for row in owner_rows):
            return "Los campos adicionales deben pertenecer a un registro existente de una sección editable."

    for section in ("inventoryMovements", "cashMovements"):
        before_rows = previous.get(section, [])
        after_rows = updated.get(section, [])
        if isinstance(before_rows, list) and isinstance(after_rows, list) and after_rows[:len(before_rows)] != before_rows:
            return "Los libros de movimientos son inmutables; registra una reversión para corregir un dato."

    for section in ("electronicDocuments", "supplierInvoices"):
        before_rows = previous.get(section, [])
        after_rows = updated.get(section, [])
        if not isinstance(before_rows, list) or not isinstance(after_rows, list):
            return f"La sección {section} debe conservar el formato de lista."
        if len(after_rows) < len(before_rows) or after_rows[:len(before_rows)] != before_rows:
            return "Los documentos tributarios y sus importaciones se conservan como historial; no se editan ni eliminan desde el estado general."

    previous_electronic_documents = previous.get("electronicDocuments", [])
    for document in updated.get("electronicDocuments", [])[len(previous_electronic_documents):]:
        if document.get("status") != "draft":
            return "El estado de aceptación solo puede cambiar desde un conector autorizado; el estado general crea borradores."
        if document.get("documentNumber") or document.get("providerReference") or document.get("cufe") or document.get("attempts"):
            return "Solo un conector autorizado puede asignar número, respuesta o intentos de transmisión."

    # On first v2 to v3 migration stock is preserved while opening balances are added.
    if int(previous.get("schemaVersion", 0) or 0) >= TYPESCRIPT_MODEL_SCHEMA_VERSION:
        before_stock = {str(row.get("id")): float(row.get("stock", 0) or 0) for row in previous.get("products", []) if isinstance(row, dict)}
        after_stock = {str(row.get("id")): float(row.get("stock", 0) or 0) for row in updated.get("products", []) if isinstance(row, dict)}
        appended_movements = updated.get("inventoryMovements", [])[len(previous.get("inventoryMovements", [])):]
        movement_delta: dict[str, float] = {}
        for movement in appended_movements:
            if isinstance(movement, dict):
                product_id = str(movement.get("productId", ""))
                movement_delta[product_id] = movement_delta.get(product_id, 0) + float(movement.get("quantity", 0) or 0)
        for product_id in before_stock.keys() | after_stock.keys():
            stock_change = after_stock.get(product_id, 0) - before_stock.get(product_id, 0)
            if abs(stock_change - movement_delta.get(product_id, 0)) > 0.0001:
                return "Cada cambio de existencia debe estar respaldado por un movimiento de inventario."
    return None


NON_NEGATIVE_FIELDS = {
    "products": ("stock", "minimumStock", "unitCost", "unitPrice", "vatRate"),
    "sales": ("discount", "total"),
    "purchases": ("total",),
    "cashMovements": ("amount",),
    "productionOrders": ("laborHours", "laborHourlyRate", "energyCost", "overheadCost"),
}
NON_NEGATIVE_LINE_FIELDS = {
    "sales": ("quantity", "unitPrice"),
    "purchases": ("quantity", "lineTotal"),
    "productionOrders": ("actualQuantity",),
}


def invalid_amount(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return True
    return not math.isfinite(value) or value < 0


def business_value_error(previous: dict, updated: dict) -> str | None:
    """Reject negative amounts in new or edited rows; stored rows are left alone."""
    for section, fields in NON_NEGATIVE_FIELDS.items():
        before_rows = previous.get(section, [])
        after_rows = updated.get(section, [])
        if not isinstance(before_rows, list) or not isinstance(after_rows, list):
            continue
        before_by_id = {str(row.get("id")): row for row in before_rows if isinstance(row, dict)}
        for row in after_rows:
            if not isinstance(row, dict) or before_by_id.get(str(row.get("id"))) == row:
                continue
            line_key = "consumedMaterials" if section == "productionOrders" else "lines"
            lines = row.get(line_key) if isinstance(row.get(line_key), list) else []
            line_fields = NON_NEGATIVE_LINE_FIELDS.get(section, ())
            if (
                any(invalid_amount(row.get(field)) for field in fields)
                or any(
                    isinstance(line, dict) and invalid_amount(line.get(field))
                    for line in lines
                    for field in line_fields
                )
            ):
                return f"Hay un valor negativo o no numérico en {section}; corrígelo antes de guardar."
    return None


SALE_LOCKED_FIELDS = (
    "number", "date", "customerId", "customerName", "lines", "subtotal", "discount", "vatAmount", "total",
)
MONEY_TOLERANCE = 1


def number_or_zero(value: object) -> float:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0.0


def rows_by_id(state: dict, section: str) -> dict[str, dict]:
    rows = state.get(section, [])
    if not isinstance(rows, list):
        return {}
    return {str(row.get("id")): row for row in rows if isinstance(row, dict)}


def local_quotation_error(previous: dict, updated: dict, *, linked: bool, restoring: bool) -> str | None:
    old_quotes = rows_by_id(previous, "quotations")
    quotes = rows_by_id(updated, "quotations")
    sales = rows_by_id(updated, "sales")
    if len(quotes) != len(updated.get("quotations", [])):
        return "Cada cotización debe tener un identificador único."
    if restoring and linked and old_quotes != quotes:
        return "Recupera las cotizaciones de este respaldo en una instalación sin vincular."
    issue = quotation_state_error(
        old_quotes, quotes, sales, conversion_allowed=not linked, restoring=restoring,
    )
    if issue or restoring:
        return issue
    company = updated.get("company")
    if quotes.keys() - old_quotes.keys() and not (
        isinstance(company, dict) and isinstance(company.get("name"), str) and company["name"].strip()
    ):
        return "Configura tu empresa antes de cotizar."
    old_sales = rows_by_id(previous, "sales")
    products = rows_by_id(previous, "products")
    contacts = rows_by_id(previous, "contacts")
    movements = updated.get("inventoryMovements", [])[len(previous.get("inventoryMovements", [])):]
    for sale_id in sales.keys() - old_sales.keys():
        sale = sales[sale_id]
        if not sale.get("quotationId"):
            continue
        quote = old_quotes.get(sale["quotationId"])
        if not quote or quote.get("saleId") or sale["date"] != colombian_date():
            return "La cotización ya se convirtió o su fecha de conversión no es válida."
        contact = contacts.get(quote["customerId"])
        if not contact or contact.get("role") == "supplier":
            return "El cliente de la cotización ya no está disponible para ventas."
        expected = quoted_quantities(quote)
        for product_id, quantity in expected.items():
            product = products.get(product_id)
            if not product or product.get("type") != "finished" or quantity > float(product.get("stock", 0)):
                return "El producto cotizado ya no está disponible o no tiene existencias suficientes."
        sale_movements = [item for item in movements if item.get("sourceId") == sale_id]
        if len(sale_movements) != len(expected) or any(
            movement.get("sourceType") != "sale" or movement.get("movementType") != "sale"
            or movement.get("productId") not in expected
            or abs(float(movement.get("quantity", 0)) + expected[movement["productId"]]) > 0.0001
            for movement in sale_movements
        ) or {movement["productId"] for movement in sale_movements} != expected.keys():
            return "Las salidas de inventario no coinciden con los productos cotizados."
    return None


def payments_of(row: dict) -> list[dict]:
    payments = row.get("payments")
    return [payment for payment in payments if isinstance(payment, dict)] if isinstance(payments, list) else []


def sale_adjustments(state: dict, sale_id: str) -> float:
    """Las notas aceptadas cambian lo que se puede cobrar, igual que en outstandingBalance."""
    total = 0.0
    for document in rows_by_id(state, "electronicDocuments").values():
        if (
            str(document.get("saleId")) != sale_id
            or document.get("status") not in {"accepted", "delivered"}
            or document.get("kind") == "invoice"
        ):
            continue
        snapshot = document.get("snapshot") if isinstance(document.get("snapshot"), dict) else {}
        amount = document.get("adjustmentAmount")
        amount = number_or_zero(snapshot.get("total") if amount is None else amount)
        total += -amount if document.get("kind") == "credit_note" else amount
    return total


def new_payments_error(
    before: dict | None,
    row: dict,
    direction: str,
    limit: float | None,
    updated: dict,
    used_movements: set[str],
    role: str,
) -> str | None:
    number = row.get("number") or row.get("id")
    payments = payments_of(row)
    current_by_id = {str(payment.get("id")): payment for payment in payments}
    previous_payments = payments_of(before) if before else []
    for payment in previous_payments:
        if current_by_id.get(str(payment.get("id"))) != payment:
            return f"Los pagos ya registrados de {number} no se cambian ni se eliminan."
    known = {str(payment.get("id")) for payment in previous_payments}
    new_payments = [payment for payment in payments if str(payment.get("id")) not in known]
    if not new_payments:
        return None
    if limit is not None and sum(number_or_zero(p.get("amount")) for p in payments) > limit + 0.01:
        return f"Los pagos de {number} superan su saldo."
    movements = rows_by_id(updated, "cashMovements")
    for payment in new_payments:
        amount = payment.get("amount")
        if invalid_amount(amount) or number_or_zero(amount) <= 0:
            return f"Un pago de {number} no tiene un valor válido."
        movement_id = str(payment.get("cashMovementId") or "")
        if not movement_id:
            # El historial importado por un administrador puede no tener caja asociada.
            if role == "admin":
                continue
            return f"Cada pago de {number} debe tener su entrada o salida de dinero."
        movement = movements.get(movement_id)
        if (
            movement is None
            or movement.get("direction") != direction
            or abs(number_or_zero(movement.get("amount")) - number_or_zero(amount)) > 0.01
            or movement_id in used_movements
        ):
            return f"El pago de {number} no coincide con su entrada o salida de dinero."
        used_movements.add(movement_id)
    return None


def payment_integrity_error(previous: dict, updated: dict, role: str) -> str | None:
    """Las ventas no se editan después de creadas y cada pago debe poder explicarse."""
    if int(previous.get("schemaVersion", 0) or 0) < TYPESCRIPT_MODEL_SCHEMA_VERSION:
        return None
    used_movements = {
        str(payment.get("cashMovementId"))
        for section in ("sales", "purchases")
        for row in rows_by_id(previous, section).values()
        for payment in payments_of(row)
        if payment.get("cashMovementId")
    }
    previous_sales = rows_by_id(previous, "sales")
    for sale_id, sale in rows_by_id(updated, "sales").items():
        before = previous_sales.get(sale_id)
        if before == sale:
            continue
        number = sale.get("number") or sale_id
        if before is not None:
            if any(before.get(field) != sale.get(field) for field in SALE_LOCKED_FIELDS):
                return f"La venta {number} no se puede modificar después de registrada."
        else:
            lines = sale.get("lines") if isinstance(sale.get("lines"), list) else []
            totals = [line.get("total") for line in lines if isinstance(line, dict)]
            if (
                lines
                and len(totals) == len(lines)
                and all(isinstance(value, (int, float)) for value in totals)
                and abs(sum(totals) - number_or_zero(sale.get("total"))) > MONEY_TOLERANCE
            ):
                return f"El total de la venta {number} no coincide con sus productos."
        limit = number_or_zero(sale.get("total")) + sale_adjustments(updated, sale_id) + sum(
            item["refund"] - item["total"] for item in sale.get("returns", [])
        )
        error = new_payments_error(before, sale, "in", limit, updated, used_movements, role)
        if error:
            return error
    previous_purchases = rows_by_id(previous, "purchases")
    for purchase_id, purchase in rows_by_id(updated, "purchases").items():
        before = previous_purchases.get(purchase_id)
        if before == purchase:
            continue
        limit = None
        if purchase.get("payableReviewStatus") != "review_required":
            amount = purchase.get("payableAmount")
            limit = number_or_zero(purchase.get("total") if amount is None else amount)
        error = new_payments_error(before, purchase, "out", limit, updated, used_movements, role)
        if error:
            return error
    return None


def local_sale_returns_error(previous: dict, updated: dict) -> str | None:
    return sale_returns_error(
        rows_by_id(previous, "sales"), rows_by_id(updated, "sales"),
        rows_by_id(updated, "inventoryMovements"), rows_by_id(updated, "cashMovements"),
        {item.get("saleId") for item in rows_by_id(updated, "electronicDocuments").values()
         if isinstance(item.get("saleId"), str)},
    )


def is_unsent_draft(document: object) -> bool:
    """Only a draft that never reached a provider may leave the document history."""
    return (
        isinstance(document, dict)
        and document.get("status") == "draft"
        and not document.get("attempts")
        and not document.get("documentNumber")
        and not document.get("providerReference")
        and not document.get("cufe")
    )


def removed_electronic_documents(previous: dict, updated: dict) -> list:
    before_rows = previous.get("electronicDocuments", [])
    after_rows = updated.get("electronicDocuments", [])
    if not isinstance(before_rows, list) or not isinstance(after_rows, list):
        return []
    after_ids = {str(row.get("id")) for row in after_rows if isinstance(row, dict)}
    return [row for row in before_rows if isinstance(row, dict) and str(row.get("id")) not in after_ids]


def ledger_change_error(previous: dict, updated: dict) -> str | None:
    """Protect append-only books and require stock changes to match their ledger."""
    previous_electronic_documents = previous.get("electronicDocuments", [])
    updated_electronic_documents = updated.get("electronicDocuments", [])
    if not isinstance(previous_electronic_documents, list) or not isinstance(updated_electronic_documents, list):
        return "La sección electronicDocuments debe conservar el formato de lista."
    known_document_ids = {
        str(document.get("id")) for document in previous_electronic_documents if isinstance(document, dict)
    }
    for document in updated_electronic_documents:
        if isinstance(document, dict) and str(document.get("id")) not in known_document_ids:
            if document.get("status") != "draft":
                return "El estado de aceptación solo puede cambiar desde un conector autorizado; el estado general crea borradores."
            if document.get("documentNumber") or document.get("providerReference") or document.get("cufe") or document.get("attempts"):
                return "Solo un conector autorizado puede asignar número, respuesta o intentos de transmisión."
    if int(previous.get("schemaVersion", 0) or 0) < TYPESCRIPT_MODEL_SCHEMA_VERSION:
        # The v2 -> v3 migration creates the opening-balance ledger from current stock.
        return None

    for section in ("inventoryMovements", "cashMovements"):
        before_rows = previous.get(section, [])
        after_rows = updated.get(section, [])
        if not isinstance(before_rows, list) or not isinstance(after_rows, list):
            return f"La sección {section} debe conservar el formato de lista."
        if len(after_rows) < len(before_rows) or after_rows[:len(before_rows)] != before_rows:
            return "Los libros de movimientos son inmutables; registra una reversión para corregir un dato."

    removed_documents = removed_electronic_documents(previous, updated)
    if any(not is_unsent_draft(document) for document in removed_documents):
        return "Solo se puede eliminar un borrador que nunca se haya enviado al proveedor."
    removed_document_ids = {str(document.get("id")) for document in removed_documents}
    for section in ("electronicDocuments", "supplierInvoices"):
        before_rows = previous.get(section, [])
        after_rows = updated.get(section, [])
        if not isinstance(before_rows, list) or not isinstance(after_rows, list):
            return f"La sección {section} debe conservar el formato de lista."
        if section == "electronicDocuments":
            before_rows = [
                row for row in before_rows
                if not isinstance(row, dict) or str(row.get("id")) not in removed_document_ids
            ]
        if len(after_rows) < len(before_rows) or after_rows[:len(before_rows)] != before_rows:
            return "Los documentos tributarios y sus importaciones se conservan como historial; no se editan ni eliminan desde el estado general."

    before_products = previous.get("products", [])
    after_products = updated.get("products", [])
    if not isinstance(before_products, list) or not isinstance(after_products, list):
        return "El inventario debe conservar el formato de lista."
    try:
        before_stock = {
            str(row.get("id")): float(row.get("stock", 0) or 0)
            for row in before_products if isinstance(row, dict)
        }
        after_stock = {
            str(row.get("id")): float(row.get("stock", 0) or 0)
            for row in after_products if isinstance(row, dict)
        }
    except (TypeError, ValueError):
        return "Un producto contiene una existencia no válida."
    if any(not math.isfinite(stock) for stock in (*before_stock.values(), *after_stock.values())):
        return "Un producto contiene una existencia no válida."
    before_movements = previous.get("inventoryMovements", [])
    appended_movements = updated.get("inventoryMovements", [])[len(before_movements):]
    movement_delta: dict[str, float] = {}
    running_stock = dict(before_stock)
    for movement in appended_movements:
        if isinstance(movement, dict):
            product_id = str(movement.get("productId", ""))
            try:
                quantity = float(movement.get("quantity", 0) or 0)
                balance_after = float(movement.get("balanceAfter", 0) or 0)
            except (TypeError, ValueError):
                return "Un movimiento de inventario contiene cantidades no válidas."
            if not math.isfinite(quantity) or not math.isfinite(balance_after):
                return "Un movimiento de inventario contiene cantidades no válidas."
            if product_id not in after_stock:
                return "Un movimiento de inventario debe pertenecer a un producto existente."
            balance = running_stock.get(product_id, 0) + quantity
            if balance < -0.0001:
                return "Un movimiento no puede dejar existencias negativas."
            if abs(balance - balance_after) > 0.0001:
                return "El saldo posterior del movimiento no coincide con el inventario calculado."
            running_stock[product_id] = balance
            movement_delta[product_id] = movement_delta.get(product_id, 0) + quantity
    for product_id in before_stock.keys() | after_stock.keys():
        stock_change = after_stock.get(product_id, 0) - before_stock.get(product_id, 0)
        if abs(stock_change - movement_delta.get(product_id, 0)) > 0.0001:
            return "Cada cambio de existencia debe estar respaldado por un movimiento de inventario."
    return None
