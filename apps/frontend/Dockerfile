# syntax=docker/dockerfile:1
#
# Built from the REPOSITORY ROOT (the frontend compiles packages/contracts and api-client):
#   docker build -f apps/frontend/Dockerfile .
# Dockerfile.dockerignore next to this file replaces the root .dockerignore, which leaves
# apps/frontend out of the backend's context.
#
# nginx serves the static build and proxies /v1 to the backend, so the browser talks to one
# origin: cookies, CORS and the backend's Origin check work for any host name or IP.

ARG NODE_VERSION=26.13.1
ARG PNPM_VERSION=12.21.0
ARG NGINX_IMAGE=nginx:1.30.6-alpine

FROM node:${NODE_VERSION}-slim AS builder
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
# Node 25+ no longer bundles corepack.
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY apps/frontend ./apps/frontend
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @subsurf/frontend...
# "/" = same origin as the page: the API is reached through nginx at /v1.
ARG VITE_API_BASE_URL=/
RUN VITE_API_BASE_URL=${VITE_API_BASE_URL} pnpm --filter @subsurf/frontend build

FROM ${NGINX_IMAGE}
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/frontend/dist /usr/share/nginx/html
EXPOSE 80
