import { Router } from "express";
import { z } from "zod";
import { authedUserId, requireAuth } from "../middleware/auth.ts";
import { AppError } from "../middleware/error.ts";
import {
  createCreditsCheckout,
  getCreditsSummary,
  redeemCoupon,
} from "../services/credits.ts";

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

const checkoutBodySchema = z.object({
  credits: z.number().int(),
});

creditsRouter.post("/credits/checkout", async (req, res, next) => {
  try {
    const userId = authedUserId(req);
    const parsed = checkoutBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body", code: "invalid_body" });
      return;
    }

    const result = await createCreditsCheckout(userId, parsed.data.credits);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    next(err);
  }
});

const redeemBodySchema = z.object({
  code: z.string().trim().min(1).max(64),
});

creditsRouter.post("/credits/redeem", async (req, res, next) => {
  try {
    const userId = authedUserId(req);
    const parsed = redeemBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body", code: "invalid_body" });
      return;
    }

    const result = await redeemCoupon(userId, parsed.data.code);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    next(err);
  }
});
