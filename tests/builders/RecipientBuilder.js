/**
 * Recipient Builder - Test Data Builder
 *
 * RESPONSIBILITY: Creates recipient wallet records for donation tests
 * OWNER: QA/Testing Team
 *
 * Provides a fluent API for building recipient objects with unique, collision-safe
 * identifiers. Recipients are the wallet addresses that receive donations.
 *
 * @example
 * const recipient = RecipientBuilder.create();
 * const named = new RecipientBuilder().withName('Save the Oceans').build();
 * const multi = RecipientBuilder.createMany(3);
 */

const { uniquePublicKey, uniqueId } = require('./uniqueId');

class RecipientBuilder {
  constructor() {
    this._publicKey = null;
    this._name = null;
    this._category = 'general';
    this._metadata = {};
  }

  /**
   * Set a specific public key for this recipient.
   * Defaults to a unique generated key if not called.
   * @param {string} publicKey
   * @returns {RecipientBuilder}
   */
  withPublicKey(publicKey) {
    this._publicKey = publicKey;
    return this;
  }

  /**
   * Set a human-readable display name for the recipient.
   * @param {string} name
   * @returns {RecipientBuilder}
   */
  withName(name) {
    this._name = name;
    return this;
  }

  /**
   * Set the recipient category (e.g. 'charity', 'education', 'health').
   * @param {string} category
   * @returns {RecipientBuilder}
   */
  withCategory(category) {
    this._category = category;
    return this;
  }

  /**
   * Attach arbitrary metadata.
   * @param {Object} metadata
   * @returns {RecipientBuilder}
   */
  withMetadata(metadata) {
    this._metadata = { ...this._metadata, ...metadata };
    return this;
  }

  /**
   * Build and return the recipient data object.
   * @returns {{ publicKey: string, name: string, category: string, metadata: Object }}
   */
  build() {
    const id = uniqueId();
    return {
      publicKey: this._publicKey || uniquePublicKey(),
      name: this._name || `Test Recipient ${id}`,
      category: this._category,
      metadata: this._metadata,
    };
  }

  // ─── Static convenience factories ──────────────────────────────────────────

  /**
   * Create a single recipient with default values.
   * @returns {{ publicKey: string, name: string, category: string, metadata: Object }}
   */
  static create() {
    return new RecipientBuilder().build();
  }

  /**
   * Create multiple recipients with default values.
   * @param {number} count
   * @returns {Array<{ publicKey: string, name: string, category: string, metadata: Object }>}
   */
  static createMany(count) {
    return Array.from({ length: count }, () => RecipientBuilder.create());
  }

  /**
   * Create a named charity recipient.
   * @param {string} name
   * @returns {{ publicKey: string, name: string, category: string, metadata: Object }}
   */
  static charity(name = 'Test Charity') {
    return new RecipientBuilder().withName(name).withCategory('charity').build();
  }
}

module.exports = RecipientBuilder;
