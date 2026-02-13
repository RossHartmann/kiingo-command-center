#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--version" ]]; then
  echo "codex 0.27.0"
  exit 0
fi

echo "progress: preparing" >&2
sleep 0.05
echo "progress: running" >&2
sleep 0.05
echo "final result from codex"
