# Stellar Micro-Donation API

A Node.js/Express API for managing micro-donations on the Stellar blockchain network. Supports one-time donations, recurring donation schedules, wallet management, and donation analytics.

## 📋 Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [API Endpoints](#api-endpoints)
- [Database Schema](#database-schema)
- [Development](#development)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)

## ✨ Features

- **One-Time Donations**: Create and verify donations on Stellar testnet/mainnet
- **Recurring Donations**: Schedule automated recurring donations (daily, weekly, monthly)
- **Wallet Management**: Track wallets and query transaction history
- **Analytics**: Get donation statistics and summaries
- **API Key Rotation**: Zero-downtime key rotation with versioning and graceful deprecation
- **Mock Mode**: Development mode with simulated Stellar operations
- **Debug Mode**: Configurable verbose logging for local development troubleshooting
- **Failure Simulation**: Comprehensive network failure testing for robust error handling
- **Automated Scheduler**: Background service for executing recurring donations
- **Rate Limiting**: Protection against abuse with configurable request limits on donation endpoints
- **Idempotency**: Prevent duplicate transactions with idempotency key support
- **Sensitive Data Masking**: Automatic masking of secrets, API keys, and private values in all logs

## 🏗️ Architecture

### High-Level Overview

```
                                     ┌─────────────┐
                                     │   Clients   │
                                     │ (Web/Mobile)│
                                     └──────┬──────┘
                                            │ HTTP/HTTPS
                                            ▼
                            ┌─────────────────────────────────┐
                            │      Express.js API Layer       │
                            │  /donations  /wallets  /stream  │
                            └──────┬──────────────────────────┘
                                            │
                                            ▼
                            ┌─────────────────────────────────┐
                            │       Service Layer             │
                            │  Stellar Service | Scheduler    │
                            └──────┬──────────────────────────┘
                                            │
                                ├──────────────┬────────────┐
                                ▼              ▼            ▼
                            ┌──────────┐   ┌──────────┐  ┌─────────┐
                            │ SQLite   │   │ Stellar  │  │ Horizon │
                            │ Database │   │ Network  │  │   API   │
                            └──────────┘   └──────────┘  └─────────┘
```

For detailed architecture documentation, see:
- [Full Architecture Documentation](docs/ARCHITECTURE.md) - Comprehensive diagrams and component details
- [Simple Architecture Diagram](docs/ARCHITECTURE_SIMPLE.txt) - ASCII art overview

### Key Components

- **API Layer**: Express.js routes handling HTTP requests
- **Service Layer**: Business logic and Stellar blockchain integration
- **Data Layer**: SQLite database for persistent storage
- **Scheduler**: Background service for recurring donations (runs every 60s)

## 🚀 Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- SQLite3

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/Stellar-Micro-Donation-API.git
cd Stellar-Micro-Donation-API
```

2. Install dependencies:
```bash
npm install
```

3. Initialize the database:
```bash
npm run init-db
```

4. Start the server:
```bash
npm start
```

The API will be available at `http://localhost:3000`

### Development Mode

For development with auto-reload:
```bash
npm run dev
```

### Debug Mode

Enable verbose logging for troubleshooting:
```bash
# Add to .env file
DEBUG_MODE=true

# Start server with debug logging
npm start
```

See [Debug Mode Documentation](docs/features/DEBUG_MODE.md) for details.

## 📡 API Endpoints

### Quick Reference

For detailed request/response examples with error handling, see the **[Complete API Examples Documentation](docs/API_EXAMPLES.md)**.

### Donations

- `POST /donations` - Create a new donation
- `GET /donations` - List all donations
- `GET /donations/recent?limit=10` - Get recent donations
- `GET /donations/:id` - Get specific donation
- `GET /donations/limits` - Get donation amount limits
- `POST /donations/verify` - Verify transaction on blockchain
- `PATCH /donations/:id/status` - Update donation status

### Wallets

- `POST /wallets` - Create wallet metadata
- `GET /wallets` - List all wallets
- `GET /wallets/:id` - Get specific wallet
- `GET /wallets/:publicKey/transactions` - Get all transactions for a wallet
- `PATCH /wallets/:id` - Update wallet metadata

### Recurring Donations (Stream)

- `POST /stream/create` - Create recurring donation schedule
- `GET /stream/schedules` - List all schedules
- `GET /stream/schedules/:id` - Get specific schedule
- `DELETE /stream/schedules/:id` - Cancel schedule

### Statistics

- `GET /stats/daily` - Get daily donation statistics
- `GET /stats/weekly` - Get weekly donation statistics
- `GET /stats/summary` - Get summary analytics
- `GET /stats/donors` - Get donor statistics
- `GET /stats/recipients` - Get recipient statistics
- `GET /stats/analytics-fees` - Get analytics fee summary
- `GET /stats/wallet/:walletAddress/analytics` - Get wallet analytics

### Transactions

- `GET /transactions` - Get paginated transactions
- `POST /transactions/sync` - Sync wallet transactions from Stellar network

### Health Check

- `GET /health` - API health status

## 🗄️ Database Schema

### Users Table
```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    publicKey TEXT NOT NULL UNIQUE,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Transactions Table
```sql
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
```

### Recurring Donations Table
```sql
CREATE TABLE recurring_donations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    donorId INTEGER NOT NULL,
    recipientId INTEGER NOT NULL,
    amount REAL NOT NULL,
    frequency TEXT NOT NULL,
    nextExecutionDate DATETIME NOT NULL,
    status TEXT DEFAULT 'active',
    executionCount INTEGER DEFAULT 0,
    FOREIGN KEY (donorId) REFERENCES users(id),
    FOREIGN KEY (recipientId) REFERENCES users(id)
);
```

## 🛠️ Development

### Project Structure

```
Stellar-Micro-Donation-API/
├── src/
│   ├── config/           # Configuration files
│   ├── middleware/       # Express middleware
│   ├── routes/           # API route handlers
│   │   ├── app.js
│   │   ├── donation.js
│   │   ├── wallet.js
│   │   ├── stream.js
│   │   ├── transaction.js
│   │   └── stats.js
│   ├── services/         # Business logic services
│   │   ├── StellarService.js
│   │   ├── MockStellarService.js
│   │   └── RecurringDonationScheduler.js
│   ├── scripts/          # Database scripts
│   │   └── initDB.js
│   └── utils/            # Utility functions
│       ├── database.js
│       └── permissions.js
├── data/                 # SQLite database files
├── docs/                 # Documentation
├── tests/                # Test files
└── package.json
```

### API Key Permissions

The API uses role-based access control (RBAC) with three roles:

| Role | Permissions | Use Case |
|------|-------------|----------|
| **admin** | All permissions (`*`) | System administration, API key management |
| **user** | donations:*, wallets:*, stream:*, stats:read, transactions:* | Standard API operations |
| **guest** | donations:read, stats:read | Read-only public access |

For detailed permission audit and security hardening, see [API Key Permissions Audit](docs/API_KEY_PERMISSIONS_AUDIT.md).

### Environment Variables

Create a `.env` file in the project root:

```env
STELLAR_NETWORK=testnet
HORIZON_URL=https://horizon-testnet.stellar.org
PORT=3000
```

For API key authentication, use the new database-backed system (recommended):
```bash
npm run keys:create -- --name "My Key" --role user --expires 365
```

Or use legacy environment-based keys (deprecated):
```env
API_KEYS=your-api-key-here
```

Required at startup:
- `API_KEYS` (legacy method, or use database-backed keys)
- `ENCRYPTION_KEY` (required only when `NODE_ENV=production`)

Validated at startup (if provided):
- `PORT` must be an integer from 1 to 65535
- `STELLAR_NETWORK` must be one of `testnet`, `mainnet`, `futurenet`
- `MOCK_STELLAR` must be `true` or `false`
- `HORIZON_URL` must be a valid URL

### API Key Management

The API supports zero-downtime key rotation. See:
- [API Key Rotation Guide](docs/API_KEY_ROTATION.md) - Complete documentation
- [Quick Start Guide](docs/API_KEY_ROTATION_QUICK_START.md) - Common commands

Quick commands:
```bash
npm run keys:create -- --name "My Key" --role user --expires 365
npm run keys:list
npm run keys -- deprecate --id 1
npm run keys -- revoke --id 2
```

## 🧪 Testing

### Run Tests

```bash
npm test
```

### Test Isolation

All tests are fully isolated and can run independently in any order:

```bash
# Run tests in random order to verify isolation
npm test -- --randomize

# Run with specific seed to reproduce order
npm test -- --randomize --seed=123456
```

For detailed information about test isolation, see [Test Isolation Guide](docs/TEST_ISOLATION.md).

### Run Tests with Coverage

```bash
npm run test:coverage
```

This generates:
- Terminal coverage summary
- HTML report at `coverage/lcov-report/index.html`
- LCOV report for CI/CD integration
- JSON summary for programmatic access

### Check Coverage Thresholds

```bash
npm run check-coverage
```

Validates that coverage meets minimum thresholds:
- **Branches**: 30%
- **Functions**: 30%
- **Lines**: 30%
- **Statements**: 30%

### View Coverage Report

After running coverage, open the HTML report:

```bash
# macOS
open coverage/lcov-report/index.html

# Windows
start coverage/lcov-report/index.html

# Linux
xdg-open coverage/lcov-report/index.html
```

### Coverage Enforcement

Coverage is automatically enforced in CI/CD:
- ✅ PRs must meet minimum 30% coverage thresholds
- ❌ Builds fail if coverage drops below thresholds
- 📊 Coverage reports uploaded as artifacts (30-day retention)

For detailed coverage documentation, see [Coverage Guide](docs/COVERAGE_GUIDE.md).

### Run Specific Tests

```bash
npm test -- tests/integration.test.js
```

### Run Integration Tests for Donation Routes

Comprehensive end-to-end tests for all donation endpoints:

```bash
npm test tests/donation-routes-integration.test.js
```

**Coverage**: 60+ test cases covering:
- All 7 donation endpoints
- Success and failure scenarios
- Validation, authentication, idempotency
- Rate limiting and error handling
- No live Stellar network required (uses MockStellarService)

For detailed information, see [Donation Routes Integration Tests](DONATION_ROUTES_INTEGRATION_TESTS.md).

### Test Recurring Donations

```bash
node test-recurring-donations.js
```

### Test Failure Scenarios

The project includes comprehensive failure simulation for testing network errors and retry logic:

```bash
# Run failure simulation tests
npm test tests/stellar-network-failures.test.js

# Run retry logic tests
npm test tests/stellar-retry-logic.test.js
```

**Failure Types Tested**:
- Timeouts and network errors
- Service unavailability
- Transaction failures (bad sequence, insufficient fee)
- Rate limiting
- Partial responses

For detailed information, see [Stellar Failure Simulation Guide](docs/STELLAR_FAILURE_SIMULATION.md).

## �️ Troubleshooting

Having issues? We've got you covered!

### Quick Fixes
- **Server won't start?** Check environment: `npm run validate-env`
- **Tests failing?** Clear cache: `npx jest --clearCache`
- **Port in use?** Kill process: `kill -9 $(lsof -ti:3000)`
- **Dependencies broken?** Fresh install: `rm -rf node_modules package-lock.json && npm install`

### Common Issues
- Missing `.env` file → `cp .env.example .env`
- API keys required → Add `API_KEYS=dev_key_123` to `.env`
- Use mock mode for development → `MOCK_STELLAR=true`

### Get Help
- **[Full Troubleshooting Guide](docs/DEVELOPER_TROUBLESHOOTING_GUIDE.md)** - Comprehensive solutions
- **[Quick Reference](docs/TROUBLESHOOTING_QUICK_REFERENCE.md)** - Fast fixes for common problems
- Check [GitHub Issues](../../issues) for known problems
- Search [Discussions](../../discussions) for community help

### Debug Mode
Enable detailed logging for troubleshooting:
```bash
DEBUG_MODE=true LOG_VERBOSE=true npm start
```

## 🔧 Configuration

### Stellar Network

The API can work with both Stellar testnet and mainnet. Configure via environment variables:

- **Testnet** (default): For development and testing
- **Mainnet**: For production use

### Recurring Donation Scheduler

The scheduler runs automatically when the server starts and checks for due donations every 60 seconds. It can be configured in `src/services/RecurringDonationScheduler.js`.

## 📚 Documentation

### Getting Started
- **[API Examples](docs/API_EXAMPLES.md)** - Complete request/response examples for all endpoints
- **[Quick Start Guide](QUICK_START.md)** - Getting started quickly
- **[Troubleshooting Guide](docs/DEVELOPER_TROUBLESHOOTING_GUIDE.md)** - Solutions for common issues
- **[Quick Reference](docs/TROUBLESHOOTING_QUICK_REFERENCE.md)** - Fast fixes for common problems

### Technical Documentation
- **[Architecture Documentation](docs/ARCHITECTURE.md)** - Detailed system architecture
- **[Versioning Strategy](docs/VERSIONING_STRATEGY.md)** - SemVer rules, release flow, and breaking change policy
- **[Stellar Failure Simulation](docs/STELLAR_FAILURE_SIMULATION.md)** - Network failure testing guide
- **[API Flow Diagram](API%20flow%20diagram.txt)** - API request flow
- **[Mock Stellar Guide](MOCK_STELLAR_GUIDE.md)** - Using mock Stellar service

### Development & Deployment
- **[Pre-Deployment Checklist](docs/guides/PRE_DEPLOYMENT_CHECKLIST.md)** - Production deployment verification
- **[CI Pipeline Documentation](docs/CI_PIPELINE.md)** - Understanding CI/CD workflows
- **[Test Coverage Guide](docs/COVERAGE_GUIDE.md)** - Writing and maintaining tests

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes and add tests
4. Run tests locally (`npm test`)
5. Check coverage (`npm run test:coverage`)
6. Ensure coverage thresholds are met (`npm run check-coverage`)
7. Commit your changes (`git commit -m 'Add amazing feature'`)
8. Push to the branch (`git push origin feature/amazing-feature`)
9. Open a Pull Request

**Note:** All CI checks must pass before merge, including:
- ✅ All tests passing
- ✅ Coverage thresholds met (30% minimum)
- ✅ Linting checks passed
- ✅ Security checks passed

See [Branch Protection](docs/BRANCH_PROTECTION.md) and [Coverage Guide](docs/COVERAGE_GUIDE.md) for details.

## 📝 License

This project is licensed under the MIT License.

## 🙏 Acknowledgments

- [Stellar Development Foundation](https://www.stellar.org/) - Blockchain platform
- [Stellar SDK](https://github.com/stellar/js-stellar-sdk) - JavaScript SDK for Stellar

## 📞 Support

For issues and questions:
- Open an issue on GitHub
- Check the [documentation](docs/)
- Review the [architecture guide](docs/ARCHITECTURE.md)

---

Built with ❤️ using Node.js and Stellar


## 📚 Documentation

For comprehensive documentation, see the [Documentation Index](docs/README.md).

### Key Documentation

- **[Pre-Deployment Checklist](docs/guides/PRE_DEPLOYMENT_CHECKLIST.md)** - Production deployment verification
- **[Quick Start Guide](docs/guides/QUICK_START.md)** - Get started quickly
- **[API Examples](docs/API_EXAMPLES.md)** - Complete API usage examples
- **[Coverage Guide](docs/COVERAGE_GUIDE.md)** - Test coverage documentation
- **[Mock Stellar Guide](docs/guides/MOCK_STELLAR_GUIDE.md)** - Testing without network calls
- **[Versioning Strategy](docs/VERSIONING_STRATEGY.md)** - SemVer rules, release flow, and breaking change policy

