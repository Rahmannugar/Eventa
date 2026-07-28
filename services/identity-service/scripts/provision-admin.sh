#!/bin/sh

set -eu

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo "Usage: pnpm admin:provision:identity <admin-email>" >&2
  exit 1
fi

admin_email=$1

docker compose exec -T identity-database \
  psql -U eventa_identity -d eventa_identity \
  -v "admin_email=$admin_email" \
  < services/identity-service/scripts/provision-admin.sql
