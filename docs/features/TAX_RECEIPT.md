# Donation Tax Receipt Generation with IRS Compliance

## Overview

The Donation Tax Receipt Generation feature provides IRS-compliant tax receipts (Form 8283) for non-cash donations. This enables US-based donors to claim tax deductions for their XLM donations.

## Features

- **IRS Form 8283 compliance**: Generates receipts with all required fields
- **Fair market value calculation**: Converts XLM to USD at time of donation
- **Exchange rate snapshot**: Stores XLM/USD rate at donation time
- **Organization configuration**: Configurable EIN, legal name, and address
- **Audit trail**: All receipt generations are logged
- **Multiple formats**: JSON and PDF output support

## IRS Requirements

### Form 8283 Required Fields

For non-cash donations over $500, IRS Form 8283 requires:

1. **Organization Information**
   - Employer Identification Number (EIN)
   - Legal name
   - Address

2. **Donation Information**
   - Date of contribution
   - Description of property (XLM cryptocurrency)
   - Fair market value on date of contribution

3. **Required Statement**
   - "No goods or services were provided in exchange for this contribution"

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ORGANIZATION_EIN` | Employer Identification Number (XX-XXXXXXX) | Yes |
| `ORGANIZATION_LEGAL_NAME` | Legal name of organization | Yes |
| `ORGANIZATION_ADDRESS` | Street address | Yes |
| `ORGANIZATION_CITY` | City | Yes |
| `ORGANIZATION_STATE` | State (2-letter code) | Yes |
| `ORGANIZATION_ZIP_CODE` | ZIP code | Yes |
| `ORGANIZATION_PHONE` | Phone number | No |
| `ORGANIZATION_EMAIL` | Email address | No |
| `ORGANIZATION_WEBSITE` | Website URL | No |

### Example Configuration

```bash
ORGANIZATION_EIN=12-3456789
ORGANIZATION_LEGAL_NAME=Stellar Micro Donation Foundation
ORGANIZATION_ADDRESS=123 Main Street
ORGANIZATION_CITY=San Francisco
ORGANIZATION_STATE=CA
ORGANIZATION_ZIP_CODE=94105
ORGANIZATION_PHONE=555-123-4567
ORGANIZATION_EMAIL=info@stellardonations.org
ORGANIZATION_WEBSITE=https://stellardonations.org
```

## API Endpoints

### GET /donations/:id/tax-receipt

Generate IRS-compliant tax receipt for a donation.

**Query Parameters:**
- `format` (optional): Output format (`json` or `pdf`, default: `json`)

**Response (JSON):**
```json
{
  "success": true,
  "data": {
    "organization": {
      "ein": "12-3456789",
      "legalName": "Stellar Micro Donation Foundation",
      "address": "123 Main Street",
      "city": "San Francisco",
      "state": "CA",
      "zipCode": "94105",
      "phone": "555-123-4567",
      "email": "info@stellardonations.org",
      "website": "https://stellardonations.org"
    },
    "donation": {
      "id": 1,
      "date": "2024-01-15T10:30:00.000Z",
      "stellarTxId": "abc123...",
      "donorPublicKey": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      "recipientPublicKey": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    },
    "financial": {
      "xlmAmount": 100,
      "xlmUsdRate": 0.15,
      "fairMarketValueUsd": 15.00,
      "currency": "XLM"
    },
    "irs": {
      "formType": "8283",
      "statement": "No goods or services were provided in exchange for this contribution.",
      "qualifiedOrganization": true,
      "noGoodsServicesProvided": true
    },
    "generatedAt": "2024-01-15T10:35:00.000Z",
    "receiptNumber": "TXN-1-1705312500000"
  }
}
```

**Error Response (503 - Service Unavailable):**
```json
{
  "success": false,
  "error": {
    "code": "SERVICE_UNAVAILABLE",
    "message": "Tax receipt service is not configured. Organization information is required.",
    "details": {
      "required": ["ORGANIZATION_EIN", "ORGANIZATION_LEGAL_NAME"],
      "current": {
        "ein": false,
        "legalName": false
      }
    }
  }
}
```

### GET /donations/tax-receipts/eligible

Get all donations eligible for tax receipts.

**Query Parameters:**
- `startDate` (optional): Filter by start date (ISO 8601)
- `endDate` (optional): Filter by end date (ISO 8601)
- `limit` (optional): Maximum results (1-1000, default: 100)

**Response:**
```json
{
  "success": true,
  "data": {
    "donations": [
      {
        "id": 1,
        "amount": 100,
        "timestamp": "2024-01-15T10:30:00.000Z",
        "xlm_usd_rate": 0.15,
        "fair_market_value_usd": 15.00,
        "tax_receipt_generated": 0,
        "donorPublicKey": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        "hasReceipt": false
      }
    ],
    "count": 1,
    "filters": {
      "startDate": "2024-01-01",
      "endDate": "2024-12-31",
      "limit": 100
    }
  }
}
```

### GET /donations/tax-receipts/config

Get tax receipt configuration status (admin only).

**Response:**
```json
{
  "success": true,
  "data": {
    "configured": true,
    "organization": {
      "ein": "12-3456789",
      "legalName": "Stellar Micro Donation Foundation",
      "address": "123 Main Street",
      "city": "San Francisco",
      "state": "CA",
      "zipCode": "94105"
    },
    "requiredEnvVars": [
      "ORGANIZATION_EIN",
      "ORGANIZATION_LEGAL_NAME",
      "ORGANIZATION_ADDRESS",
      "ORGANIZATION_CITY",
      "ORGANIZATION_STATE",
      "ORGANIZATION_ZIP_CODE"
    ]
  }
}
```

## Exchange Rate Handling

### Rate Snapshot

The system stores the XLM/USD exchange rate at the time of donation:

1. **First receipt generation**: Fetches current rate and stores it
2. **Subsequent requests**: Uses stored rate (immutable)
3. **Rate source**: Price oracle service

### Fair Market Value Calculation

```
Fair Market Value (USD) = XLM Amount × XLM/USD Rate
```

Example:
- Donation: 100 XLM
- Rate: 0.15 USD/XLM
- Fair Market Value: $15.00

## Security Considerations

1. **Organization validation**: EIN and legal name are required
2. **Exchange rate immutability**: Rate is stored once and never updated
3. **Audit logging**: All receipt generations are logged
4. **Access control**: Requires `DONATIONS_READ` permission

## Testing

Run tests with:

```bash
npm test tests/tax-receipt.test.js
```

Tests verify:
- Receipt includes EIN, donation date, USD fair market value
- Required IRS statements present
- Exchange rate stored at donation time
- Missing org config returns 503
- All required IRS Form 8283 fields are present

## Examples

### Generate Tax Receipt

```javascript
const TaxReceiptService = require('./services/TaxReceiptService');

// Generate receipt data
const receiptData = await TaxReceiptService.generateTaxReceiptData(1);

console.log(receiptData.organization.ein); // "12-3456789"
console.log(receiptData.financial.fairMarketValueUsd); // 15.00
console.log(receiptData.irs.statement); // "No goods or services..."
```

### Check Configuration

```javascript
const TaxReceiptService = require('./services/TaxReceiptService');

if (TaxReceiptService.isConfigured()) {
  const config = TaxReceiptService.getOrganizationConfig();
  console.log(config.legalName);
} else {
  console.log('Tax receipt service not configured');
}
```

### Get Eligible Donations

```javascript
const TaxReceiptService = require('./services/TaxReceiptService');

const donations = await TaxReceiptService.getEligibleDonations({
  startDate: '2024-01-01',
  endDate: '2024-12-31',
  limit: 50
});

donations.forEach(d => {
  console.log(`Donation ${d.id}: ${d.amount} XLM, has receipt: ${d.hasReceipt}`);
});
```

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| 503 Service Unavailable | Organization not configured | Set required environment variables |
| 404 Not Found | Donation not found | Verify donation ID exists |
| 400 Bad Request | Invalid donation ID | Provide valid positive integer |

### Example Error Response

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Organization tax configuration is incomplete. Please set ORGANIZATION_EIN and ORGANIZATION_LEGAL_NAME."
  }
}
```

## PDF Generation

PDF generation is currently a placeholder. In production, integrate with:

- **pdfkit**: Node.js PDF generation library
- **puppeteer**: Headless Chrome for HTML-to-PDF
- **jsPDF**: Client-side PDF generation

Example PDF structure:
```
IRS Form 8283 - Noncash Charitable Contributions

Organization Information:
  EIN: 12-3456789
  Legal Name: Stellar Micro Donation Foundation
  Address: 123 Main Street, San Francisco, CA 94105

Donation Information:
  Date: January 15, 2024
  Description: 100 XLM (Stellar Lumens)
  Fair Market Value: $15.00

Statement:
  No goods or services were provided in exchange for this contribution.

Receipt Number: TXN-1-1705312500000
Generated: January 15, 2024
```

## Compliance Notes

1. **Form 8283 threshold**: Required for non-cash donations over $500
2. **Qualified organization**: Must be a 501(c)(3) organization
3. **Donor responsibility**: Donor must file Form 8283 with tax return
4. **Record keeping**: Organization must retain records for 7 years
