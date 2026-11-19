# File Size and Complexity Budget

## Overview

To maintain code readability, testability, and performance, this project enforces a soft lint budget on file size. Files should remain focused and decomposed into logical modules.

## Budget Limits

| Metric | Limit | Level | Notes |
|--------|-------|-------|-------|
| File Lines | 1000 | Warn | Includes code only (blank lines and comments excluded) |
| Cyclomatic Complexity | (future) | Warn | Complexity budget planned for v2 |

## Rationale

**Why 1000 lines?**

- Files over 1000 lines become harder to read and navigate in most editors
- Testing a 1000+ line file is challenging; it usually indicates multiple concerns mixed
- Review quality degrades; reviewers can't fully reason about such files
- Maintenance burden increases for future changes

**Why warn, not error?**

- A hard error would block all work on large files that are being decomposed
- Warnings keep the issue visible without breaking CI
- The grandfathered allowlist shrinks as decomposition issues land
- Allows case-by-case judgment for genuine exceptions

## Current Grandfathered Files

These files exceed the limit but are in the process of being decomposed. As related issues are closed, entries here should be removed:

```
src/services/DonationService.js (1878 lines) - Issue #1212
src/services/RecurringDonationScheduler.js (1010 lines) - Issue #1211
src/routes/admin/featureFlags.js (696 lines) - Below limit, kept for reference
src/routes/admin/geoRules.js (874 lines) - Below limit; absorbed geoBlocking.js (#1778)
```

## Enforcing the Budget

**For new files:**
- Keep all new files under 1000 lines
- If you need more, decompose into separate modules
- Place related utilities in a shared module or service

**For existing files exceeding the budget:**
- Create a child GitHub issue to track decomposition
- Use `// eslint-disable-next-line max-lines` only for transient violations during refactoring
- Add the file to `GRANDFATHERED_LARGE_FILES` in `.eslintrc.js` while decomposition is in progress
- Remove the entry when decomposition is complete

**For warnings in CI:**
- Lint warnings are informational; CI does not fail on them
- Treat as tech debt to address in the next refactor cycle
- Add to backlog if the file is a hotspot or frequently changing

## Decomposition Checklist

When breaking up a large file:

1. Identify logical modules or capabilities within the file
2. Create a focused issue (e.g., "Decompose DonationService capability: X")
3. Extract related functions/classes into a separate file (e.g., `ServiceX.js`)
4. Update imports in the original file to re-export from the new module
5. Run tests to ensure functionality is preserved
6. Remove the re-export once all callers are updated
7. Remove the file from `GRANDFATHERED_LARGE_FILES` in `.eslintrc.js`

## Example Decomposition

**Before:**
```
src/services/DonationService.js (1878 lines)
  - Donation creation
  - Donation validation
  - Donation state machine
  - Export/reporting
```

**After:**
```
src/services/donation/
  ├── DonationService.js (400 lines) - Core orchestration
  ├── DonationValidator.js (300 lines) - Validation logic
  ├── DonationStateMachine.js (250 lines) - State transitions
  └── DonationExporter.js (200 lines) - Export/reporting
```

## Monitoring

**To check file sizes:**
```bash
# Show all files and their line counts
find src -name '*.js' -exec wc -l {} + | sort -rn | head -20

# Show only files over limit
find src -name '*.js' -exec wc -l {} + | awk '$1 > 1000 { print $0 }'
```

**To run the linter:**
```bash
npm run lint

# Check for max-lines violations specifically
npm run lint -- --rule "max-lines: [warn, {max: 1000}]" src/
```

## Future Enhancements

- **Cyclomatic Complexity**: Add complexity budget when needed
- **Function Length**: Warn on functions over 50 lines (future)
- **Import Depth**: Warn on deep module hierarchies (future)

## Related Issues

- #1211: Split MockStellarService
- #1212: Decompose DonationService
- #1213: Decompose wallet route
- #1214: Decompose donation route
- #1221: Standardize logging
- #1222: Enforce file size budget (this issue)
