import { createFileRoute } from '@tanstack/react-router'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/about')({
  component: About,
})

function About() {
  return (
    <main className="mx-auto flex w-full max-w-4xl px-4 py-10 md:py-14">
      <Card className="w-full">
        <CardHeader>
          <CardDescription>{m.about_kicker()}</CardDescription>
          <CardTitle className="text-3xl">{m.about_title()}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="max-w-3xl text-sm leading-7 text-muted-foreground">
            {m.about_description()}
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
