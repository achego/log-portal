import { LogEntry, LogLevel } from "../types";
import { append, nextId } from "./store";
import { getRequestId } from "./context";
import { normalizeError } from "./normalize-error";

export { normalizeError };

export function record(
  level: LogLevel,
  msg: string,
  extra?: { source?: string; meta?: unknown; err?: LogEntry["err"] }
): void {
  const now = Date.now();
  const entry: LogEntry = {
    id: nextId(now),
    ts: new Date(now).toISOString(),
    level,
    msg,
    source: extra?.source,
    requestId: getRequestId(),
    meta: extra?.meta,
    err: extra?.err,
  };
  append(entry);
}

function logError(level: LogLevel, messageOrError: unknown, error?: unknown, meta?: unknown): void {
  if (typeof messageOrError === "string") {
    const err = normalizeError(error);
    record(level, messageOrError, { err, meta });
  } else {
    const err = normalizeError(messageOrError);
    record(level, err?.message ?? "error", { err, meta: error ?? meta });
  }
}

export const logger = {
  error: (messageOrError: unknown, error?: unknown, meta?: unknown) => logError("error", messageOrError, error, meta),
  warn: (messageOrError: unknown, error?: unknown, meta?: unknown) => logError("warn", messageOrError, error, meta),
  info: (msg: string, meta?: unknown) => record("info", msg, { meta }),
  debug: (msg: string, meta?: unknown) => record("debug", msg, { meta }),
};

export const log = logger;
