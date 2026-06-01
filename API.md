# Log Portal — Frontend API Reference

Base path: `/api/_logs` (configurable; ask backend if different).

All non-stream responses use a common envelope:

```ts
// success
{ "status": "success", "message"?: string, "data": <payload> }
// error
{ "status": "error", "message": string, "data"?: any }
```

## The log entry

Every endpoint deals in this object:

```ts
interface LogEntry {
  id: string;          // opaque cursor, sortable (newer > older as a string compare)
  ts: string;          // ISO-8601 timestamp, e.g. "2026-05-29T13:45:01.234Z"
  level: "error" | "warn" | "info" | "debug" | "request" | "threat";
  msg: string;         // the log message
  source?: string;     // module tag (may be absent)
  requestId?: string;  // groups all logs from one HTTP request
  meta?: unknown;      // arbitrary structured payload
  err?: NormalizedError; // present on errors (see below)
}

interface NormalizedError {
  name?: string;       // e.g. "Error", "AxiosError", "TokenExpiredError"
  message?: string;
  stack?: string;
  code?: string;       // e.g. "ECONNREFUSED", "ERR_BAD_REQUEST", "JWT_EXPIRED"
  data?: unknown;      // type-specific extra detail (shape depends on the error)
}
```

`err` always has the **same top-level shape** regardless of error type — render `name`,
`message`, `stack`, `code` uniformly. The `data` field is a free-form bag of extra detail whose
contents depend on the error type. Treat it as optional/unknown and render generically (a collapsible
JSON tree works well). Current known shapes:

- **Axios / HTTP errors** — `data` is:
  ```ts
  {
    request?:  { method?, url?, baseURL?, params?, headers? };  // sensitive headers are "[REDACTED]"
    response?: { status?, statusText?, headers?, data? };
  }
  ```
- **Other errors** — `data` may be absent, or carry whatever the backend attached (e.g. `{ expiredAt }` for a JWT error). New error types may add new `data` shapes over time, so don't hard-code: render whatever is present.

> `id` is the only cursor you need. It sorts the same as time (string comparison), so the dashboard
> never has to parse it — just pass it back as `before` (older page) or `after` (newer / live resume).

### The `request` level

Every incoming HTTP request is logged once as its own entry at `level: "request"` — handy for a
distinct color/filter in the dashboard (akin to morgan, but request-line only, no body):

```jsonc
{
  "id": "...", "ts": "...", "level": "request", "requestId": "8f3c...",
  "msg": "Request: GET /api/balances?chain=litecoin&address=ltc1q... at Fri May 29 2026 20:15:09 GMT-0400, IP: ::1, User Agent: PostmanRuntime/7.54.0",
  "source": "request",
  "meta": { "method": "GET", "url": "/api/balances?chain=litecoin&address=ltc1q...", "ip": "::1", "userAgent": "PostmanRuntime/7.54.0" }
}
```

Render `msg` directly, or build your own line from the structured `meta`. Filter the feed to just
these with `?level=request`. The portal's own endpoints are excluded so the dashboard doesn't log itself.

### The `threat` level

Requests that trip a built-in security rule (path traversal, scanner user-agents, sensitive-path
probes, SQLi/XSS patterns, oversized URLs) are logged once at `level: "threat"`. Detection-only —
the request is **not** blocked. Detection looks at the URL, query string and user-agent only (bodies
aren't inspected).

```jsonc
{
  "id": "...", "ts": "...", "level": "threat", "requestId": "...",
  "msg": "Threat: path_traversal (high) from 192.0.2.5 GET /files/../../etc/passwd",
  "source": "threat",
  "meta": {
    "type": "path_traversal",        // highest-severity rule that matched
    "severity": "high",              // "low" | "medium" | "high"
    "ip": "192.0.2.5",
    "method": "GET",
    "url": "/files/../../etc/passwd",
    "userAgent": "curl/7.68",
    "matches": [                     // every rule that matched this request
      { "type": "path_traversal", "severity": "high", "match": "../" }
    ]
  }
}
```

Filter with `?level=threat`. Use `meta.severity` to prioritize and `meta.matches` to show exactly
what tripped. Rule types are open-ended (teams can register custom ones) — render whatever `type` arrives.

---

## 1. Historical logs

`GET /api/_logs`

Newest-first. Use for the initial load and the "load older" / refresh actions.

### Query params (all optional)

| Param       | Type   | Description |
| ----------- | ------ | ----------- |
| `level`     | string | Filter: `error` \| `warn` \| `info` \| `debug` |
| `from`      | string | ISO timestamp — only entries with `ts >= from` |
| `to`        | string | ISO timestamp — only entries with `ts <= to` |
| `q`         | string | Case-insensitive substring match on `msg` |
| `requestId` | string | Only logs for this request id |
| `limit`     | number | Page size, default `100`, max `1000` |
| `before`    | string | Pagination cursor — return entries older than this `id` |

### Response

```jsonc
{
  "status": "success",
  "data": {
    "entries": [ /* LogEntry[], newest first */ ],
    "nextBefore": "000001748524701234-000002",  // pass as `before` for the next older page
    "hasMore": true                              // false when there are no older entries
  }
}
```

### Examples

```
GET /api/_logs?limit=50                          # latest 50
GET /api/_logs?level=error&limit=20              # latest 20 errors
GET /api/_logs?q=timeout&from=2026-05-29T00:00:00Z
GET /api/_logs?requestId=8f3c...                 # everything that happened in one request
GET /api/_logs?before=000001748524701234-000002 # next older page
```

### Pagination loop (frontend)

```ts
let before: string | null = null;
async function loadOlder() {
  const url = `/api/_logs?limit=100${before ? `&before=${before}` : ""}`;
  const { data } = await fetch(url).then(r => r.json());
  append(data.entries);
  before = data.nextBefore;       // null => stop, disable "load more"
  return data.hasMore;
}
```

---

## 2. Live logs (SSE)

`GET /api/_logs/stream`

A [Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) stream.
Each new log is pushed as it happens. Use the browser `EventSource`.

### Query params (all optional)

| Param       | Type   | Description |
| ----------- | ------ | ----------- |
| `level`     | string | Only push entries of this level |
| `requestId` | string | Only push entries for this request id |
| `after`     | string | Resume: backfill entries newer than this `id` before going live |

### Event format

Each event carries the SSE `id` (the entry's `id`) and a JSON `data` payload that is a single `LogEntry`:

```
id: 000001748524701234-000003
data: {"id":"000001748524701234-000003","ts":"2026-05-29T13:45:01.234Z","level":"error","msg":"boom","err":{"message":"boom","stack":"..."}}

: ping
```

`: ping` comments arrive every ~15s to keep the connection alive — ignore them (`EventSource` does automatically).

### Frontend usage

```ts
const es = new EventSource("/api/_logs/stream?level=error");

es.onmessage = (e) => {
  const entry: LogEntry = JSON.parse(e.data);
  prepend(entry);
};

es.onerror = () => {
  // EventSource auto-reconnects and sends the last seen id as the `Last-Event-ID`
  // header, so the server backfills anything missed during the drop — no gaps.
};
```

> **Reconnect / no-gap:** `EventSource` automatically resends the last received event `id` via the
> `Last-Event-ID` header on reconnect, and the server replays everything newer before resuming live.
> If you manage the connection manually (e.g. `fetch`), pass `?after=<lastId>` instead.

### Typical dashboard pattern

1. Load a page of history from `GET /api/_logs` (gives you the newest `id`).
2. Open `EventSource("/api/_logs/stream?after=<newestIdFromStep1>")` so live picks up exactly where history ended.

---

## 3. Levels & colors

`GET /api/_logs/levels`

The set of log levels and their palette — fetch once on load to build the filter chips and
color-code rows. The backend owns the palette, so the dashboard stays in sync without hard-coding colors.

```jsonc
{
  "status": "success",
  "data": [
    { "level": "error",   "color": { "text": "#f87171", "bg": "#ef44441a", "border": "" } },
    { "level": "warn",    "color": { "text": "#fbbf24", "bg": "#f59e0b1a", "border": "" } },
    { "level": "info",    "color": { "text": "#34d399", "bg": "#10b9811a", "border": "" } },
    { "level": "debug",   "color": { "text": "#38bdf8", "bg": "#0ea5e91a", "border": "" } },
    { "level": "request", "color": { "text": "#a78bfa", "bg": "#8b5cf61a", "border": "" } },
    { "level": "threat",  "color": { "text": "#fb7185", "bg": "#f43f5e1a", "border": "" } }
  ]
}
```

Use it to render each row: `style={{ color: c.text, background: c.bg, border: \`1px solid ${c.border}\` }}`,
and to drive the `?level=` filter buttons. The array order is a sensible display order.

## 4. Available dates

`GET /api/_logs/dates`

For a day-picker. Newest first.

```jsonc
{ "status": "success", "data": ["2026-05-29", "2026-05-28"] }
```

To view a specific day, query history with that day's bounds:

```
GET /api/_logs?from=2026-05-28T00:00:00Z&to=2026-05-28T23:59:59Z&limit=1000
```

---

## 5. Health

`GET /api/_logs/health`

```jsonc
{ "status": "success", "data": { "ok": true, "dir": "/app/logs", "dates": 2 } }
```

---

## 6. Auth (when built-in auth is enabled)

The backend may run with built-in code auth. When it does, all read endpoints (sections 1–5)
require a developer code, and a small admin API manages those codes. If auth is disabled, skip
this section — the read endpoints are open.

### Developer login + reads

A developer first logs in with their **email + code** (the admin gives them both). Both must match
or it returns `401`.

```jsonc
// POST /api/_logs/login   body: { email, code }
{ "status": "success", "data": { "token": "<jwt-like>", "expiresAt": "2026-05-30T14:00:00.000Z" } }
```

Then send the returned token on **every** read request, including the SSE connection:

```
Authorization: Bearer <token>
```

`EventSource` can't set headers, so for the stream either use a fetch-based SSE client or send the
token via `X-Log-Portal-Token`. A missing/expired token — or a developer who has since been revoked
or removed — returns `401` with the standard error envelope (re-login to recover).

### Admin API

Base `<base>/admin`. Login first, then send `Authorization: Bearer <token>` on every other call.

```jsonc
// POST /api/_logs/admin/login   body: { email, password, securityCode }
{ "status": "success", "data": { "token": "<jwt-like>", "expiresAt": "2026-05-30T12:00:00.000Z" } }

// GET /api/_logs/admin/developers
{ "status": "success", "data": [ { "email": "dev@x.com", "createdAt": "...", "lastUsedAt": "...", "expiresAt": null, "active": true } ] }

// POST /api/_logs/admin/developers   body: { email, expiresInDays?, expiresAt? }   ← code shown ONCE, store/copy it now
//   expiresInDays: positive number (e.g. 30)   |   expiresAt: absolute future ISO date
//   omit both → unlimited access (expiresAt: null)
{ "status": "success", "data": { "email": "dev@x.com", "code": "<one-time-code>", "createdAt": "...", "expiresAt": "2026-07-01T00:00:00.000Z" } }

// POST /api/_logs/admin/developers/dev%40x.com/regenerate   ← old code dies immediately
{ "status": "success", "data": { "email": "dev@x.com", "code": "<new-one-time-code>" } }

// POST .../revoke → { "email": "dev@x.com", "active": false }
// POST .../activate → { "email": "dev@x.com", "active": true }
// DELETE .../dev%40x.com → { "email": "dev@x.com", "removed": true }
```

`:email` must be URL-encoded. The plaintext code is returned only at create/regenerate time and is
never retrievable afterward — surface it to the admin immediately.

---

## 7. End-to-end encryption (when `LOG_PORTAL_E2E_ENABLED=true`)

When the backend enables E2E, request and response **bodies** on authenticated routes are encrypted
with AES-256-GCM. The key is derived from the session **token** you got at login — no key exchange.
Login itself (admin or developer) stays plaintext, because you don't have a token/key yet.

**Wire shape.** An encrypted body is just `{ "enc": "<base64>" }`, where the base64 decodes to
`iv(12 bytes) || ciphertext || authTag(16 bytes)` — exactly what WebCrypto's `AES-GCM` emits/accepts.

- **Responses:** any authenticated JSON response arrives as `{ "enc": "..." }`. Decrypt → `JSON.parse`
  → you get the normal `{ status, data }` envelope from sections 1–5.
- **Requests:** wrap your JSON body as `{ "enc": "..." }` before sending (e.g. the admin
  `POST /developers { email }`).
- **SSE:** each event's `data:` value is the base64 blob (not wrapped in `{enc}`); decrypt it to get the
  `LogEntry` JSON. The `id:` line is plaintext (it's just the cursor).

### Client implementation (Web Crypto, zero deps)

```ts
const SALT = new TextEncoder().encode("log-portal-e2e");
const INFO = new TextEncoder().encode("log-portal-e2e-aesgcm-v1");
const b64 = {
  enc: (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))),
  dec: (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};

// Derive the AES-256-GCM key from the login token (call once after login).
async function deriveKey(token: string): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey("raw", new TextEncoder().encode(token), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: SALT, info: INFO },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptBody(key: CryptoKey, obj: unknown): Promise<{ enc: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  const blob = new Uint8Array(iv.length + ct.byteLength);
  blob.set(iv, 0);
  blob.set(new Uint8Array(ct), iv.length);
  return { enc: b64.enc(blob.buffer) };
}

async function decryptBody<T = any>(key: CryptoKey, enc: string): Promise<T> {
  const data = b64.dec(enc);
  const iv = data.subarray(0, 12);
  const body = data.subarray(12); // ciphertext || tag
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, body);
  return JSON.parse(new TextDecoder().decode(pt));
}
```

### Putting it together

```ts
// 1. Login (plaintext) -> token, then derive the key once.
const { data } = await (await fetch(`${BASE}/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, code }),
})).json();
const key = await deriveKey(data.token);

// 2. Read logs: response body is encrypted.
const res = await fetch(`${BASE}?level=error`, { headers: { Authorization: `Bearer ${data.token}` } });
const envelope = await decryptBody(key, (await res.json()).enc); // -> { status, data: { entries, ... } }

// 3. Send an encrypted request body (admin example).
await fetch(`${BASE}/admin/developers`, {
  method: "POST",
  headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
  body: JSON.stringify(await encryptBody(adminKey, { email: "dev@x.com" })),
});

// 4. SSE: EventSource can't set headers, so use a fetch-based reader and send the token via header.
//    For each event, the `data` field is the base64 blob:
const entry = await decryptBody(key, eventDataString); // -> LogEntry
```

Notes:
- Derive the key **once per session** and reuse it; HKDF is deterministic so re-deriving yields the same key.
- A `401` means token expired or the developer was revoked — log in again to get a fresh token (and key).
- If you send a malformed `{ enc }` request body, the server replies `400 invalid encrypted payload`.

---

## Notes for the frontend

- **Request correlation:** every backend response carries an `X-Request-Id` header. To let a user
  jump from a failed API call to its logs, capture that header and link to `GET /api/_logs?requestId=<it>`.
- **Auth:** open unless the backend enables built-in code auth — see section 6. When enabled, log in
  (`POST <base>/login` with `{ email, code }`) and send `Authorization: Bearer <token>` on every
  request (including the stream).
- **Encryption:** if the backend enables E2E (section 7), bodies are AES-GCM `{ enc }` blobs keyed by
  your login token — decrypt responses and encrypt request bodies accordingly.
- **Ordering:** history is newest-first; the SSE stream delivers oldest-first as events occur. Sort/merge
  by `id` (string compare) if you mix them.
- **Errors:** non-2xx responses still use the envelope (`{ status: "error", message }`).
