import "@tanstack/react-start/server-only";
import { getAppEnv } from "./env";
import { prisma } from "./prisma";
import { randomCode } from "./security";

export function extractVerificationCode(body: string): string | null {
  const normalized = body.replace(/&nbsp;/gi, " ").replace(/\s+/g, " ");
  const contextualMatch = normalized.match(
    /(?:code|验证码|verification code|one-time code|security code)\D{0,20}(\d{6})/i,
  );
  if (contextualMatch?.[1]) return contextualMatch[1];
  const fallback = normalized.match(/\b(\d{6})\b/);
  if (fallback?.[1]) return fallback[1];
  return null;
}

function buildReservationEmail(id: string): {
  email: string;
  prefix?: string;
  mailbox?: string;
} {
  const env = getAppEnv();
  if (env.verificationMailbox) {
    const [localPart, domain] = env.verificationMailbox.split("@");
    if (!localPart || !domain) {
      throw new Error(
        `Invalid VERIFICATION_MAILBOX value: ${env.verificationMailbox}`,
      );
    }

    return {
      email: `${localPart}+${id}@${domain}`,
      mailbox: env.verificationMailbox,
    };
  }

  const domain = env.verificationDomain || "example.invalid";
  return {
    email: `${process.env.VERIFICATION_EMAIL_PREFIX || "codey"}+${id}@${domain}`,
  };
}

export async function reserveVerificationEmailTarget() {
  const env = getAppEnv();
  const expiresAt = new Date(
    Date.now() + env.verificationReservationTtlMinutes * 60 * 1000,
  );
  const tempId = randomCode(12);
  const target = buildReservationEmail(tempId);

  const reservation = await prisma.verificationEmailReservation.create({
    data: {
      email: target.email,
      prefix: target.prefix,
      mailbox: target.mailbox,
      expiresAt,
    },
  });

  return {
    reservationId: reservation.id,
    email: reservation.email,
    prefix: reservation.prefix || undefined,
    mailbox: reservation.mailbox || undefined,
    expiresAt: reservation.expiresAt.toISOString(),
  };
}

export async function findVerificationCode(params: {
  email: string;
  startedAt: string;
}) {
  const reservation = await prisma.verificationEmailReservation.findUnique({
    where: { email: params.email },
  });

  if (!reservation) {
    return { status: "pending" as const };
  }

  const startedAt = new Date(params.startedAt);
  const since = Number.isNaN(startedAt.getTime()) ? new Date(0) : startedAt;
  const code = await prisma.verificationCode.findFirst({
    where: {
      reservationId: reservation.id,
      receivedAt: {
        gte: since,
      },
    },
    orderBy: {
      receivedAt: "desc",
    },
  });

  if (!code) {
    return {
      reservationId: reservation.id,
      status: "pending" as const,
    };
  }

  return {
    reservationId: reservation.id,
    status: "resolved" as const,
    code: code.code,
    receivedAt: code.receivedAt.toISOString(),
  };
}

export async function createManualVerificationCode(params: {
  email: string;
  code: string;
}) {
  const reservation = await prisma.verificationEmailReservation.upsert({
    where: { email: params.email },
    update: {},
    create: {
      email: params.email,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  const record = await prisma.verificationCode.create({
    data: {
      reservationId: reservation.id,
      code: params.code,
      source: "MANUAL",
    },
  });

  return record;
}

export async function ingestCloudflareEmail(params: {
  recipient: string;
  subject?: string;
  textBody?: string;
  htmlBody?: string;
  rawPayload?: string;
  messageId?: string;
  receivedAt?: string;
}) {
  const reservation = await prisma.verificationEmailReservation.findUnique({
    where: {
      email: params.recipient,
    },
  });

  const receivedAt = params.receivedAt
    ? new Date(params.receivedAt)
    : new Date();
  const body = `${params.textBody || ""}\n${params.htmlBody || ""}\n${params.subject || ""}`;
  const verificationCode = extractVerificationCode(body);

  const emailRecord = await prisma.emailIngestRecord.create({
    data: {
      reservationId: reservation?.id,
      messageId: params.messageId,
      recipient: params.recipient,
      subject: params.subject,
      textBody: params.textBody,
      htmlBody: params.htmlBody,
      rawPayload: params.rawPayload,
      verificationCode: verificationCode || undefined,
      receivedAt,
    },
  });

  let codeRecord = null;

  if (reservation && verificationCode) {
    codeRecord = await prisma.verificationCode.create({
      data: {
        reservationId: reservation.id,
        code: verificationCode,
        source: "CLOUDFLARE_EMAIL",
        messageId: params.messageId,
        receivedAt,
      },
    });
  }

  return {
    emailRecord,
    codeRecord,
  };
}

export async function listRecentVerificationActivity() {
  const [reservations, codes, emails] = await Promise.all([
    prisma.verificationEmailReservation.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.verificationCode.findMany({
      include: { reservation: true },
      orderBy: { receivedAt: "desc" },
      take: 20,
    }),
    prisma.emailIngestRecord.findMany({
      orderBy: { receivedAt: "desc" },
      take: 20,
    }),
  ]);

  return { reservations, codes, emails };
}
