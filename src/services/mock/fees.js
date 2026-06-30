const crypto = require('crypto');
const { ValidationError } = require('../../utils/errors');
const log = require('../../utils/log');

class MockFees {
  constructor(service) {
    this.service = service;
  }

  async estimateFee(operationCount = 1) {
    await this.service._simulateNetworkDelay();
    this.service._simulateFailure();

    const BASE_FEE_STROOPS = 100;
    const multiplier = this.service.config.feeMultiplier !== undefined ? this.service.config.feeMultiplier : 1;
    const recommendedFee = Math.round(BASE_FEE_STROOPS * multiplier);
    const totalFeeStroops = recommendedFee * operationCount;
    const surgeProtection = multiplier >= 5;

    return {
      feeStroops: totalFeeStroops,
      feeXLM: (totalFeeStroops / 1e7).toFixed(7),
      baseFee: BASE_FEE_STROOPS,
      surgeProtection,
      surgeMultiplier: parseFloat(multiplier.toFixed(2)),
    };
  }

  async buildAndSubmitFeeBumpTransaction(envelopeXdr, newFeeStroops, feeSourceSecret) {
    await this.service._simulateNetworkDelay();
    this.service._checkRateLimit();
    this.service._simulateFailure();

    if (!envelopeXdr) {
      throw new ValidationError('envelopeXdr is required');
    }
    if (!newFeeStroops || newFeeStroops < 100) {
      throw new ValidationError('newFeeStroops must be at least 100 (base fee)');
    }
    if (feeSourceSecret) {
      this.service._validateSecretKey(feeSourceSecret);
    }

    const hash = 'mock_feebump_' + crypto.randomBytes(16).toString('hex');
    const ledger = Math.floor(Math.random() * 1000000) + 1000000;

    log.info('MOCK_STELLAR_SERVICE', 'Fee bump transaction submitted', {
      originalEnvelopeLength: envelopeXdr.length,
      newFeeStroops,
      hash,
      ledger,
    });

    return {
      hash,
      ledger,
      fee: newFeeStroops,
      envelopeXdr: 'mock_feebump_envelope_' + crypto.randomBytes(8).toString('hex'),
    };
  }
}

module.exports = MockFees;
