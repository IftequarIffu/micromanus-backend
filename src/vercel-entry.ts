/**
 * Bundled into `api/index.js` for Vercel (`npm run vercel-build` / `bun run vercel-build`).
 * Local dev continues to use `src/index.ts` via `bun run dev`.
 */
import { createApp } from "./app.ts";
import { loadEnv } from "./config/env.ts";

loadEnv();

export default createApp();
