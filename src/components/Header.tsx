import { Link } from "@tanstack/react-router";
import { CommandIcon } from "lucide-react";

import ParaglideLocaleSwitcher from "./LocaleSwitcher";
import ThemeToggle from "./ThemeToggle";
import { Button } from "./ui/button";

const primaryLinks = [
  { href: "/#features", label: "Features" },
  { href: "/#example", label: "Docs" },
  { href: "/device", label: "Device" },
  { href: "/#process", label: "Process" },
] as const;

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm font-semibold text-foreground no-underline"
        >
          <span className="inline-flex size-8 items-center justify-center rounded-md border bg-muted">
            <CommandIcon className="size-4" />
          </span>
          Codey
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {primaryLinks.map((link) => (
            <Button key={link.href} asChild variant="ghost" size="sm">
              <a href={link.href}>{link.label}</a>
            </Button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link to="/admin">Open admin</Link>
          </Button>
          <ParaglideLocaleSwitcher />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
