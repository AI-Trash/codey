FROM node:20-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma.config.ts tsconfig.json tsconfig.base.json vite.config.ts ./
COPY components.json ./
COPY src ./src
COPY public ./public
COPY messages ./messages
COPY project.inlang ./project.inlang
COPY prisma ./prisma
COPY packages ./packages
COPY .env.example ./

RUN pnpm install --frozen-lockfile

FROM deps AS build
WORKDIR /app
RUN pnpm prisma:generate && pnpm build

FROM base AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV DATABASE_URL=file:./prisma/dev.db
ENV PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.output ./.output
COPY --from=build /app/src/generated ./src/generated
COPY --from=build /app/prisma ./prisma
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
