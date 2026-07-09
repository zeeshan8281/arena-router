# Build the SPA, then serve dist/ with a tiny zero-dep static server.
FROM node:20.18.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20.18.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app/dist ./dist
COPY serve.mjs ./
EXPOSE 8080
CMD ["node", "serve.mjs"]
