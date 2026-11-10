import { LocalApiError } from "./local-api-error";

export type UserRole = "admin" | "operator" | "viewer";

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
}

const USERS_KEY = "pyme360.auth.users.v1";
const AUTH_API = "/api/v1/auth";

export interface AuthStatus {
  setupRequired: boolean;
  user: AuthUser | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { cache: "no-store", credentials: "same-origin", ...init });
  } catch {
    throw new Error(
      "No se pudo conectar con el servidor local de Pyme360. Ábrelo con el lanzador e inténtalo de nuevo.",
    );
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new LocalApiError(payload, "La operación de autenticación no se pudo completar.");
  }
  return payload as T;
}

async function migrateLegacyUsers(): Promise<void> {
  let legacyUsers: unknown = [];
  try {
    const stored = window.localStorage.getItem(USERS_KEY);
    if (stored) legacyUsers = JSON.parse(stored) as unknown;
  } catch {
    legacyUsers = [];
  }
  if (!Array.isArray(legacyUsers) || legacyUsers.length === 0) return;
  await request<{ migrated: boolean }>(`${AUTH_API}/migrate-legacy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ users: legacyUsers }),
  });
  window.localStorage.removeItem(USERS_KEY);
  window.localStorage.removeItem("pyme360.auth.session.v1");
}

export async function initializeAuth(): Promise<AuthStatus> {
  await migrateLegacyUsers();
  return request<AuthStatus>(`${AUTH_API}/status`);
}

export async function listUsers(): Promise<AuthUser[]> {
  const result = await request<{ users: AuthUser[] }>(`${AUTH_API}/users`);
  return result.users;
}

export async function clearSession(): Promise<void> {
  await request<{ ok: boolean }>(`${AUTH_API}/logout`, { method: "POST" });
}

export async function createFirstAdmin(username: string, password: string): Promise<AuthUser> {
  const result = await request<{ user: AuthUser }>(`${AUTH_API}/bootstrap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return result.user;
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const result = await request<{ user: AuthUser }>(`${AUTH_API}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return result.user;
}

export async function createUser(
  username: string,
  password: string,
  role: UserRole,
  displayName = username,
): Promise<AuthUser> {
  const result = await request<{ user: AuthUser }>(`${AUTH_API}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, role, displayName }),
  });
  return result.user;
}

export async function updateUserRole(userId: string, role: UserRole): Promise<AuthUser> {
  const result = await request<{ user: AuthUser }>(
    `${AUTH_API}/users/${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    },
  );
  return result.user;
}

export async function changeOwnPassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await request<{ ok: boolean }>(`${AUTH_API}/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export async function resetUserPassword(userId: string, password: string): Promise<void> {
  await request<{ ok: boolean }>(`${AUTH_API}/users/${encodeURIComponent(userId)}/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

export async function deleteUser(userId: string): Promise<void> {
  await request<{ ok: boolean }>(`${AUTH_API}/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
}

export async function setUserActive(userId: string, active: boolean): Promise<AuthUser> {
  const result = await request<{ user: AuthUser }>(
    `${AUTH_API}/users/${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    },
  );
  return result.user;
}
