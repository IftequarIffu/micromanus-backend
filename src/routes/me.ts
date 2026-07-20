import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../middleware/auth.ts";
import { AppError } from "../middleware/error.ts";
import { getCurrentUser } from "../services/users.ts";

export const meRouter = Router();

meRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const { userId } = req as AuthedRequest;
    const user = await getCurrentUser(userId);
    if (!user) {
      throw new AppError(404, "not_found", "user_not_found");
    }
    res.status(200).json({
      id: user.id,
      name: user.name,
      email: user.email,
      created_at: user.created_at,
    });
  } catch (err) {
    next(err);
  }
});
