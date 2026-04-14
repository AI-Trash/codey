# Codey

Codey is now a small TanStack Start control plane plus a TypeScript CLI for ChatGPT/OpenAI browser flows.

It preserves the original Exchange mailbox verification path, adds a pluggable verification-provider layer, and includes a built-in app-backed path for:

- Cloudflare Email Routing -> Email Worker -> TanStack Start ingest
- GitHub OAuth browser login for admins
- device-code style CLI authentication
- SSE delivery of verification codes and admin notifications to CLI daemons

## What is implemented

- Exchange verification remains available through the existing Microsoft Graph client flow
- `packages/flows` now resolves verification through a provider abstraction instead of hard-coded Exchange polling
- the TanStack Start app exposes:
  - `POST /api/verification/email-reservations`
  - `GET /api/verification/codes`
  - `GET /api/verification/events`
  - `POST /api/ingest/cloudflare-email`
  - `POST /api/device`
  - `GET|POST /api/device/{deviceCode}`
  - `GET /api/device/{deviceCode}/events`
  - `GET /api/cli/events`
- browser admin routes:
  - `/admin/login`
  - `/admin`
  - `/device`
- CLI commands:
  - `flow ...`
  - `exchange ...`
  - `auth login|status|logout|codex-login|codex-status`
  - `daemon start`
- a Cloudflare Email Worker package exists at `packages/cloudflare-email-worker`

## Requirements

- Node.js 20+
- pnpm 10+
- Patchright Chrome installed via `pnpx patchright install chrome`
- Exchange Online / Microsoft 365 if you want the legacy Exchange provider
- GitHub OAuth credentials if you want browser admin login
- Cloudflare Email Routing + Email Worker if you want the built-in app-backed provider

## Installation

```bash
pnpm install
pnpm prisma generate
pnpm prisma db push
pnpx patchright install chrome
```

## Environment

Copy `.env.example` to `.env` and fill the parts you need.

Typical local app-backed setup:

```env
DATABASE_URL=file:./prisma/dev.db
APP_BASE_URL=http://localhost:3000
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

VERIFICATION_PROVIDER=app
VERIFICATION_MAILBOX=codey@your-domain.com
CLOUDFLARE_EMAIL_WEBHOOK_SECRET=replace-with-a-long-random-secret

APP_CLI_EVENTS_PATH=/api/cli/events
APP_DEVICE_START_PATH=/api/device
APP_DEVICE_STATUS_PATH=/api/device/{deviceCode}
APP_DEVICE_EVENTS_PATH=/api/device/{deviceCode}/events
VERIFICATION_APP_BASE_URL=http://localhost:3000
VERIFICATION_APP_RESERVE_EMAIL_PATH=/api/verification/email-reservations
VERIFICATION_APP_CODE_PATH=/api/verification/codes
VERIFICATION_APP_EVENTS_PATH=/api/verification/events
```

Typical legacy Exchange setup:

```env
EXCHANGE_TENANT_ID=your-tenant-id
EXCHANGE_CLIENT_ID=your-app-client-id
EXCHANGE_CLIENT_SECRET=your-app-client-secret
EXCHANGE_MAILBOX=codey-shared@contoso.com
EXCHANGE_CATCH_ALL_PREFIX=codey
```

## Verification providers

Codey now supports two provider modes:

- `exchange` — preserve the original Exchange / Graph polling behavior
- `app` — reserve email aliases from the app and receive verification codes via app SSE / Cloudflare ingest

Resolution order:

1. explicit `VERIFICATION_PROVIDER`
2. Exchange if Exchange config is present
3. app-backed provider if app verification config is present

## Running the app

```bash
pnpm dev
```

Then open:

- `http://localhost:3000/admin/login` to sign in with GitHub
- `http://localhost:3000/admin` to inspect device challenges, notifications, reservations, and verification codes

## CLI usage

### Flow commands

```bash
pnpm --filter ./packages/flows exec jiti src/cli.ts flow chatgpt-register --verificationTimeoutMs 180000
pnpm --filter ./packages/flows exec jiti src/cli.ts flow chatgpt-login-passkey
```

### Exchange commands

```bash
pnpm --filter ./packages/flows exec jiti src/cli.ts exchange verify
pnpm --filter ./packages/flows exec jiti src/cli.ts exchange folders
pnpm --filter ./packages/flows exec jiti src/cli.ts exchange messages --maxItems 20
```

### CLI auth commands

Authenticate the CLI against the app with a device-code style flow:

```bash
pnpm --filter ./packages/flows exec jiti src/cli.ts auth login --target octocat
pnpm --filter ./packages/flows exec jiti src/cli.ts auth status
pnpm --filter ./packages/flows exec jiti src/cli.ts auth logout
```

### CLI daemon notifications

```bash
pnpm --filter ./packages/flows exec jiti src/cli.ts daemon start --target octocat
```

The daemon keeps an SSE connection to `/api/cli/events` and prints admin notifications as JSON.

### Simplified Codex OAuth flow

```bash
pnpm --filter ./packages/flows exec jiti src/cli.ts auth codex-login
pnpm --filter ./packages/flows exec jiti src/cli.ts auth codex-status
```

This uses the existing localhost callback helper and stores the resulting token under `.codey/credentials/`.

## Cloudflare Email Worker

The built-in Worker package is at `packages/cloudflare-email-worker`.

It receives Cloudflare-routed mail, signs the payload, and POSTs it to the app's `/api/ingest/cloudflare-email` endpoint.

Local development example:

```bash
pnpm --dir packages/cloudflare-email-worker dev
```

Before deploying, set:

- `CODEY_INGEST_URL`
- `CODEY_WEBHOOK_SECRET`
- optional signature/timestamp header names

The app and worker must share the same webhook secret.

## Build and validation

```bash
pnpm build
pnpm test
```

## Docker and GHCR

The root TanStack Start app can be containerized with the included `Dockerfile`.

Build locally:

```bash
docker build -t codey:local .
```

Run locally:

```bash
docker run --rm -p 3000:3000 -e DATABASE_URL=file:./prisma/dev.db codey:local
```

GitHub Actions publishing is configured in `.github/workflows/publish-ghcr.yml`.
On pushes to `main`, version tags, or manual dispatch, it builds the root app image and publishes it to:

```text
ghcr.io/<owner>/<repo>
```

The workflow uses the repository `GITHUB_TOKEN`, so the package should remain linked to the same GitHub repository for GHCR writes to succeed.

## Flow app request intake

GitHub Actions or other flow apps can request new auto-add-account coverage without an admin browser session by POSTing JSON to:

```text
POST /api/flow-app-requests
```

Use the configured API key header and JSON body:

```json
{
  "appName": "my-flow-app",
  "flowType": "chatgpt-register",
  "requestedBy": "github-actions",
  "requestedIdentity": "octocat",
  "notes": "Need an additional account for nightly registration flow"
}
```

Required environment variables:

```text
FLOW_APP_API_KEY
FLOW_APP_API_KEY_HEADER (optional, defaults to x-codey-flow-app-key)
```

## Notes

- Prisma 7 is configured via `prisma.config.ts`
- generated Prisma client output is written to `src/generated/prisma`
- SQLite is used locally by default at `prisma/dev.db`
- TanStack Router generates `src/routeTree.gen.ts` during build/dev
