"""Validation shared by the local and central quotation flows."""

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
import math
import re


def colombian_date() -> str:
    return datetime.now(timezone(timedelta(hours=-5))).date().isoformat()


def valid_quotation_id(value: object) -> bool:
    return isinstance(value, str) and re.fullmatch(r"quotation-[A-Za-z0-9-]{8,80}", value) is not None


def valid_amount(value: object) -> bool:
    return type(value) in (int, float) and 0 <= value < 10**15


def quotation_error(quote: dict) -> str | None:
    if not valid_quotation_id(quote.get("id")):
        return "El identificador de la cotización no es válido."
    for key in ("number", "customerId", "customerName"):
        if not isinstance(quote.get(key), str) or not quote[key].strip():
            return "La cotización requiere número e identificación del cliente."
    # COT-0001 es el formato actual; C-… queda por las cotizaciones ya guardadas.
    if not re.fullmatch(r"(?:COT|C)-[A-Z0-9-]{1,80}", quote["number"]):
        return "El número de cotización no es válido."
    company = quote.get("company")
    if (
        not isinstance(company, dict)
        or not isinstance(company.get("name"), str)
        or not company["name"].strip()
        or any(not isinstance(company.get(key, ""), str) for key in ("taxId", "city"))
        or not isinstance(quote.get("customerTaxId"), str)
    ):
        return "Revisa los datos de la empresa y del cliente de la cotización."
    try:
        issued, expiry = (date.fromisoformat(quote[key]) for key in ("date", "validUntil"))
        if issued.isoformat() != quote["date"] or expiry.isoformat() != quote["validUntil"] or expiry < issued:
            raise ValueError
    except (TypeError, ValueError, KeyError):
        return "La cotización requiere fechas válidas de emisión y vencimiento."
    lines = quote.get("lines")
    if not isinstance(lines, list) or not lines or len(lines) > 200:
        return "Agrega entre 1 y 200 productos a la cotización."
    totals = {"subtotal": 0, "discount": 0, "vatAmount": 0, "total": 0}
    for line in lines:
        if (
            not isinstance(line, dict)
            or any(not isinstance(line.get(key), str) for key in ("productId", "productName", "sku"))
            or not line["productId"]
            or any(not valid_amount(line.get(key)) for key in (
                "quantity", "unitPrice", "vatRate", "subtotal", "discountShare", "vatAmount", "total",
            ))
        ):
            return "Una línea de cotización contiene datos no válidos."
        base = line["subtotal"] - line["discountShare"]
        if (
            line["quantity"] <= 0
            or line["quantity"] != round(line["quantity"], 4)
            or line["vatRate"] > 100
            or base < 0
            or line["subtotal"] != math.floor(line["quantity"] * line["unitPrice"] + 0.5)
            or line["vatAmount"] != math.floor(base * line["vatRate"] / 100 + 0.5)
            or line["total"] != base + line["vatAmount"]
        ):
            return "Los importes de una línea no coinciden con la oferta."
        for key in totals:
            totals[key] += line["discountShare" if key == "discount" else key]
    if any(not valid_amount(quote.get(key)) or quote[key] != total for key, total in totals.items()):
        return "Los totales de la cotización no coinciden con sus renglones."
    if "saleId" in quote and quote["saleId"] != f"sale-{quote['id']}":
        return "La cotización no conserva su vínculo de venta."
    return None


def sale_matches_quote(sale: dict, quote: dict) -> bool:
    return (
        sale.get("id") == quote.get("saleId")
        and sale.get("quotationId") == quote.get("id")
        and all(sale.get(key) == quote.get(key) for key in (
            "customerId", "customerName", "lines", "subtotal", "discount", "vatAmount", "total",
        ))
    )


def quoted_quantities(quote: dict) -> dict[str, float]:
    quantities: dict[str, float] = defaultdict(float)
    for line in quote["lines"]:
        product = line["productId"]
        quantities[product] += line["quantity"]
    return {product_id: round(quantity, 4) for product_id, quantity in quantities.items()}


def quotation_state_error(
    previous: dict[str, dict], quotes: dict[str, dict], sales: dict[str, dict],
    *, conversion_allowed: bool, restoring: bool = False,
) -> str | None:
    if not restoring and previous.keys() - quotes.keys():
        return "Las cotizaciones se conservan en el historial."
    for quote_id, quote in quotes.items():
        issue = quotation_error(quote)
        if issue:
            return issue
        if restoring:
            continue
        before = previous.get(quote_id)
        if before is not None and before != quote:
            if before.get("saleId") or {k: v for k, v in quote.items() if k != "saleId"} != before:
                return "Los datos guardados de una cotización se conservan. Duplica la oferta para renovarla."
        if quote.get("saleId") and (before is None or not before.get("saleId")):
            if not conversion_allowed or before is None:
                return "Confirma la venta desde la acción de convertir cotización."
            sale = sales.get(quote["saleId"])
            if not sale or sale.get("payments") or not isinstance(sale.get("date"), str) or not quote["date"] <= sale["date"] <= quote["validUntil"]:
                return "La conversión requiere una venta por cobrar dentro de la vigencia."
    for sale in sales.values():
        quote_id = sale.get("quotationId")
        if quote_id is None:
            continue
        if not valid_quotation_id(quote_id) or quote_id not in quotes or not sale_matches_quote(sale, quotes[quote_id]):
            return "Una venta no coincide con la cotización vinculada."
    return None
