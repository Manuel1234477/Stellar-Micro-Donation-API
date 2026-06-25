# Stellar Micro-Donation API - Curl Quick Start Guide

This guide provides copy-paste curl commands to test the core donation API flows without requiring Postman or Insomnia.

## Setup

```bash
# Set your environment variables
export API_KEY="your-api-key-here"
export BASE_URL="http://localhost:3000/api"
export DONOR_PUBLIC_KEY="GBUQWP3BOUZX34ULNQG23RQ6F4BWFIРЕQCLMNZ4QSY47PCNQRICKS57"
export RECIPIENT_PUBLIC_KEY="GCEZWJG7SSHQUUP7IBRN23JQCQR53ROE44TSBROAM4TOBJOJJU5YV2Z2"
```

## 1. Wallet Management

### Create Wallet

```bash
curl -X POST "$BASE_URL/wallets" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "publicKey": "'$DONOR_PUBLIC_KEY'",
    "name": "My Donation Wallet",
    "metadata": {
      "region": "US",
      "donorType": "individual"
    }
  }'
```

### Get Wallet Transactions

```bash
curl -X GET "$BASE_URL/wallets/$DONOR_PUBLIC_KEY/transactions" \
  -H "X-API-Key: $API_KEY"
```

## 2. One-Time Donations

### Create Donation

```bash
curl -X POST "$BASE_URL/donations" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "senderId": "'$DONOR_PUBLIC_KEY'",
    "recipientId": "'$RECIPIENT_PUBLIC_KEY'",
    "amount": "50.00",
    "memo": "Education fund donation",
    "sdgCategories": ["04"]
  }' | jq .
```

### Get Recent Donations

```bash
curl -X GET "$BASE_URL/donations/recent?limit=10" \
  -H "X-API-Key: $API_KEY" | jq .
```

### Verify Donation

```bash
# Replace TRANSACTION_HASH with the hash from create response
curl -X POST "$BASE_URL/donations/verify" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "transactionHash": "TRANSACTION_HASH_HERE"
  }' | jq .
```

### Get Donation Limits

```bash
curl -X GET "$BASE_URL/donations/limits" \
  -H "X-API-Key: $API_KEY" | jq .
```

## 3. Recurring Donations

### Create Recurring Donation Schedule

```bash
curl -X POST "$BASE_URL/stream/create" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "donorId": "'$DONOR_PUBLIC_KEY'",
    "recipientId": "'$RECIPIENT_PUBLIC_KEY'",
    "amount": "25.00",
    "frequency": "monthly",
    "startDate": "2026-07-01"
  }' | jq .
```

### List Recurring Donation Schedules

```bash
curl -X GET "$BASE_URL/stream/schedules" \
  -H "X-API-Key: $API_KEY" | jq .
```

### Get Specific Schedule

```bash
# Replace SCHEDULE_ID with ID from list response
curl -X GET "$BASE_URL/stream/schedules/SCHEDULE_ID" \
  -H "X-API-Key: $API_KEY" | jq .
```

### Cancel Recurring Donation

```bash
# Replace SCHEDULE_ID with ID from list response
curl -X DELETE "$BASE_URL/stream/schedules/SCHEDULE_ID" \
  -H "X-API-Key: $API_KEY"
```

## 4. Statistics & Analytics

### Get Daily Statistics

```bash
curl -X GET "$BASE_URL/stats/daily" \
  -H "X-API-Key: $API_KEY" | jq .
```

### Get Weekly Statistics

```bash
curl -X GET "$BASE_URL/stats/weekly" \
  -H "X-API-Key: $API_KEY" | jq .
```

### Get Summary Analytics

```bash
curl -X GET "$BASE_URL/stats/summary" \
  -H "X-API-Key: $API_KEY" | jq .
```

### Get Donor Statistics

```bash
curl -X GET "$BASE_URL/stats/donors" \
  -H "X-API-Key: $API_KEY" | jq .
```

### Get Recipient Statistics

```bash
curl -X GET "$BASE_URL/stats/recipients" \
  -H "X-API-Key: $API_KEY" | jq .
```

## 5. Server-Sent Events (SSE) Stream

### Real-Time Transaction Stream

This uses SSE (Server-Sent Events) for real-time updates. Open in a separate terminal and leave running:

```bash
curl -X GET "$BASE_URL/stream/transactions" \
  -H "X-API-Key: $API_KEY" \
  -H "Accept: text/event-stream"
```

You should see events like:
```
data: {"type":"transaction","id":"123","amount":"50.00","sender":"...","recipient":"..."}
```

### Real-Time Leaderboard Updates

```bash
curl -X GET "$BASE_URL/stream/leaderboard" \
  -H "X-API-Key: $API_KEY" \
  -H "Accept: text/event-stream"
```

## 6. Health Check

### Check API Health

```bash
curl -X GET "$BASE_URL/health" | jq .
```

## Authentication Header

All requests (except `/health`) require the `X-API-Key` header:

```bash
-H "X-API-Key: your-api-key-here"
```

## Helpful Tips

1. **Pretty-print JSON**: Add `| jq .` to any curl command to format the response
2. **Save response**: Add `-o filename.json` to save the response
3. **Include headers**: Add `-i` flag to see response headers
4. **Show request headers**: Add `-v` flag for verbose output
5. **Debug**: Add `-X GET` explicitly if curl is confused about the HTTP method

## Example Full Flow

```bash
#!/bin/bash

set -e  # Exit on error

# Set variables
export API_KEY="dev-key"
export BASE_URL="http://localhost:3000/api"
export DONOR="GBUQWP3BOUZX34ULNQG23RQ6F4BWFIРЕQCLMNZ4QSY47PCNQRICKS57"
export RECIPIENT="GCEZWJG7SSHQUUP7IBRN23JQCQR53ROE44TSBROAM4TOBJOJJU5YV2Z2"

echo "📊 Checking API health..."
curl -s "$BASE_URL/health" | jq .

echo -e "\n💰 Creating a donation..."
DONATION=$(curl -s -X POST "$BASE_URL/donations" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "senderId": "'$DONOR'",
    "recipientId": "'$RECIPIENT'",
    "amount": "50",
    "memo": "Test donation"
  }')
echo $DONATION | jq .

echo -e "\n📈 Getting recent donations..."
curl -s "$BASE_URL/donations/recent?limit=5" \
  -H "X-API-Key: $API_KEY" | jq .

echo -e "\n📊 Getting summary stats..."
curl -s "$BASE_URL/stats/summary" \
  -H "X-API-Key: $API_KEY" | jq .
```

Save as `test-api.sh`, make executable (`chmod +x test-api.sh`), and run (`./test-api.sh`).

## Troubleshooting

**401 Unauthorized**: Make sure `API_KEY` is set correctly in the `X-API-Key` header

**404 Not Found**: Check that `BASE_URL` is correct and the server is running

**Connection refused**: Make sure the API is running on `localhost:3000`

**jq: command not found**: Install jq with `sudo apt-get install jq` (Linux) or `brew install jq` (macOS)
