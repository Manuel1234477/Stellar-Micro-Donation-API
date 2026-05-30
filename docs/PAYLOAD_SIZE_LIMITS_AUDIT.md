# Payload Size Limits Audit

All POST / PUT / PATCH endpoints are protected by two layers:

1. **Global guard** — `app.use(payloadSizeLimiter())` in `app.js`, applied before body parsing. Rejects any request whose `Content-Length` exceeds the default limit (100 KB).
2. **Per-route guard** — `payloadSizeLimiter(ENDPOINT_LIMITS.<key>)` on each individual route, applied before body parsing. Enforces a tighter limit appropriate for that endpoint type.

Both layers check the `Content-Length` header and return `HTTP 413 PAYLOAD_TOO_LARGE` before the body is parsed, preventing memory exhaustion.

## ENDPOINT_LIMITS reference

| Key | Bytes | Human |
|---|---|---|
| `default` | 102 400 | 100 KB |
| `auth` | 1 024 | 1 KB |
| `singleDonation` | 10 240 | 10 KB |
| `batchDonation` | 524 288 | 512 KB |
| `wallet` | 20 480 | 20 KB |
| `stream` | 10 240 | 10 KB |
| `transaction` | 51 200 | 50 KB |
| `stats` | 10 240 | 10 KB |
| `admin` | 10 240 | 10 KB |
| `bulk` | 1 048 576 | 1 MB |
| `webhook` | 20 480 | 20 KB |
| `asset` | 51 200 | 50 KB |
| `campaign` | 20 480 | 20 KB |

## Endpoint inventory

### Auth (`src/routes/auth.js`)
| Method | Path | Limit |
|---|---|---|
| POST | /auth/token/apikey | auth (1 KB) |
| POST | /auth/refresh | auth (1 KB) |
| POST | /auth/token | auth (1 KB) |

### Donations (`src/routes/donation.js`)
| Method | Path | Limit |
|---|---|---|
| POST | /donations | singleDonation (10 KB) |
| POST | /donations/batch | batchDonation (512 KB) |
| POST | /donations/verify | singleDonation (10 KB) |
| POST | /donations/cross-asset | singleDonation (10 KB) |
| POST | /donations/:id/receipt/email | singleDonation (10 KB) |
| PATCH | /donations/:id/status | singleDonation (10 KB) |
| POST | /donations/:id/refund | singleDonation (10 KB) |

### Wallets (`src/routes/wallet.js`)
| Method | Path | Limit |
|---|---|---|
| POST | /wallets | wallet (20 KB) |
| PUT | /wallets/:id/inflation-destination | wallet (20 KB) |
| PATCH | /wallets/:id | wallet (20 KB) |
| PATCH | /wallets/:id/home-domain | wallet (20 KB) |
| PUT | /wallets/:id/home-domain | wallet (20 KB) |
| POST | /wallets/:id/home-domain/verify | wallet (20 KB) |
| PATCH | /wallets/:id/limits | wallet (20 KB) |
| PATCH | /wallets/:id/leaderboard-visibility | wallet (20 KB) |
| POST | /wallets/:id/sponsor | wallet (20 KB) |
| POST | /wallets/:id/revoke-sponsorship | wallet (20 KB) |
| POST | /wallets/:id/merge | wallet (20 KB) |
| POST | /wallets/:id/trustlines | wallet (20 KB) |
| PATCH | /wallets/:id/trustlines/:asset | wallet (20 KB) |
| PATCH | /wallets/:id/options | wallet (20 KB) |

### Stream / Recurring (`src/routes/stream.js`, `src/routes/recurringDonation.js`)
| Method | Path | Limit |
|---|---|---|
| POST | /stream/create | stream (10 KB) |
| POST | /stream/schedules/:id/pause | stream (10 KB) |
| POST | /stream/schedules/:id/resume | stream (10 KB) |
| POST | /recurring-donations | singleDonation (10 KB) |

### Transactions (`src/routes/transaction.js`)
| Method | Path | Limit |
|---|---|---|
| POST | /transactions/sync | transaction (50 KB) |
| POST | /transactions/bulk-sync | transaction (50 KB) |
| POST | /transactions/batch | transaction (50 KB) |

### Campaigns (`src/routes/campaigns.js`)
| Method | Path | Limit |
|---|---|---|
| POST | /campaigns | campaign (20 KB) |
| PATCH | /campaigns/:id | campaign (20 KB) |
| POST | /campaigns/:id/pledge | campaign (20 KB) |
| POST | /campaigns/:id/settle | campaign (20 KB) |
| POST | /campaigns/:id/milestones | campaign (20 KB) |
| POST | /campaigns/admin/:id/milestones/:milestoneId/verify | campaign (20 KB) |

### API Keys (`src/routes/apiKeys.js`)
| Method | Path | Limit |
|---|---|---|
| POST | /api-keys | admin (10 KB) |
| POST | /api-keys/:id/rotate | admin (10 KB) |
| POST | /api-keys/:id/deprecate | admin (10 KB) |
| PATCH | /api-keys/:id | admin (10 KB) |
| POST | /api-keys/cleanup | admin (10 KB) |
| POST | /api-keys/:id/totp/setup | admin (10 KB) |
| POST | /api-keys/:id/totp/verify | admin (10 KB) |

### Assets (`src/routes/assets.js`)
| Method | Path | Limit |
|---|---|---|
| POST | /assets/issue | asset (50 KB) |
| POST | /assets/:code/distribute | asset (50 KB) |
| POST | /assets/burn | asset (50 KB) |
| PUT | /assets/:code/metadata | asset (50 KB) |
| POST | /assets/:code/clawback | asset (50 KB) |

### Webhooks (`src/routes/webhooks.js`)
| Method | Path | Limit |
|---|---|---|
| POST | /webhooks | webhook (20 KB) |

### Channels (`src/routes/channels.js`)
| Method | Path | Limit |
|---|---|---|
| POST | /channels/open | default (100 KB) |
| POST | /channels/:id/update | default (100 KB) |
| POST | /channels/:id/close | default (100 KB) |
| POST | /channels/:id/dispute | default (100 KB) |

### Signers (`src/routes/signers.js`)
| Method | Path | Limit |
|---|---|---|
| POST | /wallets/:id/signers | admin (10 KB) |
| PATCH | /wallets/:id/signers/:key | admin (10 KB) |

### Exports (`src/routes/exports.js`)
| Method | Path | Limit |
|---|---|---|
| POST | /exports | bulk (1 MB) |

### Liquidity Pools (`src/routes/liquidity-pools.js`)
| Method | Path | Limit |
|---|---|---|
| POST | /liquidity-pools/deposit | default (100 KB) |
| POST | /liquidity-pools/withdraw | default (100 KB) |

### Offers (`src/routes/offers.js`)
| Method | Path | Limit |
|---|---|---|
| POST | /offers | default (100 KB) |

### Contracts (`src/routes/contracts.js`)
| Method | Path | Limit |
|---|---|---|
| POST | /contracts/:contractId/invoke | admin (10 KB) |
| POST | /contracts/:contractId/simulate | admin (10 KB) |

### Fees (`src/routes/fees.js`)
| Method | Path | Limit |
|---|---|---|
| POST | /fees | admin (10 KB) |
| POST | /fees/:id/payments | admin (10 KB) |

### Tiers (`src/routes/tiers.js`)
| Method | Path | Limit |
|---|---|---|
| POST | /tiers | admin (10 KB) |
| POST | /tiers/:id/subscribe | admin (10 KB) |

### Tools (`src/routes/tools.js`)
| Method | Path | Limit |
|---|---|---|
| POST | /tools/decode-transaction | default (100 KB) |

### Receipt (`src/routes/receipt.js`)
| Method | Path | Limit |
|---|---|---|
| POST | /donations/:id/receipt | singleDonation (10 KB) |

### Corporate Matching (`src/routes/corporateMatching.js`)
| Method | Path | Limit |
|---|---|---|
| POST | /admin/corporate-matching/claims/:id/approve | admin (10 KB) |

### Admin routes (`src/routes/admin/`)
| Method | Path | Limit |
|---|---|---|
| POST | /admin/audit-log-export | admin (10 KB) |
| POST | /admin/backup | admin (10 KB) |
| POST | /admin/backup/restore/:backupId | admin (10 KB) |
| POST | /admin/corporate-matching | admin (10 KB) |
| PATCH | /admin/corporate-matching/:id/status | admin (10 KB) |
| POST | /admin/cors-origins | admin (10 KB) |
| POST | /admin/encryption/rotate | admin (10 KB) |
| POST | /admin/encryption/memo-rotate | admin (10 KB) |
| POST | /admin/feature-flags | admin (10 KB) |
| PATCH | /admin/feature-flags/:name | admin (10 KB) |
| POST | /admin/feature-flags/:flag/enable | admin (10 KB) |
| POST | /admin/feature-flags/:flag/disable | admin (10 KB) |
| POST | /admin/fee-bump/:id | admin (10 KB) |
| PUT | /admin/geo-blocking | admin (10 KB) |
| POST | /admin/geo-blocking/reload-db | admin (10 KB) |
| POST | /admin/impact-metrics | admin (10 KB) |
| POST | /admin/matching-programs | admin (10 KB) |
| PATCH | /admin/matching-programs/:id/status | admin (10 KB) |
| POST | /admin/retention/run | admin (10 KB) |
| POST | /admin/routing/pools | admin (10 KB) |
| POST | /admin/routing/pools/:name/members | admin (10 KB) |
| POST | /admin/routing/strategies | admin (10 KB) |
| POST | /admin/wallet-limits/:id/limits | admin (10 KB) |
| POST | /admin/webhooks/dead-letter/:id/replay | webhook (20 KB) |
| POST | /reconcile | admin (10 KB) |
| POST | /admin/reconcile | admin (10 KB) |
| POST | /admin/sync | admin (10 KB) |
