import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

const loadDashboard = createServerFn({ method: "GET" }).handler(async () => {
  const [{ getRequest }, { requireAdmin }, { listAdminDashboardData }] =
    await Promise.all([
      import("@tanstack/react-start/server"),
      import("../../lib/server/auth"),
      import("../../lib/server/admin"),
    ]);
  const request = getRequest();
  let sessionUser;
  try {
    sessionUser = await requireAdmin(request);
  } catch {
    return { authorized: false as const };
  }

  const data = await listAdminDashboardData();
  return {
    authorized: true as const,
    user: {
      name: sessionUser.user.name,
      email: sessionUser.user.email,
      githubLogin: sessionUser.user.githubLogin,
      role: sessionUser.user.role,
      avatarUrl: sessionUser.user.avatarUrl,
    },
    ...data,
  };
});

export const Route = createFileRoute("/admin/")({
  loader: async () => loadDashboard(),
  component: AdminPage,
});

type VerificationData = {
  codes?: Array<{
    id: string;
    code: string;
    source: string;
    receivedAt: string | Date;
    reservation: {
      email: string;
    };
  }>;
  reservations?: Array<{
    id: string;
    email: string;
    expiresAt: string | Date;
  }>;
  emails?: Array<{
    id: string;
    recipient: string;
    subject: string | null;
    verificationCode: string | null;
    receivedAt?: string | Date;
  }>;
  activity?: Array<{
    id: string;
    title?: string | null;
    detail?: string | null;
    status?: string | null;
    createdAt?: string | Date;
  }>;
};

type DeviceChallenge = {
  id: string;
  deviceCode: string;
  userCode: string;
  status: string;
  flowType: string | null;
  cliName: string | null;
  target?: string | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
};

type AdminNotification = {
  id: string;
  title: string;
  body: string;
  flowType: string | null;
  target: string | null;
  createdAt?: string | Date;
};

type IdentitySummary = {
  id: string;
  label: string;
  provider?: string | null;
  account?: string | null;
  flowCount?: number | null;
  lastSeenAt?: string | Date | null;
  status?: string | null;
};

type ConfigStatusItem = {
  id?: string;
  key?: string;
  label: string;
  description?: string | null;
  status: string;
  detail?: string | null;
};

type FlowAppRequest = {
  id: string;
  appName: string;
  flowType?: string | null;
  requestedBy?: string | null;
  requestedIdentity?: string | null;
  notes?: string | null;
  status?: string | null;
  createdAt?: string | Date;
};

function AdminPage() {
  const data = Route.useLoaderData();
  if (!data.authorized) {
    return (
      <main className="page-wrap px-4 py-12">
        <section className="island-shell rounded-2xl p-6 sm:p-8">
          <p className="island-kicker mb-2">Admin</p>
          <h1 className="display-title mb-3 text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
            Admin sign-in required.
          </h1>
          <p className="mb-5 max-w-2xl text-base leading-8 text-[var(--sea-ink-soft)]">
            Sign in with GitHub to view admin tools.
          </p>
          <a href="/admin/login" className="admin-button admin-button-primary">
            Go to admin login
          </a>
        </section>
      </main>
    );
  }

  const identitySummaries = getIdentitySummaries(data);
  const configStatuses = getConfigStatuses(data);
  const flowAppRequests = getFlowAppRequests(data);
  const verificationActivity = getVerificationActivity(data.verification);
  const deviceChallenges = data.deviceChallenges as DeviceChallenge[];
  const notifications = data.notifications as AdminNotification[];

  const pendingCount = deviceChallenges.filter(
    (challenge) => challenge.status === "PENDING",
  ).length;

  return (
    <main className="page-wrap px-4 py-12">
      <section className="admin-panel admin-panel-muted rise-in flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="island-kicker mb-2">Admin</p>
          <h1 className="display-title text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
            Operations
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--sea-ink-soft)]">
            Signed in as{" "}
            <strong className="text-[var(--sea-ink)]">
              {data.user.githubLogin || data.user.email || data.user.name || "unknown user"}
            </strong>
            .
          </p>
        </div>
        <form method="post" action="/auth/logout">
          <button className="admin-button admin-button-secondary">
            Log out
          </button>
        </form>
      </section>

      <section id="overview" className="admin-grid mt-8">
        <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
          <article className="admin-panel admin-panel-strong">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="island-kicker mb-2">Identity summaries</p>
                <h2 className="display-title text-3xl font-bold text-[var(--sea-ink)]">
                  Saved identities
                </h2>
              </div>
              <span
                className="admin-status-pill"
                data-tone={identitySummaries.length > 0 ? "good" : "warning"}
              >
                {identitySummaries.length} known identities
              </span>
            </div>
            {identitySummaries.length > 0 ? (
              <ul className="admin-list sm:grid-cols-2 xl:grid-cols-3">
                {identitySummaries.map((summary) => (
                  <li key={summary.id} className="admin-list-item">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="admin-eyebrow">{summary.provider || "Saved identity"}</div>
                        <div className="mt-1 text-lg font-semibold text-[var(--sea-ink)]">
                          {summary.label}
                        </div>
                      </div>
                      <span
                        className="admin-status-pill"
                        data-tone={getStatusTone(summary.status)}
                      >
                        {summary.status || "available"}
                      </span>
                    </div>
                    <dl className="m-0 grid gap-2 text-sm text-[var(--sea-ink-soft)]">
                      <InfoRow label="Account" value={summary.account || "Not linked yet"} />
                      <InfoRow label="Flow coverage" value={summary.flowCount != null ? `${summary.flowCount} flows` : "Pending backend data"} />
                      <InfoRow label="Last seen" value={formatDate(summary.lastSeenAt) || "Not captured yet"} />
                    </dl>
                    <form
                      method="post"
                      action="/api/admin/identities"
                      className="mt-4 grid gap-3 border-t border-[var(--line)] pt-4"
                    >
                      <input type="hidden" name="identityId" value={summary.id} />
                      <input
                        type="hidden"
                        name="email"
                        value={summary.account || summary.label}
                      />
                      <label className="grid gap-2 text-sm font-semibold text-[var(--sea-ink)]">
                        Display label
                        <input
                          name="label"
                          defaultValue={summary.label !== summary.account ? summary.label : ""}
                          placeholder={summary.account || "Identity label"}
                          className="admin-input"
                        />
                      </label>
                      <label className="grid gap-2 text-sm font-semibold text-[var(--sea-ink)]">
                        Status
                        <select
                          name="status"
                          defaultValue={toManagedStatus(summary.status)}
                          className="admin-select"
                        >
                          <option value="ACTIVE">Active</option>
                          <option value="REVIEW">Needs review</option>
                          <option value="ARCHIVED">Archived</option>
                        </select>
                      </label>
                      <button className="admin-button admin-button-secondary">
                        Save account settings
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState message="No saved identities found." />
            )}
          </article>

          <article className="admin-panel admin-panel-muted">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="island-kicker mb-2">Config status</p>
                <h2 className="display-title text-3xl font-bold text-[var(--sea-ink)]">
                  Configuration status
                </h2>
              </div>
              <span
                className="admin-status-pill"
                data-tone={getConfigTone(configStatuses)}
              >
                {summarizeConfigState(configStatuses)}
              </span>
            </div>
            {configStatuses.length > 0 ? (
              <ul className="admin-list">
                {configStatuses.map((item, index) => (
                  <li key={item.id ?? item.key ?? `${item.label}-${index}`} className="admin-list-item">
                    <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                      <strong className="text-[var(--sea-ink)]">{item.label}</strong>
                      <span
                        className="admin-status-pill"
                        data-tone={getStatusTone(item.status)}
                      >
                        {item.status}
                      </span>
                    </div>
                    <p className="m-0 text-sm leading-7 text-[var(--sea-ink-soft)]">
                      {item.detail || item.description || "Waiting for backend status detail."}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState message="No configuration status available." />
            )}
          </article>
        </div>
      </section>

      <section id="device-flow" className="admin-grid mt-8 lg:grid-cols-[1.2fr_0.8fr]">
        <article className="admin-panel admin-panel-strong">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="island-kicker mb-2">Device flow management</p>
              <h2 className="display-title text-3xl font-bold text-[var(--sea-ink)]">
                Device approvals
              </h2>
            </div>
            <span
              className="admin-status-pill"
              data-tone={pendingCount > 0 ? "warning" : "good"}
            >
              {pendingCount > 0 ? `${pendingCount} pending` : "Queue clear"}
            </span>
          </div>
          {deviceChallenges.length > 0 ? (
            <ul className="admin-list">
              {deviceChallenges.map((challenge) => (
                <li key={challenge.id} className="admin-list-item">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="admin-eyebrow">{challenge.flowType || "CLI device flow"}</div>
                      <div className="mt-1 text-xl font-semibold text-[var(--sea-ink)]">
                        {challenge.userCode}
                      </div>
                    </div>
                    <span
                      className="admin-status-pill"
                      data-tone={getChallengeTone(challenge.status)}
                    >
                      {challenge.status}
                    </span>
                  </div>

                  <dl className="mt-4 grid gap-2 text-sm text-[var(--sea-ink-soft)] sm:grid-cols-2">
                    <InfoRow label="CLI client" value={challenge.cliName || "Unknown client"} />
                    <InfoRow label="Target" value={challenge.target || "No explicit target"} />
                    <InfoRow label="Device code" value={challenge.deviceCode} />
                    <InfoRow label="Updated" value={formatDate(challenge.updatedAt || challenge.createdAt) || "Awaiting backend timestamp"} />
                  </dl>

                  {challenge.status === "PENDING" ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <form method="post" action={`/api/admin/device/${challenge.deviceCode}/approve`}>
                        <button className="admin-button admin-button-primary">
                          Approve device
                        </button>
                      </form>
                      <form method="post" action={`/api/admin/device/${challenge.deviceCode}/deny`}>
                        <button className="admin-button admin-button-danger">
                          Deny device
                        </button>
                      </form>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState message="No device challenges found." />
          )}
        </article>

        <div className="admin-grid">
          <article className="admin-panel admin-panel-muted">
            <p className="island-kicker mb-2">Manual verification code</p>
            <h2 className="display-title mb-3 text-3xl font-bold text-[var(--sea-ink)]">
              Add verification code
            </h2>
            <form method="post" action="/api/admin/verification-codes" className="grid gap-3">
              <label className="grid gap-2 text-sm font-semibold text-[var(--sea-ink)]">
                Target email
                <input name="email" placeholder="target email" className="admin-input" />
              </label>
              <label className="grid gap-2 text-sm font-semibold text-[var(--sea-ink)]">
                6-digit code
                <input name="code" placeholder="6-digit code" className="admin-input" />
              </label>
              <button className="admin-button admin-button-primary">
                Inject verification code
              </button>
            </form>
          </article>

          <article className="admin-panel admin-panel-muted">
            <p className="island-kicker mb-2">Admin notification</p>
            <h2 className="display-title mb-3 text-3xl font-bold text-[var(--sea-ink)]">
              Create notification
            </h2>
            <form method="post" action="/api/admin/notifications" className="grid gap-3">
              <label className="grid gap-2 text-sm font-semibold text-[var(--sea-ink)]">
                Title
                <input name="title" placeholder="title" className="admin-input" />
              </label>
              <label className="grid gap-2 text-sm font-semibold text-[var(--sea-ink)]">
                Flow type
                <input name="flowType" placeholder="flow type (optional)" className="admin-input" />
              </label>
              <label className="grid gap-2 text-sm font-semibold text-[var(--sea-ink)]">
                Target
                <input name="target" placeholder="target (optional)" className="admin-input" />
              </label>
              <label className="grid gap-2 text-sm font-semibold text-[var(--sea-ink)]">
                Message
                <textarea name="body" placeholder="message" className="admin-textarea" />
              </label>
              <button className="admin-button admin-button-secondary">
                Create notification
              </button>
            </form>
          </article>
        </div>
      </section>

      <section className="admin-grid mt-8 xl:grid-cols-[1.1fr_0.9fr]">
        <article className="admin-panel admin-panel-muted">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="island-kicker mb-2">Verification activity</p>
              <h2 className="display-title text-3xl font-bold text-[var(--sea-ink)]">
                Recent verification activity
              </h2>
            </div>
            <span className="admin-status-pill" data-tone={verificationActivity.length > 0 ? "good" : "warning"}>
              {verificationActivity.length} events
            </span>
          </div>
          {verificationActivity.length > 0 ? (
            <ul className="admin-list">
              {verificationActivity.map((item) => (
                <li key={item.id} className="admin-list-item">
                  <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                    <strong className="text-[var(--sea-ink)]">{item.title}</strong>
                    <span className="admin-status-pill" data-tone={getStatusTone(item.status)}>
                      {item.status}
                    </span>
                  </div>
                  <p className="m-0 text-sm leading-7 text-[var(--sea-ink-soft)]">
                    {item.detail}
                  </p>
                  {item.createdAt ? (
                    <p className="mt-3 mb-0 text-xs font-semibold tracking-[0.12em] text-[var(--sea-ink-soft)] uppercase">
                      {formatDate(item.createdAt)}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState message="No verification activity found." />
          )}
        </article>

        <article className="admin-panel admin-panel-muted">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="island-kicker mb-2">Recent notifications</p>
              <h2 className="display-title text-3xl font-bold text-[var(--sea-ink)]">
                Recent notifications
              </h2>
            </div>
            <span className="admin-status-pill" data-tone={notifications.length > 0 ? "good" : "warning"}>
              {notifications.length} saved
            </span>
          </div>
          {notifications.length > 0 ? (
            <ul className="admin-list">
              {notifications.map((notification) => (
                <li key={notification.id} className="admin-list-item">
                  <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                    <strong className="text-[var(--sea-ink)]">{notification.title}</strong>
                    <span className="admin-chip">{notification.target || "all clients"}</span>
                  </div>
                  <p className="m-0 text-sm leading-7 text-[var(--sea-ink-soft)]">
                    {notification.body}
                  </p>
                  <dl className="mt-3 grid gap-2 text-sm text-[var(--sea-ink-soft)] sm:grid-cols-2">
                    <InfoRow label="Flow type" value={notification.flowType || "General"} />
                    <InfoRow label="Created" value={formatDate(notification.createdAt) || "Timestamp unavailable"} />
                  </dl>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState message="No notifications found." />
          )}
        </article>
      </section>

      <section id="requests" className="admin-grid mt-8 xl:grid-cols-[0.95fr_1.05fr]">
        <article className="admin-panel admin-panel-strong">
          <p className="island-kicker mb-2">GitHub Actions flow apps</p>
          <h2 className="display-title mb-3 text-3xl font-bold text-[var(--sea-ink)]">
            Flow app request
          </h2>
          <form method="post" action="/api/admin/flow-app-requests" className="grid gap-3">
            <label className="grid gap-2 text-sm font-semibold text-[var(--sea-ink)]">
              App name
              <input name="appName" placeholder="GitHub Actions app name" className="admin-input" />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-[var(--sea-ink)]">
              Flow type
              <input name="flowType" placeholder="chatgpt-register, codex-oauth..." className="admin-input" />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-[var(--sea-ink)]">
              Requested identity
              <input name="requestedIdentity" placeholder="octocat or org identity" className="admin-input" />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-[var(--sea-ink)]">
              Notes
              <textarea name="notes" placeholder="Why this app needs auto-add-account support" className="admin-textarea" />
            </label>
            <button className="admin-button admin-button-primary">
              Submit request
            </button>
          </form>
        </article>

        <article className="admin-panel admin-panel-muted">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="island-kicker mb-2">Request queue</p>
              <h2 className="display-title text-3xl font-bold text-[var(--sea-ink)]">
                Request queue
              </h2>
            </div>
            <span className="admin-status-pill" data-tone={flowAppRequests.length > 0 ? "warning" : "good"}>
              {flowAppRequests.length > 0 ? `${flowAppRequests.length} queued` : "No backlog"}
            </span>
          </div>
          {flowAppRequests.length > 0 ? (
            <ul className="admin-list">
              {flowAppRequests.map((request) => (
                <li key={request.id} className="admin-list-item">
                  <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="admin-eyebrow">{request.flowType || "Flow app"}</div>
                      <div className="mt-1 text-lg font-semibold text-[var(--sea-ink)]">
                        {request.appName}
                      </div>
                    </div>
                    <span className="admin-status-pill" data-tone={getStatusTone(request.status)}>
                      {request.status || "pending"}
                    </span>
                  </div>
                  <dl className="m-0 grid gap-2 text-sm text-[var(--sea-ink-soft)]">
                    <InfoRow label="Requested identity" value={request.requestedIdentity || "No identity attached yet"} />
                    <InfoRow label="Requested by" value={request.requestedBy || "Unknown requester"} />
                    <InfoRow label="Submitted" value={formatDate(request.createdAt) || "Awaiting timestamp"} />
                  </dl>
                  {request.notes ? (
                    <p className="mt-3 mb-0 text-sm leading-7 text-[var(--sea-ink-soft)]">
                      {request.notes}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState message="No flow app requests found." />
          )}
        </article>
      </section>
    </main>
  );
}

function InfoRow(props: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <dt className="admin-eyebrow">{props.label}</dt>
      <dd className="m-0 text-[var(--sea-ink-soft)]">{props.value}</dd>
    </div>
  );
}

function EmptyState(props: { message: string }) {
  return <div className="admin-empty text-sm leading-7">{props.message}</div>;
}

function formatDate(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleString();
}

function getStatusTone(status?: string | null) {
  const normalized = status?.toLowerCase();
  if (!normalized) {
    return "warning";
  }

  if (
    normalized.includes("error") ||
    normalized.includes("denied") ||
    normalized.includes("failed") ||
    normalized.includes("missing") ||
    normalized.includes("inactive")
  ) {
    return "danger";
  }

  if (
    normalized.includes("pending") ||
    normalized.includes("waiting") ||
    normalized.includes("queued") ||
    normalized.includes("partial")
  ) {
    return "warning";
  }

  return "good";
}

function getChallengeTone(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "pending") {
    return "warning";
  }

  if (normalized === "approved" || normalized === "complete") {
    return "good";
  }

  return "danger";
}

function getIdentitySummaries(data: Record<string, unknown>) {
  const candidate = data.identitySummaries;
  return Array.isArray(candidate) ? (candidate as IdentitySummary[]) : [];
}

function getConfigStatuses(data: Record<string, unknown>) {
  const candidate = data.configStatus;
  return Array.isArray(candidate) ? (candidate as ConfigStatusItem[]) : [];
}

function getFlowAppRequests(data: Record<string, unknown>) {
  const candidate = data.flowAppRequests;
  return Array.isArray(candidate) ? (candidate as FlowAppRequest[]) : [];
}

function getVerificationActivity(verification: VerificationData) {
  if (Array.isArray(verification.activity)) {
    return verification.activity.map((item) => ({
      id: item.id,
      title: item.title || "Verification event",
      detail: item.detail || "Recent verification activity was recorded.",
      status: item.status || "active",
      createdAt: item.createdAt,
    }));
  }

  const codeEvents = (verification.codes ?? []).slice(0, 3).map((code) => ({
    id: `code-${code.id}`,
    title: code.reservation.email,
    detail: `Code ${code.code} arrived from ${code.source}.`,
    status: "received",
    createdAt: code.receivedAt,
  }));

  const emailEvents = (verification.emails ?? []).slice(0, 3).map((email) => ({
    id: `email-${email.id}`,
    title: email.recipient,
    detail: email.subject || "Inbound verification email received.",
    status: email.verificationCode ? "parsed" : "received",
    createdAt: email.receivedAt,
  }));

  return [...codeEvents, ...emailEvents];
}

function getConfigTone(items: ConfigStatusItem[]) {
  if (items.some((item) => getStatusTone(item.status) === "danger")) {
    return "danger";
  }

  if (items.some((item) => getStatusTone(item.status) === "warning")) {
    return "warning";
  }

  return items.length > 0 ? "good" : "warning";
}

function summarizeConfigState(items: ConfigStatusItem[]) {
  if (items.length === 0) {
    return "Waiting for status";
  }

  if (items.every((item) => getStatusTone(item.status) === "good")) {
    return "All systems ready";
  }

  if (items.some((item) => getStatusTone(item.status) === "danger")) {
    return "Action required";
  }

  return "Needs review";
}

function toManagedStatus(status?: string | null) {
  const normalized = status?.toLowerCase();
  if (normalized === "archived") {
    return "ARCHIVED";
  }

  if (normalized === "review" || normalized === "pending") {
    return "REVIEW";
  }

  return "ACTIVE";
}
