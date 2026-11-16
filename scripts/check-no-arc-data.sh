#!/usr/bin/env bash
# Fails if a real Arc data file is tracked. Test fixtures must carry "__synthetic": true.
set -euo pipefail
bad=0
while IFS= read -r f; do
  case "$f" in *Storable*.json|*.arcmigrate) echo "Real Arc file name tracked: $f"; bad=1; continue;; esac
  if grep -q '"firebaseSyncState"\|"sidebarSyncState"' "$f" && ! grep -q '"__synthetic": *true' "$f"; then
    echo "Arc-like data without \"__synthetic\": true marker: $f"; bad=1
  fi
done < <(git ls-files '*.json' '*.arcmigrate')
exit $bad
