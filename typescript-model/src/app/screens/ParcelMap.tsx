import type { AppState } from "../../domain/types";
import { calculateConsumptionParcels, layoutParcels } from "../../domain/insights";
import { formatPeriod } from "../../shared/format";
import { formatMoney, formatNumber } from "../AppViews";

/** Mapa de parcelas: cada área es del tamaño de lo que se gasta. */
export function ParcelMap({ state, period }: { state: AppState; period: string }) {
  const parcels = calculateConsumptionParcels(state, period);
  if (!parcels.length)
    return (
      <p className="screen-empty">
        Cuando registres tus recibos y tu producción, aquí verás en qué se va tu consumo.
      </p>
    );
  const byProduct = parcels.some((item) => item.label !== "Energía" && item.label !== "Agua");
  const hasWater = parcels.some((item) => item.label === "Agua");
  const label = (value: number, unit: string) =>
    unit === "COP" ? formatMoney(value) : `${formatNumber(value, 0)} ${unit}`;
  return (
    <>
      <div className="home-parcels" aria-hidden="true">
        {layoutParcels(parcels).map((parcel, index) => (
          <div
            className="home-parcel"
            data-field={index % 5}
            key={parcel.label}
            style={{
              left: `${parcel.x}%`,
              top: `${parcel.y}%`,
              width: `${parcel.width}%`,
              height: `${parcel.height}%`,
            }}
          >
            {parcel.width * parcel.height >= 900 && (
              <>
                <strong>{parcel.label}</strong>
                <small>{label(parcel.value, parcel.unit)}</small>
              </>
            )}
          </div>
        ))}
      </div>
      <ul className="home-parcel-list">
        {parcels.map((parcel, index) => (
          <li key={parcel.label}>
            <i data-field={index % 5} aria-hidden="true" />
            <span>{parcel.label}</span>
            <strong>{label(parcel.value, parcel.unit)}</strong>
          </li>
        ))}
      </ul>
      <p className="screen-note">
        Datos de {formatPeriod(period)}.{" "}
        {byProduct
          ? "Cada producto muestra su parte de la energía, repartida según las unidades terminadas. Es una aproximación."
          : "Cuando termines órdenes de producción verás la energía por producto."}
        {hasWater && " El agua es de toda la empresa."}
      </p>
    </>
  );
}
