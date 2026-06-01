import path from "path";
import { LogPortalOptions, ResolvedConfig } from "./types";
import { envBool, envInt, portalEnv } from "./env";
import { resolveAuthConfig } from "./auth-config";

const DEFAULT_LOGS_DIR = path.join(process.cwd() || ".", "logs");

export function resolveConfig(options: LogPortalOptions = {}): ResolvedConfig {
  const env = portalEnv();
  const maxFileMb = options.maxFileMb ?? envInt(env.maxFileMb, 50);
  const logsDir = (options.logsDir ?? env.dir ?? DEFAULT_LOGS_DIR).trim() || DEFAULT_LOGS_DIR;
  return {
    basePath: options.basePath ?? env.basePath ?? "/api/_logs",
    logsDir,
    retentionDays: options.retentionDays ?? envInt(env.retentionDays, 2),
    maxFileBytes: Math.max(maxFileMb, 0) * 1024 * 1024,
    flushIntervalMs: options.flushIntervalMs ?? envInt(env.flushMs, 0),
    maxBufferLines: options.maxBufferLines ?? envInt(env.bufferLines, 1000),
    captureConsole: options.captureConsole ?? envBool(env.captureConsole, true),
    logRequests: options.logRequests ?? envBool(env.logRequests, true),
    detectThreats: options.detectThreats ?? envBool(env.detectThreats, true),
    maxUrlLength: options.maxUrlLength ?? envInt(env.maxUrlLen, 2000),
    enabled: options.enabled ?? envBool(env.enabled, true),
    auth: resolveAuthConfig(options, logsDir),
  };
}
