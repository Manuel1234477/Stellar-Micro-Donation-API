/**
 * EscrowContract
 * JavaScript simulation of a Soroban escrow smart contract.
 * Holds donated funds and releases them only when a configurable campaign goal is reached.
 */

class EscrowContract {
  /**
   * @param {number} goalAmount - The target amount required before funds can be released
   */
  constructor(goalAmount) {
    if (typeof goalAmount !== 'number' || goalAmount <= 0) {
      throw new Error('goalAmount must be positive');
    }
    this._goalAmount = goalAmount;
    this._balance = 0;
    this._donors = {};
    this._released = false;
    this._ledger = 1000000;
  }

  /**
   * Deposit funds into the escrow.
   * @param {string} donorId - Identifier for the donor
   * @param {number} amount - Amount to deposit (must be positive)
   * @returns {{ donorId: string, amount: number, newBalance: number }}
   */
  deposit(donorId, amount) {
    if (typeof amount !== 'number' || amount <= 0) {
      throw new Error('amount must be positive');
    }
    this._balance += amount;
    this._donors[donorId] = (this._donors[donorId] || 0) + amount;
    this._ledger += 1;
    return { donorId, amount, newBalance: this._balance };
  }

  /**
   * Release the full escrow balance to the recipient when the goal is met.
   * @param {string} recipientId - Identifier for the recipient
   * @returns {{ recipientId: string, amount: number, events: ContractEvent[] }}
   */
  release(recipientId) {
    if (this._balance < this._goalAmount) {
      throw new Error('Goal not yet reached');
    }
    const amount = this._balance;
    this._balance = 0;
    this._released = true;
    this._ledger += 1;

    const event = {
      contractId: 'escrow',
      type: 'release',
      topics: ['release', recipientId],
      data: { recipientId, amount },
      timestamp: new Date().toISOString(),
      ledger: this._ledger,
    };

    return { recipientId, amount, events: [event] };
  }

  /**
   * Get the current state of the escrow contract.
   * @returns {{ balance: number, goalAmount: number, donors: Object, released: boolean }}
   */
  getState() {
    return {
      balance: this._balance,
      goalAmount: this._goalAmount,
      donors: { ...this._donors },
      released: this._released,
    };
  }
}

module.exports = EscrowContract;
