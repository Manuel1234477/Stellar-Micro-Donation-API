/**
 * Donation Request Builder - Test Data Builder
 * 
 * RESPONSIBILITY: Simplifies donation request creation for API tests
 * OWNER: QA/Testing Team
 * 
 * Provides fluent API for building donation request payloads with sensible defaults.
 */

class DonationRequestBuilder {
  constructor() {
    this.data = {
      amount: '100',
      donor: null,
      recipient: null,
      memo: null
    };
  }

  /**
   * Set donation amount
   * @param {string|number} amount
   * @returns {DonationRequestBuilder}
   */
  withAmount(amount) {
    this.data.amount = String(amount);
    return this;
  }

  /**
   * Set donor public key
   * @param {string} publicKey
   * @returns {DonationRequestBuilder}
   */
  withDonor(publicKey) {
    this.data.donor = publicKey;
    return this;
  }

  /**
   * Set recipient public key
   * @param {string} publicKey
   * @returns {DonationRequestBuilder}
   */
  withRecipient(publicKey) {
    this.data.recipient = publicKey;
    return this;
  }

  /**
   * Set memo text
   * @param {string} memo
   * @returns {DonationRequestBuilder}
   */
  withMemo(memo) {
    this.data.memo = memo;
    return this;
  }

  /**
   * Set donor from wallet object
   * @param {Object} wallet - Wallet with publicKey
   * @returns {DonationRequestBuilder}
   */
  fromWallet(wallet) {
    this.data.donor = wallet.publicKey;
    return this;
  }

  /**
   * Set recipient from wallet object
   * @param {Object} wallet - Wallet with publicKey
   * @returns {DonationRequestBuilder}
   */
  toWallet(wallet) {
    this.data.recipient = wallet.publicKey;
    return this;
  }

  /**
   * Set both donor and recipient from wallet objects
   * @param {Object} donor - Donor wallet
   * @param {Object} recipient - Recipient wallet
   * @returns {DonationRequestBuilder}
   */
  between(donor, recipient) {
    this.data.donor = donor.publicKey;
    this.data.recipient = recipient.publicKey;
    return this;
  }

  /**
   * Build and return the donation request data
   * @returns {Object}
   */
  build() {
    // Remove null values
    const result = {};
    Object.keys(this.data).forEach(key => {
      if (this.data[key] !== null) {
        result[key] = this.data[key];
      }
    });
    return result;
  }

  /**
   * Create a minimal valid donation request
   * @param {Object} donor - Donor wallet
   * @param {Object} recipient - Recipient wallet
   * @returns {Object}
   */
  static minimal(donor, recipient) {
    return new DonationRequestBuilder()
      .between(donor, recipient)
      .build();
  }

  /**
   * Create a complete donation request with memo
   * @param {Object} donor - Donor wallet
   * @param {Object} recipient - Recipient wallet
   * @param {string} amount - Donation amount
   * @param {string} memo - Memo text
   * @returns {Object}
   */
  static complete(donor, recipient, amount = '100', memo = 'Test donation') {
    return new DonationRequestBuilder()
      .between(donor, recipient)
      .withAmount(amount)
      .withMemo(memo)
      .build();
  }

  /**
   * Create an invalid donation request (missing required fields)
   * @returns {Object}
   */
  static invalid() {
    return new DonationRequestBuilder().build();
  }
}

module.exports = DonationRequestBuilder;
