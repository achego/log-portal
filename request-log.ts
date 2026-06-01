import { RequestHandler } from "express";
import { record } from "./logger";

export function requestLogMiddleware(basePath: string): RequestHandler {
  return (req, _res, next) => {
    if (req.path.startsWith(basePath)) return next();

    const method = req.method.toUpperCase();
    const url = req.originalUrl;
    const at = new Date().toString().replace(/ \(.*\)$/, "");
    const ip = req.ip;
    const userAgent = req.headers["user-agent"];

    record("request", `Request: ${method} ${url} at ${at}, IP: ${ip}, User Agent: ${userAgent}`, {
      source: "request",
      meta: { method, url, ip, userAgent },
    });
    next();
  };
}
