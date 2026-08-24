#!/usr/bin/env bash
# Install / print a system crontab line for the automation script.
# Reads AUTOMATION_CRON (and optional AUTOMATION_CRON_TZ notes) from backend/.env
#
# Usage:
#   ./scripts/install-automation-crontab.sh           # print crontab line
#   ./scripts/install-automation-crontab.sh --install # append to user crontab
#   ./scripts/install-automation-crontab.sh --run-now # run automation once

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$BACKEND_ROOT/.env"
LOG_DIR="${AUTOMATION_LOG_DIR:-$BACKEND_ROOT/logs}"
LOG_FILE="$LOG_DIR/automation-cron.log"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing .env at $ENV_FILE" >&2
  exit 1
fi

# Load only AUTOMATION_* keys from .env (ignore comments / blanks).
while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    ''|\#*) continue ;;
  esac
  if [[ "$line" =~ ^AUTOMATION_[A-Za-z0-9_]+= ]]; then
    key="${line%%=*}"
    value="${line#*=}"
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    export "$key=$value"
  fi
done < "$ENV_FILE"

CRON_EXPR="${AUTOMATION_CRON:-}"
if [[ -z "$CRON_EXPR" ]]; then
  echo 'AUTOMATION_CRON is empty. Add e.g. AUTOMATION_CRON="0 2 * * *" to .env' >&2
  exit 1
fi

NODE_BIN="$(command -v node || true)"
NPM_BIN="$(command -v npm || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "node not found in PATH" >&2
  exit 1
fi

mkdir -p "$LOG_DIR"

# Prefer npm run so package imports / cwd match local scripts.
if [[ -n "$NPM_BIN" ]]; then
  RUN_CMD="cd \"$BACKEND_ROOT\" && \"$NPM_BIN\" run automation >> \"$LOG_FILE\" 2>&1"
else
  RUN_CMD="cd \"$BACKEND_ROOT\" && \"$NODE_BIN\" automation/automation.js >> \"$LOG_FILE\" 2>&1"
fi

CRON_LINE="$CRON_EXPR $RUN_CMD"

print_line() {
  echo "# Navi automation — schedule from AUTOMATION_CRON in .env"
  if [[ -n "${AUTOMATION_CRON_TZ:-}" ]]; then
    echo "# Note: system crontab uses server local time. AUTOMATION_CRON_TZ=${AUTOMATION_CRON_TZ}"
    echo "# For timezone-aware scheduling prefer: npm run automation:cron"
  fi
  echo "$CRON_LINE"
}

install_line() {
  local existing
  existing="$(crontab -l 2>/dev/null || true)"
  if echo "$existing" | grep -F "automation/automation.js" >/dev/null 2>&1 || \
     echo "$existing" | grep -F "npm run automation" >/dev/null 2>&1; then
    echo "An automation crontab entry already exists. Current crontab:" >&2
    echo "$existing" >&2
    exit 1
  fi

  {
    echo "$existing"
    echo ""
    print_line
  } | crontab -
  echo "Installed crontab entry:"
  print_line
}

run_now() {
  echo "Running automation once..."
  cd "$BACKEND_ROOT"
  if [[ -n "$NPM_BIN" ]]; then
    "$NPM_BIN" run automation
  else
    "$NODE_BIN" automation/automation.js
  fi
}

case "${1:-}" in
  --install)
    install_line
    ;;
  --run-now)
    run_now
    ;;
  ""|--print)
    print_line
    ;;
  *)
    echo "Usage: $0 [--print|--install|--run-now]" >&2
    exit 1
    ;;
esac
