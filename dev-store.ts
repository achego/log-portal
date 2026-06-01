import fs from "fs";
import path from "path";
import { randomBytes } from "node:crypto";
import { DevRecord, PublicDevRecord } from "./types";
import { generateDevCode, hashCode, timingSafeEqualStr } from "./auth-crypto";

let dbPath = "";
let secret = "";
let byEmail = new Map<string, DevRecord>();
let hashToEmail = new Map<string, string>();

let dirty = false;
let flushTimer: NodeJS.Timeout | null = null;
let exitHooked = false;
const FLUSH_MS = 5000;

export function initDevStore(path_: string, secret_: string): void {
  dbPath = path_;
  secret = secret_;
  byEmail = new Map();
  hashToEmail = new Map();
  load();
  hookExitFlush();
}

function load(): void {
  try {
    const raw = fs.readFileSync(dbPath, "utf8");
    const parsed = JSON.parse(raw) as { developers?: DevRecord[] };
    for (const dev of parsed.developers ?? []) {
      byEmail.set(dev.email, dev);
      if (dev.active) hashToEmail.set(dev.codeHash, dev.email);
    }
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      console.warn(`[log-portal] could not read auth DB at ${dbPath}; starting empty`, err?.message);
    }
  }
}

function persist(): void {
  const data = { version: 1, developers: Array.from(byEmail.values()) };
  const tmp = `${dbPath}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, dbPath);
    dirty = false;
  } catch (err: any) {
    console.warn(`[log-portal] could not write auth DB at ${dbPath}`, err?.message);
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

function scheduleFlush(): void {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (dirty) persist();
  }, FLUSH_MS);
}

function flushNow(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  persist();
}

function hookExitFlush(): void {
  if (exitHooked) return;
  exitHooked = true;
  process.on("beforeExit", flushNow);
  process.on("exit", flushNow);
}

function publicOf(dev: DevRecord): PublicDevRecord {
  return {
    email: dev.email,
    createdAt: dev.createdAt,
    lastUsedAt: dev.lastUsedAt,
    expiresAt: dev.expiresAt,
    active: dev.active,
  };
}

function norm(email: string): string {
  return email.trim().toLowerCase();
}

function isExpired(dev: DevRecord): boolean {
  return dev.expiresAt !== null && Date.parse(dev.expiresAt) <= Date.now();
}

export function verifyDeveloper(email: string, code: string): boolean {
  if (!email || !code) return false;
  const dev = byEmail.get(norm(email));
  if (!dev || !dev.active || isExpired(dev)) return false;
  if (!timingSafeEqualStr(dev.codeHash, hashCode(secret, code))) return false;
  dev.lastUsedAt = new Date().toISOString();
  scheduleFlush();
  return true;
}

export function isActiveDeveloper(email: string): boolean {
  const dev = byEmail.get(norm(email));
  return Boolean(dev && dev.active && !isExpired(dev));
}

export function listDevelopers(): PublicDevRecord[] {
  return Array.from(byEmail.values()).map(publicOf);
}

function freshCode(): { code: string; codeHash: string } {
  let code = generateDevCode();
  let codeHash = hashCode(secret, code);
  while (hashToEmail.has(codeHash)) {
    code = generateDevCode();
    codeHash = hashCode(secret, code);
  }
  return { code, codeHash };
}

export function addDeveloper(
  email: string,
  expiresAt: string | null = null,
): { code: string; record: PublicDevRecord } | { error: "exists" } {
  const key = norm(email);
  if (byEmail.has(key)) return { error: "exists" };
  const { code, codeHash } = freshCode();
  const record: DevRecord = {
    email: key,
    codeHash,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    expiresAt,
    active: true,
  };
  byEmail.set(key, record);
  hashToEmail.set(codeHash, key);
  flushNow();
  return { code, record: publicOf(record) };
}

export function regenerateCode(email: string): { code: string } | { error: "not_found" } {
  const key = norm(email);
  const dev = byEmail.get(key);
  if (!dev) return { error: "not_found" };
  hashToEmail.delete(dev.codeHash);
  const { code, codeHash } = freshCode();
  dev.codeHash = codeHash;
  dev.active = true;
  hashToEmail.set(codeHash, key);
  flushNow();
  return { code };
}

export function setActive(email: string, active: boolean): boolean {
  const key = norm(email);
  const dev = byEmail.get(key);
  if (!dev) return false;
  dev.active = active;
  if (active) hashToEmail.set(dev.codeHash, key);
  else hashToEmail.delete(dev.codeHash);
  flushNow();
  return true;
}

export function removeDeveloper(email: string): boolean {
  const key = norm(email);
  const dev = byEmail.get(key);
  if (!dev) return false;
  hashToEmail.delete(dev.codeHash);
  byEmail.delete(key);
  flushNow();
  return true;
}
