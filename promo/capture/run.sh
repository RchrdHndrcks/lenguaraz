#!/usr/bin/env bash
# Captures promo/public/*.png from the real UI: builds Lenguaraz, seeds a
# realistic transcript, runs the server with -fake on :8081 and screenshots
# every page with Playwright (npm install -D playwright; Chromium installed).
set -euo pipefail
promo="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "$promo/.." && pwd)"
data="$(mktemp -d)"
go build -C "$repo" -o "$promo/bin/" ./cmd/lenguaraz ./cmd/lenguaraz-ingest
node "$promo/capture/seed.mjs" "$data"
cd "$repo"
ADMIN_TOKEN=secreto PUBLIC_URL=https://subs.example.org "$promo/bin/lenguaraz" -fake -addr 127.0.0.1:8081 -data "$data" &
server=$!
trap 'kill $server 2>/dev/null; rm -rf "$data"' EXIT
for _ in $(seq 50); do
  curl -fs http://127.0.0.1:8081/healthz >/dev/null && break
  kill -0 $server 2>/dev/null || { echo "lenguaraz did not start (is :8081 free?)" >&2; exit 1; }
  sleep 0.2
done
node "$promo/capture/shots.mjs"
