# AGENTS.md

## Start here

- Read [`README.md`](README.md) before changing verification providers, device-code auth, Docker, or Cloudflare worker behavior.
- This workspace has four main areas:
  - `src/`: TanStack Start app, routes, UI, shared helpers
  - `server/`: Nitro/srvx entrypoints such as the OIDC handler
  - `packages/flows/`: browser automation CLI and tests
  - `packages/cloudflare-email-worker/`: email ingest worker

## Commands agents can rely on

- `pnpm dev` runs the app on port 3000.
- `pnpm build` validates the web app build.
- `pnpm db:generate` and `pnpm db:migrate` manage Drizzle migrations.
- `pnpm test`, `pnpm lint`, `pnpm fmt`, and `pnpm fmt:check` are scoped to `packages/flows`.
- If you change app code outside `packages/flows`, use `pnpm build` plus editor diagnostics; there is no separate root lint task for the app.

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
