#!/bin/bash
# Rebuild the map's data from the sweep on the WHG server and publish it, if anything changed.
# Idempotent: a no-op when no new readings have landed since the last run.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TMP="${TMPDIR:-/tmp}/req2-sweep"
mkdir -p "$TMP"
( cd "$TMP" && ssh whg 'cd /home/whgadmin/sites/data_dumps/sweep && tar cz .' | tar xz )
cd "$REPO"
python3 tools/build_data.py "$TMP" data
if git diff --quiet -- data; then
  echo "$(date +%H:%M) no change"
  exit 0
fi
SUMMARY=$(python3 -c "
import json
d = json.load(open('data/places.json')); t = d['totals']
print(f\"{d['counties']} counties · {len(d['places'])} places · {t['mentions']} mentions\")")
git add data
git -c user.name="Stephen Gadd" -c user.email="42514781+docuracy@users.noreply.github.com" \
  commit -q -m "Data: ${SUMMARY}

Rebuilt from the sweep. Counties are read in a farthest-point order from Essex, so coverage spreads
across England and Wales as it goes rather than creeping outwards from one corner.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push -q origin main
echo "$(date +%H:%M) published — ${SUMMARY}"
