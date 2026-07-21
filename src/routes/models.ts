import { Router } from "express";
import { requireAuth } from "../middleware/auth.ts";
import { listModels } from "../orchestration/models.ts";

export const modelsRouter = Router();

modelsRouter.use(requireAuth);

modelsRouter.get("/models", (_req, res) => {
  res.json({ models: listModels() });
});
