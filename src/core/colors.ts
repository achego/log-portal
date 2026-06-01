import { LevelInfo, LogColor, LogLevel } from "../types";

const COLORS: Record<LogLevel, LogColor> = {
  error: { text: "#f87171", bg: "#ef44441a", border: "" },
  warn: { text: "#fbbf24", bg: "#f59e0b1a", border: "" },
  info: { text: "#34d399", bg: "#10b9811a", border: "" },
  debug: { text: "#38bdf8", bg: "#0ea5e91a", border: "" },
  request: { text: "#a78bfa", bg: "#8b5cf61a", border: "" },
  threat: { text: "#fb7185", bg: "#f43f5e1a", border: "" },
};

const ORDER: LogLevel[] = ["error", "warn", "info", "debug", "request", "threat"];

export function levelInfo(): LevelInfo[] {
  return ORDER.map((level) => ({ level, color: COLORS[level] }));
}
