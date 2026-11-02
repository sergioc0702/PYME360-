# API central de Pyme360

Servicio opcional para espacios de empresa, cuentas centrales y sincronización. Está implementado con FastAPI y PostgreSQL. El servidor local React/TypeScript conserva SQLite como almacenamiento offline y reenvía los cambios por lotes al servicio central.

La facturación electrónica y el conector hacia un proveedor tecnológico se ejecutan en el servidor local. Esta API central almacena únicamente borradores tributarios y no recibe estados, referencias ni CUFE producidos por el proveedor; esos datos permanecen en SQLite local.

## Ejecutar en desarrollo

Requisitos: Docker Desktop con Docker Compose. En esta carpeta:

```sh
docker compose up --build
```

La API queda en `http://127.0.0.1:8000` y PostgreSQL solo escucha en el loopback del equipo. Comprueba `http://127.0.0.1:8000/health`. Los datos de PostgreSQL quedan en el volumen `pyme360-cloud-db`.

En modo desarrollo, `POST /api/v1/organizations/register` crea una empresa y un administrador pendiente de verificar. La respuesta incluye la URL de verificación para probar el flujo sin SMTP. Abre el enlace, inicia sesión con ese correo y contraseña y usa el ID de empresa devuelto en el registro para conectar la instancia local en **Administración → Nube y sincronización**. Los enlaces de desarrollo son secretos de un solo uso; no los publiques.

Los enlaces de verificación, recuperación e invitación transportan el token en el fragmento (`#token=...`), que no se envía al servidor en la solicitud de la página. El navegador lo entrega en el cuerpo de la solicitud de confirmación, no en la URL consultada ni en los registros de acceso HTTP.

La API debe permanecer en el mismo equipo durante las pruebas locales. En el panel, configura `http://127.0.0.1:8000`; la URL de loopback se permite para desarrollo. Si se ejecuta desde otro computador, `127.0.0.1` apuntará a ese otro computador.

## Variables de entorno

`compose.yaml` lee variables del entorno o de un archivo `.env` local. Para mantener el archivo fuera de Git, copia `.env.example` a `.env` y cambia las contraseñas. Las variables son:

| Variable | Uso |
|---|---|
| `APP_ENV` | `development` permite entregar enlaces de verificación en la respuesta; producción exige SMTP y URL pública. |
| `DATABASE_URL` | Cadena de conexión PostgreSQL. En Compose usa el nombre de servicio `postgres`. |
| `PUBLIC_BASE_URL` | Base externa de enlaces de verificación, invitaciones y recuperación. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_STARTTLS` | Servidor SMTP para cuentas y recuperación. |
| `SMTP_USERNAME`, `SMTP_PASSWORD` | Credenciales del correo, disponibles solo en el servidor. |
| `SMTP_FROM` | Dirección verificada de envío. |
| `POSTGRES_PASSWORD` | Contraseña del contenedor de desarrollo si no se reemplaza la URL de base de datos. |

## Preparar una instalación compartida

Antes de invitar usuarios o conectar datos reales, el operador de infraestructura debe:

1. Desplegar la API y una base PostgreSQL administrada o respaldada fuera del equipo local.
2. Publicar la API solo detrás de un proxy con TLS válido, limitar el acceso administrativo al host y configurar `PUBLIC_BASE_URL` con HTTPS.
3. Configurar SMTP con un remitente verificado y STARTTLS. En producción la API rechaza el arranque si faltan `SMTP_HOST`, `SMTP_FROM` o `PUBLIC_BASE_URL`, si la URL pública no usa HTTPS o si STARTTLS está desactivado.
4. Crear secretos aleatorios, sustituir todos los valores de desarrollo y guardarlos en el gestor de secretos del entorno.
5. Configurar una política de copias PostgreSQL cifradas y fuera del host, retención, alertas y una restauración de ensayo. Compose de desarrollo no configura una copia externa.
6. Mantener la API y sus dependencias actualizadas; monitorizar `/health`, errores, capacidad de almacenamiento y expiración del certificado TLS.

La imagen Docker corre como usuario sin privilegios y escucha en el puerto 8000 dentro del contenedor. Compose de desarrollo publica la API y la base solo en `127.0.0.1`. No expongas la base de datos directamente a Internet. La aplicación no crea un dominio, certificados, correo, PostgreSQL administrado ni tareas de respaldo por sí misma.

## Flujo de usuario

1. El administrador se registra desde la pantalla de sincronización; se crea una organización aislada y se verifica su correo.
2. Inicia sesión en la nube y conecta SQLite. Si la base local tiene datos, el servidor local crea una copia previa a la vinculación. Se admite la importación inicial únicamente a un espacio central vacío para evitar mezclar empresas.
3. El administrador invita integrantes como `admin`, `operator` o `viewer`. Aceptar una invitación crea la membresía central.
4. Para el modo offline, el administrador crea además la cuenta local correspondiente en **Usuarios** con el mismo correo/identificador y rol. Son dos credenciales distintas en la transición actual; las invitaciones no crean usuarios locales automáticamente.
5. Los cambios locales aparecen como provisionales en la cola SQLite. La API aplica cada lote completo, con idempotencia y versiones por registro. Si el mismo registro cambió en el servidor, guarda ambas versiones y devuelve un conflicto para su resolución.

Una cuenta central solo opera dentro de una empresa. Cada consulta usa el `workspace_id` de la sesión autenticada; el cliente no puede elegir el espacio de otra empresa. La consulta puede descargar cambios; crear y resolver cambios necesita rol central `admin` u `operator`. La administración de miembros, roles, sesiones e invitaciones requiere `admin`.

## Rutas principales

- `GET /health`: disponibilidad de la API y base de datos.
- `POST /api/v1/organizations/register`, `GET /api/v1/auth/verify-email`, `POST /api/v1/auth/verify-email/confirm`, `POST /api/v1/auth/login`, `/logout`.
- `/api/v1/auth/password-reset/*`: recuperación de contraseña.
- `/api/v1/members/invitations`, `/api/v1/members`: altas, consulta, cambio de rol, bloqueo y revocación.
- `POST /api/v1/sync/push`: lote offline atómico e idempotente.
- `GET /api/v1/sync/pull`: descarga paginada de cambios.
- `GET /api/v1/sync/summary`: conteo de revisión local/central.
- `/api/v1/sync/conflicts`: consulta y resolución de versiones concurrentes.

La documentación OpenAPI del entorno de desarrollo está en `http://127.0.0.1:8000/docs`; en producción desactiva o restringe esa ruta según la política de despliegue.

## Alcance y límites conocidos

- La API central no sustituye SQLite: si Internet falla, la interfaz local guarda en el computador y marca cambios como pendientes hasta su aceptación central.
- El usuario central y el usuario local son identidades separadas. El administrador debe mantener sus roles alineados; la unificación de inicio de sesión es una fase posterior.
- Los campos de negocio todavía se almacenan como una instantánea JSON versionada, con tabla de eventos por entidad. El modelo no es un libro de contabilidad formal.
- La validación central protege referencias básicas y consistencia de inventario; las reglas detalladas siguen ejecutándose en la lógica local. Antes de un despliegue comercial, trasladar y probar en el servidor todas las invariantes relevantes, en especial impuestos, caja, producción y datos ambientales.
- Para empresas grandes, revisar tamaños de lotes, paginación, retención de eventos y estrategia de compactación antes de producción.
- Pyme360 no emite facturas electrónicas DIAN ni realiza contabilidad de partida doble.

## Verificación

Desde la raíz del repositorio:

```sh
python -m unittest discover -s server/tests -v
python -m py_compile server/serve-local.py server/sync_local.py server/cloud/app.py
```

Las pruebas usan fixtures y no emiten documentos tributarios ni dependen de proveedores externos.
