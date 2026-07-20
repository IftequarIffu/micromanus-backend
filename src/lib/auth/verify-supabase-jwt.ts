import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  type JWTPayload,
} from "jose";
import { loadEnv } from "../../config/env.ts";

export type VerifiedAccessToken = {
  userId: string;
  email: string | undefined;
  role: string;
};

export class JwtVerifyError extends Error {
  readonly reason: string;

  constructor(reason: string, message: string) {
    super(message);
    this.name = "JwtVerifyError";
    this.reason = reason;
  }
}

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigError";
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksUrl: string | null = null;

function getJwks(supabaseUrl: string): ReturnType<typeof createRemoteJWKSet> {
  const url = `${supabaseUrl.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`;
  if (!jwks || jwksUrl !== url) {
    jwks = createRemoteJWKSet(new URL(url));
    jwksUrl = url;
  }
  return jwks;
}

function parseClaims(payload: JWTPayload): VerifiedAccessToken {
  const sub = payload.sub;
  if (!sub || !UUID_RE.test(sub)) {
    throw new JwtVerifyError("missing_sub", "Token missing valid subject");
  }

  const role = typeof payload.role === "string" ? payload.role : undefined;
  if (role !== "authenticated") {
    throw new JwtVerifyError("invalid_role", "Token is not an authenticated user access token");
  }

  const email = typeof payload.email === "string" ? payload.email : undefined;

  return { userId: sub, email, role };
}

/**
 * Verifies a Supabase user access token.
 * Asymmetric algs use JWKS; HS256 uses SUPABASE_JWT_SECRET.
 */
export async function verifySupabaseJwt(token: string): Promise<VerifiedAccessToken> {
  const env = loadEnv();
  if (!env.SUPABASE_URL) {
    throw new AuthConfigError("SUPABASE_URL is not configured");
  }

  let header: ReturnType<typeof decodeProtectedHeader>;
  try {
    header = decodeProtectedHeader(token);
  } catch {
    throw new JwtVerifyError("invalid_token", "JWT header could not be decoded");
  }

  const alg = header.alg;
  if (!alg) {
    throw new JwtVerifyError("invalid_token", "JWT missing alg");
  }

  try {
    if (alg === "HS256") {
      if (!env.SUPABASE_JWT_SECRET) {
        throw new AuthConfigError("SUPABASE_JWT_SECRET is required for HS256 tokens");
      }
      const { payload } = await jwtVerify(token, new TextEncoder().encode(env.SUPABASE_JWT_SECRET), {
        algorithms: ["HS256"],
      });
      return parseClaims(payload);
    }

    if (alg === "ES256" || alg === "RS256" || alg === "EdDSA") {
      const { payload } = await jwtVerify(token, getJwks(env.SUPABASE_URL), {
        algorithms: [alg],
      });
      return parseClaims(payload);
    }

    throw new JwtVerifyError("invalid_token", `Unsupported JWT alg: ${alg}`);
  } catch (err) {
    if (err instanceof JwtVerifyError || err instanceof AuthConfigError) {
      throw err;
    }
    throw new JwtVerifyError("invalid_token", "JWT verification failed");
  }
}

/** Test helper to reset JWKS cache between tests. */
export function resetJwtVerifierState(): void {
  jwks = null;
  jwksUrl = null;
}
