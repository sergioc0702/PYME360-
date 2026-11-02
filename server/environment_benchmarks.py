"""Public environmental benchmark integrations for the local Pyme360 server.

The module keeps source-specific HTTP and schema handling away from the request
handler. Public indicators are deliberately tagged as contextual unless their
period, units and production denominator match the company's data.
"""

from __future__ import annotations

import csv
import calendar
import email.utils
import json
import math
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable


CACHE_TTL_SECONDS = 24 * 60 * 60
MIN_MANUAL_REFRESH_INTERVAL_SECONDS = 5 * 60
HTTP_TIMEOUT_SECONDS = 12
MAX_RETRIES = 2
UNSD_URL = "https://unstats.un.org/SDGAPI/v1/sdg/Series/Data"
XM_BASE_URL = "https://servapibi.xm.com.co"
SNAPSHOT_REQUIRED_COLUMNS = {
    "source_id", "source_name", "resource", "indicator", "value", "unit",
    "period_start", "period_end", "country_code", "country", "source_url",
    "published_at", "comparability",
}

SOURCE_CATALOG: list[dict[str, str]] = [
    {"id": "unsd", "name": "ONU · Indicadores ODS", "kind": "api", "url": "https://unstats.un.org/SDGAPI/swagger/"},
    {"id": "xm", "name": "XM/Sinergox · Sistema eléctrico", "kind": "api", "url": "https://github.com/EquipoAnaliticaXM/API_XM"},
    {"id": "dane-eai", "name": "DANE · Encuesta Ambiental Industrial", "kind": "official_file", "url": "https://www.dane.gov.co/index.php?id=1048%3Ade&option=com_content&view=article"},
    {"id": "sui-energy", "name": "Superservicios · SUI energía", "kind": "official_file", "url": "https://sui.superservicios.gov.co/Reportes-del-sector/Energia"},
    {"id": "eia-mecs", "name": "EIA · MECS manufactura", "kind": "official_file", "url": "https://www.eia.gov/consumption/manufacturing/data/2022/"},
    {"id": "company-public", "name": "Referencia empresarial pública", "kind": "curated", "url": "https://www.coca-colacompany.com/content/dam/company/us/en/reports/2024-environmental-update/2024-environmental-update.pdf"},
]

_refresh_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _year(value: Any) -> int | None:
    if value is None:
        return None
    match = __import__("re").search(r"\d{4}", str(value))
    return int(match.group(0)) if match else None


def _finite_number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        result = float(str(value).replace(",", "."))
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _walk_dicts(value: Any):
    if isinstance(value, dict):
        yield value
        for nested in value.values():
            yield from _walk_dicts(nested)
    elif isinstance(value, list):
        for nested in value:
            yield from _walk_dicts(nested)


def _case_value(row: dict[str, Any], *names: str) -> Any:
    lowered: dict[str, Any] = {}
    for key, value in row.items():
        normalized = str(key).lower().replace("_", "")
        lowered[normalized] = value
        if normalized.startswith("values"):
            lowered[normalized[6:]] = value
    for name in names:
        key = name.lower().replace("_", "")
        if key in lowered:
            return lowered[key]
    return None


def _response_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        rows = payload.get("data", payload.get("Items", payload.get("items")))
    else:
        rows = None
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ValueError("La fuente respondió con una estructura de datos no reconocida.")
    return rows


def _retry_delay(response_headers: Any, attempt: int) -> float:
    value = response_headers.get("Retry-After") if response_headers else None
    if value:
        try:
            return min(5.0, max(0.0, float(value)))
        except (TypeError, ValueError):
            try:
                when = email.utils.parsedate_to_datetime(value)
                if when.tzinfo is None:
                    when = when.replace(tzinfo=timezone.utc)
                return min(5.0, max(0.0, (when - datetime.now(timezone.utc)).total_seconds()))
            except (TypeError, ValueError, OverflowError):
                pass
    return min(2.0, 0.25 * (2**attempt))


def request_json(
    url: str,
    *,
    method: str = "GET",
    body: dict[str, Any] | None = None,
    timeout: float = HTTP_TIMEOUT_SECONDS,
    opener: Callable[..., Any] = urllib.request.urlopen,
    sleeper: Callable[[float], None] = time.sleep,
) -> Any:
    """Call a public JSON endpoint with bounded retries for transient failures."""
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Accept": "application/json", "User-Agent": "Pyme360-local/2.0"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    for attempt in range(MAX_RETRIES + 1):
        try:
            with opener(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code not in (429, 500, 502, 503, 504) or attempt >= MAX_RETRIES:
                exc.close()
                raise
            delay = _retry_delay(exc.headers, attempt)
            exc.close()
            sleeper(delay)
        except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError):
            if attempt >= MAX_RETRIES:
                raise
            sleeper(_retry_delay(None, attempt))
    raise RuntimeError("La consulta pública agotó sus reintentos.")


def normalize_unsd_series(
    payload: Any,
    *,
    series_code: str,
    indicator: str,
    resource: str,
    unit: str,
    source_description: str,
    source_url: str = "https://unstats.un.org/SDGAPI/swagger/",
    industry_only: bool = False,
) -> list[dict[str, Any]]:
    """Convert UNSD observations into Pyme360's stable public-record shape."""
    rows = _response_rows(payload)
    normalized: list[dict[str, Any]] = []
    for row in rows:
        area_code = str(_case_value(row, "geoAreaCode", "areaCode") or "")
        if area_code not in {"1", "170"}:
            continue
        period_year = _year(_case_value(row, "timePeriodStart", "timePeriod", "year"))
        value = _finite_number(_case_value(row, "value", "obsValue"))
        if period_year is None or value is None:
            continue
        dimensions = row.get("dimensions") or row.get("disaggregation") or {}
        dimensions_text = json.dumps(dimensions, ensure_ascii=False).lower()
        if industry_only and dimensions_text and not any(
            word in dimensions_text for word in ("industries", "industry", "industrial", "manufacturing")
        ):
            continue
        if industry_only and not dimensions_text:
            # Do not mistake an aggregate value for the industrial disaggregation.
            continue
        area = _case_value(row, "geoAreaName", "areaName") or ("Mundo" if area_code == "1" else "Colombia")
        published_source = _case_value(row, "source", "sourceName") or "ONU · Base mundial de indicadores ODS"
        normalized.append(
            {
                "id": f"unsd:{series_code}:{area_code}:{period_year}",
                "sourceId": "unsd",
                "sourceName": str(published_source),
                "resource": resource,
                "indicator": indicator,
                "value": value,
                "unit": unit,
                "periodStart": f"{period_year}-01-01",
                "periodEnd": f"{period_year}-12-31",
                "countryCode": area_code,
                "country": str(area),
                "region": "Global" if area_code == "1" else "Nacional",
                "sectorCode": "manufacturing" if industry_only else None,
                "sourceUrl": source_url,
                "publishedAt": None,
                "retrievedAt": _now(),
                "quality": "official_statistic",
                "comparability": "contextual",
                "note": source_description,
                "seriesCode": series_code,
                "dimensions": dimensions if dimensions else None,
            }
        )
    return normalized


def fetch_unsd_benchmarks(requester: Callable[..., Any] = request_json) -> list[dict[str, Any]]:
    """Fetch official UNSD context, including the app's existing energy series."""
    definitions = [
        {
            "series": "ER_H2O_WUEYST",
            "indicator": "ODS 6.4.1 · Eficiencia hídrica",
            "resource": "water",
            "unit": "USD/m³",
            "description": "Valor económico agregado por volumen de agua usado; contexto macroeconómico, no intensidad física de una planta.",
            "industry_only": True,
        },
        {
            "series": "ER_H2O_STRESS",
            "indicator": "ODS 6.4.2 · Estrés hídrico",
            "resource": "water",
            "unit": "% de recursos hídricos disponibles",
            "description": "Extracción de agua dulce como proporción de recursos hídricos disponibles; contexto de cuenca/país.",
            "industry_only": False,
        },
        {
            "series": "EG_EGY_PRIM",
            "indicator": "ODS 7.3.1 · Intensidad energética de la economía",
            "resource": "energy",
            "unit": "MJ/USD de PIB en PPA constante",
            "description": "Energía primaria por PIB; referencia macroeconómica, no consumo de electricidad por producto.",
            "industry_only": False,
        },
    ]
    observations: list[dict[str, Any]] = []
    for definition in definitions:
        query: list[tuple[str, str]] = [
            ("seriesCode", definition["series"]),
            ("areaCode", "1"),
            ("areaCode", "170"),
            ("page", "1"),
            ("pageSize", "200"),
        ]
        payload = requester(UNSD_URL + "?" + urllib.parse.urlencode(query))
        observations.extend(
            normalize_unsd_series(
                payload,
                series_code=str(definition["series"]),
                indicator=str(definition["indicator"]),
                resource=str(definition["resource"]),
                unit=str(definition["unit"]),
                source_description=str(definition["description"]),
                industry_only=bool(definition["industry_only"]),
            )
        )
    if not observations:
        raise ValueError("La API ODS no devolvió observaciones de país o mundo con esquema reconocible.")
    return observations


def normalize_xm_demand(payload: Any, *, unit: str, fetched_at: str | None = None) -> list[dict[str, Any]]:
    """Normalize XM's Items + Hourly/Daily/Monthly/AnnualEntities response."""
    rows = _response_rows(payload)
    normalized: list[dict[str, Any]] = []
    for row in rows:
        row_date = _case_value(row, "Date", "date", "Timestamp", "fecha")
        if not isinstance(row_date, str) or len(row_date) < 10:
            continue
        entity_rows: list[dict[str, Any]] = []
        for key, value in row.items():
            if str(key).lower().endswith("entities") and isinstance(value, list):
                entity_rows.extend(item for item in value if isinstance(item, dict))
        if not entity_rows:
            entity_rows = [row]

        for index, entity in enumerate(entity_rows):
            candidates: list[float] = []
            for key, raw_value in entity.items():
                normalized_key = str(key).lower().replace("_", "")
                if normalized_key.startswith("values"):
                    normalized_key = normalized_key[6:]
                if normalized_key not in {"value", "valor", "demasin", "demanda"} and not normalized_key.startswith("dema"):
                    continue
                numeric = _finite_number(raw_value)
                if numeric is not None:
                    candidates.append(numeric)
            candidates = list(dict.fromkeys(candidates))
            if len(candidates) != 1:
                continue
            value = candidates[0]
            detail = _case_value(entity, "Hour", "Hourly", "Period", "Interval", "Id")
            suffix = str(detail if detail is not None else index)
            normalized.append(
                {
                    "id": f"xm:dema-sin:{row_date[:10]}:{suffix}",
                    "sourceId": "xm",
                    "sourceName": "XM/Sinergox · Demanda del SIN",
                    "resource": "energy",
                    "indicator": "Demanda eléctrica del SIN",
                    "value": value,
                    "unit": unit,
                    "periodStart": row_date[:10],
                    "periodEnd": row_date[:10],
                    "countryCode": "CO",
                    "country": "Colombia",
                    "region": "Sistema Interconectado Nacional",
                    "sectorCode": None,
                    "sourceUrl": "https://servapibi.xm.com.co",
                    "publishedAt": row_date[:10],
                    "retrievedAt": fetched_at or _now(),
                    "quality": "official_operational_data",
                    "comparability": "contextual",
                    "note": "Demanda agregada del sistema eléctrico; no representa el consumo de esta empresa.",
                }
            )
    return normalized


def _xm_catalog(payload: Any) -> tuple[dict[str, Any], str]:
    for row in _walk_dicts(payload):
        metric_id = _case_value(row, "MetricId", "metricId")
        entity = _case_value(row, "Entity", "entity")
        if str(metric_id).lower() == "demasin" and str(entity).lower() == "sistema":
            unit = _case_value(row, "Unit", "Units", "Unidad", "MeasureUnit")
            return row, str(unit or "")
    raise ValueError("El catálogo de XM no publicó la métrica DemaSIN para Sistema.")


def fetch_xm_benchmarks(requester: Callable[..., Any] = request_json) -> list[dict[str, Any]]:
    """Fetch a short system-demand context series from XM without extra packages."""
    base_url = os.environ.get("PYME360_XM_BASE_URL", XM_BASE_URL).rstrip("/")
    if not base_url.startswith("https://"):
        raise ValueError("La URL de XM debe usar HTTPS.")
    catalog = requester(base_url + "/Lists", method="POST", body={"MetricId": "ListadoMetricas"})
    metadata, unit = _xm_catalog(catalog)
    if not unit:
        raise ValueError("El catálogo de XM no incluye la unidad de la métrica Demanda del SIN.")
    resolution = str(_case_value(metadata, "Type", "type") or "HourlyEntities").lower()
    endpoint = "hourly" if "hour" in resolution else "daily" if "daily" in resolution else "monthly" if "monthly" in resolution else "annual"
    end = date.today()
    start = end - timedelta(days=6)
    body = {
        "MetricId": "DemaSIN",
        "StartDate": start.isoformat(),
        "EndDate": end.isoformat(),
        "Entity": "Sistema",
        "Filter": [],
    }
    payload = requester(base_url + "/" + endpoint, method="POST", body=body)
    observations = normalize_xm_demand(payload, unit=unit)
    if not observations:
        raise ValueError("XM respondió, pero no publicó observaciones con fecha, valor y unidad reconocibles.")
    return observations


def load_official_snapshot_csv(path: Path) -> list[dict[str, Any]]:
    """Load a reviewed, canonical CSV derived from official DANE/SUI/EIA files."""
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        columns = set(reader.fieldnames or [])
        missing = SNAPSHOT_REQUIRED_COLUMNS - columns
        if missing:
            raise ValueError("Faltan columnas requeridas en el archivo de referencias oficiales: " + ", ".join(sorted(missing)))
        records: list[dict[str, Any]] = []
        for line_number, row in enumerate(reader, start=2):
            source_id = (row.get("source_id") or "").strip()
            if source_id not in {"dane-eai", "sui-energy", "eia-mecs"}:
                raise ValueError(f"La fuente de la fila {line_number} no está permitida.")
            value = _finite_number(row.get("value"))
            if value is None or value < 0:
                raise ValueError(f"El valor de la fila {line_number} debe ser un número finito no negativo.")
            comparability = (row.get("comparability") or "contextual").strip()
            if comparability not in {"direct", "contextual", "incomplete", "unavailable"}:
                raise ValueError(f"La comparabilidad de la fila {line_number} no es válida.")
            period_start = (row.get("period_start") or "").strip()
            period_end = (row.get("period_end") or "").strip()
            start_date = date.fromisoformat(period_start)
            end_date = date.fromisoformat(period_end)
            if end_date < start_date:
                raise ValueError(f"El período de la fila {line_number} termina antes de comenzar.")
            for field in ("source_name", "resource", "indicator", "unit", "country_code", "country", "source_url"):
                if not (row.get(field) or "").strip():
                    raise ValueError(f"El campo {field} de la fila {line_number} está vacío.")
            if comparability == "direct" and not (row.get("denominator_unit") or "").strip():
                raise ValueError(f"La fila {line_number} no puede ser directa sin unidad denominadora.")
            records.append(
                {
                    "id": (row.get("id") or f"{source_id}:{line_number}").strip(),
                    "sourceId": source_id,
                    "sourceName": (row.get("source_name") or source_id).strip(),
                    "resource": (row.get("resource") or "").strip(),
                    "indicator": (row.get("indicator") or "").strip(),
                    "value": value,
                    "unit": (row.get("unit") or "").strip(),
                    "denominatorUnit": (row.get("denominator_unit") or "").strip() or None,
                    "periodStart": period_start,
                    "periodEnd": period_end,
                    "countryCode": (row.get("country_code") or "").strip(),
                    "country": (row.get("country") or "").strip(),
                    "region": (row.get("region") or "").strip() or None,
                    "sectorCode": (row.get("sector_code") or "").strip() or None,
                    "sourceUrl": (row.get("source_url") or "").strip(),
                    "publishedAt": (row.get("published_at") or "").strip() or None,
                    "retrievedAt": (row.get("retrieved_at") or _now()).strip(),
                    "quality": (row.get("quality") or "official_statistic").strip(),
                    "comparability": comparability,
                    "note": (row.get("note") or "").strip(),
                }
            )
    return records


def public_company_references() -> list[dict[str, Any]]:
    return [
        {
            "id": "coca-cola-system-water-2024",
            "sourceId": "company-public",
            "sourceName": "The Coca-Cola Company · Sistema Coca-Cola",
            "resource": "water",
            "indicator": "Relación de uso de agua",
            "value": 1.78,
            "unit": "L/L",
            "denominatorUnit": "L de bebida terminada",
            "periodStart": "2024-01-01",
            "periodEnd": "2024-12-31",
            "countryCode": "GLOBAL",
            "country": "Global",
            "region": "Sistema global reportado",
            "sectorCode": "1104",
            "sourceUrl": "https://www.coca-colacompany.com/content/dam/company/us/en/reports/2024-environmental-update/2024-environmental-update.pdf",
            "publishedAt": "2025",
            "retrievedAt": "2026-10-23T00:00:00+00:00",
            "quality": "public_company_report",
            "comparability": "direct",
            "note": "Mejor valor publicado en la serie 2022–2024 (2023 y 2024 empatan). Límite del sistema Coca-Cola; no es mínimo histórico universal ni objetivo normativo.",
        }
    ]


def _unit_factor(unit: str, dimension: str) -> float | None:
    normalized = unit.strip().lower().replace("³", "3").replace(" ", "")
    aliases = {
        "water": {"m3": 1000.0, "m^3": 1000.0, "l": 1.0, "liter": 1.0, "liters": 1.0, "litro": 1.0, "litros": 1.0},
        "energy": {"kwh": 1.0, "wh": 0.001, "mwh": 1000.0},
        "volume": {"l": 1.0, "liter": 1.0, "liters": 1.0, "litro": 1.0, "litros": 1.0},
    }
    return aliases.get(dimension, {}).get(normalized)


def _annual_company_intensity(state: dict[str, Any], year: int, resource: str) -> dict[str, Any]:
    readings = state.get("resourceReadings", [])
    products = {str(row.get("id")): row for row in state.get("products", []) if isinstance(row, dict)}
    orders = [
        order for order in state.get("productionOrders", [])
        if isinstance(order, dict)
        and order.get("status") == "completed"
        and str(order.get("completedAt") or order.get("date") or "")[:4] == str(year)
    ]
    output_liters = 0.0
    output_complete = bool(orders)
    for order in orders:
        product = products.get(str(order.get("productId")))
        factor = _finite_number(product.get("benchmarkOutputFactor")) if product else None
        output_unit = str(product.get("benchmarkOutputUnit") or "").strip() if product else ""
        volume_factor = _unit_factor(output_unit, "volume")
        if not product or product.get("type") != "finished" or factor is None or factor <= 0 or volume_factor is None:
            output_complete = False
            continue
        good_quantity = max(0.0, (_finite_number(order.get("quantity")) or 0.0) - (_finite_number(order.get("wasteQuantity")) or 0.0))
        output_liters += good_quantity * factor * volume_factor
    unit = "L/L" if resource == "water" else "kWh/L"
    if not output_complete or output_liters <= 0:
        return {"value": None, "unit": unit, "status": "unavailable", "note": "Falta producción completada o conversión de todos los productos terminados a litros."}

    required_activity = "withdrawal" if resource == "water" else "consumption"
    target_dimension = "water" if resource == "water" else "energy"
    monthly_values: dict[int, list[float]] = {}
    for reading in readings:
        if not isinstance(reading, dict) or reading.get("resource") != resource or reading.get("activity") != required_activity:
            continue
        if reading.get("quality") not in {"measured", "confirmed"}:
            continue
        try:
            start = date.fromisoformat(str(reading.get("periodStart")))
            end = date.fromisoformat(str(reading.get("periodEnd")))
        except ValueError:
            continue
        if start.year != year or end.year != year or end < start:
            continue
        if start.day != 1 or end.day != calendar.monthrange(end.year, end.month)[1] or start.month != end.month:
            continue
        conversion = _unit_factor(str(reading.get("unit") or ""), target_dimension)
        quantity = _finite_number(reading.get("quantity"))
        if conversion is None or quantity is None or quantity < 0:
            continue
        monthly_values.setdefault(start.month, []).append(quantity * conversion)
    if set(monthly_values) != set(range(1, 13)) or any(len(values) != 1 for values in monthly_values.values()):
        return {"value": None, "unit": unit, "status": "incomplete", "note": "Se requieren lecturas confirmadas o medidas en los 12 meses del año."}
    total = sum(values[0] for values in monthly_values.values())
    if total <= 0:
        return {"value": None, "unit": unit, "status": "unavailable", "note": "El total anual medido debe ser mayor que cero para calcular intensidad."}
    return {
        "value": total / output_liters,
        "unit": unit,
        "status": "ready",
        "note": f"Calculado con lecturas y producción buena de {year}; conversión configurada por producto.",
    }


def build_benchmark_response(state: dict[str, Any], observations: list[dict[str, Any]], sources: list[dict[str, Any]]) -> dict[str, Any]:
    config = state.get("environmentalConfig")
    profile = config.get("benchmarking", {}) if isinstance(config, dict) else {}
    comparisons = []
    for record in observations:
        record_year = _year(record.get("periodStart"))
        try:
            period_start = date.fromisoformat(str(record.get("periodStart") or ""))
            period_end = date.fromisoformat(str(record.get("periodEnd") or ""))
            full_year = bool(
                record_year
                and period_start == date(record_year, 1, 1)
                and period_end == date(record_year, 12, 31)
            )
        except ValueError:
            full_year = False
        resource = record.get("resource")
        record_unit = record.get("unit")
        company = None
        if full_year and resource == "water" and record_unit == "L/L":
            company = _annual_company_intensity(state, record_year, "water")
        elif full_year and resource == "energy" and record_unit == "kWh/L":
            company = _annual_company_intensity(state, record_year, "electricity")
        comparison_status = str(record.get("comparability") or "contextual")
        company_value = None
        gap_percent = None
        comparison_note = str(record.get("note") or "")
        if company is not None:
            company_value = company.get("value")
            if company_value is None:
                comparison_status = str(company.get("status"))
                comparison_note = str(company.get("note"))
            elif (
                comparison_status == "direct"
                and company.get("unit") == record_unit
                and _finite_number(record.get("value")) not in (None, 0)
            ):
                gap_percent = (float(company_value) / float(record["value"]) - 1.0) * 100.0
        comparisons.append(
            {
                "reference": record,
                "companyValue": company_value,
                "companyUnit": company.get("unit") if company else None,
                "gapPercent": gap_percent,
                "comparability": comparison_status,
                "note": comparison_note,
            }
        )
    return {
        "profile": {
            "countryCode": profile.get("countryCode", "CO"),
            "region": profile.get("region", "Antioquia"),
            "sectorCode": profile.get("sectorCode", "1104"),
            "outputUnit": profile.get("outputUnit", "L"),
            "assumedMonthlyOutput": profile.get("assumedMonthlyOutput", 100000),
            "assumptionOnly": True,
        },
        "comparisons": comparisons,
        "sources": sources,
        "refreshedAt": max((str(source.get("lastUpdatedAt") or "") for source in sources), default="") or None,
    }


def get_benchmark_response(
    state: dict[str, Any],
    *,
    load_cache: Callable[[str], dict[str, Any] | None],
    save_cache: Callable[[str, dict[str, Any], str, str | None], None],
    snapshot_path: Path,
    force_refresh: bool = False,
    unsd_fetcher: Callable[[], list[dict[str, Any]]] = fetch_unsd_benchmarks,
    xm_fetcher: Callable[[], list[dict[str, Any]]] = fetch_xm_benchmarks,
) -> dict[str, Any]:
    """Read the cache and refresh public sources only after an explicit request."""
    with _refresh_lock:
        observations: list[dict[str, Any]] = public_company_references()
        source_statuses: list[dict[str, Any]] = []
        api_sources = [("unsd", "ONU · Indicadores ODS", "https://unstats.un.org/SDGAPI/swagger/", unsd_fetcher), ("xm", "XM/Sinergox · Sistema eléctrico", "https://github.com/EquipoAnaliticaXM/API_XM", xm_fetcher)]
        for source_id, label, source_url, fetcher in api_sources:
            try:
                cached = load_cache(source_id)
            except Exception:
                cached = None
            cached_at = str(cached.get("fetchedAt") or "") if cached else ""
            try:
                cache_time = datetime.fromisoformat(cached_at.replace("Z", "+00:00")).timestamp() if cached_at else 0
            except ValueError:
                cache_time = 0
            cache_fresh = bool(cached and time.time() - cache_time < CACHE_TTL_SECONDS)
            error: str | None = None
            refresh_cooldown = bool(
                force_refresh
                and cached
                and time.time() - cache_time < MIN_MANUAL_REFRESH_INTERVAL_SECONDS
            )
            payload = cached.get("observations", []) if cached else []
            fetched_at = cached_at or None
            if force_refresh and not refresh_cooldown:
                try:
                    payload = fetcher()
                    fetched_at = _now()
                    save_cache(source_id, {"observations": payload}, fetched_at, None)
                    cache_fresh = True
                except Exception as exc:
                    error = f"{type(exc).__name__}: {exc}"[:400]
                    if cached:
                        payload = cached.get("observations", [])
                        save_cache(
                            source_id,
                            {"observations": payload},
                            cached_at,
                            error,
                        )
            if isinstance(payload, list):
                observations.extend(row for row in payload if isinstance(row, dict))
            cached_error = cached.get("lastError") if cached else None
            source_error = error or (
                f"Última actualización fallida: {cached_error}" if cached_error else None
            )
            if refresh_cooldown and source_error is None:
                source_error = "La fuente se consultó hace menos de 5 minutos; se conserva la última respuesta."
            elif not cached and source_error is None:
                source_error = "Usa «Actualizar datos» para consultar esta fuente."
            source_statuses.append(
                {
                    "id": source_id,
                    "name": label,
                    "url": source_url,
                    "kind": "api",
                    "status": (
                        "stale" if cached and (error or not cache_fresh)
                        else "ready" if cached and cache_fresh and not error
                        else "stale" if cached and error
                        else "error" if error
                        else "not_configured"
                    ),
                    "recordCount": len(payload) if isinstance(payload, list) else 0,
                    "lastUpdatedAt": fetched_at,
                    "stale": bool(cached and (error or not cache_fresh)),
                    "error": source_error,
                }
            )

        try:
            snapshots = load_official_snapshot_csv(snapshot_path)
            observations.extend(snapshots)
            snapshot_counts: dict[str, int] = {}
            for row in snapshots:
                snapshot_counts[row["sourceId"]] = snapshot_counts.get(row["sourceId"], 0) + 1
            for source in SOURCE_CATALOG:
                if source["kind"] != "official_file":
                    continue
                count = snapshot_counts.get(source["id"], 0)
                source_statuses.append(
                    {
                        "id": source["id"],
                        "name": source["name"],
                        "url": source["url"],
                        "kind": "official_file",
                        "status": "ready" if count else "not_configured",
                        "recordCount": count,
                        "lastUpdatedAt": max((str(row.get("retrievedAt") or "") for row in snapshots if row["sourceId"] == source["id"]), default="") or None,
                        "stale": False,
                        "error": None if count else "Añade los valores oficiales revisados al CSV local de referencias para habilitar esta fuente.",
                    }
                )
        except Exception as exc:
            for source in SOURCE_CATALOG:
                if source["kind"] == "official_file":
                    source_statuses.append(
                        {
                            "id": source["id"],
                            "name": source["name"],
                            "url": source["url"],
                            "kind": "official_file",
                            "status": "error",
                            "recordCount": 0,
                            "lastUpdatedAt": None,
                            "stale": False,
                            "error": f"No se pudo leer el archivo local: {exc}"[:300],
                        }
                    )
        company_records = public_company_references()
        source_statuses.append(
            {
                "id": "company-public",
                "name": "Referencia empresarial pública",
                "url": "https://www.coca-colacompany.com/content/dam/company/us/en/reports/2024-environmental-update/2024-environmental-update.pdf",
                "kind": "curated",
                "status": "ready",
                "recordCount": len(company_records),
                "lastUpdatedAt": "2026-10-23T00:00:00+00:00",
                "stale": False,
                "error": None,
            }
        )
        unique: dict[str, dict[str, Any]] = {}
        for row in observations:
            unique[str(row.get("id") or f"{row.get('sourceId')}:{len(unique)}")] = row
        return build_benchmark_response(state, list(unique.values()), source_statuses)
