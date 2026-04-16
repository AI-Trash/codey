import { createFileRoute } from "@tanstack/react-router";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card";

export const Route = createFileRoute("/admin/login")({
  component: AdminLoginPage,
});

function AdminLoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:py-14">
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_380px]">
        <Card>
          <CardHeader className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">Admin login</Badge>
              <Badge>GitHub OAuth</Badge>
            </div>
            <div className="space-y-3">
              <CardTitle className="text-4xl tracking-tight sm:text-5xl">
                Open the operator side of Codey.
              </CardTitle>
              <CardDescription className="max-w-2xl text-sm leading-7">
                Browser sign-in is the gateway to device approvals,
                verification oversight, saved identity review, and flow app
                queue management.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild>
              <a href="/auth/github?redirectTo=/admin">Continue with GitHub</a>
            </Button>
            <Button asChild variant="outline">
              <a href="/device">View device page</a>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>What you unlock</CardDescription>
            <CardTitle className="text-xl">Admin capabilities</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              {
                title: "Approve CLI device challenges",
                detail:
                  "Review pending browser handshakes and unblock flow operators quickly.",
              },
              {
                title: "Inspect verification motion",
                detail:
                  "Scan code capture, reservations, and inbound email summaries from one page.",
              },
              {
                title: "Manage account coverage",
                detail:
                  "See saved identities, config readiness, and GitHub Actions auto-add-account requests.",
              },
            ].map((item) => (
              <div key={item.title} className="space-y-1 rounded-lg border bg-muted/30 p-4">
                <p className="text-sm font-medium text-foreground">{item.title}</p>
                <p className="text-sm leading-6 text-muted-foreground">
                  {item.detail}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
