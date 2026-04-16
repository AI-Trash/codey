import { Separator } from "./ui/separator";

const footerLinks = {
  Product: [
    { href: "/#features", label: "Features" },
    { href: "/#example", label: "Docs" },
    { href: "/#process", label: "Process" },
  ],
  Routes: [
    { href: "/device", label: "Device flow" },
    { href: "/admin", label: "Admin dashboard" },
    { href: "/about", label: "About" },
  ],
} as const;

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10">
        <div className="flex flex-col gap-8 lg:flex-row lg:justify-between">
          <div className="max-w-lg space-y-2">
            <p className="text-sm font-semibold text-foreground">Codey</p>
            <p className="text-sm leading-6 text-muted-foreground">
              Shared browser shell for verification workflows, operator
              approvals, and automation-facing delivery.
            </p>
          </div>

          <div className="grid gap-8 sm:grid-cols-2">
            {Object.entries(footerLinks).map(([group, links]) => (
              <div key={group} className="space-y-3">
                <p className="text-sm font-medium text-foreground">{group}</p>
                <div className="flex flex-col gap-2">
                  {links.map((link) => (
                    <a
                      key={link.href}
                      href={link.href}
                      className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      {link.label}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <Separator />

        <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0">&copy; {year} Codey</p>
          <p className="m-0">
            GitHub login, Cloudflare ingest, and SSE delivery in one app
            boundary.
          </p>
        </div>
      </div>
    </footer>
  );
}
