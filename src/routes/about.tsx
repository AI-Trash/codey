import { createFileRoute } from "@tanstack/react-router";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card";

export const Route = createFileRoute("/about")({
  component: About,
});

function About() {
  return (
    <main className="mx-auto flex w-full max-w-4xl px-4 py-10 md:py-14">
      <Card className="w-full">
        <CardHeader>
          <CardDescription>About</CardDescription>
          <CardTitle className="text-3xl">
            Codey includes a control plane backend.
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="max-w-3xl text-sm leading-7 text-muted-foreground">
            The repository preserves the existing Exchange-based flow client
            while adding the app-side primitives needed for browser GitHub
            sign-in, device-style CLI authorization, verification email
            reservations, Cloudflare email ingest, and SSE-based verification
            updates.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
