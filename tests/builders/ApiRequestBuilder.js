/**
 * API Request Builder - Test Data Builder
 * 
 * RESPONSIBILITY: Simplifies HTTP request setup with headers and authentication
 * OWNER: QA/Testing Team
 * 
 * Provides fluent API for building supertest requests with common headers and auth.
 */

class ApiRequestBuilder {
  constructor(request, app) {
    this.request = request;
    this.app = app;
    this.headers = {};
    this.apiKey = 'test-key-1'; // Default test API key
    this.idempotencyKey = null;
    this.autoIdempotency = false;
  }

  /**
   * Set API key for authentication
   * @param {string} key
   * @returns {ApiRequestBuilder}
   */
  withApiKey(key) {
    this.apiKey = key;
    return this;
  }

  /**
   * Use admin API key
   * @param {string} adminKey - Optional admin key, defaults to 'test-admin-key'
   * @returns {ApiRequestBuilder}
   */
  asAdmin(adminKey = 'test-admin-key') {
    this.apiKey = adminKey;
    return this;
  }

  /**
   * Use user API key
   * @param {string} userKey - Optional user key, defaults to 'test-key-1'
   * @returns {ApiRequestBuilder}
   */
  asUser(userKey = 'test-key-1') {
    this.apiKey = userKey;
    return this;
  }

  /**
   * Set idempotency key
   * @param {string} key
   * @returns {ApiRequestBuilder}
   */
  withIdempotencyKey(key) {
    this.idempotencyKey = key;
    return this;
  }

  /**
   * Auto-generate unique idempotency key
   * @returns {ApiRequestBuilder}
   */
  withAutoIdempotency() {
    this.autoIdempotency = true;
    return this;
  }

  /**
   * Add custom header
   * @param {string} name
   * @param {string} value
   * @returns {ApiRequestBuilder}
   */
  withHeader(name, value) {
    this.headers[name] = value;
    return this;
  }

  /**
   * Build POST request
   * @param {string} path
   * @param {Object} body
   * @returns {Test}
   */
  post(path, body = {}) {
    let req = this.request(this.app).post(path);
    req = this._applyHeaders(req);
    return req.send(body);
  }

  /**
   * Build GET request
   * @param {string} path
   * @param {Object} query - Optional query parameters
   * @returns {Test}
   */
  get(path, query = {}) {
    let req = this.request(this.app).get(path);
    req = this._applyHeaders(req);
    if (Object.keys(query).length > 0) {
      req = req.query(query);
    }
    return req;
  }

  /**
   * Build PATCH request
   * @param {string} path
   * @param {Object} body
   * @returns {Test}
   */
  patch(path, body = {}) {
    let req = this.request(this.app).patch(path);
    req = this._applyHeaders(req);
    return req.send(body);
  }

  /**
   * Build DELETE request
   * @param {string} path
   * @returns {Test}
   */
  delete(path) {
    let req = this.request(this.app).delete(path);
    req = this._applyHeaders(req);
    return req;
  }

  /**
   * Apply headers to request
   * @private
   */
  _applyHeaders(req) {
    // Apply API key
    if (this.apiKey) {
      req = req.set('X-API-Key', this.apiKey);
    }

    // Apply idempotency key
    if (this.autoIdempotency) {
      req = req.set('X-Idempotency-Key', `test-idem-${Date.now()}-${Math.random()}`);
    } else if (this.idempotencyKey) {
      req = req.set('X-Idempotency-Key', this.idempotencyKey);
    }

    // Apply custom headers
    Object.keys(this.headers).forEach(name => {
      req = req.set(name, this.headers[name]);
    });

    return req;
  }

  /**
   * Create a new builder instance
   * @param {Function} request - supertest request function
   * @param {Express} app - Express app instance
   * @returns {ApiRequestBuilder}
   */
  static create(request, app) {
    return new ApiRequestBuilder(request, app);
  }

  /**
   * Create builder for donation endpoint
   * @param {Function} request
   * @param {Express} app
   * @returns {ApiRequestBuilder}
   */
  static forDonation(request, app) {
    return new ApiRequestBuilder(request, app).withAutoIdempotency();
  }

  /**
   * Create builder for admin endpoint
   * @param {Function} request
   * @param {Express} app
   * @param {string} adminKey
   * @returns {ApiRequestBuilder}
   */
  static forAdmin(request, app, adminKey = 'test-admin-key') {
    return new ApiRequestBuilder(request, app).asAdmin(adminKey);
  }
}

module.exports = ApiRequestBuilder;
