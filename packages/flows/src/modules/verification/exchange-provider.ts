import crypto from "crypto";
import type { ExchangeConfig } from "../../config";
import { sleep } from "../../utils/wait";
import { extractVerificationCode } from "../chatgpt/common";
import { ExchangeClient } from "../exchange";
import type {
  VerificationEmailTarget,
  VerificationProvider,
  WaitForVerificationCodeOptions,
} from "./types";

function randomString(length = 8): string {
  return crypto
    .randomBytes(Math.ceil(length / 2))
    .toString("hex")
    .slice(0, length);
}

export function buildExchangeVerificationTarget(
  config: ExchangeConfig,
): VerificationEmailTarget {
  const mailbox = config.mailbox;
  if (!mailbox) {
    throw new Error(
      "Exchange mailbox is required for ChatGPT registration flow.",
    );
  }

  const [localPart, domain] = mailbox.split("@");
  if (!localPart || !domain)
    throw new Error(`Invalid EXCHANGE_MAILBOX value: ${mailbox}`);

  const prefix = config.mailFlow?.catchAll?.prefix?.trim();
  const unique = `${Date.now()}-${randomString(6)}`;
  return prefix
    ? { email: `${prefix}-${unique}@${domain}`, prefix, mailbox }
    : { email: `${localPart}+${unique}@${domain}`, mailbox };
}

export class ExchangeVerificationProvider implements VerificationProvider {
  readonly kind = "exchange" as const;

  constructor(
    private readonly config: ExchangeConfig,
    private readonly client = new ExchangeClient(config),
  ) {}

  async prepareEmailTarget(): Promise<VerificationEmailTarget> {
    return buildExchangeVerificationTarget(this.config);
  }

  async primeInbox(): Promise<void> {
    await this.client.primeMessageDelta();
  }

  async waitForVerificationCode(
    options: WaitForVerificationCodeOptions,
  ): Promise<string> {
    const deadline = Date.now() + options.timeoutMs;
    let attempt = 0;

    while (Date.now() < deadline) {
      attempt += 1;
      options.onPollAttempt?.(attempt);

      const messages = await this.client.findMessages({
        maxItems: 50,
        unreadOnly: false,
        receivedAfter: options.startedAt,
        subjectIncludes: "chatgpt",
      });
      const targetedMessages = messages.filter((message) => {
        const subject = (message.subject || "").toLowerCase();
        const toValues = (message.to || []).map((entry) => entry.toLowerCase());
        return (
          subject.includes("chatgpt") ||
          subject.includes("code") ||
          toValues.some((entry) => entry.includes(options.email.toLowerCase()))
        );
      });

      for (const message of targetedMessages.length
        ? targetedMessages
        : messages) {
        const detail = await this.client.getMessage(message.id);
        const body = `${detail.body || ""}\n${detail.bodyPreview || ""}\n${detail.subject || ""}`;
        const code = extractVerificationCode(body);
        if (code) return code;
      }

      await sleep(options.pollIntervalMs);
    }

    throw new Error(
      `Timed out waiting for a verification code sent to ${options.email}.`,
    );
  }
}
