const StellarSdk = require('stellar-sdk');
const StellarErrorHandler = require('../../utils/stellarErrorHandler');
const log = require('../../utils/log');
const { withTimeout } = require('../../utils/timeoutHandler');

class StellarFees {
  constructor(service) {
    this.service = service;
  }

  async estimateFee(operationCount = 1) {
    return StellarErrorHandler.wrap(async () => {
      const BASE_FEE_STROOPS = parseInt(StellarSdk.BASE_FEE, 10);
      let recommendedFee = BASE_FEE_STROOPS;
      let surgeMultiplier = 1;

      try {
        const feeStats = await withTimeout(
          this.service.server.feeStats(),
          this.service.timeouts.api,
          'feeStats'
        );
        const p70 = parseInt(feeStats.fee_charged?.p70 || feeStats.max_fee?.p70 || BASE_FEE_STROOPS, 10);
        recommendedFee = Math.max(p70, BASE_FEE_STROOPS);
        surgeMultiplier = recommendedFee / BASE_FEE_STROOPS;
      } catch (_err) {
        log.warn('STELLAR_SERVICE', 'Could not fetch fee stats, using base fee', { error: _err.message });
      }

      const totalFeeStroops = recommendedFee * operationCount;
      const surgeProtection = surgeMultiplier >= 5;

      return {
        feeStroops: totalFeeStroops,
        feeXLM: (totalFeeStroops / 1e7).toFixed(7),
        baseFee: BASE_FEE_STROOPS,
        surgeProtection,
        surgeMultiplier: parseFloat(surgeMultiplier.toFixed(2)),
      };
    }, 'estimateFee');
  }

  async buildAndSubmitFeeBumpTransaction(envelopeXdr, newFeeStroops, feeSourceSecret) {
    return StellarErrorHandler.wrap(async () => {
      const feeSourceKeypair = StellarSdk.Keypair.fromSecret(feeSourceSecret);

      const innerTransaction = StellarSdk.TransactionBuilder.fromXDR(
        envelopeXdr,
        this.service.networkPassphrase
      );

      const feeBumpTx = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
        feeSourceKeypair,
        String(newFeeStroops),
        innerTransaction,
        this.service.networkPassphrase
      );

      feeBumpTx.sign(feeSourceKeypair);

      const result = await this.service._submitTransactionWithNetworkSafety(feeBumpTx);
      return {
        hash: result.hash,
        ledger: result.ledger,
        fee: newFeeStroops,
        envelopeXdr: feeBumpTx.toEnvelope().toXDR('base64'),
      };
    }, 'buildAndSubmitFeeBumpTransaction');
  }
}

module.exports = StellarFees;
