import { z } from "zod";

const optionalString = z.string().min(1).optional();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),

  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  SUPABASE_JWT_SECRET: optionalString,

  TAVILY_API_KEY: optionalString,

  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  CHECKOUT_SUCCESS_URL: optionalString,
  CHECKOUT_CANCEL_URL: optionalString,
  /** When true, allow sk_live_ keys. Default: refuse live keys (soft-launch / test mode). */
  ALLOW_LIVE_STRIPE: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),

  /** Comma-separated browser origins allowed for CORS (e.g. https://app.vercel.app). */
  CORS_ORIGINS: optionalString,

  ENCRYPTION_KEY: optionalString,
  ADMIN_SECRET: optionalString,
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

function emptyToUndefined<T extends Record<string, unknown>>(value: T): T {
  const out = { ...value };
  for (const key of Object.keys(out)) {
    if (out[key] === "") {
      (out as Record<string, unknown>)[key] = undefined;
    }
  }
  return out;
}

/** Load and validate env. Secrets are optional so the server can boot; feature code fails at use-time. */
export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  if (cached) {
    return cached;
  }

  const parsed = envSchema.safeParse(emptyToUndefined(raw as Record<string, unknown>));
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${message}`);
  }

  cached = parsed.data;
  return cached;
}

export function resetEnvCache(): void {
  cached = null;
}
