/**
 * Verifies service-role reachability of all micromanus tables.
 * Prints status codes only — never row contents or secrets.
 */
import { getSupabaseClient } from "../src/db/client.ts";
import { loadEnv, resetEnvCache } from "../src/config/env.ts";

const TABLES = [
  "users",
  "chats",
  "messages",
  "sources",
  "credit_usage",
  "credit_balances",
  "credit_purchases",
  "coupons",
  "coupon_redemptions",
  "api_keys",
] as const;

resetEnvCache();
const env = loadEnv();

if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("FAIL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(1);
}

const client = getSupabaseClient();
if (!client) {
  console.error("FAIL: could not create Supabase client");
  process.exit(1);
}

let failed = 0;

for (const table of TABLES) {
  const { error, count } = await client
    .from(table)
    .select("*", { count: "exact", head: true });

  if (error) {
    failed += 1;
    const code = error.code ?? "unknown";
    const message = error.message?.split("\n")[0] ?? "error";
    console.log(`${table}: FAIL code=${code} message=${message}`);
    continue;
  }

  console.log(`${table}: OK count=${count ?? 0}`);
}

if (failed > 0) {
  console.error(
    `\n${failed}/${TABLES.length} table(s) failed. If you just applied the schema, wait ~10s for PostgREST schema cache and re-run.`,
  );
  process.exit(1);
}

console.log(`\nAll ${TABLES.length} tables OK.`);
