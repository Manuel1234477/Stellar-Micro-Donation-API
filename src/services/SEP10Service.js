/**
 * SEP-0010 Service - Stellar Web Authentication
 *
 * RESPONSIBILITY: Challenge generation and verification for SEP-0010 web authentication
 * OWNER: Security Team
 * DEPENDENCIES: Stellar SDK, crypto utilities, JWT service
 *
 * Implements Stellar Ecosystem Proposal 0010 for web authentication using
 * challenge-response with Stellar keypairs. Generates time-bound challenges
 * and verifies signed transactions to authenticate users.
 */

const crypto = require('crypto');
const StellarSdk = require('stellar-sdk');
const { issueAccessToken } = require('./JwtService');
const log = require('../utils/log');
const { ValidationError, ERROR_CODES } = require('../utils/errors');

class SEP10Service {
  constructor(stellarService, config = {}) {
    this.stellarService = stellarService;
    this.challengeStore = new Map();
    this.challengePrefix = config.challengePrefix || 'web_auth_';
    this.config = {
      challengeExpiresIn: config.challengeExpiresIn || 15 * 60 * 1000, // default 15 minutes
      serverSigningKey: config.serverSigningKey,
      homeDomain: config.homeDomain || 'localhost',
      ...config
    };

    if (!this.config.serverSigningKey) {
      throw new Error('SEP10Service requires serverSigningKey configuration');
    }
  }

  /**
   * Generate a SEP-0010 challenge transaction
   * Creates a manageData operation with a time-bound memo for client signing
   *
   * @param {string} clientAccount - The client's Stellar public key
   * @returns {string} XDR-encoded challenge transaction
   */
  async generateChallenge(clientAccount) {
    try {
      if (!StellarSdk.StrKey.isValidEd25519PublicKey(clientAccount)) {
        throw new ValidationError(
          'Invalid Stellar public key format',
          null,
          ERROR_CODES.INVALID_REQUEST
        );
      }

      this._cleanupExpiredChallenges();

      const serverKeypair = StellarSdk.Keypair.fromSecret(this.config.serverSigningKey);
      const serverAccount = await this.stellarService.loadAccount(serverKeypair.publicKey());

      const challengeId = this._generateChallengeString();
      const expiresAtMs = Date.now() + this.config.challengeExpiresIn;
      const expiresAtSeconds = Math.floor(expiresAtMs / 1000);
      const memo = `${this.config.homeDomain} auth ${challengeId} ${expiresAtSeconds}`;
      const operationName = `${this.challengePrefix}${challengeId}`;

      const transaction = new StellarSdk.TransactionBuilder(serverAccount, {
        fee: this.stellarService.baseFee,
        networkPassphrase: this.stellarService.networkPassphrase,
      })
        .addOperation(StellarSdk.Operation.manageData({
          name: operationName,
          value: clientAccount,
        }))
        .addMemo(StellarSdk.Memo.text(memo))
        .setTimeout(0)
        .build();

      transaction.sign(serverKeypair);

      this._registerChallenge(challengeId, clientAccount, expiresAtMs);

      log.info('SEP10', 'Challenge transaction generated', {
        clientAccount: this._maskPublicKey(clientAccount),
        challengeId,
        expiresAt: new Date(expiresAtMs).toISOString()
      });

      return transaction.toXDR();
    } catch (error) {
      log.error('SEP10', 'Failed to generate challenge', { error: error.message });
      throw error;
    }
  }

  /**
   * Verify a signed challenge transaction and extract authenticated account
   *
   * @param {string} signedTransactionXDR - The signed challenge transaction in XDR
   * @returns {string} The authenticated Stellar public key
   */
  async verifyChallenge(signedTransactionXDR) {
    try {
      const transaction = StellarSdk.TransactionBuilder.fromXDR(
        signedTransactionXDR,
        this.stellarService.networkPassphrase
      );

      const memoPayload = this._verifyTransactionMemo(transaction);
      const { clientAccount, challengeId: operationChallengeId } = this._verifyChallengeStructure(transaction);

      if (memoPayload.challengeId !== operationChallengeId) {
        throw new ValidationError(
          'Challenge transaction metadata mismatch',
          null,
          ERROR_CODES.INVALID_REQUEST
        );
      }

      this._verifyServerSignature(transaction);
      this._verifyTransactionSignatures(transaction, clientAccount);

      this._getChallengeEntry(memoPayload.challengeId, clientAccount);
      this._markChallengeUsed(memoPayload.challengeId);

      log.info('SEP10', 'Challenge verification successful', {
        account: this._maskPublicKey(clientAccount)
      });

      return clientAccount;
    } catch (error) {
      log.error('SEP10', 'Challenge verification failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Issue a JWT token for a successfully authenticated Stellar account
   *
   * @param {string} stellarAccount - The authenticated Stellar public key
   * @param {object} [claims={}] - Additional claims for the JWT
   * @returns {string} JWT access token
   */
  issueAuthToken(stellarAccount, claims = {}) {
    const jwtClaims = {
      sub: stellarAccount,
      auth_method: 'sep10',
      role: 'user',
      ...claims
    };

    return issueAccessToken(jwtClaims);
  }

  /**
   * Generate a unique challenge string
   * @private
   * @returns {string} Random challenge identifier
   */
  _generateChallengeString() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Register issued challenge for replay detection and TTL enforcement
   * @private
   */
  _registerChallenge(challengeId, clientAccount, expiresAt) {
    this.challengeStore.set(challengeId, {
      account: clientAccount,
      expiresAt,
      issuedAt: Date.now(),
      used: false,
    });
  }

  /**
   * Clean up expired challenges from the in-memory store
   * @private
   */
  _cleanupExpiredChallenges() {
    const now = Date.now();
    for (const [key, entry] of this.challengeStore.entries()) {
      if (entry.expiresAt <= now) {
        this.challengeStore.delete(key);
      }
    }
  }

  /**
   * Fetch a challenge entry and assert it is still valid for the given account
   * @private
   */
  _getChallengeEntry(challengeId, clientAccount) {
    this._cleanupExpiredChallenges();

    const entry = this.challengeStore.get(challengeId);
    if (!entry) {
      throw new ValidationError(
        'Challenge transaction has expired or was not issued by this server',
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }

    if (entry.used) {
      throw new ValidationError(
        'Challenge transaction has already been used',
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }

    if (entry.account !== clientAccount) {
      throw new ValidationError(
        'Challenge transaction account mismatch',
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }

    return entry;
  }

  /**
   * Mark a challenge as consumed to prevent replay
   * @private
   */
  _markChallengeUsed(challengeId) {
    const entry = this.challengeStore.get(challengeId);
    if (entry) {
      entry.used = true;
      entry.usedAt = Date.now();
    }
  }

  /**
   * Verify transaction memo and extract expiration time
   * @private
   * @param {Transaction} transaction
   * @returns {{ challengeId: string, expiresAt: number }}
   */
  _verifyTransactionMemo(transaction) {
    if (!transaction.memo || transaction.memo.type !== StellarSdk.MemoText) {
      throw new ValidationError(
        'Invalid challenge transaction: missing or invalid memo',
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }

    const memoText = transaction.memo.value.toString();
    const parts = memoText.split(' ');

    if (parts.length !== 4 || parts[0] !== this.config.homeDomain || parts[1] !== 'auth') {
      throw new ValidationError(
        'Invalid challenge transaction: malformed memo',
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }

    const challengeId = parts[2];
    const expiresAt = parseInt(parts[3], 10);
    if (!challengeId || isNaN(expiresAt)) {
      throw new ValidationError(
        'Invalid challenge transaction: malformed memo',
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }

    if (Date.now() / 1000 > expiresAt) {
      throw new ValidationError(
        'Challenge transaction has expired',
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }

    return { challengeId, expiresAt };
  }

  /**
   * Verify transaction signatures
   * @private
   * @param {Transaction} transaction
   * @param {string} expectedAccount - Expected signer account
   */
  _verifyTransactionSignatures(transaction, expectedAccount) {
    const clientKeypair = StellarSdk.Keypair.fromPublicKey(expectedAccount);

    try {
      const validSignatures = transaction.signatures.filter(sig => {
        try {
          return clientKeypair.verify(transaction.hash(), sig.signature());
        } catch {
          return false;
        }
      });

      if (validSignatures.length === 0) {
        throw new ValidationError(
          'Challenge transaction not signed by claimed account',
          null,
          ERROR_CODES.INVALID_REQUEST
        );
      }
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      throw new ValidationError(
        'Invalid signature on challenge transaction',
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }
  }

  /**
   * Verify server signature is present on the challenge transaction
   * @private
   * @param {Transaction} transaction
   */
  _verifyServerSignature(transaction) {
    const serverKeypair = StellarSdk.Keypair.fromSecret(this.config.serverSigningKey);

    try {
      const serverSignatureValid = transaction.signatures.some(sig => {
        try {
          return serverKeypair.verify(transaction.hash(), sig.signature());
        } catch {
          return false;
        }
      });

      if (!serverSignatureValid) {
        throw new ValidationError(
          'Challenge transaction missing or invalid server signature',
          null,
          ERROR_CODES.INVALID_REQUEST
        );
      }
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      throw new ValidationError(
        'Invalid server signature on challenge transaction',
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }
  }

  /**
   * Verify the transaction structure matches SEP-0010 challenge format
   * @private
   * @param {Transaction} transaction
   * @returns {{ challengeId: string, clientAccount: string }}
   */
  _verifyChallengeStructure(transaction) {
    if (transaction.operations.length !== 1) {
      throw new ValidationError(
        'Invalid challenge transaction: must have exactly one operation',
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }

    const operation = transaction.operations[0];
    if (operation.type !== 'manageData') {
      throw new ValidationError(
        'Invalid challenge transaction: must be a manageData operation',
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }

    const clientAccount = operation.value.toString();
    if (!StellarSdk.StrKey.isValidEd25519PublicKey(clientAccount)) {
      throw new ValidationError(
        'Invalid challenge transaction: manageData value must be a valid Stellar public key',
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }

    const challengeId = this._extractChallengeIdFromOperation(operation);
    if (!challengeId) {
      throw new ValidationError(
        'Invalid challenge transaction: unexpected operation name',
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }

    return { challengeId, clientAccount };
  }

  /**
   * Extract challenge identifier from manageData operation name
   * @private
   */
  _extractChallengeIdFromOperation(operation) {
    if (!operation.name || typeof operation.name !== 'string') return null;
    if (!operation.name.startsWith(this.challengePrefix)) return null;
    return operation.name.slice(this.challengePrefix.length);
  }

  /**
   * Mask a public key for logging (show first and last 4 characters)
   * @private
   * @param {string} publicKey
   * @returns {string} Masked public key
   */
  _maskPublicKey(publicKey) {
    if (publicKey.length < 8) return publicKey;
    return `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`;
  }
}

module.exports = SEP10Service;
