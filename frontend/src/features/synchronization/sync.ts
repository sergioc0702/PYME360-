export interface SyncConflict {
  conflictId: string;
  batchId: string;
  entityType: string;
  entityId: string;
  localChange: Record<string, unknown>;
  remoteChange: Record<string, unknown>;
  createdAt: string;
}

export interface CloudSyncStatus {
  configured: boolean;
  workspaceId: string | null;
  centralUserId: string | null;
  centralEmail: string | null;
  apiUrl: string | null;
  deviceId: string | null;
  cursor: number;
  pendingBatches: number;
  rejectedBatches: number;
  rejectedRecords: Array<{ batchId: string; createdAt: string; error: string }>;
  pendingErrors: Array<{ batchId: string; createdAt: string; error: string }>;
  centralAuthError: "reauthenticate" | "role_mismatch" | null;
  message?: string;
  acceptedBatches: number;
  conflicts: number;
  lastSyncedAt: string | null;
  connectedForCurrentUser: boolean;
  secureStoreAvailable: boolean;
  conflictRecords: SyncConflict[];
  lastValidation: {
    checkedAt: string;
    matches: boolean;
    localCounts: Record<string, number>;
    centralCounts: Record<string, number>;
  } | null;
}

export interface CreateWorkspaceInput {
  apiUrl: string;
  email: string;
  password: string;
  displayName: string;
  organizationName: string;
}

export interface ConnectWorkspaceInput {
  apiUrl: string;
  workspaceId: string;
  email: string;
  password: string;
}

export interface CloudInvitationInput {
  email: string;
  role: "admin" | "operator" | "viewer";
}

export interface CloudMember {
  id: string;
  email: string;
  display_name: string;
  role: "admin" | "operator" | "viewer";
  active: boolean;
  emailVerified: boolean;
  created_at: string;
}

async function requestJson<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "error" in payload
        ? String(payload.error)
        : "La operación de sincronización no pudo completarse.";
    throw new Error(message);
  }
  return payload as T;
}

export function getCloudSyncStatus(): Promise<CloudSyncStatus> {
  return requestJson("/api/v1/sync/status");
}

export function synchronizeNow(): Promise<CloudSyncStatus & { pushedBatches: number; pulledRecords: number }> {
  return requestJson("/api/v1/sync/run", "POST", {});
}

export function confirmCentralQuotation(quotationId: string, expectedRevision: number): Promise<{ saleId: string }> {
  return requestJson("/api/v1/sync/convert-quotation", "POST", { quotationId, expectedRevision });
}

export function rebuildAndRetryRejectedBatch(): Promise<CloudSyncStatus & {
  rebuiltBatchId: string;
  rebuiltChanges: number;
}> {
  return requestJson("/api/v1/sync/retry-rejected", "POST", {});
}

export function registerCloudWorkspace(input: CreateWorkspaceInput): Promise<Record<string, unknown>> {
  return requestJson("/api/v1/sync/register", "POST", input);
}

export function connectCloudWorkspace(input: ConnectWorkspaceInput): Promise<Record<string, unknown>> {
  return requestJson("/api/v1/sync/connect", "POST", input);
}

export function inviteCloudMember(input: CloudInvitationInput): Promise<Record<string, unknown>> {
  return requestJson("/api/v1/sync/invitations", "POST", input);
}

export async function getCloudMembers(): Promise<CloudMember[]> {
  const result = await requestJson<{ members: CloudMember[] }>("/api/v1/sync/members");
  return result.members;
}

export function updateCloudMember(
  userId: string,
  input: { role?: CloudMember["role"]; active?: boolean },
): Promise<Record<string, unknown>> {
  return requestJson(`/api/v1/sync/members/${encodeURIComponent(userId)}`, "POST", input);
}

export function revokeCloudMemberSessions(userId: string): Promise<Record<string, unknown>> {
  return requestJson(
    `/api/v1/sync/members/${encodeURIComponent(userId)}/revoke-sessions`,
    "POST",
    {},
  );
}

export function resolveCloudConflict(
  conflictId: string,
  resolution: "local" | "remote",
): Promise<{ resolved: boolean; resolution: string }> {
  return requestJson(
    `/api/v1/sync/conflicts/${encodeURIComponent(conflictId)}/resolve`,
    "POST",
    { resolution },
  );
}
