#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--version" ]]; then
  echo "claude 0.31.1"
  exit 0
fi

echo "{\"type\":\"progress\",\"message\":\"planning\"}"
sleep 0.05
echo "{\"type\":\"final\",\"message\":\"done\"}"
