"""Validate partial returns and their inventory and refund entries."""

from datetime import date
import math
import re

if __package__:
    from .quotation_validation import valid_amount
else:
    from quotation_validation import valid_amount


def valid_return_id(value):
    return isinstance(value, str) and re.fullmatch(r"return-[0-9a-f-]{36}", value) is not None


def return_additions(previous, sales):
    return [
        (sale_id, record) for sale_id, sale in sales.items()
        for record in sale.get("returns", [])[len(previous.get(sale_id, {}).get("returns", [])):]
    ]


def return_batch_error(previous_sales, sales, previous_products, accounts, changes, return_id):
    additions = return_additions(previous_sales, sales)
    if len(additions) != 1 or additions[0][1]["id"] != return_id:
        return "El lote debe registrar una sola devolución."
    sale_id, record = additions[0]
    original = previous_sales.get(sale_id)
    sale = sales[sale_id]
    if (
        not original or {key: value for key, value in sale.items() if key != "returns"}
        != {key: value for key, value in original.items() if key != "returns"}
        or record["paymentCount"] != len(original.get("payments", []))
    ):
        return "La devolución debe conservar la venta y sus abonos vigentes."
    expected = {("sales", sale_id)}
    quantities = {}
    for line in record["lines"]:
        if line["restock"]:
            product = sale["lines"][line["lineIndex"]]["productId"]
            quantities[product] = round(quantities.get(product, 0) + line["quantity"], 4)
            expected.update({("products", product), ("inventoryMovements", line["inventoryMovementId"])})
    if record["refund"]:
        expected.add(("cashMovements", record["cashMovementId"]))
        refund = next((item.get("payload") for item in changes
                       if item["entityType"] == "cashMovements"
                       and item["entityId"] == record["cashMovementId"]), None)
        account_id = refund.get("accountId") if isinstance(refund, dict) else None
        if not isinstance(account_id, str) or accounts.get(account_id, {}).get("active") is not True:
            return "Selecciona una cuenta de caja o banco activa para el reembolso."
    if any(item["action"] != "upsert" for item in changes) or {
        (item["entityType"], item["entityId"]) for item in changes
    } != expected:
        return "El lote contiene cambios ajenos a la devolución."
    for item in changes:
        if item["entityType"] == "products":
            product_id = item["entityId"]
            before = previous_products.get(product_id)
            if not before or not valid_amount(before.get("stock")) or item["payload"] != {
                **before, "stock": round(before["stock"] + quantities[product_id], 4),
            }:
                return "El inventario cambió en otro puesto. Sincroniza y revisa la devolución."
    return None


def sale_returns_error(previous, sales, inventory, cash, fiscal_sale_ids):
    for sale_id, old in previous.items():
        old_returns = old.get("returns") or []
        current = sales.get(sale_id, {}).get("returns", [])
        if old_returns and (not isinstance(current, list) or current[:len(old_returns)] != old_returns):
            return "Las devoluciones registradas y la venta original se conservan en el historial."
        if old_returns:
            payments = old.get("payments", [])
            new = sales[sale_id]
            new_payments = new.get("payments", [])
            if not isinstance(new_payments, list) or new_payments[:len(payments)] != payments:
                return "Los abonos anteriores a una devolución se conservan en su orden original."
            if any(old.get(key) != new.get(key) for key in ("date", "customerId", "lines", "total")):
                return "Los datos originales de una venta con devoluciones se conservan."
    for sale_id, sale in sales.items():
        returns = sale.get("returns", [])
        if not isinstance(returns, list):
            return "El historial de devoluciones no es válido."
        if not returns:
            continue
        if (sale_id in fiscal_sale_ids or sale.get("invoiceFollowUpStatus") == "registered_externally"
            or sale.get("externalInvoiceNumber")):
            return "Revisa con facturación las devoluciones de una venta con documento asociado."
        issue = _validate_returns(sale, returns, inventory, cash)
        if issue:
            return issue
    return None


def _validate_returns(sale, returns, inventory, cash):
    originals = sale.get("lines", [])
    payments = sale.get("payments", [])
    if (
        not isinstance(originals, list) or not isinstance(payments, list)
        or not valid_amount(sale.get("total"))
        or any(not isinstance(payment, dict) or not valid_amount(payment.get("amount")) for payment in payments)
    ):
        return "Revisa los renglones y abonos originales antes de devolver."
    used_ids = set()
    quantities = {}
    returned = refunded = payment_count = 0
    for record in returns:
        if not isinstance(record, dict):
            return "Una devolución tiene un formato no válido."
        return_id = record.get("id")
        lines = record.get("lines")
        count = record.get("paymentCount")
        if (
            not isinstance(return_id, str) or not return_id or return_id in used_ids
            or not isinstance(record.get("reason"), str) or not record["reason"].strip()
            or not isinstance(lines, list) or not lines
            or type(count) is not int or not payment_count <= count <= len(payments)
        ):
            return "Una devolución requiere renglones, motivo e identificación válidos."
        try:
            returned_on = date.fromisoformat(record["date"])
            sold_on = date.fromisoformat(sale["date"])
            if returned_on.isoformat() != record["date"] or returned_on < sold_on:
                raise ValueError
        except (KeyError, TypeError, ValueError):
            return "La fecha de devolución debe ser igual o posterior a la venta."
        used_ids.add(return_id)
        payment_count = count
        seen = set()
        total = 0
        for line in lines:
            if not isinstance(line, dict):
                return "Un renglón de devolución tiene un formato no válido."
            index, quantity = line.get("lineIndex"), line.get("quantity")
            if (
                type(index) is not int or not 0 <= index < len(originals) or index in seen
                or not valid_amount(quantity) or quantity <= 0 or round(quantity, 4) != quantity
                or type(line.get("restock")) is not bool
            ):
                return "Revisa el renglón y la cantidad de cada producto devuelto."
            original = originals[index]
            if not isinstance(original, dict) or not valid_amount(original.get("quantity")) or not valid_amount(original.get("total")):
                return "El renglón original de la venta no es válido."
            previous = quantities.get(index, 0)
            cumulative = round(previous + quantity, 4)
            sold = original["quantity"]
            if sold <= 0 or cumulative > sold + 1e-8:
                return "La cantidad devuelta supera lo vendido en el renglón."
            value = original["total"]
            amount = math.floor(value * cumulative / sold + 0.5) - math.floor(value * previous / sold + 0.5)
            if not valid_amount(line.get("amount")) or line["amount"] != amount:
                return "El valor de la devolución no coincide con el precio de la venta."
            movement_id = line.get("inventoryMovementId")
            if line["restock"]:
                movement = inventory.get(movement_id) if isinstance(movement_id, str) else None
                if (
                    not movement or movement_id in used_ids or movement.get("productId") != original.get("productId")
                    or movement.get("movementType") != "adjustment" or movement.get("quantity") != quantity
                    or movement.get("sourceType") != "sale" or movement.get("sourceId") != sale["id"]
                ):
                    return "El reintegro no coincide con su entrada de inventario."
                used_ids.add(movement_id)
            elif movement_id is not None:
                return "Un producto que no vuelve al inventario no puede tener un reintegro."
            seen.add(index)
            quantities[index] = cumulative
            total += amount
        paid_at_return = sum(payment["amount"] for payment in payments[:count])
        refund = max(0, total - max(0, sale["total"] - returned - paid_at_return + refunded))
        if not valid_amount(record.get("total")) or not valid_amount(record.get("refund")) or record["total"] != total or record["refund"] != refund:
            return "El valor de la devolución o el reembolso no coincide con el saldo de la venta."
        movement_id = record.get("cashMovementId")
        if refund:
            movement = cash.get(movement_id) if isinstance(movement_id, str) else None
            if (
                not movement or movement_id in used_ids or not movement.get("accountId")
                or movement.get("direction") != "out" or movement.get("amount") != refund
                or movement.get("sourceType") != "sale" or movement.get("sourceId") != sale["id"]
                or movement.get("date") != record["date"] or movement.get("category") != "Devolución de venta"
            ):
                return "El reembolso no coincide con la salida de caja o banco."
            used_ids.add(movement_id)
        elif movement_id is not None:
            return "Una devolución sin reembolso no puede tener una salida de caja."
        returned += total
        refunded += refund
    if returned > sale["total"] or sum(payment["amount"] for payment in payments) - refunded > sale["total"] - returned:
        return "Los abonos y las devoluciones superan el total de la venta."
    return None
