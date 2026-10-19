/**
 * Liquidity Pool Service - Stellar AMM Integration
 * 
 * RESPONSIBILITY: Business logic for Stellar Protocol 18 liquidity pool operations
 * OWNER: Backend Team
 * DEPENDENCIES: StellarService, Cache
 * 
 * Issue #1588: Implements native AMM liquidity pool operations for depositing,
 * withdrawing, and querying pool positions. Enables automated market-making for
 * custom donation tokens without manual order placement.
 */

const StellarSdk = require('./stellar/sdk.js');
const { ValidationError, BusinessLogicError } = require('../utils/errors');
const log = require('../utils/log');
const Cache = require('../utils/cache');
const { toStellarSdkAsset } = require('../utils/stellarAsset');

/** Cache TTL for pool data: 30 seconds */
const POOL_CACHE_TTL_MS = 30 * 1000;

class LiquidityPoolService {
  constructor(stellarService) {
    this.stellarService = stellarService;
  }

  /**
   * Deposit assets into a Stellar liquidity pool.
   * 
   * @param {string} secret - Source account secret key
   * @param {Object} assetA - First asset definition
   * @param {Object} assetB - Second asset definition
   * @param {string} maxAmountA - Maximum amount of assetA to deposit
   * @param {string} maxAmountB - Maximum amount of assetB to deposit
   * @param {string} [minPrice] - Minimum price ratio
   * @param {string} [maxPrice] - Maximum price ratio
   * @returns {Promise<Object>} Deposit result with poolId, shares, txId, ledger
   */
  async depositLiquidityPool(secret, assetA, assetB, maxAmountA, maxAmountB, minPrice, maxPrice) {
    // Validate inputs
    if (!secret || !assetA || !assetB || !maxAmountA || !maxAmountB) {
      throw new ValidationError('secret, assetA, assetB, maxAmountA, and maxAmountB are required');
    }

    const maxAmountANum = parseFloat(maxAmountA);
    const maxAmountBNum = parseFloat(maxAmountB);

    if (isNaN(maxAmountANum) || maxAmountANum <= 0) {
      throw new ValidationError('maxAmountA must be a positive number');
    }
    if (isNaN(maxAmountBNum) || maxAmountBNum <= 0) {
      throw new ValidationError('maxAmountB must be a positive number');
    }

    const keypair = StellarSdk.Keypair.fromSecret(secret);
    const publicKey = keypair.publicKey();

    // Convert asset definitions to Stellar SDK assets
    const stellarAssetA = toStellarSdkAsset(assetA);
    const stellarAssetB = toStellarSdkAsset(assetB);

    // Ensure assets are in canonical order (Asset.compare)
    const [orderedAssetA, orderedAssetB] = StellarSdk.Asset.compare(stellarAssetA, stellarAssetB) <= 0
      ? [stellarAssetA, stellarAssetB]
      : [stellarAssetB, stellarAssetA];

    // Fetch pool ID (deterministic based on asset pair)
    const liquidityPoolAsset = new StellarSdk.LiquidityPoolAsset(orderedAssetA, orderedAssetB, StellarSdk.LiquidityPoolFeeV18);
    const poolId = StellarSdk.getLiquidityPoolId('constant_product', liquidityPoolAsset.getLiquidityPoolParameters()).toString('hex');

    // Validate pool reserves
    await this._validatePoolReserves(poolId, maxAmountA, maxAmountB);

    // Build deposit operation
    const account = await this.stellarService.loadAccount(publicKey);
    
    const depositOp = {
      liquidityPoolId: poolId,
      maxAmountA: maxAmountA.toString(),
      maxAmountB: maxAmountB.toString(),
      minPrice: minPrice ? { n: Math.floor(parseFloat(minPrice) * 10000000), d: 10000000 } : undefined,
      maxPrice: maxPrice ? { n: Math.floor(parseFloat(maxPrice) * 10000000), d: 10000000 } : undefined,
    };

    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: this.stellarService.baseFee,
      networkPassphrase: this.stellarService.networkPassphrase,
    })
      .addOperation(StellarSdk.Operation.liquidityPoolDeposit(depositOp))
      .setTimeout(30)
      .build();

    transaction.sign(keypair);

    const result = await this.stellarService.submitTransaction(transaction);

    // Invalidate pool cache
    Cache.delete(`liquidity_pool:${poolId}`);

    log.info('LIQUIDITY_POOL', 'Deposit successful', {
      poolId,
      publicKey,
      txId: result.hash,
      ledger: result.ledger,
    });

    return {
      poolId,
      transactionId: result.hash,
      ledger: result.ledger,
      maxAmountA,
      maxAmountB,
    };
  }

  /**
   * Withdraw assets from a Stellar liquidity pool.
   * 
   * @param {string} secret - Source account secret key
   * @param {string} poolId - Liquidity pool ID (hex string)
   * @param {string} amount - Number of pool shares to redeem
   * @param {string} [minAmountA] - Minimum amount of assetA to receive
   * @param {string} [minAmountB] - Minimum amount of assetB to receive
   * @returns {Promise<Object>} Withdrawal result with txId and ledger
   */
  async withdrawLiquidityPool(secret, poolId, amount, minAmountA, minAmountB) {
    if (!secret || !poolId || !amount) {
      throw new ValidationError('secret, poolId, and amount are required');
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new ValidationError('amount must be a positive number');
    }

    const keypair = StellarSdk.Keypair.fromSecret(secret);
    const publicKey = keypair.publicKey();

    // Build withdraw operation
    const account = await this.stellarService.loadAccount(publicKey);
    
    const withdrawOp = {
      liquidityPoolId: poolId,
      amount: amount.toString(),
      minAmountA: minAmountA ? minAmountA.toString() : '0',
      minAmountB: minAmountB ? minAmountB.toString() : '0',
    };

    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: this.stellarService.baseFee,
      networkPassphrase: this.stellarService.networkPassphrase,
    })
      .addOperation(StellarSdk.Operation.liquidityPoolWithdraw(withdrawOp))
      .setTimeout(30)
      .build();

    transaction.sign(keypair);

    const result = await this.stellarService.submitTransaction(transaction);

    // Invalidate pool cache
    Cache.delete(`liquidity_pool:${poolId}`);

    log.info('LIQUIDITY_POOL', 'Withdrawal successful', {
      poolId,
      publicKey,
      amount,
      txId: result.hash,
      ledger: result.ledger,
    });

    return {
      transactionId: result.hash,
      ledger: result.ledger,
      amount,
    };
  }

  /**
   * Get liquidity pool data from Horizon (with caching).
   * 
   * @param {string} poolId - Liquidity pool ID (hex string)
   * @returns {Promise<Object>} Pool reserves, fee rate, and total shares
   */
  async getLiquidityPool(poolId) {
    if (!poolId) {
      throw new ValidationError('poolId is required');
    }

    // Check cache
    const cacheKey = `liquidity_pool:${poolId}`;
    const cached = Cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Fetch from Horizon
    try {
      const pool = await this.stellarService.server
        .liquidityPools()
        .liquidityPoolId(poolId)
        .call();

      const poolData = {
        id: pool.id,
        fee_bp: pool.fee_bp,
        type: pool.type,
        total_shares: pool.total_shares,
        total_trustlines: pool.total_trustlines,
        reserves: pool.reserves.map(r => ({
          asset: r.asset,
          amount: r.amount,
        })),
      };

      // Cache for 30s
      Cache.set(cacheKey, poolData, POOL_CACHE_TTL_MS);

      return poolData;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        throw new BusinessLogicError('POOL_NOT_FOUND', `Liquidity pool ${poolId} not found`);
      }
      log.error('LIQUIDITY_POOL', 'Failed to fetch pool data', {
        poolId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get liquidity pool earnings (placeholder for future implementation).
   * 
   * @param {string} poolId - Liquidity pool ID
   * @returns {Promise<Object>} Earnings data
   */
  async getLiquidityPoolEarnings(poolId) {
    // Future: Calculate earnings based on share price changes and fee accrual
    // For now, return pool data as a proxy
    const pool = await this.getLiquidityPool(poolId);
    return {
      poolId: pool.id,
      totalShares: pool.total_shares,
      reserves: pool.reserves,
      fee_bp: pool.fee_bp,
      // Future fields: initial_share_price, current_share_price, earnings_xlm
    };
  }

  /**
   * Validate that a pool has sufficient reserves for a deposit.
   * Prevents transaction failures due to underfunded pools.
   * 
   * @param {string} poolId - Pool ID
   * @param {string} maxAmountA - Requested deposit amount A
   * @param {string} maxAmountB - Requested deposit amount B
   * @private
   */
  async _validatePoolReserves(poolId, maxAmountA, maxAmountB) {
    try {
      const pool = await this.getLiquidityPool(poolId);
      
      // For new pools, skip validation
      if (!pool.reserves || pool.reserves.length === 0) {
        return;
      }

      // Check if deposit amounts are reasonable relative to reserves
      const reserveA = parseFloat(pool.reserves[0]?.amount || '0');
      const reserveB = parseFloat(pool.reserves[1]?.amount || '0');
      const depositA = parseFloat(maxAmountA);
      const depositB = parseFloat(maxAmountB);

      // Warn if deposit is > 50% of reserve (may cause high slippage)
      if (reserveA > 0 && depositA > reserveA * 0.5) {
        log.warn('LIQUIDITY_POOL', 'Large deposit relative to reserve A', {
          poolId,
          depositA,
          reserveA,
        });
      }
      if (reserveB > 0 && depositB > reserveB * 0.5) {
        log.warn('LIQUIDITY_POOL', 'Large deposit relative to reserve B', {
          poolId,
          depositB,
          reserveB,
        });
      }
    } catch (error) {
      // Pool doesn't exist yet (will be created on first deposit) — skip validation
      if (error.code === 'POOL_NOT_FOUND') {
        return;
      }
      throw error;
    }
  }
}

module.exports = LiquidityPoolService;
