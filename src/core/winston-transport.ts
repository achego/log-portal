import type Transport from "winston-transport";
import { record } from "./logger";
import { LogLevel } from "../types";

const LEVELS: LogLevel[] = ["error", "warn", "info", "debug", "request", "threat"];

function asLevel(level: unknown): LogLevel {
  return typeof level === "string" && (LEVELS as string[]).includes(level)
    ? (level as LogLevel)
    : "info";
}

export function createLogPortalTransport(opts?: Transport.TransportStreamOptions): Transport {
  // `winston-transport` is an optional peer dependency: only required when a
  // consumer actually wires up the Winston transport, so the rest of the
  // package keeps working without `winston` installed.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const TransportBase: typeof Transport = require("winston-transport");

  class LogPortalTransport extends TransportBase {
    log(info: any, next: () => void): void {
      setImmediate(() => this.emit("logged", info));
      const { level, message, stack, ...meta } = info;
      record(asLevel(level), String(message), {
        meta: Object.keys(meta).length ? meta : undefined,
        err: stack ? { message: String(message), stack: String(stack) } : undefined,
      });
      next();
    }
  }
  return new LogPortalTransport(opts);
}
