#!/bin/bash
# Publish after each county completes. Polls the sweep's manifest and republishes whenever the number
# of completed counties changes; also republishes hourly so a long county still shows progress.
# Run with: nohup tools/watch.sh >> /tmp/req2-watch.log 2>&1 &
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LAST=""
LAST_PUBLISH=0
while true; do
  DONE=$(ssh whg 'python3 -c "
import json
try:
    m = json.load(open(\"/home/whgadmin/sites/data_dumps/sweep/manifest.json\"))[\"counties\"]
    print(sum(1 for v in m.values() if v.get(\"status\") == \"done\"))
except Exception:
    print(\"?\")
"' 2>/dev/null || echo "?")
  NOW=$(date +%s)
  if [ "$DONE" != "?" ] && { [ "$DONE" != "$LAST" ] || [ $((NOW - LAST_PUBLISH)) -gt 3600 ]; }; then
    "$REPO/tools/publish.sh" && { LAST="$DONE"; LAST_PUBLISH=$NOW; }
  fi
  sleep 300
done
