import { Request, Response } from "express";
import { AuthConfig } from "./types";
import { createErrorResponse, createSuccessResponse } from "./response";
import { signSession } from "./auth-crypto";
import { verifyDeveloper } from "./dev-store";

export function createDevController(auth: AuthConfig) {
  return {
    login(req: Request, res: Response) {
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      const code = typeof req.body?.code === "string" ? req.body.code : "";
      if (!verifyDeveloper(email, code)) {
        res.status(401).json(createErrorResponse("invalid email or code"));
        return;
      }
      const iat = Date.now();
      const exp = iat + auth.sessionTtlMs;
      const token = signSession(auth.secret, { sub: email, role: "dev", iat, exp });
      res.json(createSuccessResponse({ token, expiresAt: new Date(exp).toISOString() }));
    },
  };
}
