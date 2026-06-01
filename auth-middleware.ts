import { Request, RequestHandler } from "express";
import { AuthConfig } from "./types";
import { isActiveDeveloper } from "./dev-store";
import { verifySession } from "./auth-crypto";
import { createErrorResponse } from "./response";

function bearer(req: Request): string | undefined {
  const header = req.header("authorization");
  if (header && /^Bearer\s+/i.test(header)) return header.replace(/^Bearer\s+/i, "").trim();
  return undefined;
}

export function createDevAuth(auth: AuthConfig): RequestHandler {
  return (req, res, next) => {
    const token = bearer(req) ?? req.header("x-log-portal-token")?.trim();
    const session = token ? verifySession(auth.secret, token) : null;
    if (!session || session.role !== "dev" || !isActiveDeveloper(session.sub)) {
      res.status(401).json(createErrorResponse("invalid or expired developer session"));
      return;
    }
    (req as any).logPortalDev = session.sub;
    next();
  };
}

export function createAdminAuth(auth: AuthConfig): RequestHandler {
  return (req, res, next) => {
    const token = bearer(req) ?? req.header("x-log-portal-admin-token")?.trim();
    const session = token ? verifySession(auth.secret, token) : null;
    if (!session || session.role !== "admin") {
      res.status(401).json(createErrorResponse("invalid or expired admin session"));
      return;
    }
    (req as any).logPortalAdmin = session.sub;
    next();
  };
}
