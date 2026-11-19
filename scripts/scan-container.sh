#!/bin/bash
#
# Local Container Vulnerability Scanning Script
#
# This script builds the Docker image and scans it for vulnerabilities
# using Trivy. It's meant for local development testing before pushing.
#
# Usage:
#   ./scripts/scan-container.sh [OPTIONS]
#
# Options:
#   --severity <SEVERITY>   Comma-separated severity levels to report
#                          Default: CRITICAL,HIGH
#                          Options: CRITICAL,HIGH,MEDIUM,LOW,UNKNOWN
#   --format <FORMAT>       Output format: table, json, sarif
#                          Default: table
#   --output <FILE>         Output file path (optional)
#   --exit-code            Exit with code 1 if vulnerabilities found
#   --no-build             Skip building the Docker image
#   --help                 Show this help message
#
# Examples:
#   # Scan with defaults (critical + high only)
#   ./scripts/scan-container.sh
#
#   # Scan all severities
#   ./scripts/scan-container.sh --severity CRITICAL,HIGH,MEDIUM,LOW
#
#   # Scan and save JSON report
#   ./scripts/scan-container.sh --format json --output scan-results.json
#
#   # Scan and fail build on findings
#   ./scripts/scan-container.sh --exit-code
#

set -e

# Default values
SEVERITY="CRITICAL,HIGH"
FORMAT="table"
OUTPUT=""
EXIT_CODE_FLAG=""
BUILD_IMAGE=true
IMAGE_TAG="stellar-micro-donation-api:local-scan"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --severity)
      SEVERITY="$2"
      shift 2
      ;;
    --format)
      FORMAT="$2"
      shift 2
      ;;
    --output)
      OUTPUT="$2"
      shift 2
      ;;
    --exit-code)
      EXIT_CODE_FLAG="--exit-code 1"
      shift
      ;;
    --no-build)
      BUILD_IMAGE=false
      shift
      ;;
    --help)
      grep '^#' "$0" | sed 's/^# //' | sed 's/^#//'
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Container Image Vulnerability Scanner${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check if Docker is available
if ! command -v docker &> /dev/null; then
  echo -e "${RED}❌ Error: Docker is not installed or not in PATH${NC}"
  exit 1
fi

# Check if Trivy is available
if ! command -v trivy &> /dev/null; then
  echo -e "${YELLOW}⚠️  Trivy not found. Installing via Docker...${NC}"
  echo ""
  TRIVY_CMD="docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy"
else
  TRIVY_CMD="trivy"
fi

# Build the Docker image
if [ "$BUILD_IMAGE" = true ]; then
  echo -e "${BLUE}📦 Building Docker image...${NC}"
  echo -e "${BLUE}   Image: ${IMAGE_TAG}${NC}"
  echo ""
  
  if docker build -t "$IMAGE_TAG" .; then
    echo ""
    echo -e "${GREEN}✅ Docker image built successfully${NC}"
    echo ""
  else
    echo ""
    echo -e "${RED}❌ Docker build failed${NC}"
    exit 1
  fi
else
  echo -e "${YELLOW}⏭️  Skipping Docker build (--no-build flag)${NC}"
  echo ""
fi

# Run Trivy scan
echo -e "${BLUE}🔍 Running vulnerability scan...${NC}"
echo -e "${BLUE}   Severity: ${SEVERITY}${NC}"
echo -e "${BLUE}   Format: ${FORMAT}${NC}"
if [ -n "$OUTPUT" ]; then
  echo -e "${BLUE}   Output: ${OUTPUT}${NC}"
fi
echo ""

# Build Trivy command
TRIVY_COMMAND="$TRIVY_CMD image --severity $SEVERITY --format $FORMAT"

if [ -n "$OUTPUT" ]; then
  TRIVY_COMMAND="$TRIVY_COMMAND --output $OUTPUT"
fi

if [ -n "$EXIT_CODE_FLAG" ]; then
  TRIVY_COMMAND="$TRIVY_COMMAND $EXIT_CODE_FLAG"
fi

# Add allowlist if exists
if [ -f ".trivyignore" ]; then
  TRIVY_COMMAND="$TRIVY_COMMAND --ignorefile .trivyignore"
  echo -e "${YELLOW}ℹ️  Using allowlist from .trivyignore${NC}"
  echo ""
fi

# Run the scan
TRIVY_COMMAND="$TRIVY_COMMAND $IMAGE_TAG"

echo -e "${BLUE}Running: ${TRIVY_COMMAND}${NC}"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if eval "$TRIVY_COMMAND"; then
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}✅ Scan completed successfully${NC}"
  
  if [ -n "$OUTPUT" ]; then
    echo -e "${GREEN}   Report saved to: ${OUTPUT}${NC}"
  fi
  
  echo ""
  echo -e "${GREEN}No vulnerabilities found with severity: ${SEVERITY}${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  exit 0
else
  SCAN_EXIT_CODE=$?
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  
  if [ -n "$EXIT_CODE_FLAG" ]; then
    echo -e "${RED}❌ Scan failed - vulnerabilities found${NC}"
    echo ""
    echo -e "${YELLOW}Next steps:${NC}"
    echo -e "${YELLOW}  1. Review the findings above${NC}"
    echo -e "${YELLOW}  2. Update base image or dependencies${NC}"
    echo -e "${YELLOW}  3. If unfixable, add to .trivyignore with justification${NC}"
    echo -e "${YELLOW}  4. See docs/container-security.md for guidance${NC}"
  else
    echo -e "${YELLOW}⚠️  Vulnerabilities found (scan did not fail due to --exit-code not set)${NC}"
    echo ""
    echo -e "${YELLOW}To fail on findings, run with: --exit-code${NC}"
  fi
  
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  
  if [ -n "$EXIT_CODE_FLAG" ]; then
    exit $SCAN_EXIT_CODE
  else
    exit 0
  fi
fi
