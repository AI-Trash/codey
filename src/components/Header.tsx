import { Link } from "@tanstack/react-router";
import ParaglideLocaleSwitcher from "./LocaleSwitcher.tsx";
import ThemeToggle from "./ThemeToggle.tsx";

const primaryLinks = [
  { href: "/#features", label: "Features" },
  { href: "/#example", label: "Docs" },
  { href: "/device", label: "Support" },
  { href: "/#process", label: "Process" },
] as const;

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--header-bg)] px-4">
      <nav
        aria-label="Primary"
        className="page-wrap flex flex-wrap items-center gap-3 py-3"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <h2 className="m-0 flex-shrink-0 text-base font-semibold tracking-tight">
            <Link
              to="/"
              className="inline-flex items-center gap-2 rounded-md border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-2 text-sm text-[var(--sea-ink)] no-underline"
            >
              <span className="h-2 w-2 rounded-full bg-[var(--lagoon-deep)]" />
              Codey
            </Link>
          </h2>

          <div className="hidden items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--sea-ink-soft)] lg:flex">
            <span className="font-medium text-[var(--sea-ink)]">Command</span>
            <kbd className="rounded border border-[var(--line)] bg-[var(--chip-bg)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--sea-ink)]">
              Ctrl K
            </kbd>
          </div>
        </div>

        <div className="order-3 flex w-full flex-wrap items-center gap-x-4 gap-y-2 text-sm font-medium sm:order-2 sm:w-auto lg:order-none lg:ml-auto">
          {primaryLinks.map((link) => (
            <a key={link.href} href={link.href} className="nav-link">
              {link.label}
            </a>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <Link
            to="/admin"
            className="inline-flex items-center rounded-md bg-[var(--lagoon-deep)] px-3 py-2 text-sm font-semibold text-white no-underline transition hover:bg-[color-mix(in_oklab,var(--lagoon-deep)_88%,black)]"
          >
            Open admin
          </Link>
          <ParaglideLocaleSwitcher />
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}
