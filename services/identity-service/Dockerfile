FROM node:22.22.0-bookworm-slim AS base

RUN corepack enable

WORKDIR /workspace

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/grpc-contracts/package.json packages/grpc-contracts/package.json
COPY packages/messaging-contracts/package.json packages/messaging-contracts/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY services/api-gateway/package.json services/api-gateway/package.json
COPY services/identity-service/package.json services/identity-service/package.json
COPY services/notification-service/package.json services/notification-service/package.json

RUN --mount=type=cache,id=eventa-pnpm-store,target=/pnpm/store,sharing=locked \
  --mount=type=cache,id=eventa-pnpm-cache,target=/pnpm/cache,sharing=locked \
  pnpm install --frozen-lockfile \
  --store-dir=/pnpm/store \
  --cache-dir=/pnpm/cache \
  --network-concurrency=8 \
  --fetch-retries=5 \
  --fetch-timeout=300000

FROM dependencies AS quality

COPY . .

RUN pnpm --filter @eventa/grpc-contracts build \
  && pnpm --filter @eventa/messaging-contracts build \
  && pnpm --filter @eventa/observability build \
  && pnpm --filter @eventa/identity-service lint \
  && pnpm --filter @eventa/identity-service typecheck \
  && pnpm --filter @eventa/identity-service test:unit \
  && pnpm --filter @eventa/identity-service build

FROM quality AS package

RUN --mount=type=cache,id=eventa-pnpm-store,target=/pnpm/store,sharing=locked \
  --mount=type=cache,id=eventa-pnpm-cache,target=/pnpm/cache,sharing=locked \
  pnpm --filter @eventa/identity-service --prod deploy /opt/identity-service \
  --store-dir=/pnpm/store \
  --cache-dir=/pnpm/cache \
  --network-concurrency=8 \
  --fetch-retries=5 \
  --fetch-timeout=300000

FROM node:22.22.0-bookworm-slim AS runtime

WORKDIR /app

COPY --from=package --chown=node:node /opt/identity-service ./

USER node

EXPOSE 3005 50051

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.HEALTH_PORT + '/health/ready').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "--require", "./dist/instrumentation.js", "dist/main.js"]
