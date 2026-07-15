FROM node:22.22.0-alpine AS base

RUN corepack enable

WORKDIR /workspace

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/grpc-contracts/package.json packages/grpc-contracts/package.json
COPY services/api-gateway/package.json services/api-gateway/package.json

RUN pnpm install --frozen-lockfile

FROM dependencies AS quality

COPY . .

RUN pnpm --filter @eventa/grpc-contracts build \
  && pnpm --filter @eventa/api-gateway lint \
  && pnpm --filter @eventa/api-gateway typecheck \
  && pnpm --filter @eventa/api-gateway test \
  && pnpm --filter @eventa/api-gateway build

FROM quality AS package

RUN pnpm --filter @eventa/api-gateway --prod deploy /opt/api-gateway

FROM node:22.22.0-alpine AS runtime

WORKDIR /app

COPY --from=package --chown=node:node /opt/api-gateway ./

USER node

EXPOSE 3004

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health/live').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "dist/main.js"]
