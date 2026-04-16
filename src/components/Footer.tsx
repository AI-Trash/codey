import { m } from '#/paraglide/messages'

import { InfoTooltip } from './ui/info-tooltip'
import { Separator } from './ui/separator'

export default function Footer() {
  const year = new Date().getFullYear()
  const footerLinks = {
    [m.footer_group_product()]: [
      { href: '/#features', label: m.footer_link_features() },
      { href: '/#example', label: m.footer_link_docs() },
      { href: '/#process', label: m.footer_link_process() },
    ],
    [m.footer_group_routes()]: [
      { href: '/device', label: m.footer_link_device_flow() },
      { href: '/admin', label: m.footer_link_admin_dashboard() },
      { href: '/about', label: m.footer_link_about() },
    ],
  } as const

  return (
    <footer className="border-t bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10">
        <div className="flex flex-col gap-8 lg:flex-row lg:justify-between">
          <div className="max-w-lg">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-foreground">Codey</p>
              <InfoTooltip
                content={m.footer_description()}
                label="Codey"
                className="size-4"
                iconClassName="size-3"
              />
            </div>
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
          <p className="m-0">{m.footer_meta()}</p>
        </div>
      </div>
    </footer>
  )
}
