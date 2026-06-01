import { Request, Response } from "express";
import { createErrorResponse, createSuccessResponse } from "./response";
import { getEmitter, getLogsDir, listDates, readAfter, readEntries } from "../core/store";
import { encryptPayload } from "../auth/auth-crypto";
import { levelInfo } from "../core/colors";
import { LogEntry, LogLevel, ReadQuery } from "../types";

const LEVELS: LogLevel[] = ["error", "warn", "info", "debug", "request", "threat"];

function asLevel(value: unknown): LogLevel | undefined {
  return typeof value === "string" && (LEVELS as string[]).includes(value) ? (value as LogLevel) : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

export const logController = {
  history(req: Request, res: Response) {
    try {
      const q = req.query;
      const query: ReadQuery = {
        level: asLevel(q.level),
        from: str(q.from),
        to: str(q.to),
        q: str(q.q),
        requestId: str(q.requestId),
        before: str(q.before),
        limit: q.limit !== undefined ? Number(q.limit) : undefined,
      };
      res.json(createSuccessResponse(readEntries(query)));
    } catch (err: any) {
      res.status(500).json(createErrorResponse(`failed to read logs. error: ${err.message}`));
    }
  },

  levels(_req: Request, res: Response) {
    res.json(createSuccessResponse(levelInfo()));
  },

  dates(_req: Request, res: Response) {
    try {
      res.json(createSuccessResponse(listDates()));
    } catch (err: any) {
      res.status(500).json(createErrorResponse(`failed to list log dates. error: ${err.message}`));
    }
  },

  health(_req: Request, res: Response) {
    res.json(createSuccessResponse({ ok: true, dir: getLogsDir(), dates: listDates().length }));
  },

  stream(req: Request, res: Response) {
    const level = asLevel(req.query.level);
    const requestId = str(req.query.requestId);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const e2eKey = (res as any).e2eKey as Buffer | undefined;
    const send = (entry: LogEntry) => {
      if (level && entry.level !== level) return;
      if (requestId && entry.requestId !== requestId) return;
      const payload = JSON.stringify(entry);
      res.write(`id: ${entry.id}\n`);
      res.write(`data: ${e2eKey ? encryptPayload(e2eKey, payload) : payload}\n\n`);
    };

    const after = str(req.header("Last-Event-ID")) ?? str(req.query.after);
    if (after) {
      for (const entry of readAfter(after, { level, requestId })) send(entry);
    }

    const emitter = getEmitter();
    emitter.on("entry", send);

    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);

    req.on("close", () => {
      clearInterval(heartbeat);
      emitter.off("entry", send);
    });
  },
};
