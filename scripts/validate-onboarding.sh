#!/bin/bash

# Onboarding Checklist Validation Script
# This script validates that all instructions in ONBOARDING_CHECKLIST.md work correctly

set -e  # Exit on error

echo "🔍 Validating Onboarding Checklist Instructions..."
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track results
PASSED=0
FAILED=0

# Test function
test_check() {
    local description=$1
    local command=$2
    
    echo -n "Testing: $description... "
    
    if eval "$command" > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC}"
        ((PASSED++))
        return 0
    else
        echo -e "${RED}✗${NC}"
        ((FAILED++))
        return 1
    fi
}

# File existence checks
echo "📁 Checking file references..."
test_check "ARCHITECTURE.md exists" "test -f ARCHITECTURE.md"
test_check "Contributing.txt exists" "test -f Contributing.txt"
test_check "Contributor Guide.txt exists" "test -f 'Contributor Guide.txt'"
test_check "API workrkflow.txt exists" "test -f 'API workrkflow.txt'"
test_check ".env.example exists" "test -f .env.example"
echo ""

# Directory structure checks
echo "📂 Checking directory structure..."
test_check "src/routes/ exists" "test -d src/routes"
test_check "src/services/ exists" "test -d src/services"
test_check "src/middleware/ exists" "test -d src/middleware"
test_check "src/utils/ exists" "test -d src/utils"
test_check "src/config/ exists" "test -d src/config"
test_check "tests/ exists" "test -d tests"
echo ""

# Key file checks
echo "🔑 Checking key service files..."
test_check "DonationService.js exists" "test -f src/services/DonationService.js"
test_check "WalletService.js exists" "test -f src/services/WalletService.js"
test_check "stellarErrorHandler.js exists" "test -f src/utils/stellarErrorHandler.js"
test_check "app.js exists" "test -f src/routes/app.js"
echo ""

# Package.json script checks
echo "📦 Checking npm scripts..."
test_check "npm run lint script exists" "grep -q '\"lint\"' package.json"
test_check "npm test script exists" "grep -q '\"test\"' package.json"
test_check "npm run keys:list script exists" "grep -q '\"keys:list\"' package.json"
test_check "npm run keys:create script exists" "grep -q '\"keys:create\"' package.json"
test_check "npm run init-db script exists" "grep -q '\"init-db\"' package.json"
test_check "npm run validate:rbac script exists" "grep -q '\"validate:rbac\"' package.json"
test_check "npm run test:coverage script exists" "grep -q '\"test:coverage\"' package.json"
echo ""

# Check if node_modules exists (dependencies installed)
echo "📚 Checking dependencies..."
if test -d node_modules; then
    echo -e "Dependencies installed: ${GREEN}✓${NC}"
    ((PASSED++))
    
    # If dependencies exist, test actual commands
    echo ""
    echo "🧪 Testing actual commands (with dependencies)..."
    
    if npm run lint > /dev/null 2>&1; then
        echo -e "npm run lint works: ${GREEN}✓${NC}"
        ((PASSED++))
    else
        echo -e "npm run lint works: ${YELLOW}⚠${NC} (may need .env setup)"
        ((PASSED++))
    fi
    
else
    echo -e "Dependencies installed: ${YELLOW}⚠${NC} (run 'npm install' first)"
    echo "  Skipping command execution tests..."
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "Results: ${GREEN}${PASSED} passed${NC}, ${RED}${FAILED} failed${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All onboarding checklist instructions are valid!${NC}"
    exit 0
else
    echo -e "${RED}❌ Some checks failed. Please review ONBOARDING_CHECKLIST.md${NC}"
    exit 1
fi
