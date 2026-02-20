const fs = require('fs');
const path = require('path');
const config = require('../../config/stellar');

class Transaction {
  static getDbPath() {
    return config.dbPath;
  }

  static ensureDbDir() {
    const dir = path.dirname(this.getDbPath());
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  static loadTransactions() {
    this.ensureDbDir();
    const dbPath = this.getDbPath();
    if (!fs.existsSync(dbPath)) {
      return [];
    }
    try {
      const data = fs.readFileSync(dbPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return [];
    }
  }

  static saveTransactions(transactions) {
    this.ensureDbDir();
    fs.writeFileSync(this.getDbPath(), JSON.stringify(transactions, null, 2));
  }

  static create(transactionData) {
    const transactions = this.loadTransactions();

   if (transactionData.idempotencyKey) {
    const existingTransaction = transactions.find(
      t => t.idempotencyKey === transactionData.idempotencyKey
    );

    if (existingTransaction) {
      return existingTransaction; 
    }
  }

    const newTransaction = {
      id: Date.now().toString(),
      amount: transactionData.amount,
      donor: transactionData.donor,
      recipient: transactionData.recipient,
      memo: transactionData.memo || '',
      timestamp: new Date().toISOString(),
      status: transactionData.status || 'pending',
      stellarTxId: transactionData.stellarTxId || null,
      stellarLedger: transactionData.stellarLedger || null,
      statusUpdatedAt: new Date().toISOString(),
      ...transactionData
    };
    transactions.push(newTransaction);
    this.saveTransactions(transactions);
    return newTransaction;
  }

  static getPaginated({ limit = 10, offset = 0 } = {}) {
  const transactions = this.loadTransactions();

  const total = transactions.length;

  
  limit = parseInt(limit);
  offset = parseInt(offset);

  
  const paginatedData = transactions.slice(offset, offset + limit);

  return {
    data: paginatedData,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total
    }
  };
}

  static getById(id) {
    const transactions = this.loadTransactions();
    return transactions.find(t => t.id === id);
  }

  static getByDateRange(startDate, endDate) {
    const transactions = this.loadTransactions();
    return transactions.filter(t => {
      const txDate = new Date(t.timestamp);
      return txDate >= startDate && txDate <= endDate;
    });
  }

  static updateStatus(id, status, stellarData = {}) {
    const transactions = this.loadTransactions();
    const index = transactions.findIndex(t => t.id === id);
    
    if (index === -1) {
      throw new Error(`Transaction not found: ${id}`);
    }

    transactions[index].status = status;
    transactions[index].statusUpdatedAt = new Date().toISOString();
    
    if (stellarData.transactionId) {
      transactions[index].stellarTxId = stellarData.transactionId;
    }
    if (stellarData.ledger) {
      transactions[index].stellarLedger = stellarData.ledger;
    }
    if (stellarData.confirmedAt) {
      transactions[index].confirmedAt = stellarData.confirmedAt;
    }

    this.saveTransactions(transactions);
    return transactions[index];
  }

  static getByStatus(status) {
    const transactions = this.loadTransactions();
    return transactions.filter(t => t.status === status);
  }

  static getByStellarTxId(stellarTxId) {
    const transactions = this.loadTransactions();
    return transactions.find(t => t.stellarTxId === stellarTxId);
  }

  static getDailyTotalByDonor(donor, date = new Date()) {
    const transactions = this.loadTransactions();
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return transactions
      .filter(t => {
        const txDate = new Date(t.timestamp);
        return t.donor === donor && 
               txDate >= startOfDay && 
               txDate <= endOfDay &&
               t.status !== 'failed' &&
               t.status !== 'cancelled';
      })
      .reduce((total, t) => total + t.amount, 0);
  }
}

module.exports = Transaction;
