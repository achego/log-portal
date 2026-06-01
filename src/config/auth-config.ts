import path from "path";
import { AuthConfig, LogPortalOptions } from "../types";
import { envBool, envInt, portalEnv } from "./env";
import { logger } from "../core/logger";

export function resolveAuthConfig(options: LogPortalOptions, logsDir: string): AuthConfig {
  const env = portalEnv();
  const enabled = options.authEnabled ?? envBool(env.authEnabled, false);
  const secret = options.authSecret ?? env.authSecret ?? "";
  const adminEmail = (options.adminEmail ?? env.adminEmail ?? "").trim().toLowerCase();
  const adminPassword = options.adminPassword ?? env.adminPassword ?? "";
  const adminSecurityCode = options.adminSecurityCode ?? env.adminSecurityCode ?? "";
  const dbPath = (options.authDbPath ?? env.authDb ?? "").trim() || path.join(logsDir, "log-portal-auth.json");
  const sessionTtlMs = (options.sessionTtlMinutes ?? envInt(env.sessionTtlMin, 120)) * 60 * 1000;
  const e2e = options.e2eEnabled ?? envBool(env.e2eEnabled, true);

  const configured = Boolean(enabled && secret && adminEmail && adminPassword && adminSecurityCode);
  if (enabled && !configured) {
    logger.warn(
      "log portal auth is enabled but not fully configured; read routes will fail closed (503). " +
        "Set LOG_PORTAL_AUTH_SECRET, LOG_PORTAL_ADMIN_EMAIL, LOG_PORTAL_ADMIN_PASSWORD, LOG_PORTAL_ADMIN_SECURITY_CODE.",
    );
  }

  return { enabled, configured, secret, adminEmail, adminPassword, adminSecurityCode, dbPath, sessionTtlMs, e2e };
}
