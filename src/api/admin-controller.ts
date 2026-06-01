import { Request, Response } from "express";
import { AuthConfig } from "../types";
import { createErrorResponse, createSuccessResponse } from "./response";
import { signSession, timingSafeEqualStr } from "../auth/auth-crypto";
import { addDeveloper, listDevelopers, regenerateCode, removeDeveloper, setActive } from "../auth/dev-store";
import { deleteLogFiles, listLogFiles, readLogFileRaw } from "../core/store";
import { zipFiles, ZipEntry } from "../core/zip";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function paramEmail(req: Request): string {
  return decodeURIComponent(String(req.params.email ?? "")).trim().toLowerCase();
}

/** Extract a non-empty list of log file names from the request body, or `null` if absent/empty. */
function fileNames(body: any): string[] | null {
  const files = body?.files;
  if (!Array.isArray(files)) return null;
  const names = files.filter((f: unknown): f is string => typeof f === "string" && f.trim() !== "").map((f) => f.trim());
  return names.length ? names : null;
}

/** Resolve an optional access expiry from the request body. Accepts `expiresAt`
 * (absolute ISO date) or `expiresInDays` (positive number). Returns an ISO
 * string, `null` for unlimited access, or `"invalid"` on bad input. */
function resolveExpiry(body: any): string | null | "invalid" {
  const { expiresAt, expiresInDays } = body ?? {};
  if (typeof expiresAt === "string" && expiresAt.trim()) {
    const t = Date.parse(expiresAt);
    if (!Number.isFinite(t) || t <= Date.now()) return "invalid";
    return new Date(t).toISOString();
  }
  if (expiresInDays !== undefined && expiresInDays !== null && expiresInDays !== "") {
    const n = Number(expiresInDays);
    if (!Number.isFinite(n) || n <= 0) return "invalid";
    return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();
  }
  return null;
}

export function createAdminController(auth: AuthConfig) {
  return {
    login(req: Request, res: Response) {
      const { email, password, securityCode } = req.body ?? {};
      const ok =
        typeof email === "string" &&
        timingSafeEqualStr(email.trim().toLowerCase(), auth.adminEmail) &&
        typeof password === "string" &&
        timingSafeEqualStr(password, auth.adminPassword) &&
        typeof securityCode === "string" &&
        timingSafeEqualStr(securityCode, auth.adminSecurityCode);
      if (!ok) {
        res.status(401).json(createErrorResponse("invalid credentials"));
        return;
      }
      const iat = Date.now();
      const exp = iat + auth.sessionTtlMs;
      const token = signSession(auth.secret, { sub: auth.adminEmail, role: "admin", iat, exp });
      res.json(createSuccessResponse({ token, expiresAt: new Date(exp).toISOString() }));
    },

    listDevelopers(_req: Request, res: Response) {
      res.json(createSuccessResponse(listDevelopers()));
    },

    addDeveloper(req: Request, res: Response) {
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      if (!EMAIL_RE.test(email)) {
        res.status(400).json(createErrorResponse("a valid email is required"));
        return;
      }
      const expiry = resolveExpiry(req.body);
      if (expiry === "invalid") {
        res.status(400).json(createErrorResponse("expiresInDays must be a positive number, or expiresAt a valid future date"));
        return;
      }
      const result = addDeveloper(email, expiry);
      if ("error" in result) {
        res.status(409).json(createErrorResponse("developer already exists"));
        return;
      }
      res.json(
        createSuccessResponse({
          email,
          code: result.code,
          createdAt: result.record.createdAt,
          expiresAt: result.record.expiresAt,
        }),
      );
    },

    regenerateCode(req: Request, res: Response) {
      const email = paramEmail(req);
      const result = regenerateCode(email);
      if ("error" in result) {
        res.status(404).json(createErrorResponse("developer not found"));
        return;
      }
      res.json(createSuccessResponse({ email, code: result.code }));
    },

    revoke(req: Request, res: Response) {
      const email = paramEmail(req);
      if (!setActive(email, false)) {
        res.status(404).json(createErrorResponse("developer not found"));
        return;
      }
      res.json(createSuccessResponse({ email, active: false }));
    },

    activate(req: Request, res: Response) {
      const email = paramEmail(req);
      if (!setActive(email, true)) {
        res.status(404).json(createErrorResponse("developer not found"));
        return;
      }
      res.json(createSuccessResponse({ email, active: true }));
    },

    removeDeveloper(req: Request, res: Response) {
      const email = paramEmail(req);
      if (!removeDeveloper(email)) {
        res.status(404).json(createErrorResponse("developer not found"));
        return;
      }
      res.json(createSuccessResponse({ email, removed: true }));
    },

    // --- Log file management ---

    logFiles(_req: Request, res: Response) {
      const files = listLogFiles();
      const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
      res.json(createSuccessResponse({ files, totalBytes, count: files.length }));
    },

    downloadLogs(req: Request, res: Response) {
      const names = fileNames(req.body);
      if (!names) {
        res.status(400).json(createErrorResponse("files must be a non-empty array of log file names"));
        return;
      }
      const mtimes = new Map(listLogFiles().map((f) => [f.name, new Date(f.modifiedAt)]));
      const entries: ZipEntry[] = [];
      const missing: string[] = [];
      for (const name of names) {
        const data = readLogFileRaw(name);
        if (data) entries.push({ name, data, mtime: mtimes.get(name) });
        else missing.push(name);
      }
      if (entries.length === 0) {
        res.status(404).json(createErrorResponse("none of the requested log files exist", { missing }));
        return;
      }
      const zip = zipFiles(entries);
      const stamp = new Date().toISOString().slice(0, 10);
      // Binary response: res.send is NOT wrapped by the E2E middleware, so the zip streams
      // through un-encrypted (the request body, if E2E-encrypted, was already decrypted upstream).
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="logs-${stamp}.zip"`);
      res.send(zip);
    },

    deleteLogs(req: Request, res: Response) {
      const names = fileNames(req.body);
      if (!names) {
        res.status(400).json(createErrorResponse("files must be a non-empty array of log file names"));
        return;
      }
      res.json(createSuccessResponse(deleteLogFiles(names)));
    },
  };
}
