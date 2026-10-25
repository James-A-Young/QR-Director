# syntax=docker/dockerfile:1.7
# Single container: Fastify API + redirector + built React UI.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY server server
COPY web web
RUN npm run build

# Production dependencies for the server only.
FROM node:${NODE_VERSION}-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --workspace server --include-workspace-root=false --no-audit --no-fund \
  && npm cache clean --force

FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    WEB_DIST_DIR=/app/web/dist
WORKDIR /app
COPY --from=prod-deps --chown=65532:65532 /app/node_modules ./node_modules
COPY --from=prod-deps --chown=65532:65532 /app/server/node_modules ./server/node_modules
COPY --chown=65532:65532 package.json ./
COPY --chown=65532:65532 server/package.json server/
COPY --from=build --chown=65532:65532 /app/server/dist ./server/dist
COPY --from=build --chown=65532:65532 /app/web/dist ./web/dist
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["server/dist/index.js"]
