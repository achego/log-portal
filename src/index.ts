import { Express, RequestHandler } from "express";
import { resolveConfig } from "./config/config";
import { initStore } from "./core/store";
import { requestIdMiddleware } from "./core/context";
import { requestLogMiddleware } from "./middleware/request-log";
import { threatMiddleware } from "./middleware/threats";
import { patchConsole } from "./core/console-intercept";
import { createLogRouter } from "./api/router";
import { createAdminRouter } from "./api/admin-router";
import { createDevController } from "./api/dev-controller";
import { initDevStore } from "./auth/dev-store";
import { createDevAuth } from "./middleware/auth-middleware";
import { createE2EMiddleware } from "./middleware/e2e-middleware";
import { noopAuth } from "./middleware/auth";
import { createErrorResponse } from "./api/response";
import { LogPortalOptions } from "./types";

export function mountLogPortal(
  app: Express,
  options: LogPortalOptions = {},
): void {
  try {
    const config = resolveConfig(options);
    if (!config.enabled) return;

    initStore({
      logsDir: config.logsDir,
      retentionDays: config.retentionDays,
      maxFileBytes: config.maxFileBytes,
      flushIntervalMs: config.flushIntervalMs,
      maxBufferLines: config.maxBufferLines,
    });
    app.use(requestIdMiddleware());
    if (config.captureConsole) patchConsole();
    if (config.detectThreats)
      app.use(threatMiddleware(config.basePath, config.maxUrlLength));
    if (config.logRequests) app.use(requestLogMiddleware(config.basePath));

    const guards: RequestHandler[] = [noopAuth];
    let devLogin: RequestHandler | undefined;
    if (options.authMiddleware) {
      guards[0] = options.authMiddleware;
    } else if (config.auth.configured) {
      initDevStore(config.auth.dbPath, config.auth.secret);
      guards[0] = createDevAuth(config.auth);
      if (config.auth.e2e) guards.push(createE2EMiddleware());
      devLogin = createDevController(config.auth).login;
    } else if (config.auth.enabled) {
      guards[0] = (_req, res) =>
        res
          .status(503)
          .json(
            createErrorResponse(
              "log portal auth is enabled but not configured",
            ),
          );
    }

    app.use(config.basePath, createLogRouter(guards, devLogin));
    if (config.auth.configured) {
      app.use(`${config.basePath}/admin`, createAdminRouter(config.auth));
    }
  } catch (err: any) {
    console.warn(
      "[log-portal] failed to mount; continuing without it:",
      err?.message,
    );
  }
}

export { logger, log } from "./core/logger";
export { registerErrorHandler, normalizeError } from "./core/normalize-error";
export type { ErrorHandler } from "./core/normalize-error";
export { registerThreatRule, detectThreats } from "./middleware/threats";
export { getRequestId } from "./core/context";
export { createLogPortalTransport } from "./core/winston-transport";
export { createDevAuth, createAdminAuth } from "./middleware/auth-middleware";
export { createE2EMiddleware } from "./middleware/e2e-middleware";
export {
  deriveSessionKey,
  encryptPayload,
  decryptPayload,
} from "./auth/auth-crypto";
export * from "./types";
