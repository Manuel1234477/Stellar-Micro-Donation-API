# Project Architecture: Stellar-Micro-Donation-API

This document provides a detailed overview of the system architecture, directory structure, and the responsibilities of each component within the Stellar-Micro-Donation-API.

---

## 1. Directory Structure

The project follows a modular Service-Oriented Architecture (SOA) to ensure separation of concerns between the HTTP transport layer and the Stellar blockchain logic.

```text
Stellar-Micro-Donation-API/
├── src/
│   ├── api/
│   │   ├── controllers/    # Handles incoming HTTP requests and outgoing responses
│   │   ├── routes/         # Defines API endpoints and maps them to controllers
│   │   └── middlewares/    # Authentication, validation, and error-handling logic
│   ├── services/           # CORE: Contains all Stellar SDK and blockchain logic
│   ├── config/             # System constants, Horizon URLs, and Network Passphrases
│   ├── utils/              # Helper functions (Address validation, unit conversions)
│   └── app.js              # Express application configuration
├── tests/                  # Integration and unit test suites (Mocha/Chai/Supertest)
├── .env.example            # Template for environment-specific variables
└── server.js               # Entry point for the Node.js server
```

---

## 2. Layer Responsibilities

### API Layer (Routes & Controllers)

- **Routes:** Acts as the entry point for all external traffic. It defines the RESTful contract (e.g., `POST /api/donations`).
- **Controllers:** Responsible for "thin" logic. They extract data from `req.body`, perform basic schema validation, and pass data to the appropriate service. They never interact with the Stellar SDK directly.

### Service Layer (Business Logic)

- **The Engine:** This is where the primary complexity resides.
- **Stellar Integration:** Services use the `stellar-sdk` to:
  - Load account states from Horizon.
  - Construct and sign transactions.
  - Handle transaction submission and error parsing (e.g., checking for `op_low_reserve`).

### Configuration & Utils

- **Config:** Ensures the app can switch between `TESTNET` and `PUBLIC` networks without code changes.
- **Utils:** Provides shared logic, such as `isStellarAddress(address)` or `toStroops(amount)`, ensuring consistency across the codebase.

---

## 3. Data Flow (Request Lifecycle)

The lifecycle of a typical request (e.g., sending a micro-donation) follows these steps:

1. **Request:** Client sends a JSON payload to the `/api/donations` endpoint.
2. **Route/Middleware:** The request is routed; middlewares validate that the Stellar public key and secret formats are correct.
3. **Controller:** `DonationController` receives the validated data and calls `DonationService.processDonation()`.
4. **Service (Building):** The Service layer fetches the current sequence number for the sender's account from the Stellar Horizon server.
5. **Service (Signing):** A transaction is built using `TransactionBuilder`, signed with the provided secret key, and converted to an XDR envelope.
6. **Network Submission:** The transaction is submitted to the blockchain.
7. **Response:** The service returns the transaction hash to the controller, which sends a `200 OK` response back to the user.

---

## 4. Design Principles

- **Statelessness:** The API does not store private keys. It acts as a transactional pass-through for the user's keys.
- **Error Abstraction:** Low-level Stellar errors (Horizon codes) are caught in the service layer and translated into user-friendly messages by the controller.
- **Environment Driven:** All sensitive URLs and network settings are managed via `.env` files.

## Language 
JAVASCRIPT