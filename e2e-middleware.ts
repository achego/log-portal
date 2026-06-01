import { Request, RequestHandler } from "express";
import { deriveSessionKey, encryptPayload, decryptPayload } from "./auth-crypto";
import { createErrorResponse } from "./response";

function token(req: Request): string | undefined {
  const header = req.header("authorization");
  if (header && /^Bearer\s+/i.test(header)) return header.replace(/^Bearer\s+/i, "").trim();
  return req.header("x-log-portal-token")?.trim() ?? req.header("x-log-portal-admin-token")?.trim();
}

export function createE2EMiddleware(): RequestHandler {
  return (req, res, next) => {
    const t = token(req);
    if (!t) return next();
    const key = deriveSessionKey(t);

    if (req.body && typeof req.body.enc === "string") {
      try {
        req.body = JSON.parse(decryptPayload(key, req.body.enc));
      } catch {
        res.status(400).json(createErrorResponse("invalid encrypted payload"));
        return;
      }
    }

    const sendJson = res.json.bind(res);
    res.json = (body: unknown) => sendJson({ enc: encryptPayload(key, JSON.stringify(body)) });
    (res as any).e2eKey = key;
    next();
  };
}
