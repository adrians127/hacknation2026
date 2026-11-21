# syntax=docker/dockerfile:1
#
# Built from the REPOSITORY ROOT, not from apps/backend:
#   docker build -f apps/backend/Dockerfile .
# The build needs the workspace root (pnpm-lock.yaml, pnpm-workspace.yaml) and
# packages/contracts, which ships raw TypeScript that tsdown bundles into dist/.
#
# The same image runs migrations with the command overridden to
#   node_modules/.bin/prisma migrate deploy
# which is why the Prisma CLI and prisma/ are kept in the final stage.

ARG NODE_VERSION=26.13.1
ARG PNPM_VERSION=12.21.0

# Debian slim rather than Alpine: Prisma's engines link against glibc/OpenSSL.
FROM node:${NODE_VERSION}-slim AS base
ARG PNPM_VERSION
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
# Node 25+ no longer bundles corepack.
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /repo

FROM base AS builder
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
# Sources before install: the backend's postinstall runs `prisma generate`,
# which loads prisma.config.ts -> src/config/database-url.ts.
COPY packages/contracts ./packages/contracts
COPY apps/backend ./apps/backend
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @subsurf/backend...
RUN pnpm --filter @subsurf/backend build

FROM builder AS pruner
# No --prod: @prisma/client peer-depends on `prisma`, and the migration command needs the CLI.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm deploy --filter @subsurf/backend /out

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3001
WORKDIR /app
COPY --from=pruner --chown=node:node /out ./
# dist/ is gitignored, so `pnpm deploy` omits it.
COPY --from=builder --chown=node:node /repo/apps/backend/dist ./dist
RUN rm -f Dockerfile .oxlintrc.json tsdown.config.ts vitest.config.ts tsconfig.json \
          pnpm-lock.yaml pnpm-workspace.yaml
USER node
EXPOSE 3001
CMD ["node", "dist/index.mjs"]
