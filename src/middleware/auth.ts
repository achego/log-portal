import { RequestHandler } from "express";

export const noopAuth: RequestHandler = (_req, _res, next) => next();
