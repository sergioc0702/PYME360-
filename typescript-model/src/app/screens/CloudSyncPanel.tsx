import { useEffect, useState, type FormEvent } from "react";
import { Modal, PAGE_TITLES } from "../AppViews";
import type { UserRole } from "../../infrastructure/auth";
import {
  connectCloudWorkspace,
  getCloudMembers,
  getCloudSyncStatus,
  inviteCloudMember,
  rebuildAndRetryRejectedBatch,
  registerCloudWorkspace,
  resolveCloudConflict,
  revokeCloudMemberSessions,
  synchronizeNow,
  updateCloudMember,
  type CloudMember,
  type CloudSyncStatus,
} from "../../features/synchronization/sync";

function fieldClassName() {
  return "min-h-11 w-full rounded-xl border border-control bg-surface px-3 py-2 text-sm text-ink outline-none transition focus-visible:border-brand focus-visible:ring-4 focus-visible:ring-brand/10";
}

function readableEntity(entityType: string) {
  return PAGE_TITLES[entityType as keyof typeof PAGE_TITLES] ?? entityType;
}

export function CloudSyncPanel({
  role,
  onClose,
  onStatus,
}: {
  role: UserRole;
  onClose: () => void;
  onStatus: (status: CloudSyncStatus) => void;
}) {
  const [status, setStatus] = useState<CloudSyncStatus | null>(null);
  const [mode, setMode] = useState<"connect" | "register">("connect");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [verificationLink, setVerificationLink] = useState("");
  const [invitationMessage, setInvitationMessage] = useState("");
  const [members, setMembers] = useState<CloudMember[]>([]);
  const [memberRoles, setMemberRoles] = useState<Record<string, CloudMember["role"]>>({});

  async function refresh() {
    try {
      const next = await getCloudSyncStatus();
      setStatus(next);
      onStatus(next);
      if (next.configured && next.connectedForCurrentUser && role === "admin") {
        try {
          const nextMembers = await getCloudMembers();
          setMembers(nextMembers);
          setMemberRoles(Object.fromEntries(nextMembers.map((member) => [member.id, member.role])));
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "No se pudieron consultar las cuentas centrales.");
        }
      }
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo consultar la sincronización.");
      return null;
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleWorkspaceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    const apiUrlValue = String(form.get("apiUrl") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    try {
      if (mode === "register") {
        const result = await registerCloudWorkspace({
          apiUrl: apiUrlValue,
          email,
          password,
          displayName: String(form.get("displayName") ?? "").trim(),
          organizationName: String(form.get("organizationName") ?? "").trim(),
        });
        const id = String(result.workspaceId ?? result.organizationId ?? "");
        setWorkspaceId(id);
        setApiUrl(apiUrlValue);
        setVerificationLink(String(result.verificationUrl ?? ""));
        setMode("connect");
        setMessage(
          id
            ? `Verifica el correo enviado. Guarda este identificador de empresa: ${id}. Después de verificarlo, conecta la cuenta.`
            : "Se solicitó la creación del espacio. Verifica el correo para continuar.",
        );
      } else {
        const connection = await connectCloudWorkspace({
          apiUrl: apiUrlValue,
          workspaceId: String(form.get("workspaceId") ?? "").trim(),
          email,
          password,
        });
        setApiUrl(apiUrlValue);
        const backupPath = String(connection.preCloudBackup ?? "");
        setMessage(
          connection.hasSyncedData
            ? "Cuenta vinculada. Se descargarán los registros centrales al almacenamiento SQLite local."
            : `Cuenta vinculada. Los datos locales permanecen en SQLite.${backupPath ? ` Copia previa guardada en ${backupPath}.` : " La base aún no contenía datos que respaldar."}`,
        );
        const next = await refresh();
        if (next && navigator.onLine) {
          const synced = await synchronizeNow();
          setStatus(synced);
          onStatus(synced);
          if (synced.lastValidation) {
            setMessage(synced.lastValidation.matches
              ? "Sincronización inicial verificada: los conteos locales y centrales coinciden."
              : "Los cambios se procesaron. Hay registros pendientes o un conteo distinto; revisa el estado y vuelve a sincronizar.");
          }
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo completar la operación.");
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const next = await synchronizeNow();
      setStatus(next);
      onStatus(next);
      setMessage(next.message || (next.lastValidation?.matches
        ? `Sincronización verificada: ${next.pushedBatches} lotes enviados, ${next.pulledRecords} cambios recibidos y los conteos coinciden.`
        : `Sincronización terminada: ${next.pushedBatches} lotes enviados y ${next.pulledRecords} cambios recibidos. La verificación queda pendiente o muestra diferencias.`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo sincronizar.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function retryRejectedBatch() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const rebuilt = await rebuildAndRetryRejectedBatch();
      setStatus(rebuilt);
      onStatus(rebuilt);
      const next = await synchronizeNow();
      setStatus(next);
      onStatus(next);
      const latestRejection = next.rejectedRecords?.[0];
      if (latestRejection) {
        setMessage(`El servidor aún no aceptó el lote reconstruido. Corrige el dato indicado y vuelve a intentar: ${latestRejection.error}`);
      } else if (next.conflicts > 0) {
        setMessage("El lote corregido fue enviado, pero contiene cambios concurrentes. Revisa y resuelve el conflicto.");
      } else if (next.pendingBatches > 0) {
        setMessage("El lote corregido quedó guardado y pendiente. Pyme360 lo enviará cuando el servidor esté disponible.");
      } else {
        setMessage(`Lote corregido aceptado por la empresa central (${rebuilt.rebuiltChanges} registros).`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo reconstruir el lote rechazado.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function sendInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invitationForm = event.currentTarget;
    setInvitationMessage("");
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await inviteCloudMember({
        email: String(form.get("inviteEmail") ?? "").trim(),
        role: String(form.get("inviteRole") ?? "operator") as "admin" | "operator" | "viewer",
      });
      setInvitationMessage(String(result.message ?? "Invitación enviada."));
      invitationForm.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo enviar la invitación.");
    }
  }

  async function resolveConflict(conflictId: string, resolution: "local" | "remote") {
    setBusy(true);
    setError("");
    try {
      await resolveCloudConflict(conflictId, resolution);
      setMessage("Conflicto resuelto. Sincroniza de nuevo para enviar los cambios restantes.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo resolver el conflicto.");
    } finally {
      setBusy(false);
    }
  }

  async function saveMemberRole(member: CloudMember) {
    const nextRole = memberRoles[member.id] ?? member.role;
    if (nextRole === member.role) return;
    if (!window.confirm(`¿Cambiar el rol de ${member.email} de ${member.role} a ${nextRole}?`)) return;
    setBusy(true);
    setError("");
    try {
      await updateCloudMember(member.id, { role: nextRole });
      setMembers((items) => items.map((item) => item.id === member.id ? { ...item, role: nextRole } : item));
      setMessage("Rol central actualizado. Actualiza también el rol local en Usuarios para mantener el acceso sin conexión.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cambiar el rol.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function toggleMember(member: CloudMember) {
    const action = member.active ? "bloquear" : "activar";
    if (!window.confirm(`¿${action} la cuenta central de ${member.email}?`)) return;
    setBusy(true);
    setError("");
    try {
      await updateCloudMember(member.id, { active: !member.active });
      setMembers((items) => items.map((item) => item.id === member.id ? { ...item, active: !member.active } : item));
      setMessage(member.active
        ? "Cuenta bloqueada y sesiones centrales revocadas. Bloquea también su cuenta local en Usuarios para impedir nuevas operaciones offline."
        : "Cuenta central activada; revisa también su cuenta local antes de autorizar trabajo sin conexión.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cambiar el estado de la cuenta.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeSessions(member: CloudMember) {
    if (!window.confirm(`¿Cerrar todas las sesiones centrales de ${member.email}?`)) return;
    setBusy(true);
    setError("");
    try {
      const result = await revokeCloudMemberSessions(member.id);
      setMessage(`Se revocaron ${String(result.revoked ?? 0)} sesiones.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron revocar las sesiones.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Sincronización y equipo" onClose={onClose} wide>
      <div className="grid gap-5 p-4 sm:p-6">
        <section className="rounded-2xl border border-line bg-surface-muted p-4" aria-live="polite">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <strong className="text-sm font-bold text-ink">
                {status?.configured ? "Espacio de empresa" : "Modo local"}
              </strong>
              <p className="mt-1 mb-0 text-sm text-muted">
                {status?.configured
                  ? `Empresa ${status.workspaceId} · ${status.pendingBatches} pendientes · ${status.rejectedBatches} rechazados · ${status.conflicts} conflictos`
                  : "SQLite sigue guardando todos los cambios en este computador. Conecta una API central para compartirlos con otros equipos."}
              </p>
              {status?.configured && (
                <p className="mt-1 mb-0 text-xs text-muted">
                  {status.connectedForCurrentUser
                    ? "Esta cuenta local está vinculada a la organización."
                    : "Vincula la cuenta de empresa para autenticar las operaciones de este usuario."}
                  {status.lastSyncedAt ? ` Última actividad: ${new Date(status.lastSyncedAt).toLocaleString("es-CO")}.` : ""}
                </p>
              )}
              {status?.configured && status.lastValidation && (
                <p className={`mt-3 mb-0 text-xs ${status.lastValidation.matches ? "text-notice-ink" : "text-warning-text"}`}>
                  {status.lastValidation.matches ? "Conteos locales y centrales verificados." : "Hay cambios provisionales o conteos por revisar."}
                  {` Revisión: ${new Date(status.lastValidation.checkedAt).toLocaleString("es-CO")}.`}
                </p>
              )}
              {status?.centralAuthError && (
                <p role="alert" className="mt-3 mb-0 rounded-lg border border-warning-line bg-warning-soft p-3 text-sm text-warning-text">
                  {status.centralAuthError === "reauthenticate"
                    ? "La sesión central venció o fue revocada. Vuelve a conectar la cuenta; tus cambios permanecen guardados en SQLite."
                    : "El rol central de esta cuenta no permite enviar cambios. Alinea el rol local y el central en Usuarios y vuelve a sincronizar."}
                </p>
              )}
            </div>
            {status?.secureStoreAvailable === false && (
              <p className="mt-3 mb-0 text-xs text-warning-text">
                Para guardar el token con seguridad instala la integración del sistema: <code>py -m pip install -r server/requirements-sync.txt</code>.
              </p>
            )}
            {status?.configured && (
              <button className="button button-primary" type="button" disabled={busy} onClick={() => void syncNow()}>
                {busy ? "Sincronizando…" : "Sincronizar ahora"}
              </button>
            )}
          </div>
        </section>

        {!status?.configured || !status.connectedForCurrentUser ? (
          <section className="grid gap-4">
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Cuenta en la nube">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "connect"}
                className={`button ${mode === "connect" ? "button-primary" : "button-secondary"}`}
                onClick={() => setMode("connect")}
              >
                Conectar cuenta
              </button>
              {role === "admin" && !status?.configured && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "register"}
                  className={`button ${mode === "register" ? "button-primary" : "button-secondary"}`}
                  onClick={() => setMode("register")}
                >
                  Crear empresa
                </button>
              )}
            </div>
            <form className="grid gap-4" onSubmit={(event) => void handleWorkspaceSubmit(event)}>
              <label className="grid gap-1.5 text-sm font-semibold text-label">
                Dirección de la API central
                <input className={fieldClassName()} name="apiUrl" type="url" required value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} placeholder="https://api.tuempresa.com" />
              </label>
              {mode === "register" ? (
                <>
                  <label className="grid gap-1.5 text-sm font-semibold text-label">
                    Nombre de la empresa
                    <input className={fieldClassName()} name="organizationName" required placeholder="Mi empresa" />
                  </label>
                  <label className="grid gap-1.5 text-sm font-semibold text-label">
                    Nombre visible del administrador
                    <input className={fieldClassName()} name="displayName" required placeholder="Nombre y apellido" />
                  </label>
                </>
              ) : (
                <label className="grid gap-1.5 text-sm font-semibold text-label">
                  Identificador del espacio de empresa
                  <input className={fieldClassName()} name="workspaceId" required value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} placeholder="UUID recibido al registrar la empresa" />
                </label>
              )}
              <label className="grid gap-1.5 text-sm font-semibold text-label">
                Correo de la cuenta central
                <input className={fieldClassName()} name="email" type="email" autoComplete="username" required />
              </label>
              <label className="grid gap-1.5 text-sm font-semibold text-label">
                Contraseña de la cuenta central
                <input className={fieldClassName()} name="password" type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={8} required />
              </label>
              <p className="m-0 text-xs leading-relaxed text-muted">
                La contraseña pasa por el servidor local y se reenvía a la dirección central indicada, que debe usar HTTPS. El token se guarda en el almacén seguro del sistema operativo, no en el navegador ni en SQLite.
              </p>
              {mode === "connect" && apiUrl.trim() && (
                <a
                  className="text-sm font-semibold text-brand underline"
                  href={`${apiUrl.trim().replace(/\/$/, "")}/api/v1/auth/password-reset/request`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Recuperar contraseña de la cuenta central
                </a>
              )}
              <button className="button button-primary justify-self-start" type="submit" disabled={busy}>
                {busy ? "Procesando…" : mode === "register" ? "Crear espacio y enviar verificación" : "Vincular cuenta"}
              </button>
              {verificationLink && (
                <a className="text-sm font-semibold text-brand underline" href={verificationLink} target="_blank" rel="noreferrer">
                  Abrir enlace de verificación de desarrollo
                </a>
              )}
            </form>
          </section>
        ) : null}

        {status?.rejectedRecords?.length ? (
          <section className="grid gap-3 rounded-2xl border border-danger-line bg-danger-soft p-4" aria-live="polite">
            <div>
              <h3 className="m-0 text-base font-bold text-danger">Cambios provisionales rechazados</h3>
              <p className="mt-1 mb-0 text-sm text-danger">Estos datos siguen guardados en SQLite, pero no cuentan como aceptados por la empresa central. Corrige el registro en su módulo y luego reconstruye el lote para enviarlo de nuevo.</p>
            </div>
            <ul className="m-0 grid gap-2 pl-5 text-sm text-danger">
              {status.rejectedRecords.map((rejected) => (
                <li key={rejected.batchId}>{rejected.error} <span className="text-xs opacity-80">Lote {rejected.batchId}</span></li>
              ))}
            </ul>
            {role !== "viewer" && (
              <button className="button button-secondary justify-self-start" type="button" disabled={busy || !navigator.onLine} onClick={() => void retryRejectedBatch()}>
                {busy ? "Reconstruyendo…" : "Reconstruir y reintentar lote"}
              </button>
            )}
          </section>
        ) : null}

        {status?.pendingErrors?.length ? (
          <section className="grid gap-2 rounded-2xl border border-warning-line bg-warning-soft p-4" aria-live="polite">
            <h3 className="m-0 text-base font-bold text-warning-text">Envío temporalmente pendiente</h3>
            <p className="m-0 text-sm text-warning-text">Los datos siguen en SQLite y Pyme360 reintentará cuando vuelva a estar disponible la API.</p>
            <ul className="m-0 grid gap-1 pl-5 text-sm text-warning-text">
              {status.pendingErrors.map((item) => <li key={item.batchId}>{item.error}</li>)}
            </ul>
          </section>
        ) : null}

        {status?.configured && status.connectedForCurrentUser && role === "admin" && (
          <>
          <section className="grid gap-3 rounded-2xl border border-line p-4">
            <div>
              <h3 className="m-0 text-base font-bold">Invitar a una persona</h3>
              <p className="mt-1 mb-0 text-sm text-muted">El correo recibirá un enlace para aceptar la invitación y definir su contraseña. Para trabajar sin conexión, crea también su usuario local en <strong>Usuarios</strong> con el mismo rol.</p>
            </div>
            <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end" onSubmit={(event) => void sendInvitation(event)}>
              <label className="grid gap-1.5 text-sm font-semibold text-label">
                Correo
                <input className={fieldClassName()} name="inviteEmail" type="email" required />
              </label>
              <label className="grid gap-1.5 text-sm font-semibold text-label">
                Rol
                <select className={fieldClassName()} name="inviteRole" defaultValue="operator">
                  <option value="operator">Operador</option>
                  <option value="viewer">Consulta</option>
                  <option value="admin">Administrador</option>
                </select>
              </label>
              <button className="button button-secondary" type="submit">Enviar invitación</button>
            </form>
            {invitationMessage && <p role="status" className="m-0 text-sm text-muted">{invitationMessage}</p>}
          </section>
          <section className="grid gap-3 rounded-2xl border border-line p-4">
            <div>
              <h3 className="m-0 text-base font-bold">Miembros de la empresa</h3>
              <p className="mt-1 mb-0 text-sm text-muted">Los permisos centrales se validan en cada solicitud y son independientes del acceso local sin conexión. Bloquear una cuenta central revoca sus sesiones en la nube; bloquea también su cuenta local desde Usuarios para impedir nuevas operaciones offline en ese equipo.</p>
            </div>
            <div className="overflow-x-auto rounded-xl border border-line">
              <table>
                <thead><tr><th>Persona</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.id}>
                      <td><strong>{member.display_name}</strong><small>{member.email} · {member.emailVerified ? "Correo verificado" : "Correo pendiente"}{member.id === status.centralUserId ? " · Cuenta conectada" : ""}</small></td>
                      <td>
                        <select aria-label={`Rol de ${member.email}`} disabled={busy || member.id === status.centralUserId} className={fieldClassName()} value={memberRoles[member.id] ?? member.role} onChange={(event) => setMemberRoles((current) => ({ ...current, [member.id]: event.target.value as CloudMember["role"] }))}>
                          <option value="admin">Administrador</option>
                          <option value="operator">Operador</option>
                          <option value="viewer">Consulta</option>
                        </select>
                      </td>
                      <td>{member.active ? "Activa" : "Bloqueada"}</td>
                      <td>
                        <div className="flex flex-wrap gap-2">
                          <button className="button button-secondary" disabled={busy || member.id === status.centralUserId || (memberRoles[member.id] ?? member.role) === member.role} onClick={() => void saveMemberRole(member)}>Guardar rol</button>
                          <button className="button button-secondary" disabled={busy || member.id === status.centralUserId} onClick={() => void toggleMember(member)}>{member.active ? "Bloquear" : "Activar"}</button>
                          <button className="button button-secondary" disabled={busy || member.id === status.centralUserId || !member.active} onClick={() => void revokeSessions(member)}>Cerrar sesiones</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          </>
        )}

        {status?.conflictRecords?.length ? (
          <section className="grid gap-3">
            <div>
              <h3 className="m-0 text-base font-bold">Cambios por resolver</h3>
              <p className="mt-1 mb-0 text-sm text-muted">Se conservan las dos versiones. Un administrador debe elegir cuál queda como versión central.</p>
            </div>
            {status.conflictRecords.map((conflict) => (
              <article className="grid gap-3 rounded-2xl border border-warning-line bg-warning-soft p-4" key={conflict.conflictId}>
                <div>
                  <strong className="text-sm">{readableEntity(conflict.entityType)} · {conflict.entityId}</strong>
                  <p className="mt-1 mb-0 text-xs text-muted">Versión local y versión central modificadas por separado.</p>
                </div>
                <details className="text-xs text-muted">
                  <summary className="cursor-pointer font-semibold">Revisar ambas versiones</summary>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface p-3">Local: {JSON.stringify(conflict.localChange.payload, null, 2)}</pre>
                    <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface p-3">Central: {JSON.stringify(conflict.remoteChange.payload, null, 2)}</pre>
                  </div>
                </details>
                {role === "admin" && (
                  <div className="flex flex-wrap gap-2">
                    <button className="button button-secondary" disabled={busy} onClick={() => void resolveConflict(conflict.conflictId, "local")}>Conservar local</button>
                    <button className="button button-secondary" disabled={busy} onClick={() => void resolveConflict(conflict.conflictId, "remote")}>Conservar central</button>
                  </div>
                )}
              </article>
            ))}
          </section>
        ) : null}

        {message && <p role="status" className="m-0 rounded-xl border border-notice-line bg-notice px-3 py-2 text-sm text-notice-ink">{message}</p>}
        {error && <p role="alert" className="m-0 rounded-xl border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
