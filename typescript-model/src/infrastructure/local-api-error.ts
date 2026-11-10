export class LocalApiError extends Error {
  readonly incidentId: string | undefined;

  constructor(payload: unknown, fallback: string) {
    const data = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const message = typeof data.error === "string" ? data.error : fallback;
    const incidentId =
      typeof data.incidentId === "string" && /^[a-f0-9]{32}$/.test(data.incidentId)
        ? data.incidentId
        : undefined;
    super(
      incidentId ? `${message} Si necesitas ayuda, comparte este código: ${incidentId}` : message,
    );
    this.name = "LocalApiError";
    this.incidentId = incidentId;
  }
}
