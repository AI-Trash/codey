import { createFileRoute } from '@tanstack/react-router'
import { ArrowRightIcon } from 'lucide-react'

import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  HeroDitheringBadges,
  HeroDitheringContent,
  HeroDitheringDescription,
  HeroDitheringMobileVisual,
  HeroDitheringRoot,
  HeroDitheringVisual,
} from '#/components/ui/hero-dithering'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/')({ component: App })

function App() {
  const signalBadges = [
    { name: m.home_entry_badge_github() },
    { name: m.home_entry_badge_cloudflare() },
    { name: m.home_entry_badge_ws() },
  ] as const

  return (
    <main className="px-4 py-6 md:py-8">
      <HeroDitheringRoot
        srTitle="Codey"
        className="mx-auto min-h-[calc(100svh-10rem)] max-w-6xl rounded-[2rem] border border-border/70 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.1),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))] shadow-[0_24px_80px_-32px_rgba(15,23,42,0.28)] dark:bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.14),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.12),transparent_32%),linear-gradient(180deg,rgba(2,6,23,0.96),rgba(15,23,42,0.9))]"
      >
        <div className="relative z-10 grid gap-8 px-6 py-8 sm:px-8 sm:py-10 lg:min-h-[calc(100svh-10rem)] lg:grid-cols-[minmax(0,1fr)_minmax(320px,460px)] lg:items-center lg:px-12 lg:py-12">
          <HeroDitheringContent className="gap-6 px-0 sm:px-0 md:px-0 lg:pl-0 lg:pr-0 xl:pl-0 2xl:pl-0">
            <Badge
              variant="outline"
              className="mx-auto w-fit border-border/60 bg-background/70 text-[0.7rem] tracking-[0.22em] uppercase lg:mx-0"
            >
              {m.home_badge()}
            </Badge>

            <div className="space-y-4 text-center lg:text-left">
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl xl:text-6xl">
                {m.home_title()}
              </h1>
            </div>

            <HeroDitheringDescription
              className="mx-auto max-w-2xl pb-0 text-center lg:mx-0 lg:text-left"
              description={m.home_description()}
              descriptionClassName="text-base leading-7 text-muted-foreground sm:text-lg xl:text-xl"
            />

            <div className="flex flex-wrap justify-center gap-3 lg:justify-start">
              <Button asChild size="lg">
                <a href="/admin">{m.home_primary_cta()}</a>
              </Button>
              <Button asChild variant="outline" size="lg">
                <a href="/device">
                  {m.home_secondary_cta()}
                  <ArrowRightIcon className="size-4" />
                </a>
              </Button>
            </div>

            <HeroDitheringBadges
              className="justify-center lg:justify-start"
              techStack={signalBadges}
              renderBadge={(tech) => (
                <Badge
                  key={tech.name}
                  variant="secondary"
                  className="rounded-full border border-border/60 bg-background/70 px-3 py-1 text-xs text-foreground/80"
                >
                  {tech.name}
                </Badge>
              )}
            />
          </HeroDitheringContent>

          <HeroDitheringVisual
            className="h-[320px] lg:block lg:h-[420px] xl:h-[500px]"
            desktopClassName="border border-border/50 bg-background/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_20px_60px_-24px_rgba(15,23,42,0.45)]"
            desktopShaderProps={{
              width: 1280,
              height: 720,
              colorBack: '#020617',
              colorFront: '#38bdf8',
              shape: 'swirl',
              type: '4x4',
              size: 2,
              speed: 1,
              scale: 0.7,
            }}
          />
        </div>

        <HeroDitheringMobileVisual
          className="absolute inset-x-0 bottom-0 h-[320px] overflow-hidden lg:hidden"
          mobileShaderProps={{
            colorBack: '#00000000',
            colorFront: '#38bdf8',
            shape: 'swirl',
            size: 2,
            speed: 0.9,
            scale: 0.6,
            type: '4x4',
            style: { height: '100%', width: '100%' },
          }}
        />
      </HeroDitheringRoot>
    </main>
  )
}
