import express, { type Express } from "express";
import { errorHandler } from "./middleware/error.ts";
import { requestLog } from "./middleware/request-log.ts";
import { apiKeysRouter } from "./routes/api-keys.ts";
import { chatsRouter } from "./routes/chats.ts";
import { creditsRouter } from "./routes/credits.ts";
import { healthRouter } from "./routes/health.ts";
import { meRouter } from "./routes/me.ts";
import { modelsRouter } from "./routes/models.ts";
import { webhooksRouter } from "./routes/webhooks.ts";

export function createApp(): Express {
  const app = express();

  app.use(requestLog);

  // Stripe needs the raw body for signature verification (implemented later).
  app.use("/webhooks/stripe", express.raw({ type: "application/json" }));
  app.use(webhooksRouter);

  app.use(express.json());

  app.use(healthRouter);
  app.use(meRouter);
  app.use(apiKeysRouter);
  app.use(chatsRouter);
  app.use(creditsRouter);
  app.use(modelsRouter);

  app.use(errorHandler);

  return app;
}
