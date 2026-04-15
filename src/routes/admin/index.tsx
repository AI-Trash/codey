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
        <section className="island-shell admin-hero rounded-[2rem] px-6 py-8 sm:px-10 sm:py-10">
          <div className="relative z-10 max-w-2xl">
            <p className="island-kicker mb-3">Admin</p>
            <h1 className="display-title mb-4 text-4xl font-bold tracking-tight text-[var(--sea-ink)] sm:text-5xl">
              Sign in to open the control plane.
            </h1>
            <p className="mb-6 text-base leading-8 text-[var(--sea-ink-soft)]">
              GitHub browser access is required before you can approve device
              logins, inspect verification activity, or manage flow app account
              requests.
            </p>
            <div className="flex flex-wrap gap-3">
              <a href="/admin/login" className="admin-button admin-button-primary">
                Go to admin login
              </a>
              <a href="/device" className="admin-button admin-button-secondary">
                Inspect a device code
              </a>
            </div>
          </div>
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
  const verification = data.verification as VerificationData;

  const approvedCount = deviceChallenges.filter(
    (challenge) => challenge.status === "APPROVED",
  ).length;
  const pendingCount = deviceChallenges.filter(
    (challenge) => challenge.status === "PENDING",
  ).length;
  const codeCount = verification.codes?.length ?? 0;
  const requestCount = flowAppRequests.length;

  return (
    <main className="page-wrap px-4 py-12">
      <section className="island-shell admin-hero rise-in rounded-[2rem] px-6 py-8 sm:px-10 sm:py-10">
        <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-4 flex flex-wrap gap-2">
              <span className="admin-chip">Admin control plane</span>
              <span className="admin-status-pill" data-tone="good">
                {data.user.role.toLowerCase()} session
              </span>
            </div>
            <h1 className="display-title mb-4 text-4xl leading-[1.02] font-bold tracking-tight text-[var(--sea-ink)] sm:text-6xl">
              Run Codey from one calm command deck.
            </h1>
            <p className="max-w-2xl text-base leading-8 text-[var(--sea-ink-soft)] sm:text-lg">
              Signed in as{" "}
              <strong className="text-[var(--sea-ink)]">
                {data.user.githubLogin || data.user.email || data.user.name || "unknown user"}
              </strong>
              . Review identity coverage, unblock device challenges, watch recent
              verification traffic, and triage flow app auto-add-account requests
              without leaving the browser.
            </p>
          </div>

          <div className="flex flex-col gap-3 lg:items-end">
            <div className="admin-anchor-nav">
              <a href="#overview" className="admin-button admin-button-secondary">
                Overview
              </a>
              <a href="#device-flow" className="admin-button admin-button-secondary">
                Device flow
              </a>
              <a href="#requests" className="admin-button admin-button-secondary">
                Requests
              </a>
            </div>
            <form method="post" action="/auth/logout">
              <button className="admin-button admin-button-secondary">
                Log out
              </button>
            </form>
          </div>
        </div>
      </section>

      <section id="overview" className="admin-grid mt-8">
        <div className="admin-stat-grid" data-columns="4">
          <StatCard label="Pending approvals" value={String(pendingCount)} detail="Device codes awaiting an admin response." />
          <StatCard label="Approved sessions" value={String(approvedCount)} detail="Recently completed browser approvals." />
          <StatCard label="Verification codes" value={String(codeCount)} detail="Most recent captured codes visible to admins." />
          <StatCard label="Flow app requests" value={String(requestCount)} detail="Queued asks for auto-add-account support." />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
          <article className="admin-panel admin-panel-strong">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="island-kicker mb-2">Identity summaries</p>
                <h2 className="display-title text-3xl font-bold text-[var(--sea-ink)]">
                  Saved operator coverage.
                </h2>
              </div>
              <span
                className="admin-status-pill"
                data-tone={identitySummaries.length > 0 ? "good" : "warning"}
              >
                {identitySummaries.length} known identities
              </span>
            </div>
            <p className="mb-5 max-w-2xl text-sm leading-7 text-[var(--sea-ink-soft)]">
              This section gives admins a quick read on which browser-backed or
              flow-backed identities are already represented, so new requests can
              be routed to existing coverage first.
            </p>
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
              <EmptyState message="Saved identity summaries will appear here once the backend starts returning coverage data." />
            )}
          </article>

          <article className="admin-panel admin-panel-muted">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="island-kicker mb-2">Config status</p>
                <h2 className="display-title text-3xl font-bold text-[var(--sea-ink)]">
                  App readiness at a glance.
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
              <EmptyState message="Configuration cards will populate when minimal backend status reporting is connected." />
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
                Approvals and CLI handshakes.
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
            <EmptyState message="Recent device challenges will appear here after a CLI auth flow starts." />
          )}
        </article>

        <div className="admin-grid">
          <article className="admin-panel admin-panel-muted">
            <p className="island-kicker mb-2">Manual verification code</p>
            <h2 className="display-title mb-3 text-3xl font-bold text-[var(--sea-ink)]">
              Fill a code by hand.
            </h2>
            <p className="mb-4 text-sm leading-7 text-[var(--sea-ink-soft)]">
              Keep the native post flow intact for route handlers while making the
              emergency path easier to scan and use.
            </p>
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
              Broadcast an operator note.
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
                Recent mailbox motion.
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
            <EmptyState message="Verification activity summaries will appear here once the backend exposes the new activity feed." />
          )}
        </article>

        <article className="admin-panel admin-panel-muted">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="island-kicker mb-2">Recent notifications</p>
              <h2 className="display-title text-3xl font-bold text-[var(--sea-ink)]">
                Outbound admin notes.
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
            <EmptyState message="Admin notifications will appear here after the first broadcast is created." />
          )}
        </article>
      </section>

      <section id="requests" className="admin-grid mt-8 xl:grid-cols-[0.95fr_1.05fr]">
        <article className="admin-panel admin-panel-strong">
          <p className="island-kicker mb-2">GitHub Actions flow apps</p>
          <h2 className="display-title mb-3 text-3xl font-bold text-[var(--sea-ink)]">
            Request auto-add-account.
          </h2>
          <p className="mb-4 max-w-2xl text-sm leading-7 text-[var(--sea-ink-soft)]">
            This is intentionally lightweight: a native form that lets an app or
            operator queue a request for account coverage without exposing any
            secrets or speculative workflow-dispatch controls.
          </p>
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
                Pending app asks.
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
            <EmptyState message="The request queue will populate here once GitHub Actions flow apps begin filing account requests." />
          )}
        </article>
      </section>

      <section className="admin-grid mt-8 xl:grid-cols-3">
        <article className="admin-panel admin-panel-muted xl:col-span-2">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="island-kicker mb-2">Recent verification codes</p>
              <h2 className="display-title text-3xl font-bold text-[var(--sea-ink)]">
                Codes and reservations.
              </h2>
            </div>
            <span className="admin-status-pill" data-tone={codeCount > 0 ? "good" : "warning"}>
              {codeCount} captured
            </span>
          </div>
          {verification.codes && verification.codes.length > 0 ? (
            <ul className="admin-list">
              {verification.codes.map((code) => (
                <li key={code.id} className="admin-list-item">
                  <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                    <strong className="text-[var(--sea-ink)]">{code.reservation.email}</strong>
                    <span className="admin-chip">{code.source}</span>
                  </div>
                  <dl className="m-0 grid gap-2 text-sm text-[var(--sea-ink-soft)] sm:grid-cols-2">
                    <InfoRow label="Code" value={code.code} />
                    <InfoRow label="Received" value={formatDate(code.receivedAt) || "Timestamp unavailable"} />
                  </dl>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState message="Captured verification codes will appear here when mailbox ingest is active." />
          )}
        </article>

        <div className="admin-grid">
          <article className="admin-panel admin-panel-muted">
            <p className="island-kicker mb-2">Reservations</p>
            {verification.reservations && verification.reservations.length > 0 ? (
              <ul className="admin-list">
                {verification.reservations.map((reservation) => (
                  <li key={reservation.id} className="admin-list-item">
                    <strong className="block text-[var(--sea-ink)]">{reservation.email}</strong>
                    <p className="mt-2 mb-0 text-sm text-[var(--sea-ink-soft)]">
                      Expires {formatDate(reservation.expiresAt) || "soon"}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState message="Reserved aliases will show up here once email reservation flows are used." />
            )}
          </article>

          <article className="admin-panel admin-panel-muted">
            <p className="island-kicker mb-2">Inbound emails</p>
            {verification.emails && verification.emails.length > 0 ? (
              <ul className="admin-list">
                {verification.emails.map((email) => (
                  <li key={email.id} className="admin-list-item">
                    <strong className="block text-[var(--sea-ink)]">{email.recipient}</strong>
                    <p className="mt-2 mb-0 text-sm text-[var(--sea-ink-soft)]">
                      {email.subject || "No subject captured"}
                    </p>
                    <p className="mt-2 mb-0 text-sm text-[var(--sea-ink-soft)]">
                      Code: {email.verificationCode || "Not detected"}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState message="Inbound verification email summaries will populate here when webhook ingest lands." />
            )}
          </article>
        </div>
      </section>
    </main>
  );
}

function StatCard(props: { label: string; value: string; detail: string }) {
  return (
    <article className="admin-stat-card">
      <span className="admin-eyebrow">{props.label}</span>
      <strong>{props.value}</strong>
      <p className="mt-3 mb-0 text-sm leading-7 text-[var(--sea-ink-soft)]">
        {props.detail}
      </p>
    </article>
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
