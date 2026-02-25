# Coverage Quick Reference

## 🚀 Quick Commands

```bash
# Run tests with coverage
npm run test:coverage

# Check if thresholds met
npm run check-coverage

# View HTML report
open coverage/lcov-report/index.html
```

## 📊 Current Thresholds

All metrics must be ≥ **30%**:
- Branches: 30%
- Functions: 30%
- Lines: 30%
- Statements: 30%

## ✅ Pre-Commit Checklist

1. ✅ Run tests: `npm test`
2. ✅ Generate coverage: `npm run test:coverage`
3. ✅ Check thresholds: `npm run check-coverage`
4. ✅ Review uncovered code in HTML report
5. ✅ Add tests if needed
6. ✅ Commit and push

## 🔍 Understanding Coverage

- **Statements**: % of code statements executed
- **Branches**: % of if/else paths tested
- **Functions**: % of functions called
- **Lines**: % of code lines executed

## 🎯 Coverage Reports

| Format | Location | Use Case |
|--------|----------|----------|
| Text | Terminal | Quick overview |
| HTML | `coverage/lcov-report/index.html` | Detailed analysis |
| LCOV | `coverage/lcov.info` | CI/CD integration |
| JSON | `coverage/coverage-summary.json` | Programmatic access |

## 🚫 CI Enforcement

- ✅ Coverage ≥ 30%: Build passes, PR can merge
- ❌ Coverage < 30%: Build fails, PR blocked

## 📚 Full Documentation

See [Coverage Guide](docs/COVERAGE_GUIDE.md) for complete details.
