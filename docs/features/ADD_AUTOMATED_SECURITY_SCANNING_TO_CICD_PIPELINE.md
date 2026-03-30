# Automated Security Scanning in CI/CD Pipeline

This document describes the automated security scanning features implemented in the CI/CD pipeline for the Stellar-Micro-Donation-API project. The pipeline has been designed to detect vulnerabilities, secrets, and code manipulation prior to any merge event to ensure the continued security of the platform.

## Features

### 1. Dependency Auditing (`npm audit`)
- **Tool:** natively integrated via Node package manager.
- **Configured Action:** Detects dependency vulnerabilities in `package.json` tree map.
- **Threshold:** The pipeline is strictly configured to **fail** upon detecting any "High" or "Critical" level vulnerabilities.
- **Local Run:** `npm audit --audit-level=high`

### 2. Static Application Security Testing (SAST)
- **Tool:** `eslint-plugin-security`
- **Configured Action:** Automatically scans JavaScript code for known insecure patterns (e.g. `eval`, unsafe regex expressions, non-literal `require`).
- **Local Run:** `npm run lint:security`

### 3. Secrets Scanning
- **Tool:** `Gitleaks` (via GitHub Actions `gitleaks-action@v2`) and local `eslint-plugin-no-secrets`.
- **Configured Action:** Blocks pushes/PRs if it detects AWS credentials, GitHub tokens, Stellar secure keys, and other hardcoded secret structures in the commit history or staged code.
- **Local Run:** `npm run security:scan` will execute local linter regex.

### 4. Dependency Updates via Dependabot
- **File:** `.github/dependabot.yml`
- **Configured Action:** Dependabot automatically checks for new versions of npm packages and GitHub actions weekly, minimizing the exposure window to zero-days by creating automatic update PRs.

### 5. Automated PR Commenting
- When a scan fails, the CI action will post a conspicuous comment directly onto the GitHub Pull Request notifying the reviewer and author regarding the unmitigated security vulnerability.

## Utilities

A custom Node script (`src/scripts/security-scan.js`) is provided to run all internal static security checks locally and can be invoked with:
```bash
npm run security:scan
```
This utility produces process failure modes aligning exactly with those interpreted by the GitHub Actions pipeline.

## Testing Security Components
Tests have been included with > 95% coverage ensuring the wrapper behaves under both clean operations and failing edge scenarios. The `add-automated-security-scanning-to-cicd-pipeline.test.js` exercises these paths heavily, specifically targeting parsing capabilities and the CI pass/failure output matching.
