# Codey

Codey is now a small TanStack Start control plane plus a TypeScript terminal client for ChatGPT/OpenAI browser flows.

It preserves the original Exchange mailbox verification path, adds a pluggable verification-provider layer, and includes a built-in app-backed path for:

- Cloudflare Email Routing -> Email Worker -> TanStack Start ingest
- GitHub OAuth browser login for admins
- device-code style CLI authentication
- SSE delivery of verification codes and admin notifications to connected CLI clients

## What is implemented

- Exchange verification remains available through the existing Microsoft Graph client flow
- `packages/cli` now resolves verification through a provider abstraction instead of hard-coded Exchange polling
- the TanStack Start app exposes:
  - `POST /api/verification/email-reservations`
  - `GET /api/verification/codes`
  - `GET /api/verification/events`
  - `POST /api/ingest/cloudflare-email`
  - `POST /api/device`
  - `GET|POST /api/device/{deviceCode}`
  - `GET /api/device/{deviceCode}/events`
  - `GET /api/cli/events`
  - `GET /api/admin/cli-connections`
- browser admin routes:
  - `/admin/login`
  - `/admin`
  - `/admin/cli`
  - `/device`
  - `/admin/external-services`
  - `/admin/workspaces`
- CLI commands:
  - `flow ...`
  - `exchange ...`
  - `auth login|status|logout`
  - `prompt start`
  - `tui start` (legacy alias)
  - `daemon start` (legacy stream alias)
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
# Optional: prepend a stable prefix before the generated mailbox name
# VERIFICATION_EMAIL_PREFIX=codey
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

CLI browser flows can also use a proxy. Set `CODEY_PROXY_URL` (or standard
`HTTPS_PROXY` / `ALL_PROXY` / `HTTP_PROXY`) to force an explicit proxy for both
browser traffic and Patchright API requests such as Codex OAuth token exchange.
On Windows, Codey reads the enabled system proxy automatically when no explicit
proxy env var is present. Set `CODEY_USE_SYSTEM_PROXY=false` to disable that
fallback.

Verification mail domains are now managed in the admin console at `/admin/domains` and stored in Postgres. App-backed CLI registrations now randomly pick one enabled domain for each reserved mailbox instead of binding a domain to the OAuth client. `VERIFICATION_EMAIL_PREFIX` is optional and, when set, is prepended before the generated memorable mailbox name.

If you are upgrading from the older single-domain setup, legacy `VERIFICATION_MAILBOX` or `VERIFICATION_DOMAIN` values are only used as a compatibility seed when the database does not have any registered domains yet.

`CODEY_APP_CLIENT_SECRET` is optional. When it is present, app-backed verification uses `client_credentials`. When it is omitted, the flow will prompt for a device-code approval and cache the resulting user session under `.codey/credentials/app-session.json`.

Managed ChatGPT identities and captured session snapshots are now stored directly in Postgres so they can be shared across Codey app users and CLI runs. ChatGPT passwords are encrypted at rest with `OAUTH_CLIENT_SECRET_ENCRYPTION_KEY`. `flow chatgpt-login` and `flow codex-oauth` now resolve the latest shared identity from the app when `--identityId` / `--email` is omitted.

Invited OpenAI workspace memberships are also stored in Postgres. `flow chatgpt-invite` syncs the invited workspace ID together with the invited email addresses into Codey, and `/admin/workspaces` lets you review or edit those associations.

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
- `http://localhost:3000/admin/cli` to inspect which CLI terminals are currently connected and what flow each one is running
- `http://localhost:3000/admin/domains` to register verification domains and choose defaults
- `http://localhost:3000/admin/external-services` to manage app-backed Sub2API sync settings for dispatched CLI tasks
- `http://localhost:3000/admin/workspaces` to manage stored OpenAI workspace-to-account associations

## CLI usage

### Flow commands

```bash
pnpm flow chatgpt-register --verificationTimeoutMs 180000
pnpm flow chatgpt-login
pnpm flow chatgpt-login --chromeDefaultProfile true
pnpm flow codex-oauth --workspaceIndex 2
```

Pass `--chromeDefaultProfile true` when you want a flow to start from your local Chrome `Default` profile instead of a blank temporary session. On recent Chrome versions, Codey clones the on-disk `Default` profile into a temporary automation-only user-data directory before launch so Chrome will still honor the remote debugging pipe without attaching directly to your live profile.

Pass `--recordPageContent true` on any flow to save the final settled `page.content()` HTML under `artifacts/` as a `*-page-content.html` file. This is intended for developing new page branches after upstream UI changes.

### CLI logs

Every CLI run now writes two log files under `.codey/logs`:

- `*.log` - human-readable operational logs for quick inspection
- `*.ndjson` - structured JSON logs for deeper debugging or ingestion

By default the human log keeps `info` and above while the structured trace keeps `debug` and above. You can override them with:

```env
CODEY_LOG_LEVEL=debug
CODEY_HUMAN_LOG_LEVEL=info
```

### Exchange commands

```bash
pnpm codey exchange verify
pnpm codey exchange folders
pnpm codey exchange messages --maxItems 20
```

### App auth commands

Authenticate the terminal client against the app with a device-code style flow:

```bash
pnpm codey auth login --target octocat
pnpm codey auth status
pnpm codey auth logout
```

### Prompt CLI mode

```bash
pnpm codey
pnpm codey prompt start --target octocat
pnpm codey tui start --target octocat
```

The default `pnpm codey` entry now opens a prompt-driven CLI that connects to the Codey web app at `http://localhost:3000` unless `CODEY_APP_BASE_URL` is configured.
`prompt start` is the preferred explicit command name, while `tui start` remains available as a backward-compatible alias.
The CLI keeps an SSE connection to `/api/cli/events`, waits for tasks dispatched from `/admin/cli`, and reports its current flow back to the web app so the admin page can show what is running.
The operator shell can also start flows locally from inside the terminal: run `start`, answer the prompts, and Codey will launch the flow without waiting for `/admin/cli`.
When `CODEY_APP_CLIENT_SECRET` is configured, the CLI authenticates with `client_credentials`.
Otherwise it reuses the stored session from `pnpm codey auth login`.
If no reusable app session is available, the CLI now offers an in-terminal device-login prompt before opening the operator shell.
Inside the shell, run `help` to see the available commands. The main commands are `start`, `status`, `events`, `stop`, `reconnect`, `clear`, and `quit`. `Ctrl+C` still exits immediately.

### Legacy stream mode

```bash
pnpm codey daemon start --target octocat
```

`daemon start` still works for non-interactive terminals and keeps the same SSE worker loop, but the prompt CLI is now the preferred operator-facing mode.

### Codex OAuth session sharing flow

```bash
pnpm flow codex-oauth
pnpm flow codex-oauth --email someone@example.com
pnpm flow codex-oauth --workspaceIndex 2
```

This is a standalone flow, not a `codey auth` mode. It drives the PKCE OAuth flow in the browser, intercepts the configured redirect URI locally in-browser without starting a localhost server, and saves the resulting Codex OAuth session directly into the Codey app for sharing. CLI output redacts access tokens, refresh tokens, and passwords.

When login is required, `flow codex-oauth` can target a specific shared ChatGPT identity with `--identityId` or `--email`, following the same selection rules as `flow chatgpt-login`. If neither flag is provided, it falls back to the latest shared identity stored in the app.

If OpenAI shows the Codex workspace picker, `flow codex-oauth` now auto-selects a workspace. If OpenAI follows that with the Codex API organization picker or the consent form, the flow also auto-selects the first organization/project pair and submits the next step automatically. Use `--workspaceIndex <n>` to choose a different 1-based workspace position; if omitted, it selects the first workspace.

When the selected ChatGPT identity is linked to a stored workspace in Codey, `flow codex-oauth` now prefers that associated workspace ID automatically before falling back to `--workspaceIndex` / the first visible workspace.

When you run `flow codex-oauth --har true`, the CLI now keeps the browser open by default so the normal browser HAR is flushed when you close the browser window. Pass `--record false` if you want the browser to close automatically after the flow finishes.

When `--har true` is enabled, the browser HAR still captures the in-browser OAuth navigation, and `codex-oauth` also writes a separate `*-flow-codex-oauth-api.har` sidecar under `artifacts/` for the token exchange request made through Patchright's browser-context API client.

Built-in OpenAI defaults are used for Codex OAuth, so these overrides are optional:

```env
CODEX_AUTHORIZE_URL=https://auth.openai.com/oauth/authorize
CODEX_TOKEN_URL=https://auth.openai.com/oauth/token
CODEX_CLIENT_ID=app_EMoamEEZ73f0CkXaXp7hrann
CODEX_SCOPE=openid profile email offline_access
```

If `CODEY_APP_*` is configured, `flow codex-oauth` reuses the app-backed auth path to save the managed identity and OAuth token payload into the admin session page for sharing.

When the Sub2API integration is enabled in Codey Web, `flow codex-oauth` saves the captured Codex OAuth session back to the app and Codey Web performs the Sub2API refresh-token sync server-side. Codey writes JSON metadata into the Sub2API account `notes` field with the OpenAI workspace ID and email address, then removes any existing OpenAI OAuth accounts whose `notes` metadata has the same email and workspace ID before creating a fresh account. Accounts without that JSON metadata are not treated as duplicates. New accounts use the email address, plus the workspace ID when present, as the Sub2API account name.

When Codey creates a new Sub2API account, you can also pass default scheduler fields such as proxy, concurrency, priority, group IDs, mixed-channel confirmation, and an optional "auto-fill related models" whitelist that mirrors Sub2API's OpenAI model presets.

Configure Sub2API centrally from `/admin/external-services`. The connected CLI no longer fetches raw Sub2API credentials at runtime; Codey Web keeps the credentials on the server and performs the Sub2API sync itself after the managed Codex session is saved.

Optional environment variables:

```env
CODEX_CLIENT_SECRET=your-codex-client-secret
CODEX_REDIRECT_HOST=localhost
CODEX_REDIRECT_PORT=1455
CODEX_REDIRECT_PATH=/auth/callback
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
