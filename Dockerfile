FROM node:22-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY drizzle.config.ts tsconfig.json tsconfig.base.json vite.config.ts ./
COPY components.json ./
COPY src ./src
COPY public ./public
COPY messages ./messages
COPY project.inlang ./project.inlang
COPY drizzle ./drizzle
COPY packages ./packages
COPY .env.example ./

RUN pnpm install --frozen-lockfile

FROM deps AS build
WORKDIR /app
RUN pnpm build
RUN tar -czf .output/public.tar.gz -C .output public && rm -rf .output/public

FROM base AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV DATABASE_URL=postgresql://codey:codey@postgres:5432/codey
ENV PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.output ./.output
COPY --from=build /app/drizzle ./drizzle
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", ".output/server/index.mjs"]
