import { createFileRoute } from '@tanstack/react-router'

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { InfoTooltip } from '#/components/ui/info-tooltip'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/about')({
  component: About,
})

function About() {
  return (
    <main className="flex w-full px-4 py-10 md:px-6 md:py-14">
      <Card className="w-full">
        <CardHeader>
          <CardDescription>{m.about_kicker()}</CardDescription>
          <div className="flex items-start gap-2">
            <CardTitle className="text-3xl">{m.about_title()}</CardTitle>
            <InfoTooltip
              content={m.about_description()}
              label={m.about_title()}
              className="mt-1"
            />
          </div>
        </CardHeader>
      </Card>
    </main>
  )
}
