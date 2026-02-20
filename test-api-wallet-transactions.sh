#!/bin/bash

echo "Testing Wallet Transactions API Endpoint"
echo "=========================================="
echo ""

# Test 1: Get transactions for user 1 (sender)
echo "Test 1: Get transactions for wallet GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJMUC5XNODMZTQYBB5XYZXYUU"
curl -s http://localhost:3000/wallets/GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJMUC5XNODMZTQYBB5XYZXYUU/transactions | json_pp
echo ""
echo ""

# Test 2: Get transactions for user 3 (receiver)
echo "Test 2: Get transactions for wallet GCZST3XVCDTUJ76ZAV2HA72KYQM4YQQ5DUJTHIGQ5ESE3JNEZUAEUA7X"
curl -s http://localhost:3000/wallets/GCZST3XVCDTUJ76ZAV2HA72KYQM4YQQ5DUJTHIGQ5ESE3JNEZUAEUA7X/transactions | json_pp
echo ""
echo ""

# Test 3: Non-existent wallet (should return empty array)
echo "Test 3: Get transactions for non-existent wallet"
curl -s http://localhost:3000/wallets/GFAKEWALLETADDRESSNOTINDB123456789012345678901234567890/transactions | json_pp
echo ""
echo ""

echo "✓ All API tests completed!"
