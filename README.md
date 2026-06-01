# Log Portal

A drop-in logging package for Express + TypeScript backends. It writes structured
logs to the filesystem as JSONL and exposes a read API (historical + live SSE) so a
dashboard can show server logs to any developer — no SSH or server access needed.

Zero new npm dependencies (node built-ins + the already-present `express` / optional `winston`).

## Install

Copy the `log-portal/` folder into your project, then mount it once after your body parsers:

```ts
import { mountLogPortal } from "./log-portal";

mountLogPortal(app); // mounts the read API and starts capturing logs
```

That's it. By default it captures all `console.*` output, writes to `<cwd>/logs/YYYY-MM-DD.jsonl`,
and serves the API at `/api/_logs`.

## Configuration

Options passed to `mountLogPortal(app, options)` take precedence over env vars, which fall back to defaults:

| Option            | Env var                      | Default        |
| ----------------- | ---------------------------- | -------------- |
| `basePath`        | `LOG_PORTAL_BASE_PATH`       | `/api/_logs`   |
| `logsDir`         | `LOG_PORTAL_DIR`             | `<cwd>/logs`   |
| `retentionDays`   | `LOG_PORTAL_RETENTION_DAYS`  | `2`            |
| `maxFileMb`       | `LOG_PORTAL_MAX_FILE_MB`     | `50` (`0` = off) |
| `flushIntervalMs` | `LOG_PORTAL_FLUSH_MS`        | `0` (sync)     |
| `maxBufferLines`  | `LOG_PORTAL_BUFFER_LINES`    | `1000`         |
| `captureConsole`  | `LOG_PORTAL_CAPTURE_CONSOLE` | `true`         |
| `logRequests`     | `LOG_PORTAL_LOG_REQUESTS`    | `true`         |
| `detectThreats`   | `LOG_PORTAL_DETECT_THREATS`  | `true`         |
| `maxUrlLength`    | `LOG_PORTAL_MAX_URL_LEN`     | `2000`         |
| `enabled`         | `LOG_PORTAL_ENABLED`         | `true`         |
| `authMiddleware`  | —                            | no-op          |

Set `enabled: false` (or `LOG_PORTAL_ENABLED=false`) to disable entirely.

Built-in auth options (see [Auth](#auth)):

| Option              | Env var                          | Default                  |
| ------------------- | -------------------------------- | ------------------------ |
| `authEnabled`       | `LOG_PORTAL_AUTH_ENABLED`        | `false`                  |
| `authSecret`        | `LOG_PORTAL_AUTH_SECRET`         | —                        |
| `adminEmail`        | `LOG_PORTAL_ADMIN_EMAIL`         | —                        |
| `adminPassword`     | `LOG_PORTAL_ADMIN_PASSWORD`      | —                        |
| `adminSecurityCode` | `LOG_PORTAL_ADMIN_SECURITY_CODE` | —                        |
| `authDbPath`        | `LOG_PORTAL_AUTH_DB`             | `<logsDir>/log-portal-auth.json` |
| `sessionTtlMinutes` | `LOG_PORTAL_SESSION_TTL_MIN`     | `120`                    |
| `e2eEnabled`        | `LOG_PORTAL_E2E_ENABLED`         | `false`                  |

### Storage: rotation, size cap & retention

Logs are written as `YYYY-MM-DD.jsonl`, rotating daily. When a file passes `maxFileMb` it rolls
into segments (`YYYY-MM-DD.1.jsonl`, `…2.jsonl`, …) so a single busy day never produces one giant
file. Files older than `retentionDays` are deleted on init and on each rollover.

### Write durability vs throughput

By default each log is written synchronously (`fs.appendFileSync`) — durable, but a blocking disk
write per log. Under heavy load set `flushIntervalMs` (e.g. `500`) to batch writes in memory and
flush once per interval (or once `maxBufferLines` is buffered). Live SSE is unaffected — entries are
pushed the instant they're logged, independent of when they hit disk. The buffer is flushed on a
timer, on size threshold, on rotation, before every read, and on process exit (`SIGINT`/`SIGTERM`).
Trade-off: a hard `kill -9` / power loss can drop up to one flush window. Default sync mode has no
such window.

### Threat detection

When `detectThreats` is on, a middleware flags obviously malicious requests and emits them at
`level: "threat"` (detection-only — it never blocks). Built-in stateless rules: path traversal,
sensitive-path probes (`/.env`, `/.git`, `/wp-login.php`, …), scanner user-agents (sqlmap, nikto,
nmap, …), tight SQLi/XSS patterns, and oversized URLs (`> maxUrlLength`). Detection runs on the URL,
query string and user-agent only — request bodies are not inspected. Add your own rule without
touching core:

```ts
import { registerThreatRule } from "./log-portal";

registerThreatRule({
  type: "graphql_introspection",
  severity: "low",
  test: (ctx) => (ctx.decodedUrl.includes("__schema") ? "__schema" : null),
});
```

## Logging from your code

`console.log/info/warn/error/dir` are captured automatically. For richer entries use the explicit API:

```ts
import { logger } from "./log-portal";

logger.info("user created", { userId });
logger.error("payment failed", err);        // pass the error as the 2nd arg
logger.error(err);                           // or just the error itself
logger.error("charge failed", err, { orderId }); // message + error + extra meta
```

`logger.error` / `logger.warn` inspect the error and extract type-specific detail into a single
consistent `err` shape (`{ name, message, stack, code, data }`) so the dashboard renders any error
the same way. Built-in handling for generic `Error` and Axios errors (request URL, params, redacted
headers, response status + body land in `err.data`). Add more error types without touching call sites:

```ts
import { registerErrorHandler } from "./log-portal";

registerErrorHandler({
  name: "jwt",
  match: (e: any) => e?.name === "TokenExpiredError",
  normalize: (e: any) => ({ name: e.name, message: e.message, code: "JWT_EXPIRED", data: { expiredAt: e.expiredAt } }),
});
```

Every log emitted during an HTTP request shares a `requestId` (from the inbound `X-Request-Id`
header or a generated UUID, also returned on the response), so a failing request's logs cluster together.

### Optional: route winston into the portal

```ts
import { createLogPortalTransport } from "./log-portal";
manualLogger.add(createLogPortalTransport());
```

## Read API

| Endpoint               | Description                                                              |
| ---------------------- | ------------------------------------------------------------------------ |
| `GET <base>`           | Historical, newest-first. Query: `level`, `from`, `to`, `q`, `requestId`, `limit` (≤1000), `before` (older-page cursor). Returns `{ entries, nextBefore, hasMore }`. |
| `GET <base>/stream`    | Live SSE. Query: `level`, `requestId`, `after`. Honors `Last-Event-ID` to backfill missed entries on reconnect. |
| `GET <base>/levels`    | Log levels + their `{ text, bg, border }` colors (for filter chips / row styling). |
| `GET <base>/dates`     | Available `YYYY-MM-DD` log files (newest first).                         |
| `GET <base>/health`    | `{ ok, dir, dates }`.                                                     |

## Auth

There are two ways to protect the read routes.

### 1. Bring your own middleware

Every read route runs behind `options.authMiddleware` (a no-op by default). Drop your check
(e.g. an email whitelist) there with no route changes. This always takes precedence over the
built-in auth below:

```ts
mountLogPortal(app, { authMiddleware: requireWhitelistedEmail });
```

### 2. Built-in code auth

Set `LOG_PORTAL_AUTH_ENABLED=true` plus the four credential vars (`LOG_PORTAL_AUTH_SECRET`,
`LOG_PORTAL_ADMIN_EMAIL`, `LOG_PORTAL_ADMIN_PASSWORD`, `LOG_PORTAL_ADMIN_SECURITY_CODE`) and the
package manages access itself — no external store, zero new dependencies.

- An **admin** (bootstrapped from those env vars) logs in once and gets a signed, expiring
  session token used to manage developers.
- Each **developer** is issued a long random **code**, shown to the admin **once** at generation
  (only a SHA-256 hash is stored). A developer logs in with their **email + code** at
  `POST <base>/login`; both must match. That returns a signed, expiring session token they pass as
  `Authorization: Bearer <token>` on every read request. Revoking/removing a developer takes effect
  on the next request (the token is re-checked against the store), and regenerating a code forces a
  new login.

The developer DB is a single JSON file (`LOG_PORTAL_AUTH_DB`, default `<logsDir>/log-portal-auth.json`).
It's loaded into memory at startup, so checking a session on each request is an in-memory lookup —
disk is touched only when the admin adds, removes, regenerates, or revokes.

If auth is **enabled but not fully configured**, read routes fail closed with `503` (rather than
serving logs unauthenticated). If auth is left **disabled** and no `authMiddleware` is supplied,
behavior is unchanged (open).

#### Developer login

```
POST <base>/login        body: { email, code }   →  { token, expiresAt }
```

Then send `Authorization: Bearer <token>` (or `X-Log-Portal-Token: <token>`) on every read request,
including the SSE stream. A wrong email/code pair, or a revoked/removed developer, returns `401`.

#### Admin management API

All routes are under `<base>/admin` and return the standard `{ status, message?, data? }` envelope.
Every route except `login` requires `Authorization: Bearer <admin-session-token>`.

| Method   | Path                                  | Body                              | Success `data`                          |
| -------- | ------------------------------------- | --------------------------------- | --------------------------------------- |
| `POST`   | `/admin/login`                        | `{ email, password, securityCode }` | `{ token, expiresAt }`                |
| `GET`    | `/admin/developers`                   | —                                 | `[{ email, createdAt, lastUsedAt, expiresAt, active }]` |
| `POST`   | `/admin/developers`                   | `{ email, expiresInDays? \| expiresAt? }` | `{ email, code, createdAt, expiresAt }` (one-time code) |
| `POST`   | `/admin/developers/:email/regenerate` | —                                 | `{ email, code }` (new one-time code)   |
| `POST`   | `/admin/developers/:email/revoke`     | —                                 | `{ email, active: false }`              |
| `POST`   | `/admin/developers/:email/activate`   | —                                 | `{ email, active: true }`               |
| `DELETE` | `/admin/developers/:email`            | —                                 | `{ email, removed: true }`              |

`:email` must be URL-encoded (e.g. `dev%40x.com`).

When adding a developer, the admin may set a time limit: `expiresInDays` (a positive number) or
`expiresAt` (an absolute future ISO date). If neither is given, access is unlimited. Expiry is
enforced at login **and** on every read, so it cuts access promptly — like a revoke that fires on its
own at the set time.

### Optional: end-to-end payload encryption

Set `LOG_PORTAL_E2E_ENABLED=true` (requires built-in auth) to encrypt request and response **bodies**
on authenticated routes with AES-256-GCM. The key is derived per session — both sides run
`HKDF-SHA256(token)` over the login token, so nothing extra is exchanged. Login responses stay
plaintext (the client has no token/key yet).

- **Server → client:** every authenticated JSON response becomes `{ "enc": "<base64>" }`, where the
  blob is `iv(12) || ciphertext || tag(16)` — the exact layout WebCrypto's `AES-GCM` produces.
  SSE `data:` lines are individually encrypted (the `id:` cursor stays plain).
- **Client → server:** send request bodies as `{ "enc": "<base64>" }`; the server decrypts before the
  controller runs.

The frontend implementation (Web Crypto, zero deps) is in [API.md](./API.md) §7.
