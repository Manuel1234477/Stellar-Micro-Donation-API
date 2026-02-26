All API responses follow a consistent JSON envelope to ensure predictable parsing for client-side developers.Success ResponseJSON{
  "success": true,
  "data": { ... },
  "message": "Operation completed successfully"
}
Error ResponseJSON{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_FUNDS",
    "message": "The source wallet does not have enough XLM to cover the donation.",
    "details": {
      "available": "5.00",
      "required": "10.00"
    }
  }
}
Error Classifications1. Client-Side Errors (4xx)These errors indicate an issue with the request sent by the consumer.HTTP CodeError CodeDescription400VALIDATION_ERRORThe request body or parameters failed schema validation.401UNAUTHORIZEDMissing or invalid API_KEY or JWT token.402INSUFFICIENT_FUNDSStellar account balance is too low for the requested operation.404RESOURCE_NOT_FOUNDThe requested donation ID or wallet address does not exist.429RATE_LIMIT_EXCEEDEDToo many requests sent in a short window.2. Server & Blockchain Errors (5xx)These errors indicate issues within the API infrastructure or the Stellar network.HTTP CodeError CodeDescription500INTERNAL_SERVER_ERRORAn unexpected error occurred within the API.502HORIZON_UNAVAILABLECould not connect to the Stellar Horizon nodes.503TRANSACTION_FAILEDThe Stellar network rejected the transaction (e.g., timeout or bad sequence).Common Error ScenariosValidation FailureOccurs when required fields are missing or improperly formatted (e.g., an invalid Stellar public key).Scenario: POST /donations without a destination_address.Action: Check the details array for specific field errors.Transaction TimeoutScenario: The Stellar network is congested and the transaction isn't cleared within the time-bound.Response Code: 503Recommendation: Implementation of an exponential backoff retry strategy on the client side is recommended for this specific code.Decryption ErrorScenario: The ENCRYPTION_KEY in the environment variables does not match the key used to store the wallet seeds.Response Code: 500Error Code: DECRYPTION_FAILUREImplementation Guidelines for ConsumersAlways check the code string: Do not rely solely on the HTTP status code. The code string (e.g., VALIDATION_ERROR) is the stable contract.Log the Transaction Hash: For errors resulting in 503 or TRANSACTION_FAILED, the API will attempt to return a stellar_hash if one was generated. Always log this for debugging on StellarExpert.