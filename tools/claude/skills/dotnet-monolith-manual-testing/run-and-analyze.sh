#!/usr/bin/env bash
set -uo pipefail

cd "$(dirname "$0")"

bash run-all.sh || exit $?
python analysis/analyze-run.py "$DM_RUN_ID"
