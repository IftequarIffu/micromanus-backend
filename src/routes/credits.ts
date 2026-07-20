import { Router } from "express";
import { requireAuth } from "../middleware/auth.ts";
import { notImplemented } from "../middleware/error.ts";

export const creditsRouter = Router();

creditsRouter.use(requireAuth);

creditsRouter.get("/credits", notImplemented);
creditsRouter.post("/credits/checkout", notImplemented);
creditsRouter.post("/credits/redeem", notImplemented);
