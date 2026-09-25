# Container Image Security & Vulnerability Scanning

## Overview

The Stellar Micro-Donation API implements automated container image vulnerability scanning as part of the CI/CD pipeline to detect and prevent deployment of images with known security vulnerabilities.

## Scanning Strategy

### What We Scan

The container scanning process checks for:

1. **OS Package Vulnerabilities**: Known CVEs in Alpine Linux packages
2. **Application Dependencies**: Vulnerabilities in Node.js npm packages
3. **Secrets Detection**: Accidentally embedded secrets in image layers
4. **Misconfigurations**: Container security best practices violations

### When Scans Run

Container vulnerability scans are triggered:

- **On Pull Requests**: When changes affect `Dockerfile` or `package*.json`
- **On Push to main/master**: After merge to catch any issues
- **Daily Schedule**: 2 AM UTC to detect newly-disclosed CVEs
- **Manual Trigger**: Via GitHub Actions "Run workflow" button

### Scan Tooling

We use [Trivy](https://github.com/aquasecurity/trivy) by Aqua Security:
- Industry-standard open-source scanner
- Comprehensive vulnerability database (updated daily)
- Fast, accurate, and low false-positive rate
- Native GitHub Actions integration

## Build Failure Policy

### Severity Thresholds

The build **fails** when the image contains:
- ❌ **CRITICAL** severity vulnerabilities
- ❌ **HIGH** severity vulnerabilities

The build **passes with warnings** for:
- ⚠️ **MEDIUM** severity vulnerabilities (logged but not blocking)
- ℹ️ **LOW** severity vulnerabilities (logged but not blocking)

### Rationale

This policy balances security and development velocity:
- **Critical/High**: Active exploitation risk; must be addressed before deployment
- **Medium/Low**: Lower risk; can be addressed in regular maintenance cycles

## Viewing Scan Results

### GitHub Actions Workflow

1. Navigate to the **Actions** tab in the repository
2. Select the **Container Image Vulnerability Scan** workflow
3. Click on a specific workflow run
4. Review the job summary for vulnerability counts

### Artifacts

Each scan produces three report formats:

1. **trivy-report.txt**: Human-readable table format
   - Best for: Quick review in CI logs
   - Download from workflow run artifacts

2. **trivy-results.json**: Machine-readable structured data
   - Best for: Automated processing and metrics
   - Contains full vulnerability details

3. **trivy-results.sarif**: SARIF format for GitHub Security
   - Best for: Integration with GitHub Security tab
   - Automatically uploaded to Security > Code scanning

### GitHub Security Tab

Scan results appear in:
- **Security** tab → **Code scanning** → Filter by "container-image"
- Shows detailed vulnerability information with remediation guidance

### Pull Request Comments

For PRs that trigger scans, an automated comment includes:
- Overall pass/fail status
- Vulnerability count breakdown by severity
- Links to detailed reports
- Remediation guidance

## Remediating Vulnerabilities

### Step 1: Review the Findings

Download and review the scan report:
```bash
# From the GitHub Actions workflow run artifacts
trivy-report.txt      # Human-readable summary
trivy-results.json    # Detailed JSON for analysis
```

### Step 2: Identify the Root Cause

Vulnerabilities typically originate from:

1. **Base Image**: Outdated Alpine Linux version
   ```dockerfile
   # Current
   FROM node:20-alpine@sha256:fb4cd12c...
   
   # Check for updates at: https://hub.docker.com/_/node/tags?name=alpine
   ```

2. **OS Packages**: Transitive dependencies of Node.js or tools
   - Solution: Update base image digest to newer Alpine version
   - Check Alpine security advisories: https://alpinelinux.org/

3. **Application Dependencies**: Vulnerable npm packages
   ```bash
   npm audit                    # Check for vulnerable dependencies
   npm audit fix                # Auto-fix where possible
   npm audit fix --force        # Force major version updates
   npm update                   # Update to latest compatible versions
   ```

### Step 3: Apply Fixes

#### Option A: Update Base Image

```dockerfile
# Update to latest node:20-alpine digest
# Check: docker pull node:20-alpine && docker inspect node:20-alpine | grep -A5 Digest
FROM node:20-alpine@sha256:<NEW_DIGEST>
```

#### Option B: Update Dependencies

```bash
# Update package-lock.json
npm update
npm audit fix

# Test locally
docker build -t test-image .
docker run --rm aquasec/trivy image test-image
```

#### Option C: Patch Specific Packages

For OS-level vulnerabilities not fixed by base image updates:

```dockerfile
# Add explicit package updates in Dockerfile
RUN apk upgrade --no-cache <package-name>
```

### Step 4: Verify the Fix

```bash
# Build the updated image
docker build -t stellar-micro-donation-api:test .

# Run Trivy locally
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy image stellar-micro-donation-api:test

# Or use Trivy CLI directly
trivy image stellar-micro-donation-api:test
```

### Step 5: Commit and Push

```bash
git add Dockerfile package*.json
git commit -m "fix: update base image/dependencies to address CVE-YYYY-NNNNN"
git push origin your-branch
```

The CI scan will automatically re-run and verify the fix.

## Allowlist Process (Exception Handling)

### When to Use the Allowlist

Add vulnerabilities to `.trivyignore` only when:

1. **No Fix Available**: Vendor has not released a patch
2. **False Positive**: CVE does not apply to our usage
3. **Accepted Risk**: Business decision to accept the risk (requires approval)
4. **Unfixable in Timeframe**: Fix requires major migration (temporary exception)

### Allowlist Format

Edit `.trivyignore` in the repository root:

```bash
# Format: CVE-ID  # Justification | Expiry: YYYY-MM-DD | Reviewer: Name

# Example: No fix available
CVE-2024-12345  # No patch available in Alpine 3.19; low exploitability in containerized context; monitoring vendor for fix | Expiry: 2026-12-31 | Reviewer: Security Team

# Example: False positive
CVE-2024-67890  # False positive - vulnerability in CLI tool we don't use; only affects interactive mode | Expiry: 2026-06-30 | Reviewer: DevOps Lead

# Example: Accepted risk (requires security team approval)
CVE-2024-11111  # Risk accepted - requires Node.js 22 upgrade which is not compatible with current dependencies; planned for Q2 2026 | Expiry: 2026-06-30 | Reviewer: CTO
```

### Allowlist Entry Requirements

Every entry **must** include:

1. **CVE ID**: Exact identifier (e.g., `CVE-2024-12345`)
2. **Justification**: Why it's being allowed (1-2 sentences)
3. **Expiry Date**: When to re-evaluate (format: `YYYY-MM-DD`)
4. **Reviewer**: Who approved the exception (name or role)

### Allowlist Review Process

1. **Create PR** with `.trivyignore` changes
2. **Tag Security Team** for review (if available)
3. **Document** in PR description:
   - CVE details and severity
   - Why fix is not possible
   - Risk assessment
   - Mitigation measures (if any)
4. **Get Approval** from technical lead or security team
5. **Set Reminder** for expiry date to re-evaluate

### Expiry Handling

- **Monthly Review**: Check for expired entries in `.trivyignore`
- **CI Reminder**: Consider adding a script to alert on expired entries
- **Re-evaluation**: When expiry is reached:
  - Check if a fix is now available
  - Extend expiry with new justification if still unfixable
  - Remove entry if no longer relevant

## Local Development Scanning

### Install Trivy

```bash
# macOS
brew install aquasecurity/trivy/trivy

# Linux
wget -qO - https://aquasecurity.github.io/trivy-repo/deb/public.key | sudo apt-key add -
echo "deb https://aquasecurity.github.io/trivy-repo/deb $(lsb_release -sc) main" | sudo tee /etc/apt/sources.list.d/trivy.list
sudo apt-get update
sudo apt-get install trivy

# Windows (via Chocolatey)
choco install trivy

# Or use Docker (no install required)
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy
```

### Scan Local Image

```bash
# Build your image
docker build -t stellar-micro-donation-api:local .

# Scan with Trivy
trivy image stellar-micro-donation-api:local

# Scan with severity filtering (fail on high/critical)
trivy image --severity HIGH,CRITICAL --exit-code 1 stellar-micro-donation-api:local

# Scan with output to file
trivy image --format json -o scan-results.json stellar-micro-donation-api:local

# Scan with allowlist
trivy image --ignorefile .trivyignore stellar-micro-donation-api:local
```

### Pre-commit Scanning

Consider adding a pre-commit hook to catch issues early:

```bash
#!/bin/bash
# .git/hooks/pre-commit

# Check if Dockerfile changed
if git diff --cached --name-only | grep -q "Dockerfile\|package.*\.json"; then
  echo "🔍 Running container vulnerability scan..."
  
  # Build image
  docker build -t stellar-micro-donation-api:pre-commit . || exit 1
  
  # Scan for critical/high vulnerabilities
  trivy image --severity HIGH,CRITICAL --exit-code 1 \
    --ignorefile .trivyignore \
    stellar-micro-donation-api:pre-commit
  
  if [ $? -ne 0 ]; then
    echo "❌ Container scan failed. Fix vulnerabilities before committing."
    exit 1
  fi
  
  echo "✅ Container scan passed"
fi
```

## Best Practices

### Proactive Security

1. **Pin Base Images**: Use digest-pinned base images for reproducibility
   ```dockerfile
   FROM node:20-alpine@sha256:fb4cd12c...
   ```

2. **Minimal Base Images**: Use Alpine Linux for smaller attack surface
3. **Dedicated Non-Root User**: Run the process as dedicated `appuser` (UID 1001) instead of root to minimize blast radius
4. **Read-Only Root Filesystem**: Configure container runtime with a read-only root filesystem, mounting only `/data` and `/tmp` as writable volumes (`VOLUME ["/data", "/tmp"]`)
5. **Regular Updates**: Update base image digests monthly
6. **Dependency Hygiene**: Run `npm audit` and `npm update` regularly
7. **Multi-stage Builds**: Exclude dev dependencies and build tooling from production image

### Monitoring & Alerting

1. **Daily Scans**: Catch newly-disclosed CVEs via scheduled workflow
2. **Security Alerts**: Enable GitHub Security Advisories for dependencies
3. **Dependabot**: Configure Dependabot for automated dependency updates
4. **Metrics**: Track vulnerability counts over time

### Integration with Development Workflow

1. **PR Checks**: Scans run automatically on relevant PRs
2. **Block Merges**: Branch protection rules enforce passing scans
3. **Security Tab**: Centralized visibility in GitHub Security
4. **Artifacts**: 90-day retention for compliance and audit

## Troubleshooting

### Scan Takes Too Long

- Trivy downloads vulnerability database on first run (~200MB)
- Subsequent scans use cached database
- Expected duration: 1-3 minutes per scan

### False Positives

If a CVE is incorrectly flagged:
1. Verify the vulnerability details in the NVD database
2. Check if it affects our specific usage
3. Document in `.trivyignore` with clear justification

### Scan Fails Without Vulnerabilities

Check:
- Trivy action version compatibility
- Docker image build succeeded
- Image tag is correct
- Network connectivity to vulnerability database

### Allowlist Not Working

Verify:
1. `.trivyignore` file is in repository root
2. CVE ID format is exact (e.g., `CVE-2024-12345`)
3. No extra spaces or formatting issues
4. File is committed and pushed

## Related Documentation

- [Dockerfile Security Best Practices](./docs/DOCKERFILE_SECURITY.md) (if exists)
- [Dependency Management](./docs/DEPENDENCIES.md) (if exists)
- [Security Policy](./SECURITY.md) (if exists)
- [CI/CD Pipeline](./docs/CI_CD.md) (if exists)

## References

- [Trivy Documentation](https://aquasecurity.github.io/trivy/)
- [Alpine Linux Security](https://alpinelinux.org/security/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [Docker Security Best Practices](https://docs.docker.com/develop/security-best-practices/)
- [NIST National Vulnerability Database](https://nvd.nist.gov/)

## Support

For questions or issues with container scanning:
1. Check this documentation
2. Review existing workflow runs for patterns
3. Open an issue with the `security` label
4. Tag the security team for urgent matters
