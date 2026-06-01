import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { RequestHandler } from "express";

interface RequestContext {
  requestId: string;
}

const als = new AsyncLocalStorage<RequestContext>();

export function getRequestId(): string | undefined {
  return als.getStore()?.requestId;
}

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return als.run({ requestId }, fn);
}

export function requestIdMiddleware(): RequestHandler {
  return (req, res, next) => {
    const inbound = req.header("X-Request-Id");
    const requestId = inbound && inbound.trim() ? inbound.trim() : randomUUID();
    res.setHeader("X-Request-Id", requestId);
    als.run({ requestId }, () => next());
  };
}
