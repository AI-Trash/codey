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
  - `auth login|status|logout`
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
cp .env.example .env
pnpm db:generate
pnpm db:migrate
pnpx patchright install chrome
```

## Environment

Copy `.env.example` to `.env` and fill the parts you need.

Typical local app-backed setup:

```env
DATABASE_URL=postgresql://codey:codey@localhost:5432/codey
APP_BASE_URL=http://localhost:3000
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

VERIFICATION_PROVIDER=app
VERIFICATION_MAILBOX=codey@your-domain.com
CLOUDFLARE_EMAIL_WEBHOOK_SECRET=replace-with-a-long-random-secret

CODEY_APP_BASE_URL=http://localhost:3000
CODEY_APP_CLIENT_ID=your-codey-client-id
CODEY_APP_CLIENT_SECRET=your-codey-client-secret
CODEY_APP_CLI_EVENTS_PATH=/api/cli/events
CODEY_APP_DEVICE_START_PATH=/api/device
CODEY_APP_DEVICE_STATUS_PATH=/api/device/{deviceCode}
CODEY_APP_DEVICE_EVENTS_PATH=/api/device/{deviceCode}/events
CODEY_APP_RESERVE_EMAIL_PATH=/api/verification/email-reservations
CODEY_APP_CODE_PATH=/api/verification/codes
CODEY_APP_EVENTS_PATH=/api/verification/events
```

`CODEY_APP_CLIENT_SECRET` is optional. When it is present, app-backed verification uses `client_credentials`. When it is omitted, the flow will prompt for a device-code approval and cache the resulting user session under `.codey/credentials/app-session.json`.

Managed identity summaries shown in the admin UI are stored in Postgres. Flow-local ChatGPT credential files under `.codey/credentials/` remain unchanged and are still used only by the local automation CLI.

OIDC signing keys are now managed in Postgres. The app auto-generates an initial signing key on first boot, caches the published JWKS set in memory, and rotates keys automatically. Optional tuning:

```env
OAUTH_SIGNING_KEY_ROTATION_DAYS=30
OAUTH_SIGNING_KEY_RETENTION_DAYS=7
```

`OAUTH_JWKS_JSON` is no longer required. If you already have an existing key set, you can provide it once as a migration seed and the app will import it into the database when the signing-key table is empty.

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
3. app-backed provider if `CODEY_APP_*` config is present

## Running the app

PostgreSQL is required. Codey no longer falls back to SQLite, and startup will fail fast if `DATABASE_URL` is missing or not a PostgreSQL connection string.

```bash
pnpm dev
```

For local app + database development:

```bash
docker compose up --build
```

Then open:

- `http://localhost:3000/admin/login` to sign in with GitHub
- `http://localhost:3000/admin` to inspect device challenges, notifications, reservations, and verification codes

## CLI usage

### Flow commands

```bash
pnpm --filter ./packages/flows exec jiti src/cli.ts flow chatgpt-register --verificationTimeoutMs 180000
pnpm --filter ./packages/flows exec jiti src/cli.ts flow chatgpt-login
pnpm --filter ./packages/flows exec jiti src/cli.ts flow codex-oauth --projectId gid://axonhub/project/123
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

### Codex OAuth + AxonHub channel flow

```bash
pnpm --filter ./packages/flows exec jiti src/cli.ts flow codex-oauth
```

This is a standalone flow, not a `codey auth` mode. It drives the PKCE OAuth flow in the browser, intercepts the configured redirect URI locally in-browser without starting a localhost server, stores the resulting Codex token under `.codey/credentials/`, signs in to AxonHub admin, and creates a Codex channel using `credentials.oauth`. CLI output redacts access tokens, refresh tokens, and passwords.

Built-in defaults from `axonhub` are used for Codex OAuth, so these overrides are optional:

```env
CODEX_AUTHORIZE_URL=https://auth.openai.com/oauth/authorize
CODEX_TOKEN_URL=https://auth.openai.com/oauth/token
CODEX_CLIENT_ID=app_EMoamEEZ73f0CkXaXp7hrann
CODEX_SCOPE=openid profile email offline_access
```

Required environment variables for AxonHub channel creation:

```env
AXONHUB_BASE_URL=http://localhost:8080
AXONHUB_ADMIN_EMAIL=admin@example.com
AXONHUB_ADMIN_PASSWORD=replace-with-admin-password
```

Optional environment variables:

```env
CODEX_CLIENT_SECRET=your-codex-client-secret
CODEX_REDIRECT_HOST=localhost
CODEX_REDIRECT_PORT=1455
CODEX_REDIRECT_PATH=/auth/callback
AXONHUB_PROJECT_ID=your-axonhub-project-guid
AXONHUB_GRAPHQL_PATH=/admin/graphql
CODEX_CHANNEL_NAME=Codex OAuth
CODEX_CHANNEL_BASE_URL=https://api.openai.com
CODEX_CHANNEL_TAGS=codex
CODEX_CHANNEL_SUPPORTED_MODELS=codex-mini-latest
CODEX_CHANNEL_MANUAL_MODELS=
CODEX_CHANNEL_DEFAULT_TEST_MODEL=codex-mini-latest
```

## Cloudflare Email Worker

The built-in Worker package is at `packages/cloudflare-email-worker`.

It receives Cloudflare-routed mail, signs the payload, and POSTs it to the app's `/api/ingest/cloudflare-email` endpoint.

For local development, create `packages/cloudflare-email-worker/.dev.vars` with at least:

```env
CODEY_INGEST_URL=http://localhost:3000/api/ingest/cloudflare-email
CODEY_WEBHOOK_SECRET=replace-with-the-same-secret-used-by-the-app
```

Then run:

```bash
pnpm --dir packages/cloudflare-email-worker dev
```

The app and worker must share the same webhook secret.

GitHub Actions deployment is configured in `.github/workflows/deploy-cloudflare-email-worker.yml`.
It auto-deploys on pushes to `main` when `packages/cloudflare-email-worker/**` or the workflow file itself changes, and also supports manual `workflow_dispatch` runs.

In GitHub, open `Settings -> Secrets and variables -> Actions` and add these repository secrets:

- `CLOUDFLARE_API_TOKEN`: create a Cloudflare API token from the `Edit Cloudflare Workers` template and scope it to the target account
- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account ID that owns the Worker
- `CODEY_INGEST_URL`: the full HTTPS URL for the app's `/api/ingest/cloudflare-email` endpoint
- `CODEY_WEBHOOK_SECRET`: the shared secret that must match the app's `CLOUDFLARE_EMAIL_WEBHOOK_SECRET`

The workflow syncs `CODEY_INGEST_URL` and `CODEY_WEBHOOK_SECRET` into the Worker at deploy time using Wrangler-managed secrets. `CODEY_SIGNATURE_HEADER` and `CODEY_TIMESTAMP_HEADER` keep their defaults from `wrangler.toml` unless you choose to customize them in the package config.

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
docker run --rm -p 3000:3000 -e DATABASE_URL=postgresql://codey:codey@host.docker.internal:5432/codey codey:local
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

- Drizzle Kit is configured via `drizzle.config.ts`
- generated SQL migrations live under `drizzle/`
- PostgreSQL is the only supported runtime database
- OIDC signing keys are stored in `oidc_signing_keys` and rotate automatically after bootstrapping
- TanStack Router generates `src/routeTree.gen.ts` during build/dev
