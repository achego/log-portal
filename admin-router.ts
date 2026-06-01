import { Router, RequestHandler } from "express";
import { AuthConfig } from "./types";
import { createAdminController } from "./admin-controller";
import { createAdminAuth } from "./auth-middleware";
import { createE2EMiddleware } from "./e2e-middleware";

export function createAdminRouter(auth: AuthConfig): Router {
  const router = Router();
  const controller = createAdminController(auth);
  const guards: RequestHandler[] = [createAdminAuth(auth)];
  if (auth.e2e) guards.push(createE2EMiddleware());

  router.post("/login", controller.login);
  router.get("/developers", ...guards, controller.listDevelopers);
  router.post("/developers", ...guards, controller.addDeveloper);
  router.post("/developers/:email/regenerate", ...guards, controller.regenerateCode);
  router.post("/developers/:email/revoke", ...guards, controller.revoke);
  router.post("/developers/:email/activate", ...guards, controller.activate);
  router.delete("/developers/:email", ...guards, controller.removeDeveloper);
  return router;
}
