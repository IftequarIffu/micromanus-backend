import { Router } from "express";
import { authedUserId, requireAuth } from "../middleware/auth.ts";
import { notImplemented } from "../middleware/error.ts";
import { getCreditsSummary } from "../services/credits.ts";

export const creditsRouter = Router();

creditsRouter.use(requireAuth);

creditsRouter.get("/credits", async (req, res, next) => {
  try {
    const userId = authedUserId(req);
    const chatId =
      typeof req.query.chatId === "string" && req.query.chatId.length > 0
        ? req.query.chatId
        : undefined;
    const summary = await getCreditsSummary(userId, chatId);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

creditsRouter.post("/credits/checkout", notImplemented);
creditsRouter.post("/credits/redeem", notImplemented);
