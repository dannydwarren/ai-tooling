#!/usr/bin/env bash
set -uo pipefail

cd "$(dirname "$0")"

if [ -z "${A2125_RUN_ID:-}" ]; then
    echo "A2125_RUN_ID is required (6-12 lowercase alphanumerics)." >&2
    exit 2
fi
export A2125_RUN_ID
export A2125_OUTPUT_ROOT="${A2125_OUTPUT_ROOT:-C:/src/tmp/jncore-api1-runs}"

bash run-all.sh
echo "settling 150 s before merging"
sleep 150
node merge-manifests.mjs > "$A2125_OUTPUT_ROOT/$A2125_RUN_ID/logs/merge.log" 2>&1 || {
    echo "merge failed; see $A2125_OUTPUT_ROOT/$A2125_RUN_ID/logs/merge.log" >&2
    exit 1
}
python analysis/analyze-run.py "$A2125_RUN_ID"
