import { RequestHandler } from "express";

export type LogLevel = "error" | "warn" | "info" | "debug" | "request" | "threat";

export type ThreatSeverity = "low" | "medium" | "high";

export interface ThreatDetection {
  type: string;
  severity: ThreatSeverity;
  match: string;
}

export interface ThreatContext {
  method: string;
  path: string;
  url: string;
  decodedUrl: string;
  userAgent: string;
  ip?: string;
}

export interface ThreatRule {
  type: string;
  severity: ThreatSeverity;
  test(ctx: ThreatContext): string | null;
}

export interface NormalizedError {
  name?: string;
  message?: string;
  stack?: string;
  code?: string;
  data?: unknown;
}

export interface LogColor {
  text: string;
  bg: string;
  border: string;
}

export interface LevelInfo {
  level: LogLevel;
  color: LogColor;
}

export interface LogEntry {
  id: string;
  ts: string;
  level: LogLevel;
  msg: string;
  source?: string;
  requestId?: string;
  meta?: unknown;
  err?: NormalizedError;
}

export interface LogPortalOptions {
  basePath?: string;
  logsDir?: string;
  /** Delete log files older than this many days. Off by default (`-1` = keep forever). */
  retentionDays?: number;
  /** Roll to a new file segment once one exceeds this size in MB. Off by default (`0` = no rolling). */
  maxFileMb?: number;
  flushIntervalMs?: number;
  maxBufferLines?: number;
  captureConsole?: boolean;
  logRequests?: boolean;
  detectThreats?: boolean;
  maxUrlLength?: number;
  enabled?: boolean;
  authMiddleware?: RequestHandler;
  authEnabled?: boolean;
  authSecret?: string;
  adminEmail?: string;
  adminPassword?: string;
  adminSecurityCode?: string;
  authDbPath?: string;
  sessionTtlMinutes?: number;
  e2eEnabled?: boolean;
}

export interface ResolvedConfig {
  basePath: string;
  logsDir: string;
  retentionDays: number;
  maxFileBytes: number;
  flushIntervalMs: number;
  maxBufferLines: number;
  captureConsole: boolean;
  logRequests: boolean;
  detectThreats: boolean;
  maxUrlLength: number;
  enabled: boolean;
  auth: AuthConfig;
}

/** Resolved built-in auth settings. `configured` is true only when every
 * credential needed to run auth is present; otherwise auth fails closed. */
export interface AuthConfig {
  enabled: boolean;
  configured: boolean;
  secret: string;
  adminEmail: string;
  adminPassword: string;
  adminSecurityCode: string;
  dbPath: string;
  sessionTtlMs: number;
  e2e: boolean;
}

/** A developer record as persisted to the auth DB file. */
export interface DevRecord {
  email: string;
  codeHash: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  active: boolean;
}

/** A developer record as exposed by the admin API (never leaks the hash). */
export interface PublicDevRecord {
  email: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  active: boolean;
}

/** Payload carried inside a signed admin session token. */
export interface SessionPayload {
  sub: string;
  role: "admin" | "dev";
  iat: number;
  exp: number;
}

export interface StoreConfig {
  logsDir: string;
  retentionDays: number;
  maxFileBytes: number;
  flushIntervalMs: number;
  maxBufferLines: number;
}

export interface ReadQuery {
  level?: LogLevel;
  from?: string;
  to?: string;
  q?: string;
  requestId?: string;
  limit?: number;
  before?: string;
}

export interface ReadResult {
  entries: LogEntry[];
  nextBefore: string | null;
  hasMore: boolean;
}

export interface LogFileInfo {
  name: string;
  date: string;
  seg: number;
  size: number;
  modifiedAt: string;
}
