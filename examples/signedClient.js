'use strict';

const crypto = require('crypto');
const { buildCanonicalString, hashBody } = require('../src/utils/requestSigner');

class SignedApiClient {
  constructor({ baseUrl, apiKey, apiSecret }) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  _sign(method, path, timestamp, body = '') {
    const canonical = buildCanonicalString(method, path, timestamp, hashBody(body));
    return crypto.createHmac('sha256', this.apiSecret).update(canonical).digest('hex');
  }
}

module.exports = SignedApiClient;
