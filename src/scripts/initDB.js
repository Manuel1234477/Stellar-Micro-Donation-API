const fs = require('fs');
const path = require('path');

const DATA_DIR = './data';
const DONATIONS_DB = path.join(DATA_DIR, 'donations.json');
const USERS_DB = path.join(DATA_DIR, 'users.json');
const WALLETS_DB = path.join(DATA_DIR, 'wallets.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`✓ Created data directory: ${DATA_DIR}`);
  }
}

function initDonationsDB() {
  // Sample donation data spanning multiple days and weeks
  const sampleDonations = [
    // Week 1 - Monday to Sunday
    {
      id: '1',
      amount: 50,
      donor: 'Alice',
      recipient: 'Red Cross',
      timestamp: new Date('2024-02-12T10:30:00Z').toISOString(),
      status: 'completed',
      stellarTxId: 'tx_001'
    },
    {
      id: '2',
      amount: 75,
      donor: 'Bob',
      recipient: 'UNICEF',
      timestamp: new Date('2024-02-12T14:15:00Z').toISOString(),
      status: 'completed',
      stellarTxId: 'tx_002'
    },
    {
      id: '3',
      amount: 100,
      donor: 'Charlie',
      recipient: 'Red Cross',
      timestamp: new Date('2024-02-13T09:00:00Z').toISOString(),
      status: 'completed',
      stellarTxId: 'tx_003'
    },
    {
      id: '4',
      amount: 25,
      donor: 'Diana',
      recipient: 'WHO',
      timestamp: new Date('2024-02-13T16:45:00Z').toISOString(),
      status: 'completed',
      stellarTxId: 'tx_004'
    },
    {
      id: '5',
      amount: 150,
      donor: 'Eve',
      recipient: 'UNICEF',
      timestamp: new Date('2024-02-14T11:20:00Z').toISOString(),
      status: 'completed',
      stellarTxId: 'tx_005'
    },
    {
      id: '6',
      amount: 60,
      donor: 'Frank',
      recipient: 'Red Cross',
      timestamp: new Date('2024-02-14T13:30:00Z').toISOString(),
      status: 'completed',
      stellarTxId: 'tx_006'
    },
    {
      id: '7',
      amount: 90,
      donor: 'Grace',
      recipient: 'WHO',
      timestamp: new Date('2024-02-15T08:15:00Z').toISOString(),
      status: 'completed',
      stellarTxId: 'tx_007'
    },
    // Week 2 - Monday to Sunday
    {
      id: '8',
      amount: 120,
      donor: 'Henry',
      recipient: 'Red Cross',
      timestamp: new Date('2024-02-19T10:00:00Z').toISOString(),
      status: 'completed',
      stellarTxId: 'tx_008'
    },
    {
      id: '9',
      amount: 45,
      donor: 'Iris',
      recipient: 'UNICEF',
      timestamp: new Date('2024-02-19T15:30:00Z').toISOString(),
      status: 'completed',
      stellarTxId: 'tx_009'
    },
    {
      id: '10',
      amount: 200,
      donor: 'Jack',
      recipient: 'WHO',
      timestamp: new Date('2024-02-20T12:00:00Z').toISOString(),
      status: 'completed',
      stellarTxId: 'tx_010'
    },
    {
      id: '11',
      amount: 85,
      donor: 'Karen',
      recipient: 'Red Cross',
      timestamp: new Date('2024-02-20T14:45:00Z').toISOString(),
      status: 'completed',
      stellarTxId: 'tx_011'
    },
    {
      id: '12',
      amount: 110,
      donor: 'Leo',
      recipient: 'UNICEF',
      timestamp: new Date('2024-02-21T09:30:00Z').toISOString(),
      status: 'completed',
      stellarTxId: 'tx_012'
    },
    {
      id: '13',
      amount: 55,
      donor: 'Mia',
      recipient: 'WHO',
      timestamp: new Date('2024-02-21T16:00:00Z').toISOString(),
      status: 'completed',
      stellarTxId: 'tx_013'
    },
    {
      id: '14',
      amount: 175,
      donor: 'Noah',
      recipient: 'Red Cross',
      timestamp: new Date('2024-02-22T11:15:00Z').toISOString(),
      status: 'completed',
      stellarTxId: 'tx_014'
    }
  ];

  if (!fs.existsSync(DONATIONS_DB)) {
    fs.writeFileSync(DONATIONS_DB, JSON.stringify(sampleDonations, null, 2));
    console.log(`✓ Initialized donations database with ${sampleDonations.length} sample records`);
  } else {
    console.log('✓ Donations database already exists');
  }
}

function initUsersDB() {
  const sampleUsers = [
    {
      id: '1',
      name: 'Alice',
      walletAddress: 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJMUC5XNODMZTQYBB5XYZXYUU',
      createdAt: new Date('2024-01-15T10:00:00Z').toISOString()
    },
    {
      id: '2',
      name: 'Bob',
      walletAddress: 'GBBD47UZQ5EYJYJMZXZYDUC77SAZXSQEA7XJJGTAY5XJJGUJMUC5XNOD',
      createdAt: new Date('2024-01-20T14:30:00Z').toISOString()
    },
    {
      id: '3',
      name: 'Red Cross',
      walletAddress: 'GCZST3XVCDTUJ76ZAV2HA72KYQM4YQQ5DUJTHIGQ5ESE3JNEZUAEUA7X',
      createdAt: new Date('2024-01-10T08:00:00Z').toISOString()
    }
  ];

  if (!fs.existsSync(USERS_DB)) {
    fs.writeFileSync(USERS_DB, JSON.stringify(sampleUsers, null, 2));
    console.log(`✓ Initialized users database with ${sampleUsers.length} sample records`);
  } else {
    console.log('✓ Users database already exists');
  }
}

function initWalletsDB() {
  const sampleWallets = [
    {
      id: '1',
      address: 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJMUC5XNODMZTQYBB5XYZXYUU',
      label: 'Personal Wallet',
      ownerName: 'Alice',
      createdAt: new Date('2024-01-15T10:00:00Z').toISOString()
    },
    {
      id: '2',
      address: 'GBBD47UZQ5EYJYJMZXZYDUC77SAZXSQEA7XJJGTAY5XJJGUJMUC5XNOD',
      label: 'Savings Account',
      ownerName: 'Bob',
      createdAt: new Date('2024-01-20T14:30:00Z').toISOString()
    },
    {
      id: '3',
      address: 'GCZST3XVCDTUJ76ZAV2HA72KYQM4YQQ5DUJTHIGQ5ESE3JNEZUAEUA7X',
      label: 'Donation Receiver',
      ownerName: 'Red Cross',
      createdAt: new Date('2024-01-10T08:00:00Z').toISOString()
    }
  ];

  if (!fs.existsSync(WALLETS_DB)) {
    fs.writeFileSync(WALLETS_DB, JSON.stringify(sampleWallets, null, 2));
    console.log(`✓ Initialized wallets database with ${sampleWallets.length} sample records`);
  } else {
    console.log('✓ Wallets database already exists');
  }
}

function main() {
  console.log('Initializing Stellar Micro-Donation API Database...\n');
  
  try {
    ensureDataDir();
    initDonationsDB();
    initUsersDB();
    initWalletsDB();
    
    console.log('\n✓ Database initialization complete!');
    console.log(`\nDatabase files:`);
    console.log(`  - ${DONATIONS_DB}`);
    console.log(`  - ${USERS_DB}`);
    console.log(`  - ${WALLETS_DB}`);
  } catch (error) {
    console.error('✗ Database initialization failed:', error.message);
    process.exit(1);
  }
}

main();
