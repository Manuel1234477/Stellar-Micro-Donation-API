# Branch Protection Setup Guide

Quick reference for configuring branch protection rules.

## Required Status Checks

Add these exact names to branch protection:

```
Run Tests
Test Coverage
Code Linting
CI Status
```

## GitHub UI Steps

1. **Navigate to Settings**
   ```
   Repository → Settings → Branches
   ```

2. **Add Branch Protection Rule**
   - Branch name pattern: `main`
   - Click "Add rule"

3. **Enable Required Checks**
   - ☑ Require status checks to pass before merging
   - ☑ Require branches to be up to date before merging
   - Search and select:
     - `Run Tests`
     - `Test Coverage`
     - `Code Linting`
     - `CI Status`

4. **Enable Pull Request Requirements**
   - ☑ Require a pull request before merging
   - ☑ Require approvals: 1
   - ☑ Dismiss stale pull request approvals when new commits are pushed

5. **Additional Settings**
   - ☑ Require conversation resolution before merging
   - ☑ Include administrators (recommended)

6. **Save Changes**
   - Click "Create" or "Save changes"

7. **Repeat for `develop` Branch**
   - Follow same steps with pattern: `develop`

## Verification

After setup, create a test PR and verify:
- ✅ Cannot merge without CI passing
- ✅ Cannot merge without approval
- ✅ Status checks appear in PR

## Troubleshooting

**Status checks not appearing?**
- Ensure CI workflow has run at least once
- Check job names match exactly (case-sensitive)
- Re-run workflows if needed

**Can still merge without checks?**
- Verify "Require status checks" is enabled
- Check if you're an admin with override
- Ensure "Include administrators" is checked

## Quick Reference

| Setting | Value |
|---------|-------|
| Branch pattern | `main` |
| Required approvals | 1 |
| Required checks | 4 (test, coverage, lint, status) |
| Up to date | Yes |
| Conversations resolved | Yes |
| Include admins | Yes (recommended) |

## See Also

- [Full Branch Protection Documentation](BRANCH_PROTECTION.md)
- [CI Pipeline Structure](CI_PIPELINE.md)
