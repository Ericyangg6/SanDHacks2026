#!/usr/bin/env bash
# Full ingest, in order. Every fetch is cached and versioned, so re-runs are cheap and show what changed.
#   ./ingest/run-all.sh            normal run (uses cache)
#   ./ingest/run-all.sh --refresh  re-fetch live pages to detect changes (multi-time scrape)
set -euo pipefail
cd "$(dirname "$0")/.."
R="${1:-}"
run() { echo; echo "▶ $1"; shift; node --env-file=.env "$@" 2>&1 | grep -v -i -E "warning|reparsing|trace-warn|add \"type\""; }

run "official county Cool Zones layer"   ingest/official-arcgis.ts
run "official pages + PDF list"          ingest/official.ts 60
run "Google Maps sites (adds to earlier runs)" ingest/maps.ts
run "each Maps site's own website"       ingest/fetch-maps-sites.ts 400 $R
EXTRACT_PROVIDER="${EXTRACT_PROVIDER:-claude}" run "extract hours + access (verbatim-quote checked)" ingest/extract.ts
run "cross-check sources"                ingest/merge.ts
run "build seed (sorted, geocoded)"      ingest/to-seed.ts
run "load into Neon branch"              ingest/load-neon.ts
