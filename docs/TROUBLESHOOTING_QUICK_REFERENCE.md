# Troubleshooting Quick Reference

**Fast fixes for common issues** - Keep this bookmarked! 🚀

## 🚨 Immediate Fixes

### Server Won't Start
```bash
# 1. Check environment
npm run validate-env

# 2. Copy .env if missing
cp .env.example .env

# 3. Kill port process
kill -9 $(lsof -ti:3000)

# 4. Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Tests Failing
```bash
# Clear Jest cache
npx jest --clearCache

# Run with mock Stellar
MOCK_STELLAR=true npm test

# Run specific test
npx jest tests/filename.test.js
```

### CI Pipeline Failed
```bash
# Linting issues
npm run lint:security -- --fix

# Security audit
npm audit fix

# Coverage check
npm run test:coverage
```

---

## 🔧 Environment Setup

### Required .env Variables
```bash
API_KEYS=dev_key_1234567890,dev_key_abcdef123456
PORT=3000
NODE_ENV=development
```

### Development Mode (Recommended)
```bash
MOCK_STELLAR=true
DEBUG_MODE=false
LOG_VERBOSE=false
```

### Full Debug Mode
```bash
MOCK_STELLAR=true
DEBUG_MODE=true
LOG_VERBOSE=true
LOG_TO_FILE=true
```

---

## 🧪 Testing Commands

```bash
npm test                    # Run all tests
npm run test:coverage      # With coverage report
npm run test:coverage:ci   # CI mode coverage
npm run check-coverage     # Verify coverage thresholds
```

### Test Specific Files
```bash
npx jest tests/api.test.js
npx jest --testNamePattern="should create donation"
```

---

## 🔍 Debugging Commands

### Check System Status
```bash
# Health check
curl http://localhost:3000/health

# With API key
curl -H "X-API-Key: your-key" http://localhost:3000/api/v1/donations

# Check logs
tail -f logs/app.log
```

### Debug Startup
```bash
# With Node.js inspector
node --inspect src/routes/app.js

# With ndb (install first)
ndb src/routes/app.js
```

### Test Components
```bash
# Configuration
node -e "console.log(require('./src/config'))"

# Database
node -e "require('./src/utils/database').initialize().then(() => console.log('DB OK'))"

# Stellar service
node -e "console.log(require('./src/config/stellar'))"
```

---

## 🔄 Common Error Solutions

| Error | Fix |
|-------|-----|
| `EADDRINUSE :::3000` | `kill -9 $(lsof -ti:3000)` |
| `API_KEYS is required` | Add `API_KEYS=dev_key_123` to `.env` |
| `Cannot find module` | `npm install` |
| `Jest encountered unexpected token` | `npx jest --clearCache` |
| `Coverage below threshold` | Add more tests or check coverage report |
| `ESLint errors` | `npm run lint:security -- --fix` |
| `npm audit vulnerabilities` | `npm audit fix` |

---

## 📁 Important Files

```
.env                    # Environment variables
data/                   # JSON data files
logs/                   # Log files
src/config/            # Configuration
src/services/          # Business logic
tests/                 # Test files
docs/                  # Documentation
```

---

## 🎯 Pro Tips

1. **Always use `MOCK_STELLAR=true`** for development
2. **Run `npm test` locally** before pushing
3. **Check `/health` endpoint** to verify server
4. **Use `DEBUG_MODE=true`** for detailed logging
5. **Never commit `.env` file** with secrets
6. **Clear Jest cache** if tests act weird
7. **Check startup diagnostics** for system status

---

## 🆘 When All Else Fails

### Reset Everything
```bash
# Fresh start
git clean -fd
rm -rf node_modules package-lock.json .env
cp .env.example .env
npm install
npm start
```

### Get Help
1. Check [full troubleshooting guide](DEVELOPER_TROUBLESHOOTING_GUIDE.md)
2. Search GitHub Issues
3. Create issue with:
   - Error messages
   - Environment details
   - Steps to reproduce

---

*Remember: Most issues are fixed with `npm install`, proper `.env` setup, or clearing cache!* 🎉
