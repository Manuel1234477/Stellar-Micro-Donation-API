# 🚀 New Contributor Onboarding Checklist

Welcome to Stella! This checklist will help you get productive quickly. Follow these steps in order.

---

## ✅ Prerequisites: Initial Setup

Before diving into the code, complete these setup steps:

### 1. Install Dependencies
```bash
npm install                # Install all project dependencies
```

### 2. Configure Environment
```bash
cp .env.example .env       # Create your local environment file
```

Edit `.env` and set at minimum:
- `STELLAR_NETWORK=testnet` (for safe testing)
- `API_KEYS=dev_key_1234567890` (or generate your own)
- `PORT=3000`

### 3. Initialize Database
```bash
npm run init-db            # Set up local SQLite database
```

### 4. Verify Setup
```bash
npm run lint               # Should complete without errors
npm test                   # Run test suite (should pass)
npm run keys:list          # Verify API key management works
```

If any command fails, check that:
- Node.js v18+ is installed: `node --version`
- Dependencies installed successfully
- `.env` file exists with required variables

---

## ✅ Day 1: Understand the Codebase

### Repository Structure
- [ ] Read [ARCHITECTURE.md](ARCHITECTURE.md) - understand the 3-layer design (API → Service → Stellar)
- [ ] Explore `src/` directory structure:
  - `routes/` - API endpoints (your entry points)
  - `services/` - Stellar blockchain logic (the core)
  - `middleware/` - Auth, validation, rate limiting
  - `utils/` - Helpers and validators
  - `config/` - Network settings and constants

### Key Concepts
- [ ] Review [Contributor Guide.txt](Contributor%20Guide.txt) - API workflow (Initialize → Sign → Submit)
- [ ] Understand we use **Stellar Testnet** for development (never real funds)
- [ ] Note: We follow stateless design - no private keys are stored

---

## ✅ Day 2: Local Development

### Test the API Locally
```bash
npm start                  # Start the API server (Ctrl+C to stop)
# In another terminal:
curl http://localhost:3000/health  # Should return status with database check
```

### Make Your First Change
- [ ] Pick a "good first issue" from GitHub (look for `good-first-issue` label)
- [ ] Create a feature branch: `git checkout -b feat/your-feature-name`
- [ ] Common areas for contributions:
  - **Wallet APIs** (`src/services/WalletService.js`) - balance queries, key encryption
  - **Donation APIs** (`src/services/DonationService.js`) - recurring donations, metadata
  - **Middleware** (`src/middleware/`) - security, validation improvements

---

## ✅ Day 3: Development Workflow

### Before You Code
1. [ ] Check existing tests in `tests/` to understand expected behavior
2. [ ] Review related files in `src/services/` for business logic patterns
3. [ ] Use Stellar Laboratory (https://laboratory.stellar.org) to test transactions manually

### While Coding
- [ ] Follow the data flow: Route → Controller → Service → Stellar SDK
- [ ] Never put Stellar SDK calls in controllers (keep them in services)
- [ ] Use environment variables from `.env` (never hardcode secrets)

### Before Submitting PR
```bash
npm run lint              # Fix any linting issues
npm test                  # Ensure all tests pass
npm run test:coverage     # Check coverage (aim for >80%)
```

---

## 📚 Essential Resources

### Documentation
- [ARCHITECTURE.md](ARCHITECTURE.md) - System design and data flow
- [Contributing.txt](Contributing.txt) - Setup and contribution guidelines
- [Contributor Guide.txt](Contributor%20Guide.txt) - API technical specs
- [API workrkflow.txt](API%20workrkflow.txt) - Detailed API workflows (note: filename has typo)

### External Links
- [Stellar SDK Docs](https://stellar.github.io/js-stellar-sdk/) - Official SDK reference
- [Stellar Laboratory](https://laboratory.stellar.org) - Test transactions visually
- [Horizon API Docs](https://developers.stellar.org/api) - Blockchain query reference

### Common Commands
```bash
npm run dev               # Start with auto-reload
npm run keys:create       # Generate new API key
npm run init-db           # Initialize database
npm run validate:rbac     # Check permission configs
```

---

## 🎯 Your First PR Checklist

- [ ] Branch name follows convention: `feat/`, `fix/`, or `docs/`
- [ ] Code passes `npm run lint`
- [ ] Tests pass with `npm test`
- [ ] PR description links to issue: "Closes #42"
- [ ] Changes are focused (one feature/fix per PR)
- [ ] No secrets or private keys in code

---

## 💡 Pro Tips

1. **Stuck on Stellar errors?** Check `src/utils/stellarErrorHandler.js` for common error translations
2. **Need test data?** Use Friendbot to fund test accounts: https://laboratory.stellar.org/#account-creator
3. **Understanding middleware flow?** Add console.logs in `src/middleware/logger.js` temporarily
4. **Want to see live transactions?** Check Stellar Expert: https://stellar.expert/explorer/testnet

---

## 🧪 Validate Your Setup

Run this script to verify all onboarding instructions work:

```bash
bash scripts/validate-onboarding.sh
```

This checks:
- All documentation files exist
- Directory structure is correct
- Key service files are present
- npm scripts are configured
- Dependencies are installed (if applicable)

---

## 🤝 Getting Help

- **Questions?** Open a GitHub Discussion or comment on your issue
- **Found a bug?** Check if it's already reported in Issues
- **Security concern?** Email the maintainers (see Contributing.txt)

---

**Ready to contribute?** Pick an issue, create a branch, and start coding! 🎉
