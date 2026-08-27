#!/bin/sh

set -eu

startup_services='identity-migration event-migration commerce-migration notification-migration event-bus-init'
startup_containers=''
startup_failed=false

for service in $startup_services; do
  container_id="$(docker compose ps --all --quiet "$service")"

  if [ -z "$container_id" ]; then
    echo "Could not find the $service startup container." >&2
    startup_failed=true
    continue
  fi

  startup_containers="$startup_containers $container_id"
done

if [ "$startup_failed" = true ]; then
  exit 1
fi

for container_id in $startup_containers; do
  exit_code="$(docker wait "$container_id")"

  if [ "$exit_code" -ne 0 ]; then
    container_name="$(docker inspect --format '{{.Name}}' "$container_id")"
    echo "${container_name#/} failed with exit code $exit_code; keeping it for diagnosis." >&2
    startup_failed=true
  fi
done

if [ "$startup_failed" = true ]; then
  exit 1
fi

docker compose rm --force $startup_services
