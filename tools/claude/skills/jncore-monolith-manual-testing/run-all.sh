#!/usr/bin/env bash
set -uo pipefail

cd "$(dirname "$0")"

if [ -z "${A2125_RUN_ID:-}" ]; then
    echo "A2125_RUN_ID is required (6-12 lowercase alphanumerics)." >&2
    exit 2
fi
export A2125_RUN_ID
export A2125_ARM="${A2125_ARM:-on}"
export A2125_OUTPUT_ROOT="${A2125_OUTPUT_ROOT:-C:/src/tmp/jncore-api1-runs}"

LOG_DIR="$A2125_OUTPUT_ROOT/$A2125_RUN_ID/logs"
mkdir -p "$LOG_DIR"

if [ "$A2125_ARM" = "on" ]; then
    LANES=(a-activities b-contact c-job d-task e-workorder f-materialorder
           g-estimate h-invoice i-files j-ar-creditmemo k-misc l-control
           m-related-objects)
else
    LANES=(l-control)
fi

echo "=============================================="
echo " ARCH-2125   run  $A2125_RUN_ID   arm  $A2125_ARM"
echo " lanes: ${#LANES[@]}"
echo "=============================================="

pids=()
for lane in "${LANES[@]}"; do
    node "lanes/$lane.mjs" > "$LOG_DIR/$lane.log" 2>&1 &
    pids+=($!)
done

fail=0
for i in "${!pids[@]}"; do
    if ! wait "${pids[$i]}"; then
        echo "lane ${LANES[$i]} exited non-zero"
        fail=1
    fi
done

for lane in "${LANES[@]}"; do
    echo "---------- $lane"
    cat "$LOG_DIR/$lane.log"
done

echo
echo "all lanes finished (fail=$fail). Settle 2 poll cycles (~2.5 min) before merging."
echo "then: A2125_RUN_ID=$A2125_RUN_ID node merge-manifests.mjs"
exit 0
