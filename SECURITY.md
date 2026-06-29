# Security Policy

## Reporting a Vulnerability

Do **not** open a public GitHub issue for security vulnerabilities. Instead, email **emmanuelokanandu99@gmail.com** with:

- A description of the vulnerability and affected component
- Steps to reproduce
- Potential impact

You will receive an acknowledgement within **48 hours** and a status update within **7 days**.

---

## Dependency Vulnerability Triage

`npm audit --audit-level=high` runs on every PR and push to `main` via [CI](.github/workflows/ci.yml) and the dedicated [Security Scan](.github/workflows/security-scan.yml). The build **fails** on any advisory rated `high` or `critical`.

Dependabot opens weekly PRs for both npm packages and GitHub Actions. Security-only patches are grouped in a single PR labelled `dependencies`.

### SLA

| Severity | Remediation target |
|----------|--------------------|
| Critical | 24 hours           |
| High     | 7 days             |
| Medium   | 30 days            |
| Low      | 90 days            |

### Triage process

1. **Evaluate exploitability** — determine whether the vulnerable code path is reachable in this project's deployment context.
2. **Remediate or accept risk**:
   - If a patched version is available, merge the Dependabot PR (or run `npm update <pkg>`).
   - If no fix exists and the vulnerability is not exploitable in context, document the decision below in [Accepted risks](#accepted-risks) and re-evaluate when a fix ships.
3. **Verify** — confirm `npm audit --audit-level=high` exits 0 before merging.

### Suppressing a false positive

If a finding is a confirmed false positive or the vulnerable code path is unreachable, add an override to `.npmrc`:

```
# Example: audit suppression is not natively supported by npm audit.
# Use `npm audit --json | node scripts/filter-audit.js` with a local
# allowlist file, or upgrade to a version where the advisory is resolved.
```

Alternatively, pin the dependency to a safe version in `package.json` and add a comment explaining why.

---

## Required branch protection

To enforce the security gate, configure the following in **Settings → Branches → Branch protection rules** for `main`:

- Enable **Require status checks to pass before merging**
- Add `security-scan` and `test` as required checks
- Enable **Dismiss stale pull request approvals when new commits are pushed**

---

## Accepted risks

Document any accepted/deferred advisories here. Remove entries when they are resolved.

| Advisory | Package | Reason not fixed | Review date |
|----------|---------|-----------------|-------------|
| _(none)_ | | | |
