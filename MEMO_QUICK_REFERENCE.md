# Memo Feature - Quick Reference

## TL;DR

Transactions can now include an optional memo (max 28 bytes). Empty memos are valid.

## Quick Commands

```bash
# Run migration
npm run migrate:memo

# Test implementation
npm run test:memo

# Check code quality
npm run lint
```

## API Usage

### With Memo
```bash
curl -X POST http://localhost:3000/donations \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: unique-key-123" \
  -d '{
    "amount": 10.0,
    "recipient": "GBBD47UZ...",
    "memo": "For education"
  }'
```

### Without Memo
```bash
curl -X POST http://localhost:3000/donations \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: unique-key-124" \
  -d '{
    "amount": 10.0,
    "recipient": "GBBD47UZ..."
  }'
```

## Validation Rules

| Rule | Value |
|------|-------|
| Max Length | 28 bytes |
| Type | String (UTF-8) |
| Required | No (optional) |
| Null Bytes | Not allowed |
| Whitespace | Trimmed |

## Error Codes

| Code | Meaning |
|------|---------|
| `MEMO_TOO_LONG` | Exceeds 28 bytes |
| `INVALID_MEMO_TYPE` | Not a string |
| `INVALID_MEMO_CONTENT` | Contains null bytes |

## Files Changed

### New Files
- `src/utils/memoValidator.js`
- `src/scripts/addMemoColumn.js`
- `tests/memo-validation.test.js`
- `tests/memo-integration.test.js`
- `test-memo-feature.js`

### Modified Files
- `src/routes/donation.js`
- `src/services/MockStellarService.js`
- `src/services/StellarService.js`
- `src/routes/models/transaction.js`
- `src/scripts/initDB.js`
- `package.json`

## Database Change

```sql
ALTER TABLE transactions ADD COLUMN memo TEXT;
```

## Security

✅ SQL injection prevention (parameterized queries)
✅ XSS prevention (JSON encoding)
✅ Input validation (length, type, content)
✅ Input sanitization (trim, remove null bytes)

## Testing

All tests passing ✅

```
npm run test:memo
```

## Documentation

- **Feature**: [MEMO_FEATURE.md](./MEMO_FEATURE.md)
- **Security**: [MEMO_SECURITY.md](./MEMO_SECURITY.md)
- **Deployment**: [MEMO_DEPLOYMENT.md](./MEMO_DEPLOYMENT.md)
- **Summary**: [MEMO_IMPLEMENTATION_SUMMARY.md](./MEMO_IMPLEMENTATION_SUMMARY.md)

## Production Ready

✅ All acceptance criteria met
✅ Security measures implemented
✅ Tests passing
✅ Documentation complete
✅ CI/CD configured

## Need Help?

See full documentation in [MEMO_FEATURE.md](./MEMO_FEATURE.md)
