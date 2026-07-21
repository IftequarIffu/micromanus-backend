import { Router, type Request, type Response, type NextFunction } from "express";
import { AppError } from "../middleware/error.ts";
import { handleStripeWebhook } from "../services/credits.ts";

/** Stripe webhooks — no JWT auth; raw body mounted in app.ts for signature verify. */
export const webhooksRouter = Router();

webhooksRouter.post(
  "/webhooks/stripe",
  async (req: Request, res: Response, _next: NextFunction) => {
    try {
      const rawBody = req.body;
      if (!Buffer.isBuffer(rawBody)) {
        throw new AppError(
          400,
          "invalid_webhook_body",
          "Stripe webhook expects a raw JSON body",
        );
      }

      const signature = req.headers["stripe-signature"];
      const signatureHeader = Array.isArray(signature) ? signature[0] : signature;

      const result = await handleStripeWebhook(rawBody, signatureHeader);
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      console.error("stripe webhook handler error", err);
      res.status(500).json({ error: "internal_server_error", code: "internal_error" });
    }
  },
);
