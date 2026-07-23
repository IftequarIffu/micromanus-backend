import cors from "cors";
import type { RequestHandler } from "express";
import { loadEnv } from "../config/env.ts";

let warnedMissingOrigins = false;

function parseCorsOrigins(): string[] {
  const raw = loadEnv().CORS_ORIGINS;
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/** Allow listed browser origins (comma-separated CORS_ORIGINS). No wildcard. */
export function corsMiddleware(): RequestHandler {
  return cors({
    origin(origin, callback) {
      const allowed = parseCorsOrigins();

      // Non-browser / same-origin tooling (curl, Stripe webhooks, server clients)
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowed.length === 0) {
        if (!warnedMissingOrigins) {
          warnedMissingOrigins = true;
          console.warn(
            "CORS_ORIGINS is unset — browser cross-origin requests will be rejected. Set comma-separated frontend origins for Vercel.",
          );
        }
        callback(null, false);
        return;
      }

      if (allowed.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Accept"],
    maxAge: 86400,
  });
}
