import "@tanstack/react-start/server-only";

import crypto from "node:crypto";
import { getAppEnv } from "./env";

function getEncryptionKey(context: string): Buffer {
  const env = getAppEnv();
  if (!env.oauthClientSecretEncryptionKey) {
    throw new Error(
      `OAUTH_CLIENT_SECRET_ENCRYPTION_KEY is required to ${context}`,
    );
  }

  return Buffer.from(env.oauthClientSecretEncryptionKey, "base64");
}

export function encryptSecret(secret: string, context: string): string {
  const key = getEncryptionKey(context);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptSecret(ciphertext: string, context: string): string {
  const [ivPart, tagPart, dataPart] = ciphertext.split(".");
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error(`Stored secret is malformed and cannot ${context}`);
  }

  const key = getEncryptionKey(context);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
