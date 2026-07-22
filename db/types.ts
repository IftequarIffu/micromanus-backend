export type MessageRole = "user" | "assistant";

export type LlmProvider = "openai" | "claude" | "gemini";

export type PurchaseStatus = "pending" | "completed" | "failed";

export type User = {
  id: string;
  name: string;
  email: string;
  created_at: string;
};

export type Chat = {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
};

export type Message = {
  id: string;
  chat_id: string;
  role: MessageRole;
  content: string;
  model: string | null;
  /** Internal chat-pdfs object path; omit from client responses. */
  pdf_storage_path: string | null;
  pdf_filename: string | null;
  created_at: string;
};

/** Client-facing message; signed PDF URL only when available. */
export type MessagePublic = {
  id: string;
  chat_id: string;
  role: MessageRole;
  content: string;
  model: string | null;
  created_at: string;
  pdf?: { url: string; filename: string };
};

export type Source = {
  id: string;
  chat_id: string;
  message_id: string;
  source_link: string;
  content: string;
  created_at: string;
};

export type CreditUsage = {
  id: string;
  user_id: string;
  chat_id: string;
  model_name: string;
  provider: LlmProvider;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  credits_charged: number;
  created_at: string;
};

export type CreditBalance = {
  user_id: string;
  balance: number;
  updated_at: string;
};

export type CreditPurchase = {
  id: string;
  user_id: string;
  stripe_session_id: string;
  amount_paid_cents: number;
  credits_granted: number;
  status: PurchaseStatus;
  created_at: string;
};

export type Coupon = {
  code: string;
  credits_value: number;
  max_redemptions: number;
  redemptions_count: number;
  expires_at: string | null;
  active: boolean;
};

export type CouponRedemption = {
  id: string;
  coupon_code: string;
  user_id: string;
  redeemed_at: string;
};

/** BYOK row — ciphertext fields never leave the server. */
export type ApiKey = {
  id: string;
  user_id: string;
  provider: LlmProvider;
  encrypted_key: string;
  iv: string;
  auth_tag: string;
  last_four: string;
  created_at: string;
  updated_at: string;
};

/** Safe list/read shape for API responses. */
export type ApiKeyPublic = {
  provider: LlmProvider;
  last_four: string;
  created_at: string;
  updated_at: string;
};
