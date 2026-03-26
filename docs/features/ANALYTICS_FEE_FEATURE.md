# Analytics Fee Feature

## Overview
This feature calculates a small optional fee per donation for analytics purposes. The fee is calculated but **NOT deducted on-chain** and is stored in the database for reporting only.

## Implementation Details

### Fee Calculation
- **Default Fee**: 2% of donation amount
- **Minimum Fee**: $0.01
- **Maximum Fee**: 5% cap
- **Location**: `src/utils/feeCalculator.js`

### Database Storage
Each donation now includes:
- `analyticsFee`: The calculated fee amount
- `analyticsFeePercentage`: The percentage used (default: 0.02)

### API Endpoints

#### 1. Create Donation (Modified)
**POST** `/donations`

The donation creation endpoint now automatically calculates and stores the analytics fee.

**Request Body:**
```json
{
  "amount": 100,
  "donor": "Alice",
  "recipient": "Red Cross"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "123456789",
    "amount": 100,
    "donor": "Alice",
    "recipient": "Red Cross",
    "timestamp": "2024-02-20T12:00:00.000Z",
    "status": "completed",
    "analyticsFee": 2.00,
    "analyticsFeePercentage": 0.02
  }
}
```

#### 2. Analytics Fee Report (New)
**GET** `/stats/analytics-fees?startDate=2024-02-01&endDate=2024-02-28`

Get comprehensive analytics fee reporting for a date range.

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
    "feesByRecipient": {
      "Red Cross": {
        "totalFees": 10.80,
        "donationCount": 6,
        "totalVolume": 540.00
      },
      "UNICEF": {
        "totalFees": 8.60,
        "donationCount": 5,
        "totalVolume": 430.00
      },
      "WHO": {
        "totalFees": 5.90,
        "donationCount": 3,
        "totalVolume": 295.00
      }
    },
    "dateRange": {
      "start": "2024-02-01T00:00:00.000Z",
      "end": "2024-02-28T23:59:59.999Z"
    }
  },
  "metadata": {
    "note": "Analytics fees are calculated but not deducted on-chain"
  }
}
```

## Testing

### Manual Test
Run the test script to verify fee calculations:
```bash
node test-analytics-fee.js
```

### Example Calculations
| Donation Amount | Fee (2%) | Minimum Applied | Final Fee |
|----------------|----------|-----------------|-----------|
| $50.00         | $1.00    | No              | $1.00     |
| $100.00        | $2.00    | No              | $2.00     |
| $0.25          | $0.005   | Yes             | $0.01     |
| $200.00        | $4.00    | No              | $4.00     |

## Important Notes

1. **Not Deducted On-Chain**: The analytics fee is purely for internal reporting and is NOT deducted from the donation amount sent on the Stellar blockchain.

2. **Stored in Database**: All fee calculations are persisted in the donations database for historical reporting.

3. **Configurable**: The fee percentage can be adjusted in `src/utils/feeCalculator.js` by modifying the `DEFAULT_FEE_PERCENTAGE` constant.

4. **Backward Compatible**: Existing donations without fee data will show as `undefined` or `0` in reports.

## Files Modified/Created

### Created:
- `src/utils/feeCalculator.js` - Fee calculation utility
- `test-analytics-fee.js` - Test script
- `ANALYTICS_FEE_FEATURE.md` - This documentation

### Modified:
- `src/routes/donation.js` - Added fee calculation to donation creation
- `src/routes/stats.js` - Added `/stats/analytics-fees` endpoint
- `src/routes/services/StatsService.js` - Added `getAnalyticsFeeStats()` method
- `data/donations.json` - Updated existing donations with fee data

## Usage Example

```javascript
const { calculateAnalyticsFee } = require('./src/utils/feeCalculator');

// Calculate fee for a $100 donation
const result = calculateAnalyticsFee(100);
console.log(result);
// Output:
// {
//   fee: 2.00,
//   feePercentage: 0.02,
//   originalAmount: 100,
//   totalWithFee: 102.00
// }
```

## Acceptance Criteria ✓

- [x] Fee calculated but not deducted on-chain
- [x] Stored in DB for reporting
- [x] Accessible via analytics endpoint
- [x] Backward compatible with existing data
