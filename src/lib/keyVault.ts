import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { loadEnv } from "../config/env.ts";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

export type EncryptedPayload = {
  encryptedKey: string;
  iv: string;
  authTag: string;
};

function masterKeyBytes(): Buffer {
  const env = loadEnv();
  const raw = env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("ENCRYPTION_KEY is not configured");
  }

  // 64 hex chars → 32 raw bytes
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  // standard base64 of 32 bytes
  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) {
      return decoded;
    }
  } catch {
    // fall through to hash derivation
  }

  // Passphrase / arbitrary string → SHA-256
  return createHash("sha256").update(raw, "utf8").digest();
}

/** Encrypt a plaintext provider API key. Never log plaintext or ciphertext. */
export function encryptApiKey(plaintext: string): EncryptedPayload {
  const key = masterKeyBytes();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedKey: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

/** Decrypt a stored provider API key. Caller must let plaintext fall out of scope ASAP. */
export function decryptApiKey(payload: EncryptedPayload): string {
  const key = masterKeyBytes();
  const decipher = createDecipheriv(ALGO, key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.encryptedKey, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function lastFourOfKey(plaintext: string): string {
  const trimmed = plaintext.trim();
  if (trimmed.length <= 4) {
    return trimmed;
  }
  return trimmed.slice(-4);
}
