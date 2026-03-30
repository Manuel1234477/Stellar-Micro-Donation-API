# CI Testing

## Overview

All pull requests automatically run the full test suite via GitHub Actions.

## Workflow

- **Trigger**: Every PR to `main` branch
- **Test Command**: `npm test`
- **Failure Handling**: Non-zero exit code blocks merge

## Configuration

See `.github/workflows/test.yml` for workflow details.

Tests run with:
- Node.js 18
- Mock Stellar mode enabled
- Test API keys configured
