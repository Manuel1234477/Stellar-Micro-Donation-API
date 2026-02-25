# Input Sanitization Flow Diagram

## Request Flow with Sanitization

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Request                             │
│  POST /donations { memo: "test\nmemo", donor: "user<script>" }  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Express Middleware                            │
│  • API Key Validation                                            │
│  • Rate Limiting                                                 │
│  • RBAC Permission Check                                         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Route Handler                                 │
│  src/routes/donation.js                                          │
│                                                                  │
│  1. Extract user input                                           │
│     const { memo, donor, recipient } = req.body                  │
│                                                                  │
│  2. Type validation                                              │
│     if (typeof memo !== 'string') return error                   │
│                                                                  │
│  3. ⚡ SANITIZATION ⚡                                            │
│     const sanitizedMemo = sanitizeMemo(memo)                     │
│     const sanitizedDonor = sanitizeIdentifier(donor)             │
│     const sanitizedRecipient = sanitizeIdentifier(recipient)     │
│                                                                  │
│     Before: "test\nmemo"     → After: "testmemo"                 │
│     Before: "user<script>"   → After: "userscript"               │
│                                                                  │
│  4. Business logic validation                                    │
│     • Amount limits                                              │
│     • Daily limits                                               │
│     • Memo length (28 bytes)                                     │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Logging (with sanitization)                   │
│  src/utils/log.js                                                │
│                                                                  │
│  log.info('DONATION', 'Processing', {                            │
│    memo: sanitizedMemo,      // Already sanitized                │
│    donor: sanitizedDonor     // Already sanitized                │
│  })                                                              │
│                                                                  │
│  Additional sanitization in log.js:                              │
│  • sanitizeForLogging() applied to all metadata                  │
│  • Control characters removed from scope/message                 │
│                                                                  │
│  Output: [2024-01-01] [INFO] [DONATION] Processing {...}         │
│  ✅ No log injection possible                                    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Database Storage                              │
│  Transaction.create({                                            │
│    memo: sanitizedMemo,          // "testmemo"                   │
│    donor: sanitizedDonor,        // "userscript"                 │
│    recipient: sanitizedRecipient // "GXXX..."                    │
│  })                                                              │
│                                                                  │
│  ✅ Only sanitized data stored                                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Response to User                              │
│  {                                                               │
│    "success": true,                                              │
│    "data": {                                                     │
│      "memo": "testmemo",        // Sanitized                     │
│      "donor": "userscript"      // Sanitized                     │
│    }                                                             │
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘
```

## Sanitization Utility Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    src/utils/sanitizer.js                        │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐     │
│  │  sanitizeText(input, options)                          │     │
│  │  • Core sanitization function                          │     │
│  │  • Configurable options                                │     │
│  │  • Used by all other functions                         │     │
│  └────────────────────────────────────────────────────────┘     │
│                           │                                      │
│                           ▼                                      │
│  ┌─────────────────┬──────────────┬──────────────┬─────────┐    │
│  │                 │              │              │         │    │
│  ▼                 ▼              ▼              ▼         ▼    │
│  sanitizeMemo()   sanitizeLabel() sanitizeName() sanitize  sanitize │
│  • 28 bytes       • 100 chars    • 100 chars    Identifier ForLogging │
│  • No control     • No control   • No control   • Strict   • Recursive │
│  • For Stellar    • For labels   • For names    • Alphanum • For logs │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Field-Specific Sanitization Rules

```
┌──────────────────────────────────────────────────────────────────┐
│                        User Input Fields                          │
└──────────────────────────────────────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ Donation     │    │ Wallet       │    │ Logging      │
│ Fields       │    │ Fields       │    │ Data         │
├──────────────┤    ├──────────────┤    ├──────────────┤
│ • memo       │    │ • label      │    │ • Any object │
│ • donor      │    │ • ownerName  │    │ • Any array  │
│ • recipient  │    │              │    │ • Any string │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │
       ▼                   ▼                   ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ sanitizeMemo │    │ sanitizeLabel│    │ sanitizeFor  │
│ sanitize     │    │ sanitizeName │    │ Logging      │
│ Identifier   │    │              │    │              │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │
       └───────────────────┴───────────────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │ Sanitized Data  │
                  │ • No \0         │
                  │ • No \n         │
                  │ • No \x01-\x1F  │
                  │ • No ANSI codes │
                  │ • Trimmed       │
                  └─────────────────┘
```

## Attack Prevention Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      Attack Attempts                             │
└─────────────────────────────────────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ Log          │    │ Null Byte    │    │ ANSI Escape  │
│ Injection    │    │ Injection    │    │ Code         │
├──────────────┤    ├──────────────┤    ├──────────────┤
│ Input:       │    │ Input:       │    │ Input:       │
│ "user\n      │    │ "safe\x00    │    │ "\x1B[31m    │
│ [ERROR]      │    │ malicious"   │    │ Red\x1B[0m"  │
│ Fake log"    │    │              │    │              │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │
       ▼                   ▼                   ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ Remove \n    │    │ Remove \x00  │    │ Remove \x1B  │
│ and control  │    │ null bytes   │    │ escape codes │
│ characters   │    │              │    │              │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │
       └───────────────────┴───────────────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │ Safe Output     │
                  ├─────────────────┤
                  │ "user[ERROR]    │
                  │ Fake log"       │
                  │                 │
                  │ "safemalicious" │
                  │                 │
                  │ "Red"           │
                  └─────────────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │ ✅ Attack       │
                  │    Prevented    │
                  └─────────────────┘
```

## Integration Points Map

```
┌─────────────────────────────────────────────────────────────────┐
│                    Application Entry Points                      │
└─────────────────────────────────────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ Donation     │    │ Wallet       │    │ Stream       │
│ Routes       │    │ Routes       │    │ Routes       │
├──────────────┤    ├──────────────┤    ├──────────────┤
│ POST /       │    │ POST /       │    │ POST /create │
│ donations    │    │ wallets      │    │              │
│              │    │              │    │ (Future)     │
│ POST /send   │    │ PATCH /      │    │              │
│              │    │ wallets/:id  │    │              │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │
       ▼                   ▼                   ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ Sanitize:    │    │ Sanitize:    │    │ Sanitize:    │
│ • memo       │    │ • label      │    │ • TBD        │
│ • donor      │    │ • ownerName  │    │              │
│ • recipient  │    │              │    │              │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │
       └───────────────────┴───────────────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │ Logging Layer   │
                  │ (All routes)    │
                  │                 │
                  │ sanitizeFor     │
                  │ Logging()       │
                  └─────────────────┘
```

## Testing Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                         Test Pyramid                             │
└─────────────────────────────────────────────────────────────────┘

                           ┌─────────────┐
                           │ Integration │
                           │   Tests     │
                           │             │
                           │ • Endpoints │
                           │ • Full flow │
                           └─────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
              ┌─────────────┐         ┌─────────────┐
              │ Unit Tests  │         │ Security    │
              │             │         │ Tests       │
              │ • Functions │         │             │
              │ • Edge cases│         │ • Attacks   │
              │ • Validation│         │ • Injection │
              └─────────────┘         └─────────────┘

Test Files:
• tests/sanitizer.test.js (Unit + Security)
• tests/sanitization-integration.test.js (Integration)
```

## Summary

This implementation provides comprehensive input sanitization across all user-controlled metadata fields in the Stellar Micro-Donation API. The sanitization occurs at multiple layers:

1. **Route Level**: Immediate sanitization of user input
2. **Logging Level**: Automatic sanitization of all logged data
3. **Storage Level**: Only sanitized data reaches the database

All acceptance criteria have been met with thorough testing and documentation.
