import { RequestHandler } from "express";
import { record } from "../core/logger";
import { ThreatContext, ThreatDetection, ThreatRule, ThreatSeverity } from "../types";

const SENSITIVE_PATHS = [
  "/.env",
  "/.git",
  "/.aws/",
  "/.ssh/",
  "/.htaccess",
  "/.ds_store",
  "/config.json",
  "/wp-login.php",
  "/wp-admin",
  "/phpmyadmin",
  "/actuator",
  "/server-status",
];

const SCANNER_UA = /sqlmap|nikto|nmap|masscan|zgrab|gobuster|dirbuster|wpscan|acunetix|nessus|fimap|netsparker/i;
const SQLI = /('|%27)\s*(or|and)\s+\d|union\s+select|;\s*drop\s+table|--\s|xp_cmdshell/i;
const XSS = /<script|javascript:|onerror\s*=|onload\s*=/i;
const TRAVERSAL = /\.\.\/|\.\.\\|\.\.%2f|%2e%2e|%00/i;

const rules: ThreatRule[] = [
  {
    type: "path_traversal",
    severity: "high",
    test: (ctx) => firstMatch(TRAVERSAL, ctx.url) ?? firstMatch(TRAVERSAL, ctx.decodedUrl),
  },
  {
    type: "sensitive_path",
    severity: "high",
    test: (ctx) => {
      const p = ctx.path.toLowerCase();
      return SENSITIVE_PATHS.find((s) => p.startsWith(s) || p.includes(s)) ?? null;
    },
  },
  {
    type: "scanner_ua",
    severity: "medium",
    test: (ctx) => firstMatch(SCANNER_UA, ctx.userAgent),
  },
  {
    type: "sqli",
    severity: "medium",
    test: (ctx) => firstMatch(SQLI, ctx.decodedUrl),
  },
  {
    type: "xss",
    severity: "medium",
    test: (ctx) => firstMatch(XSS, ctx.decodedUrl),
  },
];

function firstMatch(re: RegExp, value: string): string | null {
  const m = re.exec(value);
  return m ? m[0] : null;
}

export function registerThreatRule(rule: ThreatRule): void {
  rules.unshift(rule);
}

const RANK: Record<ThreatSeverity, number> = { low: 1, medium: 2, high: 3 };

function decode(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

export function detectThreats(ctx: ThreatContext, maxUrlLength: number): ThreatDetection[] {
  const found: ThreatDetection[] = [];
  for (const rule of rules) {
    const match = rule.test(ctx);
    if (match) found.push({ type: rule.type, severity: rule.severity, match });
  }
  if (ctx.url.length > maxUrlLength) {
    found.push({ type: "oversized_url", severity: "low", match: `length=${ctx.url.length}` });
  }
  return found;
}

export function threatMiddleware(basePath: string, maxUrlLength: number): RequestHandler {
  return (req, _res, next) => {
    if (req.path.startsWith(basePath)) return next();
    try {
      const url = req.originalUrl;
      const ctx: ThreatContext = {
        method: req.method.toUpperCase(),
        path: req.path,
        url,
        decodedUrl: decode(url),
        userAgent: (req.headers["user-agent"] as string) ?? "",
        ip: req.ip,
      };

      const detections = detectThreats(ctx, maxUrlLength);
      if (detections.length) {
        const primary = detections.reduce((a, b) => (RANK[b.severity] > RANK[a.severity] ? b : a));
        record("threat", `Threat: ${primary.type} (${primary.severity}) from ${ctx.ip} ${ctx.method} ${url}`, {
          source: "threat",
          meta: {
            type: primary.type,
            severity: primary.severity,
            ip: ctx.ip,
            method: ctx.method,
            url,
            userAgent: ctx.userAgent,
            matches: detections,
          },
        });
      }
    } catch {
      // detection must never break the request path
    }
    next();
  };
}
