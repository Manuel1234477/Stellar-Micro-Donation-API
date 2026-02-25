# Package Lock File Sync Issue

## Problem
The CI is failing with:
```
npm ci can only install packages when your package.json and package-lock.json are in sync
Missing: uuid@9.0.1 from lock file
```

## Root Cause
The `package-lock.json` file is out of sync with `package.json`. The lock file references `uuid@9.0.1` which is not in `package.json`.

## Solution
Run these commands locally to regenerate the lock file:

```bash
# Remove the old lock file
rm package-lock.json

# Remove node_modules (optional but recommended)
rm -rf node_modules

# Regenerate lock file
npm install

# Commit the new lock file
git add package-lock.json
git commit -m "fix: regenerate package-lock.json to sync with package.json"
git push
```

## Alternative (if you have node_modules)
```bash
npm install --package-lock-only
git add package-lock.json
git commit -m "fix: update package-lock.json"
git push
```

This will create a fresh `package-lock.json` that matches the current `package.json`.
