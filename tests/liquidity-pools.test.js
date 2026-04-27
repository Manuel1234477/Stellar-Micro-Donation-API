'use strict';
/**
 * Tests for Issue #411: Stellar liquidity pool deposits
 */
process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key,admin-key';

const MockStellarService = require('../src/services/MockStellarService');

const NATIVE = { type: 'native' };
const USDC = { type: 'credit_alphanum4', code: 'USDC', issuer: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890' };

describe('Liquidity Pool Operations - Issue #411', () => {
  let mockService;
  let walletA;

  beforeEach(async () => {
    mockService = new MockStellarService();
    walletA = await mockService.createWallet();
    const wallet = mockService.wallets.get(walletA.publicKey);
    wallet.assetBalances['native'] = '1000';
    wallet.assetBalances['USDC:GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890'] = '500';
  });

  // ── depositLiquidityPool ──────────────────────────────────────────────────

  describe('MockStellarService.depositLiquidityPool', () => {
    it('returns poolId, sharesReceived, transactionId, ledger', async () => {
      const result = await mockService.depositLiquidityPool(
        walletA.secretKey, NATIVE, USDC, '100', '50'
      );
      expect(result.poolId).toBeDefined();
      expect(parseFloat(result.sharesReceived)).toBeGreaterThan(0);
      expect(result.transactionId).toBeDefined();
      expect(result.ledger).toBeGreaterThan(0);
    });

    it('deducts deposited amounts from wallet balances', async () => {
      await mockService.depositLiquidityPool(walletA.secretKey, NATIVE, USDC, '100', '50');
      const wallet = mockService.wallets.get(walletA.publicKey);
      expect(parseFloat(wallet.assetBalances['native'])).toBeCloseTo(900);
    });

    it('throws on insufficient balance for assetA', async () => {
      await expect(
        mockService.depositLiquidityPool(walletA.secretKey, NATIVE, USDC, '9999', '50')
      ).rejects.toThrow(/Insufficient balance/);
    });

    it('throws on invalid (negative) maxAmountA', async () => {
      await expect(
        mockService.depositLiquidityPool(walletA.secretKey, NATIVE, USDC, '-1', '50')
      ).rejects.toThrow(/positive/);
    });

    it('throws on invalid (zero) maxAmountB', async () => {
      await expect(
        mockService.depositLiquidityPool(walletA.secretKey, NATIVE, USDC, '10', '0')
      ).rejects.toThrow(/positive/);
    });

    it('two deposits to same pool accumulate reserves', async () => {
      const walletB = await mockService.createWallet();
      const wb = mockService.wallets.get(walletB.publicKey);
      wb.assetBalances['native'] = '1000';
      wb.assetBalances['USDC:GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890'] = '500';

      const r1 = await mockService.depositLiquidityPool(walletA.secretKey, NATIVE, USDC, '100', '50');
      const r2 = await mockService.depositLiquidityPool(walletB.secretKey, NATIVE, USDC, '200', '100');

      expect(r1.poolId).toBe(r2.poolId);
      const pool = mockService._liquidityPools.get(r1.poolId);
      expect(pool.reserveA).toBeCloseTo(300);
      expect(pool.reserveB).toBeCloseTo(150);
    });

    it('pool ID is deterministic for same asset pair', async () => {
      const r1 = await mockService.depositLiquidityPool(walletA.secretKey, NATIVE, USDC, '10', '5');
      const wallet = mockService.wallets.get(walletA.publicKey);
      wallet.assetBalances['native'] = '1000';
      wallet.assetBalances['USDC:GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890'] = '500';
      const r2 = await mockService.depositLiquidityPool(walletA.secretKey, NATIVE, USDC, '10', '5');
      expect(r1.poolId).toBe(r2.poolId);
    });
  });

  // ── withdrawLiquidityPool ─────────────────────────────────────────────────

  describe('MockStellarService.withdrawLiquidityPool', () => {
    let poolId;
    let sharesReceived;

    beforeEach(async () => {
      const result = await mockService.depositLiquidityPool(
        walletA.secretKey, NATIVE, USDC, '100', '50'
      );
      poolId = result.poolId;
      sharesReceived = parseFloat(result.sharesReceived);
    });

    it('returns amountA, amountB, transactionId, ledger', async () => {
      const result = await mockService.withdrawLiquidityPool(
        walletA.secretKey, poolId, sharesReceived
      );
      expect(parseFloat(result.amountA)).toBeGreaterThan(0);
      expect(parseFloat(result.amountB)).toBeGreaterThan(0);
      expect(result.transactionId).toBeDefined();
      expect(result.ledger).toBeGreaterThan(0);
    });

    it('restores wallet balances after full withdrawal', async () => {
      await mockService.withdrawLiquidityPool(walletA.secretKey, poolId, sharesReceived);
      const wallet = mockService.wallets.get(walletA.publicKey);
      expect(parseFloat(wallet.assetBalances['native'])).toBeCloseTo(1000);
    });

    it('throws on insufficient shares', async () => {
      await expect(
        mockService.withdrawLiquidityPool(walletA.secretKey, poolId, sharesReceived * 2)
      ).rejects.toThrow(/Insufficient pool shares/);
    });

    it('throws on unknown pool', async () => {
      await expect(
        mockService.withdrawLiquidityPool(walletA.secretKey, 'nonexistent-pool', 1)
      ).rejects.toThrow(/Pool not found/);
    });

    it('throws on invalid (zero) amount', async () => {
      await expect(
        mockService.withdrawLiquidityPool(walletA.secretKey, poolId, 0)
      ).rejects.toThrow(/positive/);
    });
  });

  // ── getLiquidityPoolEarnings ──────────────────────────────────────────────

  describe('MockStellarService.getLiquidityPoolEarnings', () => {
    it('returns pool earnings data', async () => {
      const { poolId } = await mockService.depositLiquidityPool(
        walletA.secretKey, NATIVE, USDC, '100', '50'
      );
      const earnings = await mockService.getLiquidityPoolEarnings(poolId);
      expect(earnings.poolId).toBe(poolId);
      expect(earnings.totalShares).toBeGreaterThan(0);
      expect(earnings.reserveA).toBeCloseTo(100);
      expect(earnings.reserveB).toBeCloseTo(50);
      expect(earnings.earnings).toBeDefined();
    });

    it('throws on unknown pool', async () => {
      await expect(
        mockService.getLiquidityPoolEarnings('unknown-pool')
      ).rejects.toThrow(/Pool not found/);
    });

    it('throws when no pools exist at all', async () => {
      const fresh = new MockStellarService();
      await expect(
        fresh.getLiquidityPoolEarnings('any-pool')
      ).rejects.toThrow(/Pool not found/);
    });
  });

  // ── Partial deposit atomicity ─────────────────────────────────────────────

  describe('Partial deposit atomicity', () => {
    it('does not deduct funds when deposit fails due to insufficient balance', async () => {
      const wallet = mockService.wallets.get(walletA.publicKey);
      const balBefore = parseFloat(wallet.assetBalances['native']);

      await expect(
        mockService.depositLiquidityPool(walletA.secretKey, NATIVE, USDC, '9999', '50')
      ).rejects.toBeDefined();

      const balAfter = parseFloat(mockService.wallets.get(walletA.publicKey).assetBalances['native']);
      expect(balAfter).toBe(balBefore);
    });

    it('does not deduct funds when deposit fails due to invalid amount', async () => {
      const wallet = mockService.wallets.get(walletA.publicKey);
      const balBefore = parseFloat(wallet.assetBalances['native']);

      await expect(
        mockService.depositLiquidityPool(walletA.secretKey, NATIVE, USDC, '-5', '50')
      ).rejects.toBeDefined();

      const balAfter = parseFloat(mockService.wallets.get(walletA.publicKey).assetBalances['native']);
      expect(balAfter).toBe(balBefore);
    });
  });

  // ── Route module loads ────────────────────────────────────────────────────

  describe('Liquidity pools route module', () => {
    it('exports an express router', () => {
      const router = require('../src/routes/liquidity-pools');
      expect(typeof router).toBe('function');
    });
  });
});
