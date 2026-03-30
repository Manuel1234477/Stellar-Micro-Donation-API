# Pull Request: Analytics Fee Calculation Feature

## Branch Information
- **Branch Name**: `feature/analytics-fee-calculation`
- **Base Branch**: `main`
- **Commit Hash**: d1a0395

## Description
Implements a small optional fee calculation per donation for analytics purposes. The fee is calculated but NOT deducted on-chain and is stored in the database for reporting only.

## Changes Made

### New Files Created
1. **src/utils/feeCalculator.js**
   - Fee calculation utility
   - Default: 2% of donation amount
   - Minimum fee: $0.01
   - Maximum fee cap: 5%

2. **test-analytics-fee.js**
   - Test script to verify fee calculations
   - Run with: `node test-analytics-fee.js`

3. **ANALYTICS_FEE_FEATURE.md**
   - Complete feature documentation
   - API endpoint examples
   - Usage instructions

### Modified Files
1. **src/routes/donation.js**
   - Added fee calculation on donation creation
   - Stores `analyticsFee` and `analyticsFeePercentage` in DB

2. **src/routes/stats.js**
   - Added new endpoint: `GET /stats/analytics-fees`
   - Returns comprehensive fee reporting

3. **src/routes/services/StatsService.js**
   - Added `getAnalyticsFeeStats()` method
   - Aggregates fees by recipient and date range

4. **data/donations.json**
   - Updated all existing donations with retroactive fee calculations
   - Ensures consistent reporting across historical data

## Acceptance Criteria ✅

- [x] Fee calculated but not deducted on-chain
- [x] Stored in DB for reporting
- [x] New analytics endpoint available
- [x] Backward compatible with existing data
- [x] Documentation provided

## API Examples

### Create Donation (Modified)
```bash
POST /donations
Content-Type: application/json
Idempotency-Key: unique-key-123

{
  "amount": 100,
  "donor": "Alice",
  "recipient": "Red Cross"
}
```

**Response includes fee data:**
```json
{
  "success": true,
  "data": {
    "id": "123456789",
    "amount": 100,
    "analyticsFee": 2.00,
    "analyticsFeePercentage": 0.02,
    ...
  }
}
```

### Analytics Fee Report (New)
```bash
GET /stats/analytics-fees?startDate=2024-02-01&endDate=2024-02-28
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalFeesCalculated": 25.30,
    "totalDonationVolume": 1265.00,
    "transactionCount": 14,
    "averageFeePerTransaction": 1.81,
    "effectiveFeePercentage": 2.00,
    "feesByRecipient": { ... }
  }
}
```

## Testing

### Manual Testing
```bash
# Test fee calculator
node test-analytics-fee.js

# Test donation creation
curl -X POST http://localhost:3000/donations \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-123" \
  -d '{"amount": 100, "donor": "Test", "recipient": "Red Cross"}'

# Test analytics endpoint
curl "http://localhost:3000/stats/analytics-fees?startDate=2024-02-01&endDate=2024-02-28"
```

## Important Notes

1. **Not Deducted On-Chain**: Analytics fees are for internal reporting only and do NOT affect the actual Stellar blockchain transactions.

2. **Configurable**: Fee percentage can be adjusted in `src/utils/feeCalculator.js` by modifying `DEFAULT_FEE_PERCENTAGE`.

3. **Backward Compatible**: Existing code continues to work; fee fields are optional additions.

## Files Changed
- 7 files changed
- 383 insertions(+)
- 17 deletions(-)

## How to Push This Branch

Since you have access granted, you can push using:

```bash
# If using HTTPS (you'll be prompted for credentials)
git push -u origin feature/analytics-fee-calculation

# Or if you need to authenticate first
git config credential.helper store
git push -u origin feature/analytics-fee-calculation
```

After pushing, create a pull request on GitHub:
1. Go to: https://github.com/Manuel1234477/Stellar-Micro-Donation-API
2. Click "Compare & pull request" for the `feature/analytics-fee-calculation` branch
3. Use this template as the PR description
4. Submit for review

## Reviewer Checklist

- [ ] Fee calculation logic is correct
- [ ] Fees are NOT deducted from on-chain transactions
- [ ] Database schema includes new fee fields
- [ ] Analytics endpoint returns accurate data
- [ ] Existing functionality remains unaffected
- [ ] Documentation is clear and complete
