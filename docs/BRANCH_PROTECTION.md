# Branch Protection and Merge Policy

This document describes the branch protection rules and merge requirements for the Stellar Micro-Donation API.

## Required CI Checks

The following CI checks **must pass** before a PR can be merged:

1. ✅ **Run Tests** - All test suites must pass
2. ✅ **Test Coverage** - Coverage must meet 30% threshold
3. ✅ **Code Linting** - No ESLint errors (warnings allowed)
4. ✅ **CI Status** - Aggregate status check must pass

**Optional** (informational only):
- Security Checks - Dependency audit (continues on error)

## Configuring Branch Protection

### For Repository Administrators

To enforce these rules on the `main` branch:

1. Go to **Settings** → **Branches**
2. Click **Add rule** or edit existing rule for `main`
3. Configure the following:

#### Required Settings

**Branch name pattern:** `main`

**Protect matching branches:**
- ☑ Require a pull request before merging
  - ☑ Require approvals: 1
  - ☑ Dismiss stale pull request approvals when new commits are pushed
- ☑ Require status checks to pass before merging
  - ☑ Require branches to be up to date before merging
  - **Required status checks:**
    - `Run Tests`
    - `Test Coverage`
    - `Code Linting`
    - `CI Status`
- ☑ Require conversation resolution before merging
- ☐ Require signed commits (optional)
- ☐ Require linear history (optional)
- ☑ Include administrators (recommended for consistency)

#### Optional Settings

- ☑ Allow force pushes: **Specify who can force push** → Select administrators only
- ☑ Allow deletions: **Disabled**

### For `develop` Branch

Apply the same rules to `develop` branch for consistency.

## Merge Policy

### Pull Request Requirements

Before a PR can be merged:

1. **All CI checks must pass**
   - Tests: 232+ passing
   - Coverage: ≥30% for all metrics
   - Linting: 0 errors
   - Status: All jobs successful

2. **Code review approval**
   - At least 1 approval from maintainer
   - All conversations resolved

3. **Branch up to date**
   - Must be rebased/merged with latest main
   - No merge conflicts

### Merge Methods

**Allowed merge methods:**
- ✅ **Squash and merge** (recommended) - Clean history
- ✅ **Rebase and merge** - Linear history
- ⚠️ **Merge commit** - Use sparingly

**Default:** Squash and merge

### Who Can Merge

- Repository maintainers
- Contributors with write access (after approval)
- Administrators (can override if needed)

## Bypass Procedures

### Emergency Hotfixes

In critical situations, administrators can:

1. Create hotfix branch from `main`
2. Apply minimal fix
3. Use administrator override to merge
4. Create follow-up PR for proper testing

**Note:** Document reason in PR description

### Flaky CI

If CI fails due to infrastructure issues (not code):

1. Re-run failed jobs
2. If persistent, check GitHub Status
3. Administrator can override with justification
4. Report issue to CI maintainers

## Enforcement

### What Gets Blocked

❌ PRs with failing tests  
❌ PRs below coverage threshold  
❌ PRs with linting errors  
❌ PRs without approval  
❌ PRs with unresolved conversations  

### What's Allowed

✅ PRs with warnings (up to 100)  
✅ PRs with security audit info (non-critical)  
✅ PRs from forks (after review)  

## Maintainer Responsibilities

### Code Review

- Review code quality and logic
- Verify tests cover new functionality
- Check for security issues
- Ensure documentation is updated

### CI Monitoring

- Monitor CI health and performance
- Update required checks as needed
- Fix flaky tests promptly
- Keep dependencies updated

### Merge Decisions

- Ensure PR meets all requirements
- Verify CI checks are legitimate passes
- Use squash merge for clean history
- Write clear merge commit messages

## Developer Workflow

### Before Creating PR

```bash
# Run checks locally
npm test
npm run test:coverage
npm run lint:security

# Ensure all pass
```

### After Creating PR

1. Wait for CI checks to complete
2. Address any failures
3. Request review from maintainer
4. Respond to review comments
5. Ensure branch is up to date
6. Wait for approval and merge

### If CI Fails

1. Click failed check to view logs
2. Fix the issue locally
3. Push new commit
4. CI re-runs automatically
5. Repeat until all checks pass

## Configuration Files

### GitHub Settings
- Repository → Settings → Branches → Branch protection rules

### CI Workflows
- `.github/workflows/ci.yml` - Main CI pipeline
- `.github/workflows/test.yml` - Legacy test workflow
- `.github/workflows/coverage.yml` - Legacy coverage workflow
- `.github/workflows/static-security.yml` - Legacy security workflow

**Note:** Legacy workflows can be removed once unified CI is stable.

## Monitoring

### Check CI Health

- Go to **Actions** tab
- Review recent workflow runs
- Check success rate
- Identify patterns in failures

### Metrics to Track

- CI pass rate (target: >95%)
- Average CI duration (target: <3 min)
- Time to merge (target: <24 hours)
- Number of re-runs needed

## Troubleshooting

### "Required status check is missing"

**Cause:** CI workflow didn't run or job name changed

**Fix:**
1. Re-run workflows
2. Check workflow file for job names
3. Update branch protection rules if needed

### "Branch is out of date"

**Cause:** New commits on main since PR created

**Fix:**
```bash
git checkout main
git pull
git checkout your-branch
git rebase main
git push --force-with-lease
```

### "Administrator override needed"

**Cause:** Legitimate CI failure or emergency

**Process:**
1. Document reason in PR
2. Get administrator approval
3. Use "Merge without waiting for requirements"
4. Create follow-up issue if needed

## Related Documentation

- [CI Pipeline Structure](CI_PIPELINE.md)
- [Test Coverage](TEST_COVERAGE.md)
- [Static Security Analysis](STATIC_SECURITY_ANALYSIS.md)
- [Contributing Guidelines](../CONTRIBUTING.md)

## Updates

This policy should be reviewed:
- When adding new CI checks
- After major CI changes
- Quarterly for effectiveness
- When team size changes

## Questions?

Contact repository maintainers or open a discussion in GitHub Discussions.
