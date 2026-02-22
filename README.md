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
- [Documentation](#documentation)

## ✨ Features

- **One-Time Donations**: Create and verify donations on Stellar testnet/mainnet
- **Recurring Donations**: Schedule automated recurring donations (daily, weekly, monthly)
- **Wallet Management**: Track wallets and query transaction history
- **Analytics**: Get donation statistics and summaries
- **Mock Mode**: Development mode with simulated Stellar operations
- **Automated Scheduler**: Background service for executing recurring donations

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

## 📡 API Endpoints

### Donations

- `POST /donations` - Create a new donation
- `GET /donations` - List all donations
- `GET /donations/recent?limit=10` - Get recent donations
- `GET /donations/:id` - Get specific donation
- `POST /donations/verify` - Verify transaction on blockchain

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

- `GET /stats/donations` - Get donation statistics
- `GET /stats/summary` - Get summary analytics

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
│   │   └── stats.js
│   ├── services/         # Business logic services
│   │   ├── StellarService.js
│   │   ├── MockStellarService.js
│   │   └── RecurringDonationScheduler.js
│   ├── scripts/          # Database scripts
│   │   └── initDB.js
│   └── utils/            # Utility functions
│       └── database.js
├── data/                 # SQLite database files
├── docs/                 # Documentation
├── tests/                # Test files
└── package.json
```

### Environment Variables

Create a `.env` file in the `src/` directory:

```env
STELLAR_NETWORK=testnet
HORIZON_URL=https://horizon-testnet.stellar.org
PORT=3000
```

## 🧪 Testing

Run tests:
```bash
npm test
```

Run specific test file:
```bash
npm test -- tests/integration.test.js
```

### Test Recurring Donations

```bash
node test-recurring-donations.js
```

## 📚 Documentation

- [Architecture Documentation](docs/ARCHITECTURE.md) - Detailed system architecture
- [API Flow Diagram](API%20flow%20diagram.txt) - API request flow
- [Mock Stellar Guide](MOCK_STELLAR_GUIDE.md) - Using mock Stellar service
- [Quick Start Guide](QUICK_START.md) - Getting started quickly

## 🔧 Configuration

### Stellar Network

The API can work with both Stellar testnet and mainnet. Configure via environment variables:

- **Testnet** (default): For development and testing
- **Mainnet**: For production use

### Recurring Donation Scheduler

The scheduler runs automatically when the server starts and checks for due donations every 60 seconds. It can be configured in `src/services/RecurringDonationScheduler.js`.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

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
