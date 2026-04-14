import "@tanstack/react-start/server-only";
import { getAppEnv } from "./env";
import { prisma } from "./prisma";
import { randomToken, randomUserCode, sha256 } from "./security";

export async function createDeviceChallenge(input: {
  scope?: string;
  flowType?: string;
  cliName?: string;
  requestedBy?: string;
}) {
  const env = getAppEnv();
  const expiresAt = new Date(
    Date.now() + env.deviceChallengeTtlMinutes * 60 * 1000,
  );
  const deviceCode = randomToken(24);
  const userCode = randomUserCode();

  const challenge = await prisma.deviceChallenge.create({
    data: {
      deviceCode,
      userCode,
      scope: input.scope,
      flowType: input.flowType,
      cliName: input.cliName,
      requestedBy: input.requestedBy,
      expiresAt,
    },
  });

  return challenge;
}

export async function getDeviceChallengeByCode(deviceCode: string) {
  return prisma.deviceChallenge.findUnique({
    where: { deviceCode },
    include: { user: true },
  });
}

export async function approveDeviceChallenge(params: {
  deviceCode: string;
  userId: string;
  approvalMessage?: string;
}) {
  const token = randomToken();
  const challenge = await prisma.deviceChallenge.update({
    where: { deviceCode: params.deviceCode },
    data: {
      status: "APPROVED",
      userId: params.userId,
      approvalMessage: params.approvalMessage,
      accessTokenHash: sha256(token),
      approvedAt: new Date(),
    },
    include: { user: true },
  });

  return {
    challenge,
    accessToken: token,
  };
}

export async function denyDeviceChallenge(
  deviceCode: string,
  approvalMessage?: string,
) {
  return prisma.deviceChallenge.update({
    where: { deviceCode },
    data: {
      status: "DENIED",
      approvalMessage,
      deniedAt: new Date(),
    },
  });
}

export async function consumeApprovedDeviceChallenge(deviceCode: string) {
  const challenge = await prisma.deviceChallenge.findUnique({
    where: { deviceCode },
    include: { user: true },
  });

  if (!challenge) {
    throw new Error("Device challenge not found");
  }

  if (challenge.expiresAt.getTime() <= Date.now()) {
    await prisma.deviceChallenge.update({
      where: { id: challenge.id },
      data: { status: "EXPIRED" },
    });
    throw new Error("Device challenge expired");
  }

  if (challenge.status !== "APPROVED" || !challenge.userId) {
    throw new Error("Device challenge is not approved yet");
  }

  const token = randomToken();
  await prisma.session.create({
    data: {
      userId: challenge.userId,
      kind: "CLI",
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.deviceChallenge.update({
    where: { id: challenge.id },
    data: {
      status: "CONSUMED",
      consumedAt: new Date(),
      lastPolledAt: new Date(),
    },
  });

  return {
    accessToken: token,
    user: challenge.user,
  };
}

export async function pollDeviceChallenge(deviceCode: string) {
  const challenge = await prisma.deviceChallenge.findUnique({
    where: { deviceCode },
    include: { user: true },
  });

  if (!challenge) {
    return null;
  }

  const status =
    challenge.expiresAt.getTime() <= Date.now() &&
    challenge.status === "PENDING"
      ? "EXPIRED"
      : challenge.status;

  if (status !== challenge.status) {
    await prisma.deviceChallenge.update({
      where: { id: challenge.id },
      data: { status },
    });
  }

  await prisma.deviceChallenge.update({
    where: { id: challenge.id },
    data: { lastPolledAt: new Date() },
  });

  return {
    ...challenge,
    status,
  };
}

export async function listRecentDeviceChallenges() {
  return prisma.deviceChallenge.findMany({
    include: { user: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
}
