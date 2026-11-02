from __future__ import annotations

import sys
import unittest
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_DIR / "cloud"))

from validation import BusinessValidationError, validate_business_records


def valid_records() -> dict[str, dict[str, dict]]:
    return {
        "products": {
            "finished": {
                "id": "finished", "name": "Producto terminado", "type": "finished",
                "stock": 4, "minimumStock": 1, "unitCost": 10, "unitPrice": 100,
                "vatRate": 19, "recipe": [],
            },
            "material": {
                "id": "material", "name": "Materia prima", "type": "raw_material",
                "stock": 10, "minimumStock": 1, "unitCost": 5, "unitPrice": 0,
                "vatRate": 0, "recipe": [],
            },
        },
        "contacts": {"customer": {"id": "customer", "role": "customer"}},
        "inventoryMovements": {
            "opening-finished": {"id": "opening-finished", "productId": "finished", "quantity": 4, "balanceAfter": 4},
            "opening-material": {"id": "opening-material", "productId": "material", "quantity": 10, "balanceAfter": 10},
        },
        "financialAccounts": {"cash": {"id": "cash", "openingBalance": 20}},
        "sales": {
            "sale-1": {
                "id": "sale-1", "customerId": "customer", "subtotal": 100,
                "discount": 10, "vatAmount": 17.1, "total": 107.1,
                "lines": [{
                    "productId": "finished", "quantity": 1, "subtotal": 100,
                    "discountShare": 10, "vatAmount": 17.1, "total": 107.1,
                }],
                "payments": [{"id": "payment-1", "amount": 20, "accountId": "cash", "date": "2026-10-30"}],
            }
        },
        "purchases": {
            "purchase-1": {
                "id": "purchase-1", "supplierId": "customer", "total": 50,
                "payableAmount": 40,
                "lines": [{"productId": "material", "quantity": 2, "lineTotal": 50}],
                "payments": [{"id": "purchase-payment-1", "amount": 10, "accountId": "cash"}],
            }
        },
        "cashMovements": {
            "cash-movement-1": {"id": "cash-movement-1", "accountId": "cash", "amount": 20, "direction": "in", "date": "2026-10-30"}
        },
        "productionOrders": {
            "order-1": {
                "id": "order-1", "productId": "finished", "quantity": 2,
                "wasteQuantity": 0,
                "consumedMaterials": [{"productId": "material", "quantity": 3}],
            }
        },
        "resourceReadings": {
            "reading-1": {
                "id": "reading-1", "quantity": 100, "unit": "kWh",
                "periodStart": "2026-10-01", "periodEnd": "2026-10-31",
                "resource": "electricity", "activity": "consumption",
            }
        },
        "environmentalRecords": {
            "environment-1": {
                "id": "environment-1", "period": "2026-10", "electricityKwh": 100,
                "waterM3": 4, "fuelLiters": 0, "productionUnits": 100,
                "wasteKg": 10, "recoveredKg": 4,
            }
        },
        "emissionFactors": {
            "factor-1": {"id": "factor-1", "kgCo2ePerUnit": 0.2, "year": 2024, "activityUnit": "kWh", "version": "2024-v1", "source": "Fuente oficial"}
        },
        "indicatorTargets": {
            "target-1": {"id": "target-1", "baselineValue": 10, "reductionPercent": 5, "horizonMonths": 6}
        },
        "receiptImports": {
            "receipt-1": {"id": "receipt-1", "extraction": {"billedAmount": 500, "confidence": 0.92}}
        },
    }


class CloudBusinessValidationTests(unittest.TestCase):
    def test_accepts_consistent_operational_snapshot(self) -> None:
        validate_business_records(valid_records())

    def test_accepts_versioned_batch_recipe(self) -> None:
        records = valid_records()
        records["recipes"] = {
            "recipe-1": {
                "id": "recipe-1",
                "productId": "finished",
                "activeVersionId": "version-1",
                "versions": [{
                    "id": "version-1",
                    "versionNumber": 1,
                    "status": "active",
                    "baseQuantity": 10,
                    "expectedYieldPercent": 92.5,
                    "components": [{"productId": "material", "quantity": 20}],
                }],
            }
        }
        validate_business_records(records)

    def test_rejects_recipe_with_finished_product_or_duplicate_active_version(self) -> None:
        records = valid_records()
        records["recipes"] = {
            "recipe-1": {
                "id": "recipe-1",
                "productId": "finished",
                "activeVersionId": "version-1",
                "versions": [{
                    "id": "version-1",
                    "versionNumber": 1,
                    "status": "active",
                    "baseQuantity": 10,
                    "expectedYieldPercent": 90,
                    "components": [{"productId": "finished", "quantity": 2}],
                }],
            }
        }
        with self.assertRaisesRegex(BusinessValidationError, "solo puede utilizar materiales"):
            validate_business_records(records)

        records["recipes"]["recipe-1"]["versions"][0]["components"][0]["productId"] = "material"
        records["recipes"]["recipe-1"]["versions"].append({
            "id": "version-2",
            "versionNumber": 2,
            "status": "active",
            "baseQuantity": 10,
            "expectedYieldPercent": 90,
            "components": [{"productId": "material", "quantity": 5}],
        })
        with self.assertRaisesRegex(BusinessValidationError, "única versión activa"):
            validate_business_records(records)

    def test_accepts_non_negative_production_cost_snapshots(self) -> None:
        records = valid_records()
        records["productionOrders"]["order-1"].update(
            {"estimatedMaterialCost": 15, "materialCostPerGoodUnit": 7.5}
        )
        records["productionOrders"]["order-1"]["consumedMaterials"][0].update(
            {"unitCostSnapshot": 5, "lineCostSnapshot": 15}
        )
        validate_business_records(records)

    def test_rejects_negative_production_cost_snapshots(self) -> None:
        records = valid_records()
        records["productionOrders"]["order-1"]["consumedMaterials"][0]["lineCostSnapshot"] = -1
        with self.assertRaisesRegex(BusinessValidationError, "fuera del rango"):
            validate_business_records(records)

    def test_rejects_sale_above_available_stock_and_inconsistent_totals(self) -> None:
        records = valid_records()
        records["sales"]["sale-1"]["payments"][0]["amount"] = 500
        with self.assertRaisesRegex(BusinessValidationError, "superan"):
            validate_business_records(records)

    def test_rejects_purchase_total_that_does_not_match_lines(self) -> None:
        records = valid_records()
        records["purchases"]["purchase-1"]["total"] = 75
        with self.assertRaisesRegex(BusinessValidationError, "no coincide"):
            validate_business_records(records)

    def test_rejects_missing_cash_account_and_invalid_resource_period(self) -> None:
        records = valid_records()
        records["cashMovements"]["cash-movement-1"]["accountId"] = "missing"
        with self.assertRaisesRegex(BusinessValidationError, "cuenta inexistente"):
            validate_business_records(records)

        records = valid_records()
        records["resourceReadings"]["reading-1"]["periodEnd"] = "2026-09-30"
        with self.assertRaisesRegex(BusinessValidationError, "termina antes"):
            validate_business_records(records)

    def test_rejects_temporary_ocr_text_from_being_synced(self) -> None:
        records = valid_records()
        records["receiptImports"]["receipt-1"]["extraction"]["textPreview"] = "texto transitorio"
        with self.assertRaisesRegex(BusinessValidationError, "OCR temporal"):
            validate_business_records(records)

    def test_rejects_unbalanced_stock_and_recovered_waste_above_generated(self) -> None:
        records = valid_records()
        records["products"]["finished"]["stock"] = 5
        with self.assertRaisesRegex(BusinessValidationError, "no coinciden"):
            validate_business_records(records)

        records = valid_records()
        records["environmentalRecords"]["environment-1"]["recoveredKg"] = 12
        with self.assertRaisesRegex(BusinessValidationError, "no puede superar"):
            validate_business_records(records)


if __name__ == "__main__":
    unittest.main()
