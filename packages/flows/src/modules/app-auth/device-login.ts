import { getRuntimeConfig } from "../../config";
import { ensureJson, resolveAppUrl } from "./http";
import { streamSse } from "./sse";
import type {
  AdminNotificationEvent,
  DeviceChallengeResponse,
  DeviceChallengeStatusResponse,
  DeviceChallengeTokenResponse,
} from "./types";
import { readAppSession, saveAppSession } from "./token-store";

export async function startDeviceLogin(
  input: {
    flowType?: string;
    cliName?: string;
    scope?: string;
  } = {},
): Promise<DeviceChallengeResponse> {
  const config = getRuntimeConfig();
  const response = await fetch(
    resolveAppUrl(config.app?.deviceStartPath || "/api/device"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(input),
    },
  );

  return ensureJson<DeviceChallengeResponse>(response);
}

export async function getDeviceChallengeStatus(
  deviceCode: string,
): Promise<DeviceChallengeStatusResponse> {
  const config = getRuntimeConfig();
  const pathTemplate =
    config.app?.deviceStatusPath || "/api/device/{deviceCode}";
  const response = await fetch(
    resolveAppUrl(
      pathTemplate.replace("{deviceCode}", encodeURIComponent(deviceCode)),
    ),
    {
      headers: {
        Accept: "application/json",
      },
    },
  );
  return ensureJson<DeviceChallengeStatusResponse>(response);
}

export async function exchangeDeviceChallenge(
  deviceCode: string,
  target?: string,
): Promise<DeviceChallengeTokenResponse> {
  const config = getRuntimeConfig();
  const pathTemplate =
    config.app?.deviceStatusPath || "/api/device/{deviceCode}";
  const response = await fetch(
    resolveAppUrl(
      pathTemplate.replace("{deviceCode}", encodeURIComponent(deviceCode)),
    ),
    {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    },
  );
  const result = await ensureJson<DeviceChallengeTokenResponse>(response);
  saveAppSession({
    accessToken: result.accessToken,
    target,
    user: result.user,
    createdAt: new Date().toISOString(),
  });
  return result;
}

export async function waitForDeviceApproval(
  deviceCode: string,
): Promise<DeviceChallengeStatusResponse> {
  const config = getRuntimeConfig();
  const pathTemplate =
    config.app?.deviceEventsPath || "/api/device/{deviceCode}/events";
  const response = await fetch(
    resolveAppUrl(
      pathTemplate.replace("{deviceCode}", encodeURIComponent(deviceCode)),
    ),
    {
      headers: {
        Accept: "text/event-stream",
      },
    },
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  for await (const event of streamSse(response)) {
    if (event.event !== "device_status" || !event.data) continue;
    return JSON.parse(event.data) as DeviceChallengeStatusResponse;
  }

  return getDeviceChallengeStatus(deviceCode);
}

export async function* streamCliNotifications(
  input: {
    target?: string;
  } = {},
): AsyncGenerator<AdminNotificationEvent, void, void> {
  const config = getRuntimeConfig();
  const session = readAppSession();
  const target =
    input.target ||
    session.target ||
    session.user?.githubLogin ||
    session.user?.email ||
    undefined;
  const eventsUrl = new URL(
    resolveAppUrl(config.app?.cliEventsPath || "/api/cli/events"),
  );
  if (target) {
    eventsUrl.searchParams.set("target", target);
  }

  const response = await fetch(eventsUrl, {
    headers: {
      Accept: "text/event-stream",
      Authorization: `Bearer ${session.accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  for await (const event of streamSse(response)) {
    if (event.event !== "admin_notification" || !event.data) continue;
    yield JSON.parse(event.data) as AdminNotificationEvent;
  }
}
