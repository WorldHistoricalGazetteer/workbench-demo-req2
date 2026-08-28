#!/bin/bash
# Publish after each county completes, and say so loudly if the sweep stops.
#
# The first version of this watched only the count of completed counties and republished hourly
# regardless. When the sweep died at 23:00 it went on publishing identical data until morning,
# reporting success every hour while nothing whatever was happening. Monitoring that cannot
# distinguish "no news" from "no pulse" is worse than none, so this tracks the readings total and
# shouts when it stops moving.
#
# Run with: nohup tools/watch.sh >> /tmp/req2-watch.log 2>&1 &
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
POLL=300
STALL_AFTER=1800          # seconds without a new reading before this is a problem
LAST_STATE=""
LAST_CHANGE=$(date +%s)
WARNED=0

while true; do
  STATE=$(ssh whg 'python3 -c "
import glob, json
try:
    m = json.load(open(\"/home/whgadmin/sites/data_dumps/sweep/manifest.json\"))[\"counties\"]
    done = sum(1 for v in m.values() if v.get(\"status\") == \"done\")
except Exception:
    done = 0
n = sum(1 for f in glob.glob(\"/home/whgadmin/sites/data_dumps/sweep/*.jsonl\") for _ in open(f))
alive = 1 if __import__(\"os\").popen(\"pgrep -cf sweep_tmp.py\").read().strip() not in (\"\", \"0\") else 0
print(f\"{done} {n} {alive}\")
"' 2>/dev/null) || STATE=""

  NOW=$(date +%s)
  if [ -n "$STATE" ]; then
    read -r DONE READINGS ALIVE <<< "$STATE"
    if [ "$STATE" != "$LAST_STATE" ]; then
      LAST_CHANGE=$NOW; WARNED=0
      "$REPO/tools/publish.sh"
      LAST_STATE="$STATE"
    elif [ $((NOW - LAST_CHANGE)) -gt $STALL_AFTER ] && [ "$WARNED" = "0" ]; then
      echo "$(date +%H:%M) *** STALLED: $READINGS readings, unchanged for $(( (NOW-LAST_CHANGE)/60 )) min ***"
      echo "    check: ssh whg 'tail -20 /home/whgadmin/sites/data_dumps/sweep.log'"
      WARNED=1
    fi
  else
    echo "$(date +%H:%M) could not reach the server"
  fi
  sleep $POLL
done
