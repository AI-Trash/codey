import { parse as parseUrl } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { toFetchHandler } from "srvx/node";

import { getOidcProvider } from "../../src/lib/server/oidc/provider";
import {
  completeInteraction,
  loadInteractionPage,
  renderInteractionComplete,
} from "../../src/lib/server/oidc/interactions";

function toWebRequest(req: IncomingMessage): Request {
  const protocol = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers.host || "127.0.0.1";
  const url = `${protocol}://${host}${req.url || "/"}`;
  const headerEntries: [string, string][] = Object.entries(req.headers).flatMap(
    ([key, value]) => {
      if (Array.isArray(value)) {
        return value.map((entry) => [key, entry] as [string, string]);
      }
      return value == null ? [] : [[key, value] as [string, string]];
    },
  );
  return new Request(url, {
    method: req.method,
    headers: new Headers(headerEntries),
  }) as Request;
}

async function sendResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  const body = Buffer.from(await response.arrayBuffer());
  res.end(body);
}

async function invokeMountedOidcCallback(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const originalUrl = req.url || "/";
  const mountedUrl = originalUrl.startsWith("/oidc")
    ? originalUrl.slice("/oidc".length) || "/"
    : originalUrl;

  req.url = mountedUrl;
  try {
    await getOidcProvider().callback()(req, res);
  } finally {
    req.url = originalUrl;
  }
}

async function oidcHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  console.log("oidc node handler hit", req.url);
  try {
    const pathname = parseUrl(req.url || "/").pathname || "/";

    if (pathname === "/oidc/__debug") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: true, url: req.url }));
      return;
    }

    const interactionMatch = pathname.match(/^\/oidc\/interaction\/([^/]+)(?:\/(confirm|abort|done))?$/);

    if (interactionMatch) {
      const [, uid, action] = interactionMatch;
      const request = toWebRequest(req);
      if (!action && req.method === "GET") {
        await sendResponse(res, await loadInteractionPage(request, uid, req, res));
        return;
      }
      if (action === "confirm" && req.method === "POST") {
        await sendResponse(res, await completeInteraction(request, uid, false, req, res));
        return;
      }
      if (action === "abort" && req.method === "POST") {
        await sendResponse(res, await completeInteraction(request, uid, true, req, res));
        return;
      }
      if (action === "done" && req.method === "GET") {
        await sendResponse(res, renderInteractionComplete());
        return;
      }
    }

    await invokeMountedOidcCallback(req, res);
  } catch (error) {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          error: true,
          detail:
            error instanceof Error
              ? `${error.message}${
                  "cause" in error && error.cause instanceof Error
                    ? ` :: ${error.cause.message}`
                    : ""
                }`
              : String(error),
          url: req.url || "/",
        }),
      );
    }
  }
}

const fetchOidcHandler = toFetchHandler(oidcHandler);

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function resolveFetchRequestUrl(req: Request): URL {
  const rawUrl = String((req as { url?: unknown }).url || "/");
  if (/^https?:\/\//i.test(rawUrl)) {
    return new URL(rawUrl);
  }

  const host = req.headers.get("host") || "127.0.0.1";
  const protocol = req.headers.get("x-forwarded-proto") || "http";
  return new URL(rawUrl, `${protocol}://${host}`);
}

export default {
  async fetch(req: Request): Promise<Response> {
    console.log("oidc fetch wrapper hit", String((req as { url?: unknown }).url || ""));
    const url = resolveFetchRequestUrl(req);
    if (url.pathname === "/oidc/__debug") {
      return jsonResponse({
        ok: true,
        pathname: url.pathname,
      });
    }

    try {
      return await fetchOidcHandler(req);
    } catch (error) {
      return jsonResponse(
        {
          error: true,
          detail:
            error instanceof Error
              ? `${error.message}${
                  "cause" in error && error.cause instanceof Error
                    ? ` :: ${error.cause.message}`
                    : ""
                }`
              : String(error),
          pathname: url.pathname,
        },
        500,
      );
    }
  },
};
