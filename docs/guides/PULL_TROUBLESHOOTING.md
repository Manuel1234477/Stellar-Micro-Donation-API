# Git Pull Troubleshooting Guide

## If you cannot pull from the repository, try these steps:

### 1. Check your current status
```bash
git status
```

### 2. Check which branch you're on
```bash
git branch
```

### 3. If you have uncommitted changes, stash them
```bash
git stash
git pull origin main
git stash pop
```

### 4. If you're on a different branch, switch to main
```bash
git checkout main
git pull origin main
```

### 5. If there are merge conflicts
```bash
git fetch origin
git reset --hard origin/main
```
**Warning:** This will discard all local changes!

### 6. If authentication fails
Make sure you have:
- Valid GitHub credentials
- Personal Access Token (if using HTTPS)
- SSH key configured (if using SSH)

### 7. Force fetch and reset
```bash
git fetch --all
git reset --hard origin/main
```

### 8. Check remote URL
```bash
git remote -v
```
Should show: `https://github.com/darcszn/Stellar-Micro-Donation-API.git`

### 9. Re-add remote if needed
```bash
git remote remove origin
git remote add origin https://github.com/darcszn/Stellar-Micro-Donation-API.git
git pull origin main
```

## Current Repository State

The main branch now includes:
- Network selection via environment variables
- Network presets for testnet, mainnet, futurenet
- NETWORK_SWITCHING.md documentation

Latest commit: `Merge feature/analytics-fee-calculation into main`
