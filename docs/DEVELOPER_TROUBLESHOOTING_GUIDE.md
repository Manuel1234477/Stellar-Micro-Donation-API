# Developer Troubleshooting Guide

This guide helps new contributors diagnose and fix common setup, CI, and runtime issues when working with the Stellar Micro Donation API.

## 📋 Table of Contents

- [Quick Start Checklist](#quick-start-checklist)
- [Common Setup Issues](#common-setup-issues)
- [Environment Configuration Problems](#environment-configuration-problems)
- [CI/CD Pipeline Failures](#cicd-pipeline-failures)
- [Testing Issues](#testing-issues)
- [Runtime Problems](#runtime-problems)
- [Debugging Tips & Techniques](#debugging-tips--techniques)
- [Getting Help](#getting-help)

## 🚀 Quick Start Checklist

Before diving into issues, make sure you've completed these steps:

```bash
# 1. Clone and navigate to project
git clone <repository-url>
cd Stellar-Micro-Donation-API

# 2. Install dependencies
npm install

# 3. Copy environment template
cp .env.example .env

# 4. Start the application
npm start
```

If any of these steps fail, check the relevant section below.

---

## 🔧 Common Setup Issues

### 1. "npm install" fails

**Symptoms:**
- `npm ERR!` messages during installation
- Missing node_modules directory
- Peer dependency conflicts

**Solutions:**

```bash
# Clear npm cache
npm cache clean --force

# Remove node_modules and package-lock.json
rm -rf node_modules package-lock.json

# Reinstall dependencies
npm install

# If still failing, try with legacy peer deps
npm install --legacy-peer-deps
```

**Common Causes:**
- Outdated npm version (run `npm install -g npm@latest`)
- Network connectivity issues
- Corrupted package-lock.json file

### 2. "npm start" fails immediately

**Symptoms:**
- Application exits with error code 1
- "Configuration validation failed" message
- Missing environment variables

**Solutions:**

```bash
# 1. Check if .env file exists
ls -la .env

# 2. Copy template if missing
cp .env.example .env

# 3. Validate environment
npm run validate-env

# 4. Check required variables
grep -E "API_KEYS|PORT|NODE_ENV" .env
```

**Required Environment Variables:**
- `API_KEYS` - Comma-separated list of API keys
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (development/test/production)

### 3. Port already in use

**Symptoms:**
- `Error: listen EADDRINUSE :::3000`
- Server fails to start

**Solutions:**

```bash
# Find process using port 3000
lsof -ti:3000

# Kill the process
kill -9 $(lsof -ti:3000)

# Or use a different port
PORT=3001 npm start
```

### 4. Database/Storage Issues

**Symptoms:**
- "Database connection failed" errors
- File permission errors
- Missing data files

**Solutions:**

```bash
# Check data directory permissions
ls -la data/

# Create data directory if missing
mkdir -p data

# Set proper permissions
chmod 755 data/

# Check if JSON files exist
ls -la data/*.json
```

---

## ⚙️ Environment Configuration Problems

### 1. API Keys Configuration

**Problem:** Application won't start without API keys

**Solution:**
```bash
# Edit .env file
API_KEYS=dev_key_1234567890,dev_key_abcdef123456

# Or use database-backed keys (recommended)
npm run keys:create -- --name "Local Dev Key" --role admin
```

### 2. Stellar Network Configuration

**Problem:** Stellar network connection errors

**Solutions:**

```bash
# Use mock mode for development
MOCK_STELLAR=true

# Or specify correct network
STELLAR_NETWORK=testnet
HORIZON_URL=https://horizon-testnet.stellar.org
```

**Network Options:**
- `testnet` - Test network (recommended for development)
- `mainnet` - Production network
- `futurenet` - Future test network

### 3. Debug Mode Issues

**Problem:** Too much or too little logging

**Solution:**
```bash
# Enable debug mode for detailed logs
DEBUG_MODE=true

# Enable verbose logging
LOG_VERBOSE=true

# Enable file logging
LOG_TO_FILE=true
LOG_DIR=./logs
```

---

## 🔄 CI/CD Pipeline Failures

### 1. Test Job Failures

**Common Issues:**

#### Missing Dependencies
```bash
# Error: "Cannot find module 'sql.js'"
npm install sql.js
```

#### Test Timeouts
```bash
# Run tests with increased timeout
npm test -- --testTimeout=10000
```

#### Mock Stellar Service Issues
```bash
# Ensure mock mode is enabled in CI
export MOCK_STELLAR=true
export API_KEYS=test-key-1,test-key-2
npm test
```

### 2. Coverage Job Failures

**Symptoms:**
- Coverage below threshold (30% required)
- Coverage report generation errors

**Solutions:**

```bash
# Generate coverage locally
npm run test:coverage

# View detailed report
open coverage/lcov-report/index.html

# Check coverage thresholds
npm run check-coverage
```

**Current Coverage Requirements:**
- Branches: 30%
- Functions: 30%
- Lines: 30%
- Statements: 30%

### 3. Linting Failures

**Common Issues:**

#### ESLint Errors
```bash
# Run linting locally
npm run lint:security

# Auto-fix where possible
npm run lint:security -- --fix

# Check specific rules
npx eslint . --rule 'no-console: error'
```

#### Security Warnings
```bash
# Check for security issues
npm run lint:security

# Common fixes:
# - Remove console.log statements
# - Fix unused variables
# - Add missing semicolons
```

### 4. Security Audit Failures

**Symptoms:**
- npm audit finds vulnerabilities
- Critical/high severity issues

**Solutions:**

```bash
# Check audit results
npm audit

# Fix automatically (when possible)
npm audit fix

# Force fix (may break things)
npm audit fix --force

# Update specific packages
npm update package-name
```

---

## 🧪 Testing Issues

### 1. Jest Configuration Problems

**Symptoms:**
- "Jest encountered an unexpected token"
- Module resolution errors

**Solutions:**

```bash
# Clear Jest cache
npx jest --clearCache

# Update Jest configuration
# Check jest.config.js or package.json jest section

# Run specific test file
npx jest tests/filename.test.js
```

### 2. Test Isolation Issues

**Symptoms:**
- Tests pass individually but fail together
- State leakage between tests

**Solutions:**

```bash
# Run tests with isolation
npm test -- --runInBand

# Check test helpers
# Ensure proper cleanup in afterEach/afterAll
```

### 3. Mock Stellar Service Issues

**Symptoms:**
- "Stellar network unreachable" errors
- Transaction simulation failures

**Solutions:**

```bash
# Ensure mock mode is enabled
export MOCK_STELLAR=true

# Check mock service configuration
# Look at src/services/MockStellarService.js

# Test with real network (if needed)
export MOCK_STELLAR=false
export STELLAR_NETWORK=testnet
```

### 4. Database Test Failures

**Symptoms:**
- "Database locked" errors
- Test data conflicts

**Solutions:**

```bash
# Clean test data
rm -f data/test-*.json

# Run tests with clean environment
npm test -- --setupFilesAfterEnv=./tests/helpers/testIsolation.js
```

---

## 🏃 Runtime Problems

### 1. Server Startup Issues

**Symptoms:**
- Server starts but immediately crashes
- "Unhandled promise rejection" errors

**Debugging Steps:**

```bash
# Enable debug mode
DEBUG_MODE=true npm start

# Check startup diagnostics
# Look for "🚀 Stellar Micro Donation API starting" logs

# Check error logs
tail -f logs/app.log
```

### 2. API Request Failures

**Symptoms:**
- 401 Unauthorized errors
- 500 Internal Server Error
- Request timeouts

**Solutions:**

```bash
# Check API key authentication
curl -H "X-API-Key: your-api-key" http://localhost:3000/health

# Check server logs for errors
tail -f logs/app.log

# Test with debug mode
DEBUG_MODE=true npm start
```

### 3. Stellar Network Issues

**Symptoms:**
- Transaction failures
- Network timeout errors
- Horizon API errors

**Solutions:**

```bash
# Switch to mock mode
MOCK_STELLAR=true npm start

# Check network configuration
curl https://horizon-testnet.stellar.org/

# Test Stellar service directly
node -e "const { getStellarService } = require('./src/config/stellar'); console.log(getStellarService());"
```

### 4. Rate Limiting Issues

**Symptoms:**
- 429 Too Many Requests errors
- Requests being blocked

**Solutions:**

```bash
# Check rate limit configuration
grep -E "RATE_LIMIT" .env

# Reset rate limiter (restart server)
npm start

# Test with different API key
curl -H "X-API-Key: different-key" http://localhost:3000/api/v1/donations
```

---

## 🐛 Debugging Tips & Techniques

### 1. Enable Comprehensive Logging

```bash
# Full debug configuration
DEBUG_MODE=true
LOG_VERBOSE=true
LOG_TO_FILE=true
npm start
```

### 2. Use Node.js Debugging

```bash
# Start with Node.js debugger
node --inspect src/routes/app.js

# Or with ndb (install first: npm install -g ndb)
ndb src/routes/app.js
```

### 3. Test Individual Components

```bash
# Test configuration loading
node -e "console.log(require('./src/config'))"

# Test Stellar service
node -e "console.log(require('./src/config/stellar'))"

# Test database connection
node -e "require('./src/utils/database').initialize().then(() => console.log('DB OK'))"
```

### 4. API Testing with curl

```bash
# Health check
curl http://localhost:3000/health

# With API key
curl -H "X-API-Key: your-api-key" http://localhost:3000/api/v1/donations

# Verbose output
curl -v -H "X-API-Key: your-api-key" http://localhost:3000/api/v1/donations
```

### 5. Common Debugging Commands

```bash
# Check environment variables
env | grep -E "NODE_ENV|PORT|API_KEYS|MOCK_STELLAR"

# Check running processes
ps aux | grep node

# Check port usage
lsof -i :3000

# Check file permissions
ls -la data/ logs/

# Check recent logs
tail -n 100 logs/app.log
```

### 6. IDE Debugging Setup

**VS Code Debug Configuration (.vscode/launch.json):**
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug API",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/src/routes/app.js",
      "env": {
        "DEBUG_MODE": "true",
        "LOG_VERBOSE": "true"
      },
      "console": "integratedTerminal",
      "restart": true,
      "runtimeExecutable": "nodemon"
    }
  ]
}
```

---

## 🆘 Getting Help

### 1. Check Existing Documentation

- [README.md](../README.md) - General project information
- [API Documentation](docs/API_EXAMPLES.md) - API usage examples
- [Architecture Guide](docs/ARCHITECTURE.md) - System architecture
- [CI Pipeline Documentation](docs/CI_PIPELINE.md) - CI/CD details

### 2. Search Issues and Discussions

- Check [GitHub Issues](../../issues) for similar problems
- Search [Discussions](../../discussions) for community help
- Look at [Pull Requests](../../pulls) for recent fixes

### 3. Create a Good Issue Report

When asking for help, include:

```markdown
## Issue Description
Brief description of the problem

## Steps to Reproduce
1. Step one
2. Step two
3. Step three

## Expected Behavior
What should happen

## Actual Behavior
What actually happens

## Environment
- OS: [e.g., macOS, Ubuntu, Windows]
- Node.js version: [run `node --version`]
- npm version: [run `npm --version`]
- Branch: [e.g., main, feature-branch]

## Error Messages
```
Paste full error messages here
```

## What You've Tried
List of solutions you've attempted
```

### 4. Common Commands to Include in Issues

```bash
# System info
node --version
npm --version
git --version

# Project info
npm list --depth=0
git status
git branch

# Configuration
cat .env | grep -v "SECRET\|KEY"

# Test results
npm test 2>&1 | head -50
```

### 5. Community Resources

- **Discord/Slack**: Check project README for community links
- **Stack Overflow**: Use tags `stellar` and `nodejs`
- **Stellar Documentation**: [https://developers.stellar.org/](https://developers.stellar.org/)

---

## 📝 Quick Reference

### Environment Variables
```bash
# Required
API_KEYS=your-key-1,your-key-2
PORT=3000
NODE_ENV=development

# Optional (Common)
MOCK_STELLAR=true
DEBUG_MODE=false
LOG_VERBOSE=false
LOG_TO_FILE=false
```

### Useful npm Scripts
```bash
npm start              # Start server
npm run dev            # Start with nodemon
npm test               # Run tests
npm run test:coverage  # Run with coverage
npm run lint:security  # Run linting
npm run validate-env   # Check environment
npm run keys:create    # Create API key
```

### Common File Locations
```
.env                   # Environment variables
data/                  # JSON data files
logs/                  # Log files
src/config/           # Configuration files
src/services/         # Service layer
tests/                # Test files
```

---

## 🎯 Pro Tips

1. **Always use mock mode** for development unless specifically testing Stellar integration
2. **Check logs first** - most issues are logged with clear error messages
3. **Run tests locally** before pushing to avoid CI failures
4. **Use environment validation** to catch configuration issues early
5. **Keep .env file out of git** - never commit secrets
6. **Use the health endpoint** (`/health`) to verify server is running
7. **Check startup diagnostics** for comprehensive system status

---

*This guide is a living document. If you encounter issues not covered here, please consider contributing to improve it for future developers!*
