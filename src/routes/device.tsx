import { useEffect, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

const loadChallenge = createServerFn({ method: "GET" })
  .inputValidator((data: { userCode?: string }) => data)
  .handler(async ({ data }) => {
    const { getDeviceChallengeByUserCode } = await import(
      "../lib/server/device-auth"
    );
    if (!data.userCode) {
      return null;
    }

    return getDeviceChallengeByUserCode(data.userCode);
  });

export const Route = createFileRoute("/device")({
  validateSearch: (search: Record<string, unknown>) => ({
    userCode: typeof search.userCode === "string" ? search.userCode : undefined,
  }),
  loaderDeps: ({ search: { userCode } }) => ({ userCode }),
  loader: ({ deps }) => loadChallenge({ data: { userCode: deps.userCode } }),
  component: DevicePage,
});

function normalizeUserCode(value: string): string {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length <= 4) {
    return compact;
  }

  return `${compact.slice(0, 4)}-${compact.slice(4, 8)}`;
}

function DevicePage() {
  const challenge = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const [userCode, setUserCode] = useState(search.userCode || "");

  useEffect(() => {
    setUserCode(search.userCode || "");
  }, [search.userCode]);

  return (
    <main className="page-wrap px-4 py-12">
      <section className="island-shell rounded-2xl p-6 sm:p-8">
        <p className="island-kicker mb-2">Device authorization</p>
        <h1 className="display-title mb-3 text-4xl font-bold text-[var(--sea-ink)] sm:text-5xl">
          Approve a CLI session.
        </h1>
        <p className="mb-6 max-w-2xl text-base leading-8 text-[var(--sea-ink-soft)]">
          Paste the user code shown in the CLI to inspect the pending challenge,
          then complete approval from the admin dashboard.
        </p>

        <form
          className="mb-6 grid gap-3 rounded-2xl border border-[var(--line)] bg-white/50 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            const nextUserCode = normalizeUserCode(userCode);
            navigate({
              to: "/device",
              search: {
                userCode: nextUserCode || undefined,
              },
            });
          }}
        >
          <label className="grid gap-2 text-sm font-semibold text-[var(--sea-ink)]">
            User code
            <input
              value={userCode}
              onChange={(event) => {
                setUserCode(normalizeUserCode(event.target.value));
              }}
              placeholder="ABCD-EFGH"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={9}
              className="admin-input uppercase"
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button className="admin-button admin-button-primary" type="submit">
              Inspect code
            </button>
            {userCode ? (
              <Link
                to="/device"
                search={{ userCode: undefined }}
                className="admin-button admin-button-secondary"
              >
                Clear
              </Link>
            ) : null}
          </div>
        </form>

        {challenge ? (
          <div className="space-y-4 text-base text-[var(--sea-ink-soft)]">
            <p>
              User code:{" "}
              <strong className="text-[var(--sea-ink)]">
                {challenge.userCode}
              </strong>
            </p>
            <p>Status: {challenge.status}</p>
            <p>Flow: {challenge.flowType || "n/a"}</p>
            <p>CLI: {challenge.cliName || "n/a"}</p>
            <p>
              Finish sign-in as an admin in the browser, then approve this
              device from the
              <a className="ml-1 underline" href="/admin">
                admin dashboard
              </a>
              .
            </p>
          </div>
        ) : (
          <div className="space-y-3 text-[var(--sea-ink-soft)]">
            <p className="m-0 max-w-2xl text-base leading-8">
              Enter a code manually, or open this page with
              <code> ?userCode=XXXX-XXXX</code> to preload a pending challenge.
            </p>
            <p className="m-0 text-sm leading-7">
              Once the challenge is visible here, switch to the
              <a className="ml-1 underline" href="/admin">
                admin dashboard
              </a>
              to approve or deny it.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
