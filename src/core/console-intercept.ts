import util from "util";
import { LogLevel } from "../types";
import { record } from "./logger";
import { normalizeError, isErrorLike } from "./normalize-error";

type ConsoleMethod = "log" | "info" | "warn" | "error" | "dir";

const LEVEL: Record<ConsoleMethod, LogLevel> = {
  error: "error",
  warn: "warn",
  log: "info",
  info: "info",
  dir: "info",
};

let patched = false;
let inside = false;

function render(args: unknown[]): string {
  return args
    .map((a) => (typeof a === "string" ? a : util.inspect(a, { depth: null })))
    .join(" ");
}

export function patchConsole(): void {
  if (patched) return;
  patched = true;

  (Object.keys(LEVEL) as ConsoleMethod[]).forEach((method) => {
    const original = console[method].bind(console) as (...args: unknown[]) => void;
    console[method] = (...args: unknown[]) => {
      original(...args);
      if (inside) return;
      inside = true;
      try {
        const errArg = args.find(isErrorLike);
        record(LEVEL[method], render(args), { err: normalizeError(errArg) });
      } catch {
        // never let logging capture break the app
      } finally {
        inside = false;
      }
    };
  });
}
