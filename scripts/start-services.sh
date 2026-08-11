#!/bin/sh

set -eu

build_mode="${1:-}"

case "$build_mode" in
  --build | --no-build) ;;
  *)
    echo 'Usage: scripts/start-services.sh --build|--no-build' >&2
    exit 2
    ;;
esac

# Warm the two heavyweight brokers independently before the remaining local
# stack competes for CPU. Both commands wait for their real listener probes.
COMPOSE_PARALLEL_LIMIT=1 docker compose up -d --no-build --wait --wait-timeout 360 event-bus
COMPOSE_PARALLEL_LIMIT=1 docker compose up -d --no-build --wait --wait-timeout 360 job-queue

COMPOSE_PARALLEL_LIMIT=2 docker compose up -d "$build_mode"
pnpm services:cleanup
