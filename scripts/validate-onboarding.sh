#!/usr/bin/env bash
#
# Onboarding validation (#1977)
#
# Verifies that the commands and files a new contributor is told to use in
# CONTRIBUTING.md exist and work. CI runs this on a fresh checkout after
# `npm ci`, migrations and a mock-mode boot (see .github/workflows/ci.yml).
#
# Environment:
#   ONBOARDING_HEALTH_URL  If set, GET this URL and require HTTP 200 (e.g.
#                          http://localhost:3000/health). When unset the health
#                          check is skipped, so the script also runs locally
#                          without a running server.

set -u

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

PASSED=0
FAILED=0

check() {
  local description=$1
  shift
  if "$@" > /dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} $description"
    PASSED=$((PASSED + 1))
  else
    echo -e "  ${RED}✗${NC} $description"
    FAILED=$((FAILED + 1))
  fi
}

has_npm_script() {
  node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts['$1'] ? 0 : 1)"
}

echo "Files referenced by CONTRIBUTING.md"
for f in CONTRIBUTING.md README.md .env.example package.json \
         src/app.js src/services/DonationService.js src/services/WalletService.js \
         src/utils/stellarErrorHandler.js scripts/validate-rbac.js; do
  check "$f exists" test -f "$f"
done

echo "Directory layout"
for d in src/routes src/services src/middleware src/utils src/config tests; do
  check "$d/ exists" test -d "$d"
done

echo "npm scripts named in CONTRIBUTING.md"
for s in test test:coverage lint validate-env init-db generate-key keys:list keys:create validate:rbac check:parse migrate:check; do
  check "npm run $s is defined" has_npm_script "$s"
done

echo "Dependencies"
check "node_modules installed (npm ci)" test -d node_modules

if [ -n "${ONBOARDING_HEALTH_URL:-}" ]; then
  echo "Running server"
  check "GET $ONBOARDING_HEALTH_URL returns 200" \
    bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 '$ONBOARDING_HEALTH_URL')\" = 200 ]"
else
  echo "Running server: skipped (set ONBOARDING_HEALTH_URL to check /health)"
fi

echo ""
echo "Results: ${PASSED} passed, ${FAILED} failed"

if [ "$FAILED" -eq 0 ]; then
  echo -e "${GREEN}All onboarding checks passed.${NC}"
  exit 0
fi
echo -e "${RED}Onboarding checks failed. Review CONTRIBUTING.md and the items above.${NC}"
exit 1
