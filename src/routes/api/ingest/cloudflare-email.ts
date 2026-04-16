import { createFileRoute } from "@tanstack/react-router";
import { getAppEnv } from "../../../lib/server/env";
import { json, text } from "../../../lib/server/http";
import { hmacSha256, timingSafeEqual } from "../../../lib/server/security";
import { ingestCloudflareEmail } from "../../../lib/server/verification";

interface CloudflareEmailPayload {
  recipient?: string;
  subject?: string;
  textBody?: string;
  htmlBody?: string;
  rawPayload?: string;
  extractedCode?: string;
  messageId?: string;
  receivedAt?: string;
}

export const Route = createFileRoute("/api/ingest/cloudflare-email")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const env = getAppEnv();
        const rawBody = await request.text();
        if (env.cloudflareWebhookSecret) {
          const signature = request.headers.get(env.cloudflareSignatureHeader);
          const timestamp = request.headers.get(env.cloudflareTimestampHeader);
          if (!signature) {
            return text("Missing Cloudflare signature headers", 401);
          }

          const expected = hmacSha256(
            env.cloudflareWebhookSecret,
            timestamp ? `${timestamp}.${rawBody}` : rawBody,
          );
          if (!timingSafeEqual(signature, expected)) {
            return text("Invalid Cloudflare signature", 401);
          }
        }

        const payload = JSON.parse(rawBody) as CloudflareEmailPayload;
        if (!payload.recipient) {
          return text("recipient is required", 400);
        }

        const result = await ingestCloudflareEmail({
          recipient: payload.recipient,
          subject: payload.subject,
          textBody: payload.textBody,
          htmlBody: payload.htmlBody,
          rawPayload: payload.rawPayload,
          extractedCode: payload.extractedCode,
          messageId: payload.messageId,
          receivedAt: payload.receivedAt,
        });

        return json({
          ok: true,
          emailRecordId: result.emailRecord.id,
          codeRecordId: result.codeRecord?.id,
        });
      },
    },
  },
});
