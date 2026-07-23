import { createApp } from "./app.ts";
import { loadEnv } from "./config/env.ts";

const env = loadEnv();
const app = createApp();

export default app;

// Local Bun/Node: listen. On Vercel, the platform invokes the exported app.
if (!process.env.VERCEL) {
  app.listen(env.PORT, () => {
    console.log(`micromanus-backend listening on http://localhost:${env.PORT}`);
  });
}
