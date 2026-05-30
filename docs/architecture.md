# Stellar Micro-Donation API - Architecture

## System Overview

The Stellar Micro-Donation API is a Node.js/Express application that enables micro-donations using the Stellar blockchain network. The system supports one-time donations, recurring donation schedules, and provides analytics on donation patterns.

## Architecture Diagram

```mermaid
graph TB
    subgraph "Client Layer"
        Client[API Clients<br/>Web/Mobile Apps]
    end

    subgraph "API Layer - Express.js"
        Router[Express Router]
        DonationRoutes[/donations<br/>Donation Routes]
        WalletRoutes[/wallets<br/>Wallet Routes]
        StreamRoutes[/stream<br/>Recurring Donations]
        StatsRoutes[/stats<br/>Analytics Routes]
    end

    subgraph "Service Layer"
        StellarService[Stellar Service<br/>Blockchain Integration]
        MockStellarService[Mock Stellar Service<br/>Testing/Development]
        Scheduler[Recurring Donation<br/>Scheduler<br/>Runs every 60s]
    end

    subgraph "Data Layer"
        DB[(SQLite Database<br/>stellar_donations.db)]
        Tables[Tables:<br/>- users<br/>- transactions<br/>- recurring_donations]
    end

    subgraph "External Services"
        Stellar[Stellar Network<br/>Testnet/Mainnet]
        Horizon[Horizon API<br/>Stellar Gateway]
    end

    Client -->|HTTP Requests| Router
    Router --> DonationRoutes
    Router --> WalletRoutes
    Router --> StreamRoutes
    Router --> StatsRoutes

    DonationRoutes -->|Create/Verify| StellarService
    WalletRoutes -->|Query Transactions| DB
    StreamRoutes -->|Schedule Management| DB
    StatsRoutes -->|Analytics Queries| DB

    StellarService -->|Submit Transactions| Horizon
    MockStellarService -->|Simulate Transactions| DB
    Horizon -->|Blockchain Operations| Stellar

    Scheduler -->|Check Due Schedules| DB
    Scheduler -->|Execute Donations| MockStellarService
    Scheduler -->|Record Transactions| DB

    DonationRoutes -.->|Development Mode| MockStellarService
    StreamRoutes --> Scheduler

    style Client fill:#e1f5ff
    style Router fill:#fff4e1
    style DB fill:#e8f5e9
    style Stellar fill:#f3e5f5
    style Scheduler fill:#fff9c4
```

## Component Details

### 1. API Layer (Express.js)

**Main Components:**
- `app.js` - Application entry point, middleware configuration
- Route handlers for different API endpoints

**Endpoints:**

#### Donations (`/donations`)
- `POST /donations` - Create a new donation
- `GET /donations` - List all donations
- `GET /donations/recent` - Get recent donations
- `GET /donations/:id` - Get specific donation
- `POST /donations/verify` - Verify transaction on blockchain

#### Wallets (`/wallets`)
- `POST /wallets` - Create wallet metadata
- `GET /wallets` - List all wallets
- `GET /wallets/:id` - Get specific wallet
- `GET /wallets/:publicKey/transactions` - Get all transactions for a wallet
- `PATCH /wallets/:id` - Update wallet metadata

#### Recurring Donations (`/stream`)
- `POST /stream/create` - Create recurring donation schedule
- `GET /stream/schedules` - List all schedules
- `GET /stream/schedules/:id` - Get specific schedule
- `DELETE /stream/schedules/:id` - Cancel schedule

#### Statistics (`/stats`)
- `GET /stats/donations` - Get donation statistics
- `GET /stats/summary` - Get summary analytics

### 2. Service Layer

#### Stellar Service
- Integrates with Stellar blockchain via Horizon API
- Handles transaction submission and verification
- Manages wallet operations on testnet/mainnet

#### Mock Stellar Service
- Simulates Stellar operations for development/testing
- In-memory transaction storage
- No external network calls required

#### Recurring Donation Scheduler
- Background service that runs every 60 seconds
- Checks for due recurring donation schedules
- Automatically executes donations via Stellar Service
- Updates schedule execution status and next run time

### 3. Data Layer (SQLite)

**Database Schema:**

```sql
-- Users table
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    publicKey TEXT NOT NULL UNIQUE,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Transactions table
CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    senderId INTEGER NOT NULL,
    receiverId INTEGER NOT NULL,
    amount REAL NOT NULL,
    memo TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (senderId) REFERENCES users(id),
    FOREIGN KEY (receiverId) REFERENCES users(id)
);

-- Recurring donations table
CREATE TABLE recurring_donations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    donorId INTEGER NOT NULL,
    recipientId INTEGER NOT NULL,
    amount REAL NOT NULL,
    frequency TEXT NOT NULL,
    startDate DATETIME DEFAULT CURRENT_TIMESTAMP,
    nextExecutionDate DATETIME NOT NULL,
    status TEXT DEFAULT 'active',
    lastExecutionDate DATETIME,
    executionCount INTEGER DEFAULT 0,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (donorId) REFERENCES users(id),
    FOREIGN KEY (recipientId) REFERENCES users(id)
);
```

## Data Flow Examples

### One-Time Donation Flow

```
1. Client sends POST /donations
   ↓
2. Donation Route validates request
   ↓
3. Stellar Service submits transaction to Horizon API
   ↓
4. Horizon API processes on Stellar Network
   ↓
5. Transaction recorded in database
   ↓
6. Success response returned to client
```

### Recurring Donation Flow

```
1. Client sends POST /stream/create
   ↓
2. Stream Route validates and stores schedule in DB
   ↓
3. Scheduler checks every 60 seconds for due schedules
   ↓
4. When schedule is due:
   - Scheduler executes donation via Stellar Service
   - Transaction recorded in database
   - Schedule updated with next execution date
   ↓
5. Process repeats until schedule is cancelled
```

### Wallet Transaction Query Flow

```
1. Client sends GET /wallets/:publicKey/transactions
   ↓
2. Wallet Route queries database for user
   ↓
3. Database returns all transactions (sent + received)
   ↓
4. Response formatted and returned to client
```

## Technology Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** SQLite3
- **Blockchain:** Stellar Network (via stellar-sdk)
- **Testing:** Jest (for unit/integration tests)
- **Development Tools:** Nodemon, ESLint

## Security Considerations

1. **Input Validation:** All API endpoints validate input data
2. **Error Handling:** Comprehensive error handling prevents information leakage
3. **Rate Limiting:** Should be implemented for production
4. **Secret Management:** Stellar secret keys should be stored securely (env variables)
5. **HTTPS:** All production traffic should use HTTPS
6. **CORS:** Configure CORS policies for production

## Deployment Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Load Balancer                      │
└─────────────────┬───────────────────────────────────┘
                  │
        ┌─────────┴─────────┐
        │                   │
┌───────▼────────┐  ┌───────▼────────┐
│  API Server 1  │  │  API Server 2  │
│  (Node.js)     │  │  (Node.js)     │
└───────┬────────┘  └───────┬────────┘
        │                   │
        └─────────┬─────────┘
                  │
        ┌─────────▼─────────┐
        │  SQLite Database  │
        │  (or PostgreSQL)  │
        └───────────────────┘
```

## Scalability Considerations

1. **Database:** For production, consider migrating from SQLite to PostgreSQL or MySQL
2. **Caching:** Implement Redis for frequently accessed data
3. **Queue System:** Use message queue (RabbitMQ/Redis) for async operations
4. **Horizontal Scaling:** Multiple API instances behind load balancer
5. **Monitoring:** Implement logging and monitoring (e.g., Winston, Prometheus)

## Future Enhancements

- [ ] WebSocket support for real-time transaction updates
- [ ] Multi-currency support
- [ ] Advanced analytics dashboard
- [ ] Email notifications for recurring donations
- [ ] Webhook support for transaction events
- [ ] GraphQL API option
- [ ] Rate limiting and API key management
- [ ] Comprehensive audit logging
