import { Router } from "express";
import { z } from "zod";
import { authedUserId, requireAuth } from "../middleware/auth.ts";
import { AppError } from "../middleware/error.ts";
import {
  isLlmProvider,
  listPublicApiKeys,
  removeApiKey,
  saveApiKey,
} from "../services/api-keys.ts";

export const apiKeysRouter = Router();

apiKeysRouter.use(requireAuth);

const saveBodySchema = z.object({
  provider: z.string().trim().min(1),
  apiKey: z.string().min(1),
});

apiKeysRouter.post("/api-keys", async (req, res, next) => {
  try {
    const userId = authedUserId(req);
    const parsed = saveBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body", code: "invalid_body" });
      return;
    }

    const { provider, apiKey } = parsed.data;
    if (!isLlmProvider(provider)) {
      throw new AppError(400, "invalid_provider", "provider must be openai, claude, or gemini");
    }

    const saved = await saveApiKey(userId, provider, apiKey);
    res.status(200).json(saved);
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    next(err);
  }
});

apiKeysRouter.get("/api-keys", async (req, res, next) => {
  try {
    const userId = authedUserId(req);
    const keys = await listPublicApiKeys(userId);
    res.json({ keys });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    next(err);
  }
});

apiKeysRouter.delete("/api-keys/:provider", async (req, res, next) => {
  try {
    const userId = authedUserId(req);
    const provider = String(req.params.provider ?? "");
    if (!isLlmProvider(provider)) {
      throw new AppError(400, "invalid_provider", "provider must be openai, claude, or gemini");
    }
    await removeApiKey(userId, provider);
    res.status(204).send();
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    next(err);
  }
});
