export function envBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === "true";
}

export function envInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export interface PortalEnv {
  /** LOG_PORTAL_BASE_PATH — URL prefix the portal mounts under. Default `/api/_logs`. */
  basePath?: string;
  /** LOG_PORTAL_DIR — directory where log files are written. Default `<cwd>/logs`. */
  dir?: string;
  /** LOG_PORTAL_RETENTION_DAYS — delete log files older than this many days. Default `-1` = off (keep forever); set a positive number to enable. */
  retentionDays?: string;
  /** LOG_PORTAL_MAX_FILE_MB — roll to a new file segment once one exceeds this size in MB. Default `0` = off (no rolling); set a positive number to enable. */
  maxFileMb?: string;
  /** LOG_PORTAL_FLUSH_MS — buffer writes and flush every N ms. Default `0` = write synchronously per entry. */
  flushMs?: string;
  /** LOG_PORTAL_BUFFER_LINES — when buffering, force a flush after this many queued lines. Default `1000`. */
  bufferLines?: string;
  /** LOG_PORTAL_CAPTURE_CONSOLE — patch `console.*` so its output is captured. Default `true`. */
  captureConsole?: string;
  /** LOG_PORTAL_LOG_REQUESTS — log every inbound HTTP request. Default `true`. */
  logRequests?: string;
  /** LOG_PORTAL_DETECT_THREATS — flag suspicious requests (path traversal, injection, etc.) as `threat` logs. Default `true`. */
  detectThreats?: string;
  /** LOG_PORTAL_MAX_URL_LEN — truncate logged request URLs longer than this. Default `2000`. */
  maxUrlLen?: string;
  /** LOG_PORTAL_ENABLED — master switch; `false` disables the whole portal. Default `true`. */
  enabled?: string;
  /** LOG_PORTAL_AUTH_ENABLED — turn on built-in code auth on the read routes. Default `false`. */
  authEnabled?: string;
  /** LOG_PORTAL_AUTH_SECRET — HMAC key for admin session tokens and pepper for developer code hashes. Required when auth is enabled. */
  authSecret?: string;
  /** LOG_PORTAL_ADMIN_EMAIL — bootstrap admin login email. Required when auth is enabled. */
  adminEmail?: string;
  /** LOG_PORTAL_ADMIN_PASSWORD — bootstrap admin login password. Required when auth is enabled. */
  adminPassword?: string;
  /** LOG_PORTAL_ADMIN_SECURITY_CODE — second factor required at admin login. Required when auth is enabled. */
  adminSecurityCode?: string;
  /** LOG_PORTAL_AUTH_DB — path to the developer JSON store. Default `<cwd>/log-portal-auth.json` (kept outside `dir`). */
  authDb?: string;
  /** LOG_PORTAL_SESSION_TTL_MIN — admin session token lifetime in minutes. Default `120`. */
  sessionTtlMin?: string;
  /** LOG_PORTAL_E2E_ENABLED — encrypt request/response bodies with a per-session key. Default `true`. */
  e2eEnabled?: string;
}

function val(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export function portalEnv(): PortalEnv {
  return {
    basePath: val("LOG_PORTAL_BASE_PATH"),
    dir: val("LOG_PORTAL_DIR"),
    retentionDays: val("LOG_PORTAL_RETENTION_DAYS"),
    maxFileMb: val("LOG_PORTAL_MAX_FILE_MB"),
    flushMs: val("LOG_PORTAL_FLUSH_MS"),
    bufferLines: val("LOG_PORTAL_BUFFER_LINES"),
    captureConsole: val("LOG_PORTAL_CAPTURE_CONSOLE"),
    logRequests: val("LOG_PORTAL_LOG_REQUESTS"),
    detectThreats: val("LOG_PORTAL_DETECT_THREATS"),
    maxUrlLen: val("LOG_PORTAL_MAX_URL_LEN"),
    enabled: val("LOG_PORTAL_ENABLED"),
    authEnabled: val("LOG_PORTAL_AUTH_ENABLED"),
    authSecret: val("LOG_PORTAL_AUTH_SECRET"),
    adminEmail: val("LOG_PORTAL_ADMIN_EMAIL"),
    adminPassword: val("LOG_PORTAL_ADMIN_PASSWORD"),
    adminSecurityCode: val("LOG_PORTAL_ADMIN_SECURITY_CODE"),
    authDb: val("LOG_PORTAL_AUTH_DB"),
    sessionTtlMin: val("LOG_PORTAL_SESSION_TTL_MIN"),
    e2eEnabled: val("LOG_PORTAL_E2E_ENABLED"),
  };
}
