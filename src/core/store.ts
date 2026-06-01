import fs from "fs";
import path from "path";
import { EventEmitter } from "events";
import { LogEntry, LogFileInfo, ReadQuery, ReadResult, StoreConfig } from "../types";

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

let logsDir = path.join(process.cwd(), "logs");
let retentionDays = -1;
let maxFileBytes = 0;
let flushIntervalMs = 0;
let maxBufferLines = 1000;

let lastMs = 0;
let seq = 0;

let currentDate = "";
let currentSegment = 0;
let currentFile = "";
let currentBytes = 0;

let buffer: { date: string; line: string }[] = [];
let bufferTimer: NodeJS.Timeout | null = null;
let exitHooked = false;

const NAME_RE = /^(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.jsonl$/;

export function initStore(cfg: StoreConfig): void {
  flush();
  logsDir = cfg.logsDir;
  retentionDays = cfg.retentionDays;
  maxFileBytes = cfg.maxFileBytes;
  flushIntervalMs = cfg.flushIntervalMs;
  maxBufferLines = cfg.maxBufferLines;
  currentDate = "";
  currentSegment = 0;
  currentFile = "";
  currentBytes = 0;
  buffer = [];
  fs.mkdirSync(logsDir, { recursive: true });
  if (flushIntervalMs > 0) hookExitFlush();
  runRetention();
}

export function getEmitter(): EventEmitter {
  return emitter;
}

export function nextId(epochMs: number): string {
  if (epochMs === lastMs) {
    seq += 1;
  } else {
    lastMs = epochMs;
    seq = 0;
  }
  return `${String(epochMs).padStart(15, "0")}-${String(seq).padStart(6, "0")}`;
}

function dateOf(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function segmentName(date: string, seg: number): string {
  return seg === 0 ? `${date}.jsonl` : `${date}.${seg}.jsonl`;
}

function segmentPath(date: string, seg: number): string {
  return path.join(logsDir, segmentName(date, seg));
}

function latestSegmentFor(date: string): number {
  let max = -1;
  for (const f of listFiles()) {
    if (f.date === date && f.seg > max) max = f.seg;
  }
  return max;
}

function openFor(date: string): void {
  const latest = latestSegmentFor(date);
  let seg = latest < 0 ? 0 : latest;
  let file = segmentPath(date, seg);
  let bytes = fs.existsSync(file) ? fs.statSync(file).size : 0;
  if (maxFileBytes > 0 && bytes >= maxFileBytes) {
    seg += 1;
    file = segmentPath(date, seg);
    bytes = 0;
  }
  currentDate = date;
  currentSegment = seg;
  currentFile = file;
  currentBytes = bytes;
  runRetention();
}

function ensureTarget(date: string): void {
  if (date !== currentDate || !currentFile) {
    openFor(date);
    return;
  }
  if (maxFileBytes > 0 && currentBytes >= maxFileBytes) {
    currentSegment += 1;
    currentFile = segmentPath(currentDate, currentSegment);
    currentBytes = 0;
  }
}

function writeChunk(date: string, text: string): void {
  ensureTarget(date);
  fs.appendFileSync(currentFile, text);
  currentBytes += Buffer.byteLength(text);
}

function scheduleFlush(): void {
  if (bufferTimer) return;
  bufferTimer = setTimeout(flush, flushIntervalMs);
}

export function flush(): void {
  if (bufferTimer) {
    clearTimeout(bufferTimer);
    bufferTimer = null;
  }
  if (buffer.length === 0) return;
  const items = buffer;
  buffer = [];
  try {
    let runDate = items[0].date;
    let chunk = "";
    for (const it of items) {
      if (it.date !== runDate) {
        writeChunk(runDate, chunk);
        runDate = it.date;
        chunk = "";
      }
      chunk += it.line;
    }
    if (chunk) writeChunk(runDate, chunk);
  } catch {
    // A logging failure must never throw into the request path.
  }
}

function hookExitFlush(): void {
  if (exitHooked) return;
  exitHooked = true;
  process.on("beforeExit", flush);
  process.on("exit", flush);
  process.on("SIGINT", () => {
    flush();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    flush();
    process.exit(143);
  });
}

export function append(entry: LogEntry): void {
  try {
    const date = entry.ts.slice(0, 10);
    const line = JSON.stringify(entry) + "\n";
    emitter.emit("entry", entry);
    if (flushIntervalMs <= 0) {
      writeChunk(date, line);
    } else {
      buffer.push({ date, line });
      if (buffer.length >= maxBufferLines) flush();
      else scheduleFlush();
    }
  } catch {
    // A logging failure must never throw into the request path.
  }
}

function runRetention(): void {
  if (retentionDays < 0) return;
  try {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    for (const f of listFiles()) {
      const ts = Date.parse(f.date);
      if (Number.isFinite(ts) && ts < cutoff) fs.unlinkSync(path.join(logsDir, f.name));
    }
  } catch {
    // ignore retention errors
  }
}

interface FileRef {
  name: string;
  date: string;
  seg: number;
}

function listFiles(): FileRef[] {
  try {
    const out: FileRef[] = [];
    for (const name of fs.readdirSync(logsDir)) {
      const m = NAME_RE.exec(name);
      if (m) out.push({ name, date: m[1], seg: m[2] ? Number(m[2]) : 0 });
    }
    return out;
  } catch {
    return [];
  }
}

/** All log files sorted oldest-first by (date, segment). */
function listFilesSorted(): FileRef[] {
  return listFiles().sort((a, b) => (a.date === b.date ? a.seg - b.seg : a.date < b.date ? -1 : 1));
}

export function listDates(): string[] {
  const seen = new Set<string>();
  for (const f of listFiles()) seen.add(f.date);
  return Array.from(seen).sort().reverse();
}

export function getLogsDir(): string {
  return logsDir;
}

/** All log files with their on-disk size + mtime, newest-first. For the admin log-management API. */
export function listLogFiles(): LogFileInfo[] {
  flush();
  const out: LogFileInfo[] = [];
  for (const f of listFiles()) {
    try {
      const st = fs.statSync(path.join(logsDir, f.name));
      out.push({ name: f.name, date: f.date, seg: f.seg, size: st.size, modifiedAt: st.mtime.toISOString() });
    } catch {
      // file vanished between readdir and stat; skip
    }
  }
  return out.sort((a, b) => (a.date === b.date ? b.seg - a.seg : a.date < b.date ? 1 : -1));
}

/**
 * Resolve a log filename to its absolute path, or `null` if it is not a valid log file inside
 * `logsDir`. Guards against path traversal / absolute paths — only names matching the log file
 * pattern that resolve to a direct child of `logsDir` are accepted.
 */
export function safeLogPath(name: string): string | null {
  if (typeof name !== "string" || !NAME_RE.test(name)) return null;
  const full = path.resolve(logsDir, name);
  if (path.dirname(full) !== path.resolve(logsDir)) return null;
  return full;
}

/** Delete the named log files (admin action). Returns what was removed, skipped, or rejected. */
export function deleteLogFiles(names: string[]): {
  deleted: string[];
  notFound: string[];
  invalid: string[];
  freedBytes: number;
} {
  flush();
  const deleted: string[] = [];
  const notFound: string[] = [];
  const invalid: string[] = [];
  let freedBytes = 0;
  for (const name of names) {
    const full = safeLogPath(name);
    if (!full) {
      invalid.push(name);
      continue;
    }
    try {
      freedBytes += fs.statSync(full).size;
      fs.unlinkSync(full);
      deleted.push(name);
      if (name === path.basename(currentFile)) {
        // dropped the active file; force a fresh target on next write
        currentFile = "";
        currentBytes = 0;
      }
    } catch (err: any) {
      if (err?.code === "ENOENT") notFound.push(name);
      else invalid.push(name);
    }
  }
  return { deleted, notFound, invalid, freedBytes };
}

/** Read a log file's raw bytes by name, or `null` if the name is invalid / unreadable. Used for zip download. */
export function readLogFileRaw(name: string): Buffer | null {
  const full = safeLogPath(name);
  if (!full) return null;
  try {
    return fs.readFileSync(full);
  } catch {
    return null;
  }
}

function readFile(name: string): LogEntry[] {
  try {
    const raw = fs.readFileSync(path.join(logsDir, name), "utf8");
    const out: LogEntry[] = [];
    for (const line of raw.split("\n")) {
      if (!line) continue;
      try {
        out.push(JSON.parse(line) as LogEntry);
      } catch {
        // skip torn/partial lines
      }
    }
    return out;
  } catch {
    return [];
  }
}

function matches(entry: LogEntry, query: ReadQuery): boolean {
  if (query.level && entry.level !== query.level) return false;
  if (query.requestId && entry.requestId !== query.requestId) return false;
  if (query.from && entry.ts < query.from) return false;
  if (query.to && entry.ts > query.to) return false;
  if (query.q && !entry.msg.toLowerCase().includes(query.q.toLowerCase())) return false;
  return true;
}

/**
 * Historical read, newest-first. Walks files (across date segments) backwards
 * from `before` (or the newest), back-filling earlier files until `limit` is reached.
 */
export function readEntries(query: ReadQuery): ReadResult {
  flush();
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 1000);
  const files = listFilesSorted().reverse();
  const collected: LogEntry[] = [];

  for (const file of files) {
    if (query.from && file.date < query.from.slice(0, 10)) break;
    const entries = readFile(file.name).sort((a, b) => (a.id < b.id ? 1 : -1));
    for (const entry of entries) {
      if (query.before && entry.id >= query.before) continue;
      if (!matches(entry, query)) continue;
      collected.push(entry);
      if (collected.length > limit) break;
    }
    if (collected.length > limit) break;
  }

  const hasMore = collected.length > limit;
  const page = collected.slice(0, limit);
  const nextBefore = hasMore ? page[page.length - 1].id : null;
  return { entries: page, nextBefore, hasMore };
}

/** Entries with `id > after` (oldest-first), used to backfill an SSE reconnect. */
export function readAfter(after: string, query: Pick<ReadQuery, "level" | "requestId">): LogEntry[] {
  flush();
  const afterDate = after.length >= 15 ? dateOf(Number(after.slice(0, 15))) : "";
  const files = listFilesSorted().filter((f) => !afterDate || f.date >= afterDate);
  const out: LogEntry[] = [];
  for (const file of files) {
    for (const entry of readFile(file.name)) {
      if (entry.id <= after) continue;
      if (query.level && entry.level !== query.level) continue;
      if (query.requestId && entry.requestId !== query.requestId) continue;
      out.push(entry);
    }
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}
