# AGENTS.md

## Start here

- Read [`README.md`](README.md) before changing verification providers, device-code auth, Docker, or Cloudflare worker behavior.
- This workspace has four main areas:
  - `src/`: TanStack Start app, routes, UI, shared helpers
  - `server/`: Nitro/srvx entrypoints such as the OIDC handler
  - `packages/cli/`: browser automation CLI and tests
  - `packages/cloudflare-email-worker/`: email ingest worker

## Concurrent agent changes

- If you encounter git working tree changes during a run that you did not make yourself, assume they were most likely made by another agent and ignore them unless they directly block your assigned task.

## Commands agents can rely on

- `pnpm dev` runs the app on port 3000.
- Do not attempt to start or manage the dev server unless explicitly asked by the user.
- `pnpm build` validates the web app build.
- `pnpm db:generate` and `pnpm db:migrate` manage Drizzle migrations.
- This local workspace does not have a database environment. Do not attempt to execute real Drizzle migrations in the development environment unless the user explicitly provides a database target and asks for it.
- `pnpm fmt` and `pnpm fmt:check` run `oxfmt` across the repository, respecting ignore files.
- `pnpm lint` and `pnpm lint:fix` run `oxlint` across the repository.
- Do not assume linting or formatting changes code logic; inspect diffs or test results before attributing behavior changes to `pnpm lint`, `pnpm lint:fix`, `pnpm fmt`, or `pnpm fmt:check`.
- `pnpm test` is scoped to `packages/cli`.
- If you change app code outside `packages/cli`, use `pnpm build` in addition to linting.

## Flow state machines

- Treat flow branching as a state-machine concern. Do not add new `if/else` trees in flow runners to decide between states such as email/password/verification/retry.
- Flow runners must not own next-state selection. Runners should execute the side effects for the current state or selected transition, observe the page/API result, and send that observation back to the machine as an event/input; the machine must select the next state.
- When a reusable sequence of flow states is needed, extract a state-machine fragment or child machine and compose it with `composeStateMachineConfig()` instead of wrapping the sequence in a procedural helper that hides branching, retry, or reentry logic.
- Reusing the same state set across different flows is allowed only when the state names, transition semantics, and required context fields mean the same thing in every caller. If the same labels would require different guards, retry behavior, side effects, or reporting semantics, create separate domain-specific states/fragments or parameterize the shared fragment with an explicit typed context contract.
- Encode branch selection as guarded transitions with explicit priority. When multiple transitions exist for the same event, guards must be evaluated in priority order and only the first passing transition should be selected.
- Keep guards pure. In `packages/cli`, guards should consume query results or candidate lists returned by `queries.ts`; prefer helpers such as `get*Candidates()` / `waitFor*Candidates()` over embedding DOM checks directly in mutation code.
- Keep retry and fallback bookkeeping in machine context, not in ad-hoc local variables only. This includes `retryCount`, `retryReason`, `retryFromState`, `lastAttempt`, and `lastMessage`.
- Retry states must be globally reachable from every flow state. When a branch fails in a recoverable way, emit the flow's retry event and record the fallback in context before trying the next eligible branch.
- When a flow needs to enter one of several guarded branches at runtime, use the ordered guarded-branch runner (`runGuardedBranches`) so recoverable branch-entry failures can automatically fall through to the next matching branch.
- States that may be revisited must be safe to re-enter. Prefer explicit same-state/reentry transitions and idempotent actions over recursive helper loops or one-off retry code paths.

## Package and version management

- This repo uses **pnpm workspace catalogs**.
- Keep dependency specifiers in `package.json` files as `"catalog:"`.
- Add or update real versions in [`pnpm-workspace.yaml`](pnpm-workspace.yaml) under `catalog:`.
- Do not introduce direct semver strings into package manifests unless the repo already has a deliberate exception.

## Routing and generated files

- Add pages under `src/routes/`; TanStack Router generates `src/routeTree.gen.ts`.
- Never hand-edit generated files: `src/routeTree.gen.ts`, `src/paraglide/**`, and generated output under `src/generated/**`.
- Both `#/*` and `@/*` resolve to `src/*`. Match the alias style already used in the surrounding file to keep diffs small.

## ParaglideJS and i18n

- Translation source files live in [`messages/en.json`](messages/en.json) and [`messages/zh.json`](messages/zh.json).
- Paraglide project settings live in [`project.inlang/settings.json`](project.inlang/settings.json).
- The Vite integration is configured in [`vite.config.ts`](vite.config.ts) via `paraglideVitePlugin({ project: './project.inlang', outdir: './src/paraglide', strategy: ['cookie', 'preferredLanguage', 'baseLocale'] })`.
- Keep `baseLocale` last in the strategy chain.
- Import user-facing messages from `#/paraglide/messages` and runtime helpers from `#/paraglide/runtime`.
- Reuse helpers in [`src/lib/i18n.ts`](src/lib/i18n.ts) for locale names, theme labels, and common status labels instead of duplicating translation logic.
- Do not edit `src/paraglide/**` by hand; let the Vite plugin regenerate it during normal dev/build runs.
- Any request path that needs locale resolution should go through `paraglideMiddleware`; copy the patterns in [`src/start.ts`](src/start.ts) and [`server/handlers/oidc.ts`](server/handlers/oidc.ts).

## Tables and filters

- Reuse the in-repo filtering system at [`src/components/data-table-filter/`](src/components/data-table-filter/) instead of introducing a second table-filter abstraction.
- Use the Bazza UI docs as the behavior/reference source for filterable tables: <https://ui.bazza.dev/docs/data-table-filter>.
- Treat those docs as a reference, not an install instruction: the component is already vendored in this repo.
- Prefer `createColumnConfigHelper()` from `#/components/data-table-filter/core/filters` over handwritten `ColumnConfig[]`.
- Export filter config arrays as `as const`.
- Keep filter `id()` values identical to the TanStack Table column IDs for the same table.
- Use `strategy: 'client'` only when the full dataset is already on the client. Use `strategy: 'server'` when filtering or pagination is owned by the backend.
- For `server` strategy, provide declared `options` for `option` / `multiOption` columns and faceted min/max values for `number` columns when available; do not rely on client-side inference.
- The local `DataTableFilter` component accepts a `locale` prop, but [`src/components/data-table-filter/lib/i18n.ts`](src/components/data-table-filter/lib/i18n.ts) currently only supports `'en'`. If a table UI must be localized beyond English, extend that table-filter locale layer first instead of passing unsupported locale values.
- If a view only needs a simple static table, do not force `data-table-filter` into the design.

## UI and string conventions

- Reuse existing building blocks in `src/components/ui/` before creating new primitives.
- Follow patterns in `src/components/admin/` for admin screens.
- Keep new user-facing strings translatable; avoid hardcoded English in app UI.

## Useful references

- [`README.md`](README.md) for environment variables, provider modes, CLI flows, Docker, and deployment.
- [`vite.config.ts`](vite.config.ts) and [`project.inlang/settings.json`](project.inlang/settings.json) for Paraglide setup.
- [`src/lib/i18n.ts`](src/lib/i18n.ts) for app-level translation helpers.
- [`src/components/data-table-filter/`](src/components/data-table-filter/) for the local table-filter implementation.
