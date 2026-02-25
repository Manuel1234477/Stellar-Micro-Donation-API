# Merge Order for Feature Branches

## Issue Resolution Order

These three PRs should be merged in the following order to avoid conflicts:

### 1. PR #240 - Centralized Configuration (feature/centralized-config-240)
**Merge First**
- Creates `src/config/index.js` - centralized configuration module
- Modifies multiple files to use centralized config
- Base for other changes

### 2. PR #241 - Single Responsibility Controllers (feature/single-responsibility-controllers-241)
**Merge Second**
- Creates service layer (DonationService, WalletService, StatsService)
- Refactors controllers to be thin orchestration layers
- Depends on #240's centralized config

### 3. PR #242 - Remove Legacy Code (feature/remove-legacy-code-242)
**Merge Last**
- Deletes `src/config/envValidation.js` (replaced by #240's centralized config)
- Removes unused stellar service modules
- Removes dead code and unused functions
- Depends on both #240 and #241

## Conflict Resolution

If merged in order, conflicts will be minimal:

1. After #240 merges: #241 and #242 may need rebasing
2. After #241 merges: #242 may need rebasing
3. #242 should merge cleanly after #240 and #241

## Alternative: Rebase Strategy

If PRs are already created, you can:

1. Merge #240 to main
2. Rebase #241 on main: `git rebase origin/main`
3. Merge #241 to main
4. Rebase #242 on main: `git rebase origin/main`
5. Merge #242 to main

## Files with Potential Conflicts

- `src/config/envValidation.js` - Deleted in #242 (this is intentional, not a conflict)
- `src/routes/donation.js` - Modified in #241, may conflict with #242
- `src/routes/stats.js` - Modified in #241, may conflict with #242
- `src/routes/wallet.js` - Modified in #241, may conflict with #242
- `src/config/index.js` - Created in #240, modified in #242

## Note on envValidation.js "Conflict"

GitHub shows `src/config/envValidation.js` as a conflict because:
- Main branch has this file
- PR #242 deletes this file

This is **NOT a real conflict** - it's the intended behavior. The file is obsolete and should be deleted. When #242 merges, the file will be properly removed from main.

## Recommendation

**Merge in order: #240 → #241 → #242**

This ensures each PR builds on the previous one's changes and minimizes conflicts.
