import util from "util";
import { NormalizedError } from "../types";

export interface ErrorHandler {
  name: string;
  match(input: unknown): boolean;
  normalize(input: unknown): NormalizedError;
}

const SENSITIVE_HEADERS = ["authorization", "cookie", "set-cookie", "x-api-key", "apikey", "x-auth-token", "proxy-authorization", "x-log-portal-token", "x-log-portal-admin-token"];
const MAX_DATA_CHARS = 10000;

function redactHeaders(headers: unknown): Record<string, unknown> | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    out[key] = SENSITIVE_HEADERS.includes(key.toLowerCase()) ? "[REDACTED]" : value;
  }
  return out;
}

function cap(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.length > MAX_DATA_CHARS ? value.slice(0, MAX_DATA_CHARS) + "…[truncated]" : value;
}

// Built-in handlers. Order matters: the first match wins, so more specific
// types must come before the generic Error catch-all. Register new types
// (db, jwt, auth, ...) with registerErrorHandler — they take precedence.
const handlers: ErrorHandler[] = [
  {
    name: "axios",
    match: (input: any) => !!input && input.isAxiosError === true,
    normalize: (input: any) => {
      const config = input.config ?? {};
      const response = input.response;
      return {
        name: input.name ?? "AxiosError",
        message: input.message,
        stack: input.stack,
        code: input.code,
        data: {
          request: {
            method: config.method,
            url: config.url,
            baseURL: config.baseURL,
            params: config.params,
            headers: redactHeaders(config.headers),
          },
          response: response && {
            status: response.status,
            statusText: response.statusText,
            headers: redactHeaders(response.headers),
            data: cap(response.data),
          },
        },
      };
    },
  },
  {
    name: "error",
    match: (input) => input instanceof Error,
    normalize: (input: any) => ({
      name: input.name,
      message: input.message,
      stack: input.stack,
      code: typeof input.code === "string" ? input.code : undefined,
      data: input.data ?? undefined,
    }),
  },
];

export function registerErrorHandler(handler: ErrorHandler): void {
  handlers.unshift(handler);
}

export function isErrorLike(input: unknown): boolean {
  return handlers.some((h) => h.match(input));
}

export function normalizeError(input: unknown): NormalizedError | undefined {
  if (input === undefined || input === null) return undefined;
  for (const handler of handlers) {
    if (handler.match(input)) return handler.normalize(input);
  }
  if (typeof input === "string") return { message: input };
  return { name: "UnknownError", data: cap(util.inspect(input, { depth: 4 })) };
}
