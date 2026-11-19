#!/usr/bin/env bash
#
# validate-onboarding.sh
#
# Verifies the README quickstart still works.
#
# Default (static) mode, run in CI on every change:
#   - README and docs/quickstart.md pass scripts/check-docs.js
#   - every file the quickstart depends on exists
#   - every npm script the quickstart runs is defined in package.json
#
# Boot mode (--boot): also runs the quickstart commands against a real process:
#   npm run init-db, npm start, then GET /api/v1/health must return HTTP 200.
#   Requires a working install (npm ci) and uses a temporary database.
#
# Usage:
#   bash scripts/validate-onboarding.sh          # static checks
#   bash scripts/validate-onboarding.sh --boot   # static checks + live boot

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BOOT=false
if [[ "${1:-}" == "--boot" ]]; then
  BOOT=true
fi

PORT="${ONBOARDING_PORT:-3000}"
FAILED=0

pass() { printf '  \033[0;32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[0;31m✗\033[0m %s\n' "$1"; FAILED=$((FAILED + 1)); }

check_file() {
  if [[ -f "$1" ]]; then pass "$1 exists"; else fail "$1 is missing"; fi
}

check_npm_script() {
  if node -e "const s=require('./package.json').scripts||{};process.exit(s[process.argv[1]]?0:1)" "$1"; then
    pass "npm run $1 is defined"
  else
    fail "npm run $1 is not defined in package.json"
  fi
}

echo "Checking quickstart files..."
check_file README.md
check_file docs/quickstart.md
check_file .env.example
check_file docs/openapi.json
check_file examples/API_CURL_EXAMPLES.md
check_file examples/Stellar-Micro-Donation-API.postman_collection.json

echo "Checking quickstart npm scripts..."
for script in generate-key init-db validate-env keys:create check:docs; do
  check_npm_script "$script"
done

echo "Checking README and quickstart documentation..."
if node scripts/check-docs.js; then
  pass "check-docs.js passed"
else
  fail "check-docs.js reported problems"
fi

if [[ "$BOOT" == true ]]; then
  echo "Booting the quickstart (mock mode, temporary database)..."
  TMP_DIR="$(mktemp -d)"
  SERVER_PID=""
  cleanup() {
    if [[ -n "$SERVER_PID" ]]; then kill "$SERVER_PID" 2>/dev/null || true; fi
    rm -rf "$TMP_DIR"
  }
  trap cleanup EXIT

  export MOCK_STELLAR=true
  export PORT
  export DB_PATH="$TMP_DIR/onboarding.db"
  export API_KEYS="onboarding_key_$(date +%s)"
  export ENCRYPTION_KEY="${ENCRYPTION_KEY:-$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")}"

  if npm run init-db >"$TMP_DIR/init-db.log" 2>&1; then
    pass "npm run init-db succeeded"
  else
    fail "npm run init-db failed (see $TMP_DIR/init-db.log)"
    tail -n 20 "$TMP_DIR/init-db.log" || true
  fi

  npm start >"$TMP_DIR/server.log" 2>&1 &
  SERVER_PID=$!

  HEALTH_CODE=000
  for _ in $(seq 1 60); do
    HEALTH_CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${PORT}/api/v1/health" || true)"
    if [[ "$HEALTH_CODE" == "200" ]]; then break; fi
    sleep 1
  done

  if [[ "$HEALTH_CODE" == "200" ]]; then
    pass "GET /api/v1/health returned 200"
  else
    fail "GET /api/v1/health returned $HEALTH_CODE (see $TMP_DIR/server.log)"
    tail -n 30 "$TMP_DIR/server.log" || true
  fi
fi

echo ""
if [[ $FAILED -eq 0 ]]; then
  echo "All onboarding checks passed."
  exit 0
fi
echo "$FAILED onboarding check(s) failed. Update README.md or docs/quickstart.md to match."
exit 1
