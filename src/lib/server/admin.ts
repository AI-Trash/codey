import "@tanstack/react-start/server-only";
import { prisma } from "./prisma";
import { listRecentDeviceChallenges } from "./device-auth";
import { listRecentVerificationActivity } from "./verification";

export async function listAdminDashboardData() {
  const [notifications, deviceChallenges, verification] = await Promise.all([
    prisma.adminNotification.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    listRecentDeviceChallenges(),
    listRecentVerificationActivity(),
  ]);

  return {
    notifications,
    deviceChallenges,
    verification,
  };
}

export async function createAdminNotification(params: {
  title: string;
  body: string;
  flowType?: string;
  target?: string;
}) {
  return prisma.adminNotification.create({
    data: params,
  });
}

export async function listCliNotifications(params: {
  target?: string;
  after?: Date;
}) {
  const filters = [] as Array<{
    target?: string | null;
    createdAt?: { gt: Date };
  }>;

  filters.push({ target: null });
  filters.push({ target: "all" });
  if (params.target) {
    filters.push({ target: params.target });
  }

  return prisma.adminNotification.findMany({
    where: {
      OR: filters.map((filter) => ({
        target: filter.target,
        ...(params.after ? { createdAt: { gt: params.after } } : {}),
      })),
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
}
