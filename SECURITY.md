# Security Policy

## Supported Versions

The following versions receive active security fixes. Older versions are not patched — please upgrade.

| Version | Supported |
|---------|-----------|
| 1.x (latest) | ✅ Yes |
| < 1.0 | ❌ No |

We follow semantic versioning. Security fixes are released as patch releases (e.g. `1.2.3` → `1.2.4`) and the changelog entry is labelled `security`.

---

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.** Public disclosure before a fix is available puts all users at risk.

### Private reporting channel

**Email:** `emmanuelokanandu99@gmail.com`

Use the subject line `[SECURITY] <short description>` so the message is routed correctly. If you need to send sensitive proof-of-concept material, request a PGP public key in your initial email and we will respond with one.

Alternatively, you may use **GitHub's built-in private vulnerability reporting**:  
`Security` tab → `Report a vulnerability` (requires a GitHub account).

### What to include

A useful report contains:

- A description of the vulnerability and the affected component(s)
- Steps to reproduce (curl commands, minimal code, or a recorded session)
- The potential impact (confidentiality, integrity, availability)
- Any suggested remediation or mitigations you have identified (optional but appreciated)

Proof-of-concept code that demonstrates the issue without causing lasting harm (e.g. no data deletion, no production account compromise) is welcome and speeds up triage.

---

## Response Process and SLAs

| Milestone | Target timeline |
|-----------|----------------|
| Acknowledgement of receipt | 48 hours |
| Initial severity assessment | 5 business days |
| Status update / remediation plan | 7 days |
| Patch released (Critical/High) | 14 days |
| Patch released (Medium) | 30 days |
| Patch released (Low) | 90 days |

These are targets, not guarantees. Complex issues or those requiring upstream fixes may take longer; we will communicate any delay.

When a fix is released, we will:

1. Publish a new patch version.
2. Add a `security` entry to [CHANGELOG.md](CHANGELOG.md).
3. Credit the reporter in the changelog (unless you prefer to remain anonymous).
4. Optionally coordinate a public CVE disclosure with you once the patch is widely available.

---

## Dependency Vulnerability Triage

`npm audit --audit-level=high` runs on every PR and push to `main` via [CI](.github/workflows/ci.yml) and the dedicated [Security Scan](.github/workflows/security-scan.yml). The build **fails** on any advisory rated `high` or `critical`.

Dependabot opens weekly PRs for both npm packages and GitHub Actions. Security-only patches are grouped in a single PR labelled `dependencies`.

### Dependency SLA

| Severity | Remediation target |
|----------|--------------------|
| Critical | 24 hours |
| High | 7 days |
| Medium | 30 days |
| Low | 90 days |

### Triage process

1. **Evaluate exploitability** — determine whether the vulnerable code path is reachable in this project's deployment context.
2. **Remediate or accept risk**:
   - If a patched version is available, merge the Dependabot PR (or run `npm update <pkg>`).
   - If no fix exists and the vulnerability is not exploitable in context, document the decision in [Accepted risks](#accepted-risks) and re-evaluate when a fix ships.
3. **Verify** — confirm `npm audit --audit-level=high` exits 0 before merging.

---

## Safe-Harbor Statement

We support responsible security research. If you discover a vulnerability and report it to us in good faith following this policy, we commit to:

- **Not pursuing legal action** against you for the discovery and private disclosure of the vulnerability.
- **Working with you** to understand and remediate the issue before any public disclosure.
- **Acknowledging your contribution** in the patch release (unless you prefer anonymity).

We ask that you:

- Give us a reasonable time to investigate and remediate before any public disclosure.
- Avoid accessing, modifying, or deleting user data beyond what is necessary to demonstrate the vulnerability.
- Do not perform denial-of-service attacks, social engineering, or physical security attacks.
- Do not disclose the vulnerability to third parties before the fix is released.

This is not a bug bounty program — we do not offer financial rewards at this time.

---

## Required Branch Protection

To enforce the security gate, configure the following in **Settings → Branches → Branch protection rules** for `main`:

- Enable **Require status checks to pass before merging**
- Add `security-scan` and `test` as required checks
- Enable **Dismiss stale pull request approvals when new commits are pushed**

---

## Accepted Risks

Document any accepted/deferred advisories here. Remove entries when they are resolved.

| Advisory | Package | Reason not fixed | Review date |
|----------|---------|-----------------|-------------|
| _(none)_ | | | |
