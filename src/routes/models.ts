import { Router } from "express";
import { requireAuth } from "../middleware/auth.ts";
import { notImplemented } from "../middleware/error.ts";

export const modelsRouter = Router();

modelsRouter.use(requireAuth);

modelsRouter.get("/models", notImplemented);
