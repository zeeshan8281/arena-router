# syntax=docker/dockerfile:1
# One image, two roles (conductor + worker). Deterministic build for a
# reproducible image digest (pinned lockfile via npm ci; pin the base by
# @sha256 for a bit-reproducible digest — see the comment below).
#
#   FROM node:20.18.0-bookworm-slim@sha256:<digest> AS build
#
# Conductor:  CMD is the default below (node dist/index.js)
# Worker:     override CMD at deploy -> ["node","dist/worker/index.js"]
# Both roles attest to the SAME code; the role is a runtime CMD, not a rebuild.

FROM node:20.18.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20.18.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
EXPOSE 8080
# Role selected at runtime by ROLE_PUBLIC (conductor | worker). See src/main.ts.
CMD ["node", "dist/main.js"]
