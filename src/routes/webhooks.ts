import { Router } from "express";
import { notImplemented } from "../middleware/error.ts";

/** Stripe webhooks — no JWT auth; raw body mounted in app.ts for signature verify later. */
export const webhooksRouter = Router();

webhooksRouter.post("/webhooks/stripe", notImplemented);
