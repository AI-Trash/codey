export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer mt-16 px-4 pb-8 pt-6 text-[var(--sea-ink-soft)]">
      <div className="page-wrap flex flex-col gap-6 border-t border-[var(--line)] pt-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-lg">
          <p className="mb-2 text-sm font-semibold text-[var(--sea-ink)]">Codey</p>
          <p className="m-0 text-sm leading-7">
            Shared browser shell for verification workflows, operator approvals, and automation-facing delivery.
          </p>
        </div>

        <div className="grid gap-6 text-sm sm:grid-cols-2">
          <div>
            <p className="mb-3 font-semibold text-[var(--sea-ink)]">Navigate</p>
            <div className="flex flex-col gap-2">
              <a href="/#features" className="nav-link w-fit">
                Features
              </a>
              <a href="/#example" className="nav-link w-fit">
                Docs
              </a>
              <a href="/#process" className="nav-link w-fit">
                Process
              </a>
            </div>
          </div>

          <div>
            <p className="mb-3 font-semibold text-[var(--sea-ink)]">Resources</p>
            <div className="flex flex-col gap-2">
              <a href="/device" className="nav-link w-fit">
                Support route
              </a>
              <a href="/admin" className="nav-link w-fit">
                Admin dashboard
              </a>
              <a href="/#start" className="nav-link w-fit">
                Getting started
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="page-wrap mt-5 flex flex-col gap-2 border-t border-[var(--line)] pt-4 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="m-0">&copy; {year} Codey. Neutral shell, single accent, practical route-first copy.</p>
        <p className="m-0">GitHub login, Cloudflare ingest, and SSE delivery in one app boundary.</p>
      </div>
    </footer>
  );
}
