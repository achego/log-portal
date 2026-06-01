import { Router, RequestHandler } from "express";
import { logController } from "./controller";

export function createLogRouter(guards: RequestHandler[], login?: RequestHandler): Router {
  const router = Router();
  if (login) router.post("/login", login);
  router.get("/", ...guards, logController.history);
  router.get("/stream", ...guards, logController.stream);
  router.get("/levels", ...guards, logController.levels);
  router.get("/dates", ...guards, logController.dates);
  router.get("/health", ...guards, logController.health);
  return router;
}
