import "@tanstack/react-start/server-only";

import type { IncomingMessage, ServerResponse } from "node:http";
import type { InteractionResults, KoaContextWithOIDC } from "oidc-provider";

import { requireAdmin } from "../auth";
import { redirect as httpRedirect } from "../http";
import { getOidcProvider } from "./provider";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderPage(params: {
  title: string;
  kicker: string;
  body: string;
}): string {
  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${escapeHtml(params.title)}</title>
      <style>
        :root {
          --sea-ink: #0f172a;
          --sea-ink-soft: #475569;
          --lagoon-deep: #0f766e;
          --surface: #ffffff;
          --surface-muted: #f8fafc;
          --line: #dbe3ee;
          --danger: #8b4040;
          --danger-bg: rgba(155, 73, 73, 0.1);
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1.5rem;
          background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          color: var(--sea-ink);
        }
        main {
          width: min(44rem, 100%);
          border: 1px solid var(--line);
          background: var(--surface);
          border-radius: 1.5rem;
          padding: 1.5rem;
          box-shadow: 0 20px 50px rgba(15, 23, 42, 0.08);
        }
        .kicker {
          margin: 0 0 0.5rem;
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--lagoon-deep);
        }
        h1 {
          margin: 0;
          font-size: clamp(2rem, 4vw, 2.6rem);
          line-height: 1.05;
        }
        p {
          margin: 0;
          color: var(--sea-ink-soft);
          line-height: 1.8;
        }
        .stack {
          margin-top: 1.25rem;
          display: grid;
          gap: 1rem;
        }
        .actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.75rem;
        }
        .actions > * { flex: 1 1 12rem; }
        button {
          width: 100%;
          border-radius: 1rem;
          border: 1px solid var(--line);
          padding: 0.9rem 1rem;
          font: inherit;
          font-weight: 700;
          cursor: pointer;
          background: color-mix(in oklab, var(--lagoon-deep) 10%, white);
          color: var(--lagoon-deep);
        }
        .danger {
          background: var(--danger-bg);
          color: var(--danger);
        }
        .secondary {
          background: var(--surface-muted);
          color: var(--sea-ink);
        }
        a.button-link {
          display: inline-flex;
          text-decoration: none;
        }
        code {
          border: 1px solid var(--line);
          background: var(--surface-muted);
          border-radius: 0.6rem;
          padding: 0.2rem 0.5rem;
          color: var(--sea-ink);
        }
      </style>
    </head>
    <body>
      <main>
        <p class="kicker">${escapeHtml(params.kicker)}</p>
        <h1>${escapeHtml(params.title)}</h1>
        <div class="stack">${params.body}</div>
      </main>
    </body>
  </html>`;
}

export async function renderDeviceUserCodeInput(params: {
  ctx: KoaContextWithOIDC;
  form: string;
  errorMessage?: string;
}): Promise<string> {
  return renderPage({
    kicker: "Device authorization",
    title: "Approve a CLI session",
    body: `
      <p>Enter the user code shown in the CLI to continue the standard device authorization flow.</p>
      ${
        params.errorMessage
          ? `<div class="error">${escapeHtml(params.errorMessage)}</div>`
          : ""
      }
      ${params.form}
    `,
  });
}

export async function renderDeviceUserCodeConfirm(params: {
  ctx: KoaContextWithOIDC;
  form: string;
  clientName: string;
  userCode: string;
}): Promise<string> {
  return renderPage({
    kicker: "Device authorization",
    title: "Confirm device access",
    body: `
      <p><strong>${escapeHtml(params.clientName)}</strong> is requesting device authorization.</p>
      <p>User code: <code>${escapeHtml(params.userCode)}</code></p>
      ${params.form.replace("[ Abort ]", "Deny device")}
    `,
  });
}

export async function renderDeviceFlowSuccess(clientName: string): Promise<string> {
  return renderPage({
    kicker: "Device authorization",
    title: "Authorization complete",
    body: `<p>Device authorization completed for ${escapeHtml(clientName)}. You may close this window.</p>`,
  });
}

function getNodeContext(request: Request): {
  req: IncomingMessage;
  res: ServerResponse;
} {
  const node = (request as Request & {
    node?: { req?: IncomingMessage; res?: ServerResponse };
  }).node;

  if (!node?.req || !node.res) {
    throw new Error("Node request context is required for OIDC interactions.");
  }

  return { req: node.req, res: node.res };
}

function getProvidedNodeContext(
  req?: IncomingMessage,
  res?: ServerResponse,
): { req: IncomingMessage; res: ServerResponse } | null {
  if (req && res) {
    return { req, res };
  }
  return null;
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function loadInteractionPage(
  request: Request,
  uid: string,
  req?: IncomingMessage,
  res?: ServerResponse,
): Promise<Response> {
  const provider = getOidcProvider();
  const nodeContext = getProvidedNodeContext(req, res) || getNodeContext(request);
  const details = await provider.interactionDetails(nodeContext.req, nodeContext.res);
  const client = await provider.Client.find(String(details.params.client_id || ""));
  const clientName = client?.clientName || client?.clientId || String(details.params.client_id || "OAuth client");

  try {
    await requireAdmin(request);
  } catch {
    return html(
      renderPage({
        kicker: "Device authorization",
        title: "Admin sign-in required",
        body: `
          <p>Sign in with GitHub as an admin before completing this OAuth device authorization request.</p>
          <div class="actions">
            <a class="button-link" href="/auth/github?redirectTo=${escapeHtml(`/oidc/interaction/${uid}`)}"><button type="button">Continue with GitHub</button></a>
            <a class="button-link" href="/admin/login"><button type="button" class="secondary">Open admin login</button></a>
          </div>
        `,
      }),
      401,
    );
  }

  return html(
    renderPage({
      kicker: "Device authorization",
      title: "Confirm device access",
      body: `
        <p><strong>${escapeHtml(clientName)}</strong> is requesting device authorization.</p>
        <p>Prompt: <code>${escapeHtml(details.prompt.name)}</code></p>
        <div class="actions">
          <form method="post" action="/oidc/interaction/${encodeURIComponent(uid)}/confirm"><button type="submit">Authorize device</button></form>
          <form method="post" action="/oidc/interaction/${encodeURIComponent(uid)}/abort"><button type="submit" class="danger">Deny device</button></form>
        </div>
      `,
    }),
  );
}

export async function completeInteraction(
  request: Request,
  uid: string,
  aborted: boolean,
  req?: IncomingMessage,
  res?: ServerResponse,
): Promise<Response> {
  const admin = await requireAdmin(request);
  const provider = getOidcProvider();
  const nodeContext = getProvidedNodeContext(req, res) || getNodeContext(request);

  const result: InteractionResults = aborted
    ? {
        error: "access_denied",
        error_description: "End-User denied device authorization",
      }
    : {
        login: {
          accountId: admin.user.id,
          remember: true,
          ts: Math.floor(Date.now() / 1000),
          amr: ["github"],
          acr: "urn:codey:admin:github",
        },
      };

  await provider.interactionFinished(nodeContext.req, nodeContext.res, result, {
    mergeWithLastSubmission: false,
  });

  return httpRedirect(`/oidc/interaction/${encodeURIComponent(uid)}/done`);
}

export function renderInteractionComplete(): Response {
  return html(
    renderPage({
      kicker: "Device authorization",
      title: "Authorization complete",
      body: "<p>The device authorization decision has been recorded. You may close this window.</p>",
    }),
  );
}
