#!/usr/bin/env bash
# Run a command with DATABASE_URL pointed at Cloud SQL through a local
# cloud-sql-proxy. Reuses the `database-url` secret (swapping the connector
# socket host for 127.0.0.1) so there's one source of truth for credentials.
#
#   DB_CONN=proj:region:inst PROJECT=proj ./scripts/with-db.sh "npm run db:push"
#
# Requires: gcloud, cloud-sql-proxy (v2) on PATH.
set -euo pipefail

: "${DB_CONN:?set DB_CONN (project:region:instance)}"
: "${PROJECT:?set PROJECT (admin project id)}"
CMD="${1:?pass a command to run, e.g. \"npm run db:push\"}"
PORT="${PORT:-5432}"

echo ">> Fetching database credentials from Secret Manager"
SECRET="$(gcloud secrets versions access latest --secret=database-url --project "$PROJECT")"
CREDS="$(printf '%s' "$SECRET" | sed -E 's#^postgresql://([^@]+)@.*#\1#')"
DBNAME="$(printf '%s' "$SECRET" | sed -E 's#.*/([^/?]+)\?.*#\1#')"
export DATABASE_URL="postgresql://${CREDS}@127.0.0.1:${PORT}/${DBNAME}"

echo ">> Starting cloud-sql-proxy for ${DB_CONN} on :${PORT}"
cloud-sql-proxy --port "${PORT}" "${DB_CONN}" &
PROXY_PID=$!
trap 'kill "${PROXY_PID}" 2>/dev/null || true' EXIT

echo ">> Waiting for proxy..."
for _ in $(seq 1 30); do
  if (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null; then
    exec 3>&- 3<&-
    break
  fi
  sleep 1
done

echo ">> Running: ${CMD}"
eval "${CMD}"
echo ">> Done"
