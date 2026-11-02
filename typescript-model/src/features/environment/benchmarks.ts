import type { EnvironmentalBenchmarkResponse } from "../../domain/types";

const BENCHMARKS_PATH = "/api/v1/environment/benchmarks";
const REFRESH_PATH = BENCHMARKS_PATH + "/refresh";

async function requestBenchmarks(
  path: string,
  method: "GET" | "POST",
): Promise<EnvironmentalBenchmarkResponse> {
  const response = await fetch(path, {
    method,
    cache: "no-store",
    credentials: "same-origin",
    headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
    body: method === "POST" ? "{}" : undefined,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "error" in payload
        ? String(payload.error)
        : "No se pudieron consultar las referencias ambientales.";
    throw new Error(message);
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    !Array.isArray((payload as EnvironmentalBenchmarkResponse).comparisons) ||
    !Array.isArray((payload as EnvironmentalBenchmarkResponse).sources)
  )
    throw new Error("El servidor devolvió referencias ambientales con un formato no válido.");
  return payload as EnvironmentalBenchmarkResponse;
}

export function loadEnvironmentalBenchmarks(): Promise<EnvironmentalBenchmarkResponse> {
  return requestBenchmarks(BENCHMARKS_PATH, "GET");
}

export function refreshEnvironmentalBenchmarks(): Promise<EnvironmentalBenchmarkResponse> {
  return requestBenchmarks(REFRESH_PATH, "POST");
}
