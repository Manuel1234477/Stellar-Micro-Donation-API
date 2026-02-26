/**
 * API Key Builder - Test Data Builder
 * 
 * RESPONSIBILITY: Simplifies API key creation for authentication tests
 * OWNER: QA/Testing Team
 * 
 * Provides fluent API for creating test API keys with different roles and statuses.
 */

const apiKeysModel = require('../../src/models/apiKeys');

class ApiKeyBuilder {
  constructor() {
    this.data = {
      name: 'Test API Key',
      role: 'user',
      createdBy: 'test-suite',
      expiresInDays: null,
      metadata: null
    };
    this.createdKeys = []; // Track created keys for cleanup
  }

  /**
   * Set API key name
   * @param {string} name
   * @returns {ApiKeyBuilder}
   */
  withName(name) {
    this.data.name = name;
    return this;
  }

  /**
   * Set API key role
   * @param {string} role - 'admin', 'user', or 'guest'
   * @returns {ApiKeyBuilder}
   */
  withRole(role) {
    this.data.role = role;
    return this;
  }

  /**
   * Set as admin role
   * @returns {ApiKeyBuilder}
   */
  asAdmin() {
    this.data.role = 'admin';
    return this;
  }

  /**
   * Set as user role
   * @returns {ApiKeyBuilder}
   */
  asUser() {
    this.data.role = 'user';
    return this;
  }

  /**
   * Set as guest role
   * @returns {ApiKeyBuilder}
   */
  asGuest() {
    this.data.role = 'guest';
    return this;
  }

  /**
   * Set expiration in days
   * @param {number} days
   * @returns {ApiKeyBuilder}
   */
  expiresIn(days) {
    this.data.expiresInDays = days;
    return this;
  }

  /**
   * Set metadata
   * @param {Object} metadata
   * @returns {ApiKeyBuilder}
   */
  withMetadata(metadata) {
    this.data.metadata = metadata;
    return this;
  }

  /**
   * Set created by
   * @param {string} createdBy
   * @returns {ApiKeyBuilder}
   */
  createdBy(createdBy) {
    this.data.createdBy = createdBy;
    return this;
  }

  /**
   * Build and create the API key in database
   * @returns {Promise<{key: string, keyPrefix: string, id: number, ...}>}
   */
  async build() {
    const keyInfo = await apiKeysModel.createApiKey(this.data);
    this.createdKeys.push(keyInfo.id);
    return keyInfo;
  }

  /**
   * Build multiple API keys
   * @param {number} count
   * @returns {Promise<Array>}
   */
  async buildMany(count) {
    const keys = [];
    for (let i = 0; i < count; i++) {
      const keyData = { ...this.data };
      keyData.name = `${keyData.name} ${i + 1}`;
      const keyInfo = await apiKeysModel.createApiKey(keyData);
      this.createdKeys.push(keyInfo.id);
      keys.push(keyInfo);
    }
    return keys;
  }

  /**
   * Get list of created key IDs for cleanup
   * @returns {Array<number>}
   */
  getCreatedKeyIds() {
    return [...this.createdKeys];
  }

  /**
   * Clean up all created keys
   * @returns {Promise<void>}
   */
  async cleanup() {
    const db = require('../../src/utils/database');
    for (const keyId of this.createdKeys) {
      try {
        await db.run('DELETE FROM api_keys WHERE id = ?', [keyId]);
      } catch (error) {
        // Ignore errors during cleanup
      }
    }
    this.createdKeys = [];
  }

  /**
   * Create an admin API key
   * @param {string} name
   * @returns {Promise<Object>}
   */
  static async admin(name = 'Test Admin Key') {
    return new ApiKeyBuilder()
      .withName(name)
      .asAdmin()
      .build();
  }

  /**
   * Create a user API key
   * @param {string} name
   * @returns {Promise<Object>}
   */
  static async user(name = 'Test User Key') {
    return new ApiKeyBuilder()
      .withName(name)
      .asUser()
      .build();
  }

  /**
   * Create a guest API key
   * @param {string} name
   * @returns {Promise<Object>}
   */
  static async guest(name = 'Test Guest Key') {
    return new ApiKeyBuilder()
      .withName(name)
      .asGuest()
      .build();
  }

  /**
   * Create admin and user key pair
   * @returns {Promise<{admin: Object, user: Object}>}
   */
  static async createAdminUserPair() {
    const builder = new ApiKeyBuilder();
    const admin = await builder.asAdmin().withName('Test Admin').build();
    const user = await builder.asUser().withName('Test User').build();
    return { admin, user };
  }
}

module.exports = ApiKeyBuilder;
