from __future__ import annotations

import csv
import calendar
import hashlib
import importlib.util
import io
import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

SERVER_PATH = Path(__file__).resolve().parents[1] / "serve-local.py"
TEST_TEMP_PARENT = SERVER_PATH.parent / "tests"
sys.path.insert(0, str(SERVER_PATH.parent))

import environment_benchmarks as benchmarks


SERVER_SPEC = importlib.util.spec_from_file_location("pyme360_server_for_tests", SERVER_PATH)
assert SERVER_SPEC and SERVER_SPEC.loader
server_module = importlib.util.module_from_spec(SERVER_SPEC)
SERVER_SPEC.loader.exec_module(server_module)


class _JsonResponse:
    def __init__(self, value: object):
        self.payload = json.dumps(value).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self) -> bytes:
        return self.payload


def _empty_state() -> dict:
    return {
        "environmentalConfig": {
            "benchmarking": {
                "countryCode": "CO",
                "region": "Antioquia",
                "sectorCode": "1104",
                "outputUnit": "L",
                "assumedMonthlyOutput": 100000,
                "preferredSources": [],
            }
        },
        "resourceReadings": [],
        "products": [],
        "productionOrders": [],
    }


class BenchmarkNormalizationTests(unittest.TestCase):
    def test_unsd_rows_are_normalized_and_aggregates_stay_contextual(self):
        payload = {
            "data": [
                {
                    "geoAreaCode": 170,
                    "geoAreaName": "Colombia",
                    "timePeriodStart": "2023",
                    "value": "12,5",
                    "dimensions": {"Economic activity": "Manufacturing industries"},
                },
                {
                    "geoAreaCode": 1,
                    "geoAreaName": "World",
                    "timePeriodStart": 2023,
                    "value": 8.0,
                    "dimensions": {"Economic activity": "Industry"},
                },
                {"geoAreaCode": 999, "timePeriodStart": 2023, "value": 4},
                {"geoAreaCode": 170, "timePeriodStart": "N/A", "value": 2},
            ]
        }
        records = benchmarks.normalize_unsd_series(
            payload,
            series_code="ER_H2O_WUEYST",
            indicator="ODS 6.4.1",
            resource="water",
            unit="USD/m³",
            source_description="Indicador económico macro.",
            industry_only=True,
        )
        self.assertEqual(len(records), 2)
        self.assertEqual(records[0]["countryCode"], "170")
        self.assertEqual(records[0]["periodStart"], "2023-01-01")
        self.assertEqual(records[0]["value"], 12.5)
        self.assertEqual(records[0]["comparability"], "contextual")

    def test_xm_nested_entities_and_values_prefix_are_normalized(self):
        payload = {
            "Items": [
                {
                    "Date": "2025-04-12",
                    "HourlyEntities": [
                        {"Hour": "01", "Values_DemaSIN": 6400.2},
                        {"Hour": "02", "Values_DemaSIN": "6410.7"},
                    ],
                }
            ]
        }
        records = benchmarks.normalize_xm_demand(payload, unit="MWh", fetched_at="2025-04-13T00:00:00+00:00")
        self.assertEqual([record["value"] for record in records], [6400.2, 6410.7])
        self.assertEqual(records[0]["periodStart"], "2025-04-12")
        self.assertEqual(records[0]["comparability"], "contextual")
        self.assertNotEqual(records[0]["id"], records[1]["id"])

    def test_xm_fetch_uses_catalog_unit_and_hourly_endpoint(self):
        calls: list[tuple[str, str, dict | None]] = []

        def requester(url: str, *, method="GET", body=None):
            calls.append((url, method, body))
            if url.endswith("/Lists"):
                return {"Items": [{"ListEntities": [{
                    "Values_MetricId": "DemaSIN",
                    "Values_Entity": "Sistema",
                    "Values_Type": "HourlyEntities",
                    "Values_Unit": "MWh",
                }]}]}
            return {"Items": [{"Date": "2025-04-12", "HourlyEntities": [{"Hour": "01", "Values_DemaSIN": 44}]}]}

        records = benchmarks.fetch_xm_benchmarks(requester=requester)
        self.assertEqual(records[0]["unit"], "MWh")
        self.assertTrue(calls[0][0].endswith("/Lists"))
        self.assertTrue(calls[1][0].endswith("/hourly"))
        self.assertEqual(calls[1][2]["MetricId"], "DemaSIN")

    def test_public_company_reference_is_scoped_and_versioned(self):
        record = benchmarks.public_company_references()[0]
        self.assertEqual(record["value"], 1.78)
        self.assertEqual(record["unit"], "L/L")
        self.assertEqual(record["periodEnd"], "2024-12-31")
        self.assertIn("no es mínimo histórico universal", record["note"])


class BenchmarkCalculationAndCacheTests(unittest.TestCase):
    def _complete_state(self) -> dict:
        state = _empty_state()
        state["products"] = [{
            "id": "bottle-500",
            "type": "finished",
            "benchmarkOutputUnit": "L",
            "benchmarkOutputFactor": 0.5,
        }]
        state["productionOrders"] = [{
            "productId": "bottle-500",
            "quantity": 200000,
            "wasteQuantity": 0,
            "status": "completed",
            "completedAt": "2024-12-31T15:00:00Z",
        }]
        for month in range(1, 13):
            day_count = calendar.monthrange(2024, month)[1]
            state["resourceReadings"].append({
                "id": f"water-{month}",
                "resource": "water",
                "activity": "withdrawal",
                "quantity": 178 / 12,
                "unit": "m3",
                "quality": "measured",
                "periodStart": f"2024-{month:02d}-01",
                "periodEnd": f"2024-{month:02d}-{day_count:02d}",
            })
        return state

    def test_annual_intensity_and_direct_gap_use_actual_output(self):
        state = self._complete_state()
        company = benchmarks._annual_company_intensity(state, 2024, "water")
        self.assertEqual(company["status"], "ready")
        self.assertAlmostEqual(company["value"], 1.78)

        response = benchmarks.build_benchmark_response(
            state,
            benchmarks.public_company_references(),
            [],
        )
        comparison = response["comparisons"][0]
        self.assertAlmostEqual(comparison["companyValue"], 1.78)
        self.assertAlmostEqual(comparison["gapPercent"], 0.0)
        self.assertEqual(comparison["comparability"], "direct")
        self.assertTrue(response["profile"]["assumptionOnly"])

        energy_state = self._complete_state()
        energy_state["resourceReadings"] = [
            {
                "id": f"energy-{month}",
                "resource": "electricity",
                "activity": "consumption",
                "quantity": 1000,
                "unit": "kWh",
                "quality": "confirmed",
                "periodStart": f"2024-{month:02d}-01",
                "periodEnd": f"2024-{month:02d}-{calendar.monthrange(2024, month)[1]:02d}",
            }
            for month in range(1, 13)
        ]
        energy_reference = {
            "id": "eia-energy-2024",
            "sourceId": "eia-mecs",
            "sourceName": "EIA MECS",
            "resource": "energy",
            "indicator": "Electricidad por litro",
            "value": 0.1,
            "unit": "kWh/L",
            "periodStart": "2024-01-01",
            "periodEnd": "2024-12-31",
            "countryCode": "CO",
            "country": "Colombia",
            "sourceUrl": "https://www.eia.gov/",
            "retrievedAt": "2026-10-23T00:00:00+00:00",
            "comparability": "direct",
        }
        energy_comparison = benchmarks.build_benchmark_response(energy_state, [energy_reference], [])["comparisons"][0]
        self.assertAlmostEqual(energy_comparison["companyValue"], 0.12)
        self.assertAlmostEqual(energy_comparison["gapPercent"], 20.0)

    def test_incomplete_months_and_duplicate_months_do_not_produce_intensity(self):
        state = self._complete_state()
        state["resourceReadings"].pop(3)
        result = benchmarks._annual_company_intensity(state, 2024, "water")
        self.assertIsNone(result["value"])
        self.assertEqual(result["status"], "incomplete")

        state = self._complete_state()
        state["resourceReadings"].append(dict(state["resourceReadings"][0], id="duplicate"))
        result = benchmarks._annual_company_intensity(state, 2024, "water")
        self.assertIsNone(result["value"])

    def test_missing_product_conversion_never_uses_assumed_monthly_output(self):
        state = self._complete_state()
        state["products"][0].pop("benchmarkOutputFactor")
        result = benchmarks._annual_company_intensity(state, 2024, "water")
        self.assertIsNone(result["value"])
        self.assertEqual(result["status"], "unavailable")

    def test_official_csv_is_validated_and_normalized(self):
        with tempfile.TemporaryDirectory(dir=TEST_TEMP_PARENT) as directory:
            path = Path(directory) / "snapshots.csv"
            columns = sorted(benchmarks.SNAPSHOT_REQUIRED_COLUMNS | {"denominator_unit", "note", "quality", "region", "sector_code", "retrieved_at"})
            row = {
                "source_id": "dane-eai",
                "source_name": "DANE EAI",
                "resource": "water",
                "indicator": "Retirada de agua",
                "value": "15.2",
                "unit": "m3/1000 L",
                "denominator_unit": "1000 L de producto",
                "period_start": "2024-01-01",
                "period_end": "2024-12-31",
                "country_code": "CO",
                "country": "Colombia",
                "region": "Antioquia",
                "sector_code": "1104",
                "source_url": "https://www.dane.gov.co/",
                "published_at": "2025-12-01",
                "retrieved_at": "2026-10-23T00:00:00+00:00",
                "quality": "official_statistic",
                "comparability": "direct",
                "note": "Ejemplo revisado",
            }
            with path.open("w", newline="", encoding="utf-8") as stream:
                writer = csv.DictWriter(stream, fieldnames=columns)
                writer.writeheader()
                writer.writerow(row)
            normalized = benchmarks.load_official_snapshot_csv(path)
            self.assertEqual(normalized[0]["sourceId"], "dane-eai")
            self.assertEqual(normalized[0]["value"], 15.2)

            row["denominator_unit"] = ""
            with path.open("w", newline="", encoding="utf-8") as stream:
                writer = csv.DictWriter(stream, fieldnames=columns)
                writer.writeheader()
                writer.writerow(row)
            with self.assertRaisesRegex(ValueError, "unidad denominadora"):
                benchmarks.load_official_snapshot_csv(path)

    def test_cache_is_read_without_network_and_stale_cache_survives_failed_refresh(self):
        fresh_at = datetime.now(timezone.utc).isoformat()
        cache = {
            "unsd": {"fetchedAt": fresh_at, "observations": [{"id": "cached-unsd", "sourceId": "unsd", "resource": "water", "indicator": "ODS", "value": 2, "unit": "USD/m3", "periodStart": "2024-01-01", "periodEnd": "2024-12-31", "countryCode": "CO", "country": "Colombia", "sourceUrl": "https://unstats.un.org/", "retrievedAt": fresh_at, "comparability": "contextual"}]},
            "xm": {"fetchedAt": fresh_at, "observations": []},
        }
        saves: list[str] = []

        def load_cache(source_id: str):
            return cache.get(source_id)

        def save_cache(source_id, _payload, _fetched_at, _error):
            saves.append(source_id)

        with tempfile.TemporaryDirectory(dir=TEST_TEMP_PARENT) as directory:
            path = Path(directory) / "empty.csv"
            get = lambda: self.fail("Una lectura GET no debe iniciar una consulta de red")
            response = benchmarks.get_benchmark_response(
                _empty_state(),
                load_cache=load_cache,
                save_cache=save_cache,
                snapshot_path=path,
                unsd_fetcher=get,
                xm_fetcher=get,
            )
            self.assertIn("cached-unsd", [row["id"] for row in [item["reference"] for item in response["comparisons"]]])
            self.assertEqual(saves, [])

            fresh_calls: list[str] = []
            limited = benchmarks.get_benchmark_response(
                _empty_state(),
                load_cache=load_cache,
                save_cache=save_cache,
                snapshot_path=path,
                force_refresh=True,
                unsd_fetcher=lambda: fresh_calls.append("unsd") or [],
                xm_fetcher=lambda: fresh_calls.append("xm") or [],
            )
            self.assertEqual(fresh_calls, [])
            self.assertIn("5 minutos", next(source for source in limited["sources"] if source["id"] == "unsd")["error"])

            stale_cache = {"unsd": {"fetchedAt": "2020-01-01T00:00:00+00:00", "observations": [{"id": "old-unsd", "sourceId": "unsd"}]}}
            saves.clear()
            response = benchmarks.get_benchmark_response(
                _empty_state(),
                load_cache=lambda source_id: stale_cache.get(source_id),
                save_cache=save_cache,
                snapshot_path=path,
                force_refresh=True,
                unsd_fetcher=lambda: (_ for _ in ()).throw(TimeoutError("offline")),
                xm_fetcher=lambda: (_ for _ in ()).throw(ConnectionError("offline")),
            )
            unsd_status = next(source for source in response["sources"] if source["id"] == "unsd")
            self.assertEqual(unsd_status["status"], "stale")
            self.assertTrue(unsd_status["stale"])
            self.assertIn("old-unsd", [item["reference"]["id"] for item in response["comparisons"]])
            self.assertIn("unsd", saves)

    def test_retry_after_is_bounded_and_retries_transient_http_status(self):
        calls = 0
        sleeps: list[float] = []

        def opener(_request, timeout):
            nonlocal calls
            self.assertGreater(timeout, 0)
            calls += 1
            if calls == 1:
                raise urllib.error.HTTPError("https://example.test", 429, "Too Many", {"Retry-After": "60"}, io.BytesIO())
            return _JsonResponse({"ok": True})

        payload = benchmarks.request_json("https://example.test", opener=opener, sleeper=sleeps.append)
        self.assertEqual(payload, {"ok": True})
        self.assertEqual(calls, 2)
        self.assertEqual(sleeps, [5.0])

    def test_server_errors_timeouts_and_changed_schemas_fail_without_fabricating_values(self):
        server_calls = 0

        def server_error(_request, timeout):
            nonlocal server_calls
            server_calls += 1
            raise urllib.error.HTTPError("https://example.test", 503, "Unavailable", {}, io.BytesIO())

        with self.assertRaises(urllib.error.HTTPError):
            benchmarks.request_json("https://example.test", opener=server_error, sleeper=lambda _delay: None)
        self.assertEqual(server_calls, benchmarks.MAX_RETRIES + 1)

        timeout_calls = 0

        def timeout(_request, timeout):
            nonlocal timeout_calls
            timeout_calls += 1
            raise TimeoutError("slow")

        with self.assertRaises(TimeoutError):
            benchmarks.request_json("https://example.test", opener=timeout, sleeper=lambda _delay: None)
        self.assertEqual(timeout_calls, benchmarks.MAX_RETRIES + 1)

        with self.assertRaisesRegex(ValueError, "estructura de datos"):
            benchmarks.normalize_xm_demand({"Unexpected": []}, unit="MWh")


class BenchmarkRoutePermissionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_directory = tempfile.TemporaryDirectory(dir=TEST_TEMP_PARENT)
        root = Path(cls.temp_directory.name)
        server_module.DATA_DIR = root
        server_module.DB_PATH = root / "test.sqlite3"
        server_module.BACKUP_DIR = root / "backups"
        server_module.BENCHMARK_DIR = root / "benchmarks"
        server_module.BENCHMARK_SNAPSHOT_PATH = root / "benchmarks" / "official_snapshots.csv"
        server_module.BENCHMARK_TEMPLATE_PATH = SERVER_PATH.parent / "benchmark-data" / "official_snapshots.template.csv"
        server_module.initialize_database()
        cls.tokens: dict[str, str] = {}
        now = datetime.now(timezone.utc)
        with server_module.db_session() as connection:
            for role in ("admin", "operator", "viewer"):
                user_id = f"user-{role}"
                token = f"token-{role}"
                cls.tokens[role] = token
                connection.execute(
                    """INSERT INTO users (id, username, display_name, role, active, password_salt,
                       password_hash, password_algorithm, password_iterations, created_at)
                       VALUES (?, ?, ?, ?, 1, '', '', 'test', 0, ?)""",
                    (user_id, user_id, user_id, role, now.isoformat()),
                )
                connection.execute(
                    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                    (hashlib.sha256(token.encode()).hexdigest(), user_id, now.isoformat(), (now + timedelta(hours=1)).isoformat()),
                )
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server_module.Pyme360Handler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.httpd.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=2)
        cls.temp_directory.cleanup()

    def request(self, path: str, method: str = "GET", role: str | None = None) -> tuple[int, dict]:
        headers = {}
        if role:
            headers["Cookie"] = f"pyme360_session={self.tokens[role]}"
        data = b"{}" if method == "POST" else None
        if data:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.base_url + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=2) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            status = error.code
            payload = json.loads(error.read())
            error.close()
            return status, payload

    def test_references_require_session_and_are_readable_by_viewer(self):
        status, _ = self.request("/api/v1/environment/benchmarks")
        self.assertEqual(status, 401)
        status, payload = self.request("/api/v1/environment/benchmarks", role="viewer")
        self.assertEqual(status, 200)
        self.assertIn("comparisons", payload)
        self.assertTrue(any(row["id"] == "company-public" for row in payload["sources"]))

    def test_refresh_is_forbidden_to_viewer_and_allowed_to_operator_and_admin(self):
        status, _ = self.request("/api/v1/environment/benchmarks/refresh", "POST", "viewer")
        self.assertEqual(status, 403)
        with patch.object(server_module, "current_benchmark_payload", return_value={"comparisons": [], "sources": [], "profile": {}, "refreshedAt": None}) as refresh:
            for role in ("operator", "admin"):
                status, _ = self.request("/api/v1/environment/benchmarks/refresh", "POST", role)
                self.assertEqual(status, 200)
            self.assertEqual(refresh.call_count, 2)


if __name__ == "__main__":
    unittest.main()
