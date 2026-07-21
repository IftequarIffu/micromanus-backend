import { AppError } from "../middleware/error.ts";

/** Map PostgREST / Postgres errors into AppError when possible. */
export function mapDbError(context: string, error: { code?: string; message?: string }): never {
  const code = error.code ?? "";
  const message = error.message ?? "unknown";

  // undefined_column / missing schema cache column — usually unapplied BYOK migration
  if (
    code === "42703" ||
    code === "PGRST204" ||
    /column .* does not exist/i.test(message) ||
    /Could not find the .* column/i.test(message)
  ) {
    throw new AppError(
      503,
      "schema_outdated",
      "Database schema is outdated for api_keys. Run db/migrations/001_api_keys_byok.sql in the Supabase SQL Editor, then retry.",
    );
  }

  throw new Error(`${context}: ${code || message}`);
}
