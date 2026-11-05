#!/usr/bin/env bash
set -uo pipefail

cd "$(dirname "$0")"

if [ -z "${DM_RUN_ID:-}" ]; then
    echo "DM_RUN_ID is required (6-12 lowercase alphanumerics)." >&2
    exit 2
fi
export DM_RUN_ID
export DM_OUTPUT_ROOT="${DM_OUTPUT_ROOT:-C:/src/tmp/dotnet-api2-runs}"

LOG_DIR="$DM_OUTPUT_ROOT/$DM_RUN_ID/logs"
mkdir -p "$LOG_DIR"

LANES=(a-retired b-auth c-tasks-shares d-hydration e-deprecation f-edits g-creates)

echo "dotnet-monolith API2   run $DM_RUN_ID   lanes ${#LANES[@]}"

pids=()
for lane in "${LANES[@]}"; do
    node "lanes/$lane.mjs" > "$LOG_DIR/$lane.log" 2>&1 &
    pids+=($!)
done

for i in "${!pids[@]}"; do
    wait "${pids[$i]}" || echo "lane ${LANES[$i]} exited non-zero"
done

for lane in "${LANES[@]}"; do
    echo "---------- $lane"
    cat "$LOG_DIR/$lane.log"
done

node merge.mjs
