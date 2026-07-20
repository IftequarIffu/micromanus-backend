import type { NextFunction, Request, Response } from "express";

export type AuthedRequest = Request & {
  /** Placeholder until JWT verification is implemented (auth-middleware prompt). */
  userId?: string;
};

/**
 * Stub auth: require Authorization Bearer token; do not verify JWT yet.
 * Never trust user_id from the request body.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    res.status(401).json({ error: "missing_or_invalid_authorization", code: "unauthorized" });
    return;
  }

  const token = header.slice("bearer ".length).trim();
  if (!token) {
    res.status(401).json({ error: "missing_or_invalid_authorization", code: "unauthorized" });
    return;
  }

  // TODO(auth-middleware): verify Supabase JWT with SUPABASE_JWT_SECRET and set real userId.
  (req as AuthedRequest).userId = "unverified";
  next();
}
