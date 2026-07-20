import type { NextFunction, Request, Response } from "express";
import {
  AuthConfigError,
  JwtVerifyError,
  verifySupabaseJwt,
} from "../lib/auth/verify-supabase-jwt.ts";
import { ensureUser } from "../services/users.ts";

export type AuthedRequest = Request & {
  userId: string;
};

function bearerToken(req: Request): string | null {
  const header = req.header("authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  const token = header.slice("bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Verify Supabase JWT, attach userId (sub), upsert public.users on first request.
 * Never trust user_id from the request body.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = bearerToken(req);
  if (!token) {
    console.log("auth failure reason=missing_bearer");
    res.status(401).json({ error: "missing_or_invalid_authorization", code: "unauthorized" });
    return;
  }

  try {
    const verified = await verifySupabaseJwt(token);
    await ensureUser({
      userId: verified.userId,
      emailFromJwt: verified.email,
      accessToken: token,
    });

    (req as AuthedRequest).userId = verified.userId;
    console.log(`auth success userId=${verified.userId}`);
    next();
  } catch (err) {
    if (err instanceof AuthConfigError) {
      console.error(`auth misconfigured: ${err.message}`);
      res.status(503).json({ error: "auth_not_configured", code: "service_unavailable" });
      return;
    }

    if (err instanceof JwtVerifyError) {
      console.log(`auth failure reason=${err.reason}`);
      res.status(401).json({ error: "missing_or_invalid_authorization", code: "unauthorized" });
      return;
    }

    const message = err instanceof Error ? err.message : "unknown";
    if (message.includes("not configured") || message.includes("service-role")) {
      console.error(`auth misconfigured: ${message}`);
      res.status(503).json({ error: "auth_not_configured", code: "service_unavailable" });
      return;
    }

    console.error(`auth failure reason=ensure_user message=${message}`);
    res.status(401).json({ error: "missing_or_invalid_authorization", code: "unauthorized" });
  }
}
