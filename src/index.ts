import { createApp } from "./app.ts";
import { loadEnv } from "./config/env.ts";

const env = loadEnv();
const app = createApp();

app.listen(env.PORT, () => {
  console.log(`micromanus-backend listening on http://localhost:${env.PORT}`);
});
