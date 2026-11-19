# Threat Modeling: Donation Flow

This document analyzes the security posture of the **Stellar-Micro-Donation-API**, identifying potential attack vectors and providing actionable mitigations to ensure the integrity of the donation process.

---

## 1. Attack Surface Analysis

The following areas represent the primary entry points for potential threats:
- **Public API Endpoints**: `/donations`, `/wallets`, and `/stats`.
- **Credential Handling**: The ingestion and processing of `senderSecret`.
- **Infrastructure**: The connection between this API and the Stellar Horizon network.
- **Log Management**: Storage of request/response data that might contain sensitive fragments.

---

## 2. Threat Scenarios (STRIDE Model)



| Category | Threat Scenario | Impact |
| :--- | :--- | :--- |
| **Spoofing** | Attacker intercepts or guesses a `senderSecret` to impersonate a donor. | Unauthorized drainage of XLM from user wallets. |
| **Tampering** | Man-in-the-Middle (MITM) modifies the `recipient` address in the request body. | Donation funds are diverted to an attacker's wallet. |
| **Repudiation** | A user claims a donation was never authorized due to a lack of unique audit trails. | Inability to resolve financial disputes or verify ledger history. |
| **Information Disclosure** | Verbose error messages leak internal paths or partial secret keys. | Attacker gains insight into the server environment or crypto logic. |
| **Denial of Service** | Flooding the `/donations` endpoint to exhaust account sequence numbers. | Service becomes unavailable for legitimate donors. |
| **Elevation of Privilege** | Bypassing `rbacMiddleware` to access administrative stats or private wallet data. | Unauthorized access to sensitive financial reporting. |

---

## 3. Data Flow & Security Boundaries

1. **Client -> API**: The "Danger Zone" where the `senderSecret` is transmitted.
2. **API -> Service**: Internal logic where the Transaction Envelope is built.
3. **Service -> Horizon**: The boundary where the signed transaction enters the public ledger.



---

## 4. Actionable Mitigations

### **A. Secure Key Management (High Priority)**
- **Current Risk**: Handling raw secrets in the request body.
- **Mitigation**: Move toward **SEP-10** (Stellar Web Authentication) or implement client-side signing (using Freighter or Albedo) so the API only receives a signed transaction, never the secret key.

### **B. Transaction Idempotency**
- **Current Risk**: Network retries causing double-spending.
- **Mitigation**: Utilize the `requestId` as an **Idempotency Key**. Before submitting to Horizon, check the local `Database` to see if a transaction with that ID has already been successfully processed.

### **C. Log Sanitization**
- **Current Risk**: `logger.js` may capture the `senderSecret` in the request body.
- **Mitigation**: Implement a filter in the logging middleware to redact any field named `secret`, `seed`, or `key`.

### **D. Rate Limiting**
- **Current Risk**: Automated scripts exhausting resources.
- **Mitigation**: Implement `express-rate-limit` specifically on the `/donations` and `/wallets` endpoints to prevent brute-force or DoS attempts.

### **E. Detailed Error Handling**
- **Current Risk**: Leaking stack traces in production.
- **Mitigation**: Ensure `errorHandler.js` only returns generic codes (e.g., `INTERNAL_ERROR`) in production while logging the full trace internally alongside the `requestId`.

---

## 5. Security Checklist for Contributors
- [ ] Does this change log any sensitive data?
- [ ] Is input validation strictly enforced for Stellar addresses?
- [ ] Does the new endpoint respect established RBAC permissions?