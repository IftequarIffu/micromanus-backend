/**
 * Encrypt/decrypt helpers for `api_keys.encrypted_key`.
 * TODO: implement with ENCRYPTION_KEY (libsodium/crypto) in a later prompt.
 */

export function encryptApiKey(_plaintext: string): string {
  throw new Error("encryptApiKey is not implemented yet");
}

export function decryptApiKey(_ciphertext: string): string {
  throw new Error("decryptApiKey is not implemented yet");
}
