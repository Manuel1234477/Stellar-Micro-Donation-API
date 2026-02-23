# Label-Based CI Enforcement

## Overview

PRs labeled with `testing` or `security` automatically trigger additional CI checks beyond the standard pipeline.

## Labels

### `testing`
Triggers extended test suite with:
- Full test execution
- Strict coverage validation
- Coverage report generation and validation

### `security`
Triggers enhanced security checks with:
- Strict dependency audit (moderate level)
- Zero-tolerance security linting (--max-warnings=0)
- Hardcoded secrets detection
- Environment variable usage validation

## Workflow Behavior

1. **Label Detection**: Automatically detects when PR is labeled/unlabeled
2. **Conditional Execution**: Runs extended checks only when relevant labels are present
3. **Strict Enforcement**: PRs fail if extended checks don't pass

## Usage

### For Contributors

Add labels when creating/updating PRs:
```bash
# Via GitHub CLI
gh pr create --label testing
gh pr create --label security

# Or add labels to existing PR
gh pr edit <PR_NUMBER> --add-label testing
```

### For Reviewers

Labels can be added through GitHub UI or CLI to trigger additional validation.

## CI Pipeline Integration

The label enforcement workflow runs alongside the standard CI pipeline:

```
Standard CI (always runs)
├── Test
├── Coverage
├── Lint
└── Security

Label-Based CI (conditional)
├── Extended Testing (if 'testing' label)
└── Extended Security (if 'security' label)
```

## Failure Scenarios

### Testing Label
- Test suite fails
- Coverage thresholds not met
- Coverage report not generated

### Security Label
- Dependencies with moderate+ vulnerabilities
- Any security linting warnings
- Hardcoded secrets detected
- Suspicious environment variable usage

## Configuration

Workflow file: `.github/workflows/label-enforcement.yml`

Modify thresholds or checks by editing the workflow file.

## Examples

### Testing PR
```yaml
# PR with testing label runs:
- npm test (full suite)
- npm run test:coverage (with validation)
- Coverage report validation
```

### Security PR
```yaml
# PR with security label runs:
- npm audit --audit-level=moderate
- npm run lint:security --max-warnings=0
- Hardcoded secrets scan
- Environment variable validation
```

## Troubleshooting

**Extended checks not running?**
- Verify label is exactly `testing` or `security` (case-sensitive)
- Check workflow run logs in Actions tab

**Checks failing unexpectedly?**
- Review specific failure in workflow logs
- Extended checks are stricter than standard CI
- Fix issues or remove label if not applicable
