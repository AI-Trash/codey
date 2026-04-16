import { extractVerificationCodeFromText } from "../../../src/lib/shared/verification-code";

export interface Env {
  CODEY_INGEST_URL: string;
  CODEY_WEBHOOK_SECRET: string;
  CODEY_SIGNATURE_HEADER?: string;
  CODEY_TIMESTAMP_HEADER?: string;
}

async function hmacSha256(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const raw = await new Response(message.raw).text();
    const timestamp = new Date().toISOString();
    const payload = JSON.stringify({
      recipient: message.to,
      subject: message.headers.get("subject") || undefined,
      textBody: raw,
      htmlBody: undefined,
      rawPayload: raw,
      messageId: message.headers.get("message-id") || undefined,
      receivedAt: timestamp,
      extractedCode: extractVerificationCodeFromText(raw),
    });
    const signature = await hmacSha256(
      env.CODEY_WEBHOOK_SECRET,
      `${timestamp}.${payload}`,
    );

    const response = await fetch(env.CODEY_INGEST_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [env.CODEY_SIGNATURE_HEADER || "x-codey-signature"]: signature,
        [env.CODEY_TIMESTAMP_HEADER || "x-codey-timestamp"]: timestamp,
      },
      body: payload,
    });

    if (!response.ok) {
      throw new Error(
        `Codey ingest failed with ${response.status}: ${await response.text()}`,
      );
    }
  },
};
