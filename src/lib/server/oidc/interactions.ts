import "@tanstack/react-start/server-only";

import type { IncomingMessage, ServerResponse } from "node:http";
import type { InteractionResults, KoaContextWithOIDC } from "oidc-provider";

import { m } from "#/paraglide/messages";
import { getLocalizedHtmlLang } from "#/lib/i18n";
import { requireAdminPermission } from "../auth";
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
  <html lang="${escapeHtml(getLocalizedHtmlLang())}">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${escapeHtml(params.title)}</title>
      <style>
        :root {
          --background: #fafafa;
          --foreground: #09090b;
          --card: #ffffff;
          --muted: #f4f4f5;
          --muted-foreground: #71717a;
          --border: #e4e4e7;
          --primary: #18181b;
          --primary-foreground: #fafafa;
          --destructive: #dc2626;
          --destructive-foreground: #ffffff;
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1.5rem;
          background: var(--background);
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          color: var(--foreground);
        }
        main {
          width: min(44rem, 100%);
          border: 1px solid var(--border);
          background: var(--card);
          border-radius: 0.75rem;
          padding: 1.5rem;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
        }
        .kicker {
          margin: 0 0 0.5rem;
          font-size: 0.75rem;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
        h1 {
          margin: 0;
          font-size: clamp(2rem, 4vw, 2.5rem);
          line-height: 1.1;
        }
        p {
          margin: 0;
          color: var(--muted-foreground);
          line-height: 1.7;
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
          border-radius: 0.5rem;
          border: 1px solid var(--primary);
          padding: 0.75rem 1rem;
          font: inherit;
          font-weight: 500;
          cursor: pointer;
          background: var(--primary);
          color: var(--primary-foreground);
        }
        .danger {
          border-color: var(--destructive);
          background: var(--destructive);
          color: var(--destructive-foreground);
        }
        .secondary {
          border-color: var(--border);
          background: var(--card);
          color: var(--foreground);
        }
        a.button-link {
          display: inline-flex;
          text-decoration: none;
        }
        code {
          border: 1px solid var(--border);
          background: var(--muted);
          border-radius: 0.375rem;
          padding: 0.2rem 0.5rem;
          color: var(--foreground);
        }
        .error {
          border: 1px solid #fecaca;
          background: #fef2f2;
          color: #991b1b;
          border-radius: 0.5rem;
          padding: 0.75rem 1rem;
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
    kicker: m.oidc_interaction_kicker(),
    title: m.oidc_interaction_input_title(),
    body: `
      <p>${escapeHtml(m.oidc_interaction_input_description())}</p>
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
    kicker: m.oidc_interaction_kicker(),
    title: m.oidc_interaction_confirm_title(),
    body: `
      <p>${escapeHtml(
        m.oidc_interaction_requesting({
          client: params.clientName,
        }),
      )}</p>
      <p>${escapeHtml(m.oidc_interaction_user_code_label())}: <code>${escapeHtml(params.userCode)}</code></p>
      ${params.form.replace("[ Abort ]", m.oidc_interaction_deny())}
    `,
  });
}

export async function renderDeviceFlowSuccess(clientName: string): Promise<string> {
  return renderPage({
    kicker: m.oidc_interaction_kicker(),
    title: m.oidc_interaction_success_title(),
    body: `<p>${escapeHtml(
      m.oidc_interaction_success_body({
        client: clientName,
      }),
    )}</p>`,
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
  const provider = await getOidcProvider();
  const nodeContext = getProvidedNodeContext(req, res) || getNodeContext(request);
  const details = await provider.interactionDetails(nodeContext.req, nodeContext.res);
  const client = await provider.Client.find(String(details.params.client_id || ""));
  const clientName =
    client?.clientName ||
    client?.clientId ||
    String(details.params.client_id || m.oidc_device_client_fallback());

  try {
    await requireAdminPermission(request, "OPERATIONS");
  } catch {
    return html(
      renderPage({
        kicker: m.oidc_interaction_kicker(),
        title: m.oidc_interaction_admin_required_title(),
        body: `
          <p>${escapeHtml(m.oidc_interaction_admin_required_description())}</p>
          <div class="actions">
            <a class="button-link" href="/auth/github?redirectTo=${escapeHtml(`/oidc/interaction/${uid}`)}"><button type="button">${escapeHtml(m.oidc_interaction_continue_github())}</button></a>
            <a class="button-link" href="/admin/login"><button type="button" class="secondary">${escapeHtml(m.oidc_interaction_open_admin())}</button></a>
          </div>
        `,
      }),
      401,
    );
  }

  return html(
    renderPage({
      kicker: m.oidc_interaction_kicker(),
      title: m.oidc_interaction_confirm_title(),
      body: `
        <p>${escapeHtml(
          m.oidc_interaction_requesting({
            client: clientName,
          }),
        )}</p>
        <p>${escapeHtml(m.oidc_interaction_prompt_label())}: <code>${escapeHtml(details.prompt.name)}</code></p>
        <div class="actions">
          <form method="post" action="/oidc/interaction/${encodeURIComponent(uid)}/confirm"><button type="submit">${escapeHtml(m.oidc_interaction_authorize())}</button></form>
          <form method="post" action="/oidc/interaction/${encodeURIComponent(uid)}/abort"><button type="submit" class="danger">${escapeHtml(m.oidc_interaction_deny())}</button></form>
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
  const admin = await requireAdminPermission(request, "OPERATIONS");
  const provider = await getOidcProvider();
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
      kicker: m.oidc_interaction_kicker(),
      title: m.oidc_interaction_success_title(),
      body: `<p>${escapeHtml(m.oidc_interaction_complete_body())}</p>`,
    }),
  );
}
