/**
 * Example server for local development / testing the dashboard frontend.
 *
 * Run it with:   npm run example
 * Then point your frontend at:   http://localhost:4000/api/_logs
 *
 * It mounts log-portal, enables CORS for a browser frontend, exposes a couple
 * of demo routes that produce logs, and emits a heartbeat log every few seconds
 * so the live SSE stream always has something to show.
 */
import express from "express";
import { mountLogPortal, logger } from "../src";

const app = express();
app.use(express.json());

// --- CORS so a browser dashboard on another origin (e.g. Vite on :5173) can read ---
app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.header("Access-Control-Allow-Origin", origin || "*");
  if (origin) res.header("Access-Control-Allow-Credentials", "true");
  res.header("Vary", "Origin");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Request-Id, Last-Event-ID",
  );
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// --- Mount the portal (serves the read API + SSE at /api/_logs by default) ---
mountLogPortal(app, {
  // Try auth/e2e here when you want to exercise those flows, e.g.:
  // authEnabled: true,
  // authSecret: "dev-secret",
  // adminEmail: "you@example.com",
  // adminPassword: "password",
  // adminSecurityCode: "1234",
});

// --- Demo routes that generate logs you can watch in the dashboard ---
app.get("/", (_req, res) =>
  res.json({ ok: true, try: ["/demo/info", "/demo/error"] }),
);

app.get("/demo/info", (req, res) => {
  logger.info("demo info log", { query: req.query });
  res.json({ logged: "info" });
});

app.get("/demo/error", (_req, res) => {
  logger.error("demo error log", new Error("something broke"));
  res.status(500).json({ logged: "error" });
});

// --- Heartbeat so the live stream always has fresh entries ---
setInterval(
  () => logger.info("heartbeat", { at: new Date().toISOString() }),
  5000,
);

setInterval(async () => {
  try {
    const response = await fetch(
      "https://jsonplaceholder.typicode.com/todos/1000",
    );
    logger.info("the response", { response });

    // throw Error("Test Error");
  } catch (e) {
    logger.error("An error occurred", e);
  }
}, 3000);

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(
    `[example] log-portal server running on http://localhost:${PORT}`,
  );
  console.log(`[example] read API:   http://localhost:${PORT}/api/_logs`);
  console.log(
    `[example] live SSE:   http://localhost:${PORT}/api/_logs/stream`,
  );
});

// Users should be turn off intercepting console log
// SSE connection should be authenticated per request
// Role based log viewing
// Protection for logging sensitive data
