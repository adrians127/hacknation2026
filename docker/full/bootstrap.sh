#!/bin/sh
# The `bootstrap` service of docker-compose.full.yml. Every step is idempotent.
set -eu

echo "==> pnpm db:seed (system roles, admin, demo accounts)"
pnpm run db:seed

echo "==> pnpm db:seed:hosts (demo scans of 10.40.0.0/18)"
pnpm run db:seed:hosts

if [ "${LAB_SCAN:-true}" = "true" ]; then
  echo "==> Lab scan of ${LAB_TARGET}"
  node /bootstrap/lab-scan.mjs
else
  echo "==> LAB_SCAN=${LAB_SCAN}: no lab scan queued"
fi
