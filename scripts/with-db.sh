#!/usr/bin/env bash
# Run a command with DATABASE_URL pointed at Cloud SQL through a local
# cloud-sql-proxy. Reuses the `database-url` secret (swapping the connector
# socket host for 127.0.0.1) so there's one source of truth for credentials.
#
#   ./scripts/with-db.sh "npm run db:push"
#   DB_CONN=proj:region:inst PROJECT=proj ./scripts/with-db.sh "npm run db:push"
#
# Requires: gcloud, cloud-sql-proxy (v2) on PATH.
#
# Two things this script is careful about, both learned the hard way:
#
#   * It discovers DB_CONN and PROJECT from gcloud when they are not passed. The
#     Makefile derives them from `tofu output`, and this config's state lives in
#     a Harness IaCM workspace — so on a machine that has not run
#     `make backend-local` those come through empty and every db target failed
#     with "set DB_CONN". Reading a database is not a reason to need a Terraform
#     backend password.
#   * It refuses to reuse a port it did not open. The old default of 5432 is
#     occupied on a dev machine (an ssh tunnel, here), so the proxy failed to
#     bind, the readiness probe saw the *other* listener and passed, and the
#     command ran against whoever was on the far end of that socket with Cloud
#     SQL credentials in hand. A migration is not something to point at a
#     surprise database.
set -euo pipefail

CMD="${1:?pass a command to run, e.g. \"npm run db:push\"}"

if ! command -v cloud-sql-proxy >/dev/null 2>&1; then
  echo "!! cloud-sql-proxy (v2) is not on PATH." >&2
  exit 1
fi

# --- What to connect to -----------------------------------------------------
# Passed in by the Makefile from Terraform outputs when it can; discovered from
# gcloud when it can't. Explicit values always win.
PROJECT="${PROJECT:-}"
DB_CONN="${DB_CONN:-}"

if [[ -z "${PROJECT}" ]]; then
  PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
  [[ "${PROJECT}" == "(unset)" ]] && PROJECT=""
  [[ -n "${PROJECT}" ]] && echo ">> PROJECT from gcloud config: ${PROJECT}"
fi
if [[ -z "${PROJECT}" ]]; then
  echo "!! No PROJECT. Pass PROJECT=<admin-project-id> or set a gcloud default." >&2
  exit 1
fi

if [[ -z "${DB_CONN}" ]]; then
  # One instance per admin project, so listing is unambiguous; if that ever
  # stops being true, say so rather than picking one. Kept to POSIX word
  # splitting rather than `mapfile`, because macOS ships bash 3.2 and this
  # script's whole job is to work on the machine in front of you.
  INSTANCES="$(
    gcloud sql instances list --project "${PROJECT}" \
      --format='value(connectionName)' 2>/dev/null || true
  )"
  COUNT="$(printf '%s' "${INSTANCES}" | grep -c . || true)"
  if [[ "${COUNT}" -eq 1 ]]; then
    DB_CONN="${INSTANCES}"
    echo ">> DB_CONN from gcloud: ${DB_CONN}"
  elif [[ "${COUNT}" -gt 1 ]]; then
    echo "!! ${PROJECT} has ${COUNT} Cloud SQL instances:" >&2
    printf '     %s\n' "${INSTANCES}" >&2
    echo "   Pass DB_CONN=project:region:instance to choose." >&2
    exit 1
  fi
fi
if [[ -z "${DB_CONN}" ]]; then
  echo "!! No DB_CONN (project:region:instance) and none found in ${PROJECT}." >&2
  exit 1
fi

# --- A port we know is ours -------------------------------------------------
# 6543 rather than 5432: the point is a port nothing else on a dev machine
# expects. Scanned upward so two of these can run at once, and never reused, so
# DATABASE_URL cannot end up addressing someone else's listener.
port_free() {
  ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

PORT="${PORT:-}"
if [[ -n "${PORT}" ]]; then
  if ! port_free "${PORT}"; then
    echo "!! Port ${PORT} is already in use, and this script will not share it." >&2
    echo "   Something else is listening there; unset PORT to pick a free one." >&2
    exit 1
  fi
else
  for candidate in $(seq 6543 6563); do
    if port_free "${candidate}"; then
      PORT="${candidate}"
      break
    fi
  done
  if [[ -z "${PORT}" ]]; then
    echo "!! No free port in 6543-6563 for the proxy." >&2
    exit 1
  fi
fi

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
READY=""
for _ in $(seq 1 30); do
  # The liveness check is not incidental: if the proxy died (bad credentials, no
  # network, revoked IAM) the loop must stop rather than run the command against
  # a port that is closed — or, worse, one that something else has since opened.
  if ! kill -0 "${PROXY_PID}" 2>/dev/null; then
    echo "!! cloud-sql-proxy exited during startup — see its output above." >&2
    exit 1
  fi
  if ! port_free "${PORT}"; then
    READY=1
    break
  fi
  sleep 1
done
if [[ -z "${READY}" ]]; then
  echo "!! Proxy never came up on :${PORT} after 30s." >&2
  exit 1
fi

echo ">> Running: ${CMD}"
eval "${CMD}"
echo ">> Done"
