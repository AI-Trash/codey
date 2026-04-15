import { useEffect, useMemo, useState, type ReactNode, type Dispatch, type SetStateAction, type FormEvent } from "react";

export type ManagedOAuthClient = {
  id: string;
  clientId: string;
  clientName: string;
  description: string | null;
  enabled: boolean;
  clientCredentialsEnabled: boolean;
  deviceFlowEnabled: boolean;
  tokenEndpointAuthMethod: "client_secret_basic" | "client_secret_post";
  allowedScopes: string[];
  clientSecretPreview: string;
  clientSecretUpdatedAt: string | Date;
  createdAt: string | Date;
  updatedAt: string | Date;
};

type OAuthClientFormValues = {
  clientName: string;
  description: string;
  enabled: boolean;
  tokenEndpointAuthMethod: "client_secret_basic" | "client_secret_post";
  allowedScopes: string;
  clientCredentialsEnabled: boolean;
  deviceFlowEnabled: boolean;
};

type OAuthClientPayload = {
  clientName: string;
  description?: string;
  enabled: boolean;
  tokenEndpointAuthMethod: "client_secret_basic" | "client_secret_post";
  allowedScopes: string[];
  clientCredentialsEnabled: boolean;
  deviceFlowEnabled: boolean;
};

export function AdminAuthRequired() {
  return (
    <main className="page-wrap px-4 py-12">
      <section className="island-shell rounded-2xl p-6 sm:p-8">
        <p className="island-kicker mb-2">Admin</p>
        <h1 className="display-title mb-3 text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
          Admin sign-in required.
        </h1>
        <p className="mb-5 max-w-2xl text-base leading-8 text-[var(--sea-ink-soft)]">
          Sign in with GitHub to manage OAuth clients.
        </p>
        <a href="/admin/login" className="admin-button admin-button-primary">
          Go to admin login
        </a>
      </section>
    </main>
  );
}

export function AdminAppsHero({
  kicker,
  title,
  description,
  actions,
}: {
  kicker: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <section className="admin-panel admin-panel-muted rise-in flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-3xl">
        <p className="island-kicker mb-2">{kicker}</p>
        <h1 className="display-title text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
          {title}
        </h1>
        <p className="mt-3 text-sm leading-7 text-[var(--sea-ink-soft)]">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </section>
  );
}

export function AdminAppsNav({ current }: { current: "list" | "new" | "detail" }) {
  return (
    <nav className="admin-anchor-nav mt-6">
      <a href="/admin" className="admin-button admin-button-secondary">
        Operations
      </a>
      <a
        href="/admin/apps"
        className={`admin-button ${current === "list" ? "admin-button-primary" : "admin-button-secondary"}`}
      >
        OAuth apps
      </a>
      <a
        href="/admin/apps/new"
        className={`admin-button ${current === "new" ? "admin-button-primary" : "admin-button-secondary"}`}
      >
        Register app
      </a>
    </nav>
  );
}

export function OAuthClientsList({ clients }: { clients: ManagedOAuthClient[] }) {
  if (!clients.length) {
    return (
      <div className="admin-empty">
        No OAuth clients registered yet. Create the first app to issue client credentials or enable device flow.
      </div>
    );
  }

  return (
    <ul className="admin-list">
      {clients.map((client) => {
        const tone = client.enabled ? "good" : "warning";

        return (
          <li key={client.id} className="admin-list-item">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="admin-eyebrow">{client.clientId}</div>
                <h2 className="mt-1 text-xl font-semibold text-[var(--sea-ink)]">
                  {client.clientName}
                </h2>
              </div>
              <span className="admin-status-pill" data-tone={tone}>
                {client.enabled ? "enabled" : "disabled"}
              </span>
            </div>

            <p className="mt-3 mb-0 text-sm leading-7 text-[var(--sea-ink-soft)]">
              {client.description || "No description added yet."}
            </p>

            <dl className="mt-4 grid gap-2 text-sm text-[var(--sea-ink-soft)] sm:grid-cols-2 xl:grid-cols-4">
              <InfoRow label="Auth method" value={formatAuthMethod(client.tokenEndpointAuthMethod)} />
              <InfoRow label="Allowed scopes" value={client.allowedScopes.join(", ") || "None"} />
              <InfoRow
                label="Grants"
                value={[
                  client.clientCredentialsEnabled ? "client_credentials" : null,
                  client.deviceFlowEnabled ? "device flow" : null,
                ]
                  .filter(Boolean)
                  .join(" • ")}
              />
              <InfoRow
                label="Secret preview"
                value={`${client.clientSecretPreview}… • updated ${formatDate(client.clientSecretUpdatedAt) || "recently"}`}
              />
            </dl>

            <div className="mt-4 flex flex-wrap gap-2">
              <a href={`/admin/apps/${client.id}`} className="admin-button admin-button-primary">
                Edit app
              </a>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function NewOAuthClientPageContent({
  supportedScopes,
}: {
  supportedScopes: string[];
}) {
  const [form, setForm] = useState<OAuthClientFormValues>(() =>
    createFormValues({
      clientName: "",
      description: "",
      enabled: true,
      tokenEndpointAuthMethod: "client_secret_basic",
      allowedScopes: supportedScopes.join("\n"),
      clientCredentialsEnabled: true,
      deviceFlowEnabled: false,
    }),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    client: ManagedOAuthClient;
    clientSecret: string;
  } | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const payload = toPayload(form);
      const response = await fetch("/api/admin/oauth-clients", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data = (await response.json()) as {
        client: ManagedOAuthClient;
        clientSecret: string;
      };
      setCreated(data);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to create OAuth client",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="admin-grid mt-8 xl:grid-cols-[1.15fr_0.85fr]">
      <article className="admin-panel admin-panel-strong">
        <div className="mb-5">
          <p className="island-kicker mb-2">Registration</p>
          <h2 className="display-title text-3xl font-bold text-[var(--sea-ink)]">
            Create a managed OAuth app
          </h2>
        </div>
        <OAuthClientForm
          form={form}
          submitting={submitting}
          submitLabel="Create OAuth app"
          supportedScopes={supportedScopes}
          error={error}
          onChange={setForm}
          onSubmit={handleSubmit}
        />
      </article>

      <div className="admin-grid">
        <article className="admin-panel admin-panel-muted">
          <p className="island-kicker mb-2">Practical defaults</p>
          <ul className="admin-list">
            <li className="admin-list-item">
              <strong className="block text-[var(--sea-ink)]">Client credentials</strong>
              <p className="mt-2 mb-0 text-sm leading-7 text-[var(--sea-ink-soft)]">
                Turn this on for service-to-service access where the app can hold a secret.
              </p>
            </li>
            <li className="admin-list-item">
              <strong className="block text-[var(--sea-ink)]">Device flow</strong>
              <p className="mt-2 mb-0 text-sm leading-7 text-[var(--sea-ink-soft)]">
                Turn this on for GitHub-like device approvals where the operator completes a browser step.
              </p>
            </li>
            <li className="admin-list-item">
              <strong className="block text-[var(--sea-ink)]">Secret handling</strong>
              <p className="mt-2 mb-0 text-sm leading-7 text-[var(--sea-ink-soft)]">
                The full secret is shown once after registration. Save it immediately, then use the edit page if you need to rotate or reveal the current value.
              </p>
            </li>
          </ul>
        </article>

        {created ? (
          <SecretPanel
            title="OAuth app created"
            body="This secret is only shown here after registration. Copy it into the calling app before leaving the page."
            clientId={created.client.clientId}
            secret={created.clientSecret}
            preview={created.client.clientSecretPreview}
            footer={
              <div className="flex flex-wrap gap-2">
                <a href={`/admin/apps/${created.client.id}`} className="admin-button admin-button-primary">
                  Open app settings
                </a>
                <a href="/admin/apps" className="admin-button admin-button-secondary">
                  Back to apps
                </a>
              </div>
            }
          />
        ) : null}
      </div>
    </div>
  );
}

export function EditOAuthClientPageContent({
  initialClient,
  supportedScopes,
}: {
  initialClient: ManagedOAuthClient;
  supportedScopes: string[];
}) {
  const [client, setClient] = useState(initialClient);
  const [form, setForm] = useState<OAuthClientFormValues>(() => createFormValues(initialClient));
  const [saving, setSaving] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [visibleSecret, setVisibleSecret] = useState<string | null>(null);

  useEffect(() => {
    setClient(initialClient);
    setForm(createFormValues(initialClient));
  }, [initialClient]);

  async function saveClient(rotateSecret: boolean) {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/admin/oauth-clients/${client.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...toPayload(form),
          rotateSecret,
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data = (await response.json()) as {
        client: ManagedOAuthClient;
        rotatedSecret?: string;
      };
      setClient(data.client);
      setForm(createFormValues(data.client));
      setVisibleSecret(data.rotatedSecret || null);
      setSuccess(
        rotateSecret
          ? "OAuth app updated and secret rotated."
          : "OAuth app settings saved.",
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Unable to update OAuth client",
      );
    } finally {
      setSaving(false);
    }
  }

  async function revealSecret() {
    setRevealing(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/oauth-clients/${client.id}?includeSecret=true`);
      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data = (await response.json()) as {
        client: ManagedOAuthClient;
        clientSecret?: string;
      };
      setVisibleSecret(data.clientSecret || null);
      setClient(data.client);
      setSuccess("Current client secret revealed.");
    } catch (revealError) {
      setError(
        revealError instanceof Error ? revealError.message : "Unable to reveal client secret",
      );
    } finally {
      setRevealing(false);
    }
  }

  const grantSummary = useMemo(
    () =>
      [
        client.clientCredentialsEnabled ? "client_credentials" : null,
        client.deviceFlowEnabled ? "device flow" : null,
      ]
        .filter(Boolean)
        .join(" • "),
    [client.clientCredentialsEnabled, client.deviceFlowEnabled],
  );

  return (
    <div className="admin-grid mt-8 xl:grid-cols-[1.15fr_0.85fr]">
      <article className="admin-panel admin-panel-strong">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="island-kicker mb-2">OAuth app settings</p>
            <h2 className="display-title text-3xl font-bold text-[var(--sea-ink)]">
              {client.clientName}
            </h2>
          </div>
          <span className="admin-status-pill" data-tone={client.enabled ? "good" : "warning"}>
            {client.enabled ? "enabled" : "disabled"}
          </span>
        </div>

        <OAuthClientForm
          form={form}
          submitting={saving}
          submitLabel="Save app settings"
          supportedScopes={supportedScopes}
          error={error}
          success={success}
          onChange={setForm}
          onSubmit={(event) => {
            event.preventDefault();
            void saveClient(false);
          }}
        >
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              className="admin-button admin-button-primary disabled:cursor-not-allowed disabled:opacity-70"
              disabled={saving || revealing}
            >
              {saving ? "Saving…" : "Save app settings"}
            </button>
            <button
              type="button"
              className="admin-button admin-button-secondary disabled:cursor-not-allowed disabled:opacity-70"
              disabled={saving || revealing}
              onClick={() => {
                void saveClient(true);
              }}
            >
              {saving ? "Updating…" : "Rotate secret"}
            </button>
          </div>
        </OAuthClientForm>
      </article>

      <div className="admin-grid">
        <article className="admin-panel admin-panel-muted">
          <p className="island-kicker mb-2">Client summary</p>
          <dl className="grid gap-3 text-sm text-[var(--sea-ink-soft)]">
            <InfoRow label="Client ID" value={client.clientId} />
            <InfoRow label="Auth method" value={formatAuthMethod(client.tokenEndpointAuthMethod)} />
            <InfoRow label="Enabled grants" value={grantSummary} />
            <InfoRow label="Allowed scopes" value={client.allowedScopes.join(", ") || "None"} />
            <InfoRow label="Updated" value={formatDate(client.updatedAt) || "Recently"} />
          </dl>
        </article>

        <article className="admin-panel admin-panel-muted">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="island-kicker mb-2">Secret state</p>
              <h3 className="m-0 text-xl font-semibold text-[var(--sea-ink)]">Reveal or rotate</h3>
            </div>
            <span className="admin-status-pill" data-tone="good">
              preview {client.clientSecretPreview}…
            </span>
          </div>
          <p className="mt-0 mb-4 text-sm leading-7 text-[var(--sea-ink-soft)]">
            The stored secret is hidden by default. Reveal the current value if you need to reconfigure an existing caller, or rotate it to invalidate the old one.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="admin-button admin-button-secondary disabled:cursor-not-allowed disabled:opacity-70"
              disabled={saving || revealing}
              onClick={() => {
                void revealSecret();
              }}
            >
              {revealing ? "Revealing…" : "Reveal current secret"}
            </button>
          </div>
        </article>

        {visibleSecret ? (
          <SecretPanel
            title="Client secret"
            body="Treat this like a password. Copy it into the calling app, then rotate it if you suspect it has leaked."
            clientId={client.clientId}
            secret={visibleSecret}
            preview={client.clientSecretPreview}
          />
        ) : null}
      </div>
    </div>
  );
}

function OAuthClientForm({
  form,
  onChange,
  onSubmit,
  submitting,
  submitLabel,
  supportedScopes,
  error,
  success,
  children,
}: {
  form: OAuthClientFormValues;
  onChange: Dispatch<SetStateAction<OAuthClientFormValues>>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitting: boolean;
  submitLabel: string;
  supportedScopes: string[];
  error?: string | null;
  success?: string | null;
  children?: ReactNode;
}) {
  const parsedScopes = parseScopes(form.allowedScopes);
  const hasGrantEnabled = form.clientCredentialsEnabled || form.deviceFlowEnabled;

  return (
    <form className="grid gap-5" onSubmit={onSubmit}>
      <label className="grid gap-2 text-sm font-semibold text-[var(--sea-ink)]">
        Client name
        <input
          value={form.clientName}
          onChange={(event) => {
            const nextValue = event.target.value;
            onChange((current) => ({ ...current, clientName: nextValue }));
          }}
          placeholder="CLI daemon"
          className="admin-input"
          required
        />
      </label>

      <label className="grid gap-2 text-sm font-semibold text-[var(--sea-ink)]">
        Description
        <textarea
          value={form.description}
          onChange={(event) => {
            const nextValue = event.target.value;
            onChange((current) => ({ ...current, description: nextValue }));
          }}
          placeholder="What this app is for"
          className="admin-textarea"
        />
      </label>

      <div className="grid gap-4 lg:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold text-[var(--sea-ink)]">
          Token endpoint auth method
          <select
            value={form.tokenEndpointAuthMethod}
            onChange={(event) => {
              const nextValue = event.target.value as OAuthClientFormValues["tokenEndpointAuthMethod"];
              onChange((current) => ({ ...current, tokenEndpointAuthMethod: nextValue }));
            }}
            className="admin-select"
          >
            <option value="client_secret_basic">client_secret_basic</option>
            <option value="client_secret_post">client_secret_post</option>
          </select>
        </label>

        <div className="grid gap-3">
          <label className="admin-list-item flex items-start gap-3">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => {
                const nextValue = event.target.checked;
                onChange((current) => ({ ...current, enabled: nextValue }));
              }}
              className="mt-1"
            />
            <span>
              <strong className="block text-[var(--sea-ink)]">Enabled</strong>
              <span className="mt-1 block text-sm leading-6 text-[var(--sea-ink-soft)]">
                Disable the app without deleting its configuration.
              </span>
            </span>
          </label>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <label className="admin-list-item flex items-start gap-3">
          <input
            type="checkbox"
            checked={form.clientCredentialsEnabled}
            onChange={(event) => {
              const nextValue = event.target.checked;
              onChange((current) => ({ ...current, clientCredentialsEnabled: nextValue }));
            }}
            className="mt-1"
          />
          <span>
            <strong className="block text-[var(--sea-ink)]">Enable client credentials</strong>
            <span className="mt-1 block text-sm leading-6 text-[var(--sea-ink-soft)]">
              Allow token exchange with the app secret and no browser step.
            </span>
          </span>
        </label>

        <label className="admin-list-item flex items-start gap-3">
          <input
            type="checkbox"
            checked={form.deviceFlowEnabled}
            onChange={(event) => {
              const nextValue = event.target.checked;
              onChange((current) => ({ ...current, deviceFlowEnabled: nextValue }));
            }}
            className="mt-1"
          />
          <span>
            <strong className="block text-[var(--sea-ink)]">Enable device flow</strong>
            <span className="mt-1 block text-sm leading-6 text-[var(--sea-ink-soft)]">
              Allow user-code sign-in flows that finish with an admin-approved browser step.
            </span>
          </span>
        </label>
      </div>

      <label className="grid gap-2 text-sm font-semibold text-[var(--sea-ink)]">
        Allowed scopes
        <textarea
          value={form.allowedScopes}
          onChange={(event) => {
            const nextValue = event.target.value;
            onChange((current) => ({ ...current, allowedScopes: nextValue }));
          }}
          placeholder={supportedScopes.join("\n")}
          className="admin-textarea"
        />
        <span className="text-xs leading-6 text-[var(--sea-ink-soft)]">
          One scope per line. Supported in this app: {supportedScopes.join(", ")}.
        </span>
      </label>

      {!hasGrantEnabled ? (
        <div className="admin-status-pill w-fit" data-tone="danger">
          Enable at least one grant type before saving.
        </div>
      ) : null}

      {parsedScopes.length ? (
        <div className="flex flex-wrap gap-2">
          {parsedScopes.map((scope) => (
            <span key={scope} className="admin-chip">
              {scope}
            </span>
          ))}
        </div>
      ) : null}

      {error ? (
        <div className="admin-status-pill w-fit" data-tone="danger">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="admin-status-pill w-fit" data-tone="good">
          {success}
        </div>
      ) : null}

      {children || (
        <button
          type="submit"
          className="admin-button admin-button-primary disabled:cursor-not-allowed disabled:opacity-70"
          disabled={submitting || !hasGrantEnabled}
        >
          {submitting ? "Saving…" : submitLabel}
        </button>
      )}
    </form>
  );
}

function SecretPanel({
  title,
  body,
  clientId,
  secret,
  preview,
  footer,
}: {
  title: string;
  body: string;
  clientId: string;
  secret: string;
  preview: string;
  footer?: ReactNode;
}) {
  return (
    <article className="admin-panel admin-panel-strong">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="island-kicker mb-2">Secret preview</p>
          <h3 className="m-0 text-xl font-semibold text-[var(--sea-ink)]">{title}</h3>
        </div>
        <span className="admin-status-pill" data-tone="good">
          {preview}…
        </span>
      </div>
      <p className="mt-0 mb-4 text-sm leading-7 text-[var(--sea-ink-soft)]">{body}</p>
      <dl className="grid gap-3 text-sm text-[var(--sea-ink-soft)]">
        <InfoRow label="Client ID" value={clientId} />
      </dl>
      <div className="mt-4 rounded-[1.25rem] border border-[var(--line)] bg-[color:var(--surface-strong)] p-4 shadow-[inset_0_1px_0_var(--inset-glint)]">
        <code className="block overflow-x-auto border-0 bg-transparent px-0 py-0 text-sm text-[var(--sea-ink)]">
          {secret}
        </code>
      </div>
      {footer ? <div className="mt-4">{footer}</div> : null}
    </article>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs font-semibold tracking-[0.12em] uppercase text-[var(--kicker)]">
        {label}
      </dt>
      <dd className="m-0 text-sm text-[var(--sea-ink)]">{value}</dd>
    </div>
  );
}

function createFormValues(client: {
  clientName: string;
  description?: string | null;
  enabled: boolean;
  tokenEndpointAuthMethod: "client_secret_basic" | "client_secret_post";
  allowedScopes: string[] | string;
  clientCredentialsEnabled: boolean;
  deviceFlowEnabled: boolean;
}): OAuthClientFormValues {
  return {
    clientName: client.clientName,
    description: client.description || "",
    enabled: client.enabled,
    tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
    allowedScopes: Array.isArray(client.allowedScopes)
      ? client.allowedScopes.join("\n")
      : client.allowedScopes,
    clientCredentialsEnabled: client.clientCredentialsEnabled,
    deviceFlowEnabled: client.deviceFlowEnabled,
  };
}

function toPayload(form: OAuthClientFormValues): OAuthClientPayload {
  return {
    clientName: form.clientName.trim(),
    description: form.description.trim() || undefined,
    enabled: form.enabled,
    tokenEndpointAuthMethod: form.tokenEndpointAuthMethod,
    allowedScopes: parseScopes(form.allowedScopes),
    clientCredentialsEnabled: form.clientCredentialsEnabled,
    deviceFlowEnabled: form.deviceFlowEnabled,
  };
}

function parseScopes(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,\n\s]+/)
        .map((scope) => scope.trim())
        .filter(Boolean),
    ),
  ).sort();
}

function formatDate(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatAuthMethod(value: "client_secret_basic" | "client_secret_post") {
  return value === "client_secret_post" ? "client_secret_post" : "client_secret_basic";
}
