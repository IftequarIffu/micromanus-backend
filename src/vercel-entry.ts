/**
 * Bundled into `api/index.js` (CommonJS) for Vercel.
 * Local dev continues to use `src/index.ts` via `bun run dev`.
 */
import type { Request, Response } from "express";
import { createApp } from "./app.ts";
import { loadEnv } from "./config/env.ts";

loadEnv();

const app = createApp();

/** Vercel / @vercel/node invoke `(req, res) => …` or an Express app. */
function handler(req: Request, res: Response): void {
  app(req, res);
}

export default handler;
