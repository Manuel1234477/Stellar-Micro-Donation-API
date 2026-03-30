'use strict';

/**
 * Social Recovery Tests
 *
 * Covers:
 * - Guardian designation
 * - Recovery initiation creates pending request
 * - Guardian approval accumulates correctly
 * - Recovery executes at threshold
 * - 48-hour time-lock enforced
 * - Funds transferred to new account on success
 */

const SocialRecoveryService = require('../../src/services/SocialRecoveryService');
const Database = require('../../src/utils/database');

// ─── Helpers ────────────────────────────────────────────────────────────────

const GUARDIAN_A = 'GAguardian1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const GUARDIAN_B = 'GAguardian2BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const GUARDIAN_C = 'GAguardian3CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
const NEW_KEY    = 'GANEWPUBLICKEYNEWPUBLICKEYNEWPUBLICKEYNEWPUBLICKEYNEWPUB';

async function createWallet(publicKey = 'GATEST' + Math.random().toString(36).slice(2)) {
  const result = await Database.run(
    'INSERT INTO users (publicKey) VALUES (?)',
    [publicKey]
  );
  return result.id;
}

// ─── Setup / Teardown ────────────────────────────────────────────────────────

beforeAll(async () => {
  await Database.initialize();
});

afterEach(async () => {
  await Database.run('DELETE FROM recovery_approvals');
  await Database.run('DELETE FROM recovery_requests');
  await Database.run('DELETE FROM recovery_guardians');
  await Database.run("DELETE FROM users WHERE publicKey LIKE 'GATEST%' OR publicKey LIKE 'GANEW%'");
});

afterAll(async () => {
  await Database.run('DROP TABLE IF EXISTS recovery_approvals');
  await Database.run('DROP TABLE IF EXISTS recovery_requests');
  await Database.run('DROP TABLE IF EXISTS recovery_guardians');
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SocialRecoveryService', () => {
  let service;
  let mockStellarService;

  beforeEach(() => {
    mockStellarService = { mergeAccount: jest.fn().mockResolvedValue({ success: true }) };
    service = new SocialRecoveryService(mockStellarService);
  });

  // ── Guardian Management ──────────────────────────────────────────────────

  describe('setGuardians()', () => {
    it('sets guardians for a wallet', async () => {
      const walletId = await createWallet();
      const result = await service.setGuardians(walletId, [GUARDIAN_A, GUARDIAN_B], 1);
      expect(result.guardians).toEqual([GUARDIAN_A, GUARDIAN_B]);
      expect(result.threshold).toBe(1);
    });

    it('replaces existing guardians', async () => {
      const walletId = await createWallet();
      await service.setGuardians(walletId, [GUARDIAN_A], 1);
      await service.setGuardians(walletId, [GUARDIAN_B, GUARDIAN_C], 2);
      const guardians = await service.getGuardians(walletId);
      expect(guardians).toEqual([GUARDIAN_B, GUARDIAN_C]);
    });

    it('throws ValidationError for empty guardians array', async () => {
      const walletId = await createWallet();
      await expect(service.setGuardians(walletId, [], 1)).rejects.toThrow('non-empty array');
    });

    it('throws ValidationError when threshold exceeds guardian count', async () => {
      const walletId = await createWallet();
      await expect(service.setGuardians(walletId, [GUARDIAN_A], 2)).rejects.toThrow('threshold');
    });

    it('throws ValidationError when threshold is zero', async () => {
      const walletId = await createWallet();
      await expect(service.setGuardians(walletId, [GUARDIAN_A], 0)).rejects.toThrow('threshold');
    });

    it('throws NotFoundError for non-existent wallet', async () => {
      await expect(service.setGuardians(99999, [GUARDIAN_A], 1)).rejects.toThrow('not found');
    });
  });

  describe('getGuardians()', () => {
    it('returns empty array when no guardians set', async () => {
      const walletId = await createWallet();
      const guardians = await service.getGuardians(walletId);
      expect(guardians).toEqual([]);
    });

    it('returns configured guardians', async () => {
      const walletId = await createWallet();
      await service.setGuardians(walletId, [GUARDIAN_A, GUARDIAN_B], 1);
      const guardians = await service.getGuardians(walletId);
      expect(guardians).toContain(GUARDIAN_A);
      expect(guardians).toContain(GUARDIAN_B);
    });
  });

  // ── Recovery Initiation ──────────────────────────────────────────────────

  describe('initiateRecovery()', () => {
    it('creates a pending recovery request', async () => {
      const walletId = await createWallet();
      await service.setGuardians(walletId, [GUARDIAN_A, GUARDIAN_B], 1);

      const request = await service.initiateRecovery(walletId, NEW_KEY);

      expect(request.status).toBe('pending');
      expect(request.walletId).toBe(walletId);
      expect(request.newPublicKey).toBe(NEW_KEY);
      expect(request.id).toBeDefined();
    });

    it('sets executeAfter ~48 hours in the future', async () => {
      const walletId = await createWallet();
      await service.setGuardians(walletId, [GUARDIAN_A], 1);

      const before = Date.now();
      const request = await service.initiateRecovery(walletId, NEW_KEY);
      const after = Date.now();

      const executeAfter = new Date(request.executeAfter).getTime();
      const expectedMin = before + 47 * 60 * 60 * 1000;
      const expectedMax = after + 49 * 60 * 60 * 1000;

      expect(executeAfter).toBeGreaterThanOrEqual(expectedMin);
      expect(executeAfter).toBeLessThanOrEqual(expectedMax);
    });

    it('cancels existing pending request when new one is initiated', async () => {
      const walletId = await createWallet();
      await service.setGuardians(walletId, [GUARDIAN_A], 1);

      const first = await service.initiateRecovery(walletId, NEW_KEY);
      await service.initiateRecovery(walletId, NEW_KEY);

      const old = await Database.get('SELECT status FROM recovery_requests WHERE id = ?', [first.id]);
      expect(old.status).toBe('cancelled');
    });

    it('throws ValidationError when no guardians configured', async () => {
      const walletId = await createWallet();
      await expect(service.initiateRecovery(walletId, NEW_KEY)).rejects.toThrow('No guardians');
    });

    it('throws NotFoundError for non-existent wallet', async () => {
      await expect(service.initiateRecovery(99999, NEW_KEY)).rejects.toThrow('not found');
    });
  });

  // ── Guardian Approval ────────────────────────────────────────────────────

  describe('approveRecovery()', () => {
    it('records a guardian approval', async () => {
      const walletId = await createWallet();
      await service.setGuardians(walletId, [GUARDIAN_A, GUARDIAN_B], 2);
      const request = await service.initiateRecovery(walletId, NEW_KEY);

      const result = await service.approveRecovery(walletId, request.id, GUARDIAN_A);

      expect(result.approvalCount).toBe(1);
    });

    it('accumulates approvals from multiple guardians', async () => {
      const walletId = await createWallet();
      await service.setGuardians(walletId, [GUARDIAN_A, GUARDIAN_B, GUARDIAN_C], 3);
      const request = await service.initiateRecovery(walletId, NEW_KEY);

      await service.approveRecovery(walletId, request.id, GUARDIAN_A);
      const result = await service.approveRecovery(walletId, request.id, GUARDIAN_B);

      expect(result.approvalCount).toBe(2);
    });

    it('prevents duplicate approval from same guardian', async () => {
      const walletId = await createWallet();
      await service.setGuardians(walletId, [GUARDIAN_A, GUARDIAN_B], 2);
      const request = await service.initiateRecovery(walletId, NEW_KEY);

      await service.approveRecovery(walletId, request.id, GUARDIAN_A);
      await expect(
        service.approveRecovery(walletId, request.id, GUARDIAN_A)
      ).rejects.toThrow('already approved');
    });

    it('throws ValidationError for unauthorized guardian', async () => {
      const walletId = await createWallet();
      await service.setGuardians(walletId, [GUARDIAN_A], 1);
      const request = await service.initiateRecovery(walletId, NEW_KEY);

      await expect(
        service.approveRecovery(walletId, request.id, GUARDIAN_B)
      ).rejects.toThrow('authorized guardian');
    });

    it('throws NotFoundError for non-existent request', async () => {
      const walletId = await createWallet();
      await service.setGuardians(walletId, [GUARDIAN_A], 1);

      await expect(
        service.approveRecovery(walletId, 99999, GUARDIAN_A)
      ).rejects.toThrow('not found');
    });
  });

  // ── Time-Lock Enforcement ────────────────────────────────────────────────

  describe('48-hour time-lock', () => {
    it('does NOT execute recovery before time-lock expires even at threshold', async () => {
      const walletId = await createWallet();
      await service.setGuardians(walletId, [GUARDIAN_A], 1);
      const request = await service.initiateRecovery(walletId, NEW_KEY);

      // executeAfter is ~48h in the future — time-lock not yet passed
      const result = await service.approveRecovery(walletId, request.id, GUARDIAN_A);

      expect(result.status).toBe('pending');
      expect(mockStellarService.mergeAccount).not.toHaveBeenCalled();
    });

    it('executes recovery when threshold met AND time-lock has passed', async () => {
      const walletId = await createWallet();
      await service.setGuardians(walletId, [GUARDIAN_A], 1);
      const request = await service.initiateRecovery(walletId, NEW_KEY);

      // Backdate executeAfter to simulate time-lock expiry
      await Database.run(
        "UPDATE recovery_requests SET executeAfter = ? WHERE id = ?",
        [new Date(Date.now() - 1000).toISOString(), request.id]
      );

      const result = await service.approveRecovery(walletId, request.id, GUARDIAN_A);

      expect(result.status).toBe('executed');
      expect(mockStellarService.mergeAccount).toHaveBeenCalledWith(walletId, NEW_KEY);
    });

    it('does not execute when threshold not yet met even if time-lock passed', async () => {
      const walletId = await createWallet();
      await service.setGuardians(walletId, [GUARDIAN_A, GUARDIAN_B], 2);
      const request = await service.initiateRecovery(walletId, NEW_KEY);

      await Database.run(
        "UPDATE recovery_requests SET executeAfter = ? WHERE id = ?",
        [new Date(Date.now() - 1000).toISOString(), request.id]
      );

      // Only one approval — threshold is 2
      const result = await service.approveRecovery(walletId, request.id, GUARDIAN_A);

      expect(result.status).toBe('pending');
      expect(mockStellarService.mergeAccount).not.toHaveBeenCalled();
    });
  });

  // ── Execution & Fund Transfer ────────────────────────────────────────────

  describe('recovery execution', () => {
    it('updates wallet publicKey to newPublicKey on execution', async () => {
      const walletId = await createWallet();
      await service.setGuardians(walletId, [GUARDIAN_A], 1);
      const request = await service.initiateRecovery(walletId, NEW_KEY);

      await Database.run(
        "UPDATE recovery_requests SET executeAfter = ? WHERE id = ?",
        [new Date(Date.now() - 1000).toISOString(), request.id]
      );

      await service.approveRecovery(walletId, request.id, GUARDIAN_A);

      const wallet = await Database.get('SELECT publicKey FROM users WHERE id = ?', [walletId]);
      expect(wallet.publicKey).toBe(NEW_KEY);
    });

    it('marks request as executed with executedAt timestamp', async () => {
      const walletId = await createWallet();
      await service.setGuardians(walletId, [GUARDIAN_A], 1);
      const request = await service.initiateRecovery(walletId, NEW_KEY);

      await Database.run(
        "UPDATE recovery_requests SET executeAfter = ? WHERE id = ?",
        [new Date(Date.now() - 1000).toISOString(), request.id]
      );

      await service.approveRecovery(walletId, request.id, GUARDIAN_A);

      const updated = await Database.get('SELECT * FROM recovery_requests WHERE id = ?', [request.id]);
      expect(updated.status).toBe('executed');
      expect(updated.executedAt).not.toBeNull();
    });

    it('calls stellarService.mergeAccount with correct arguments', async () => {
      const walletId = await createWallet();
      await service.setGuardians(walletId, [GUARDIAN_A], 1);
      const request = await service.initiateRecovery(walletId, NEW_KEY);

      await Database.run(
        "UPDATE recovery_requests SET executeAfter = ? WHERE id = ?",
        [new Date(Date.now() - 1000).toISOString(), request.id]
      );

      await service.approveRecovery(walletId, request.id, GUARDIAN_A);

      expect(mockStellarService.mergeAccount).toHaveBeenCalledTimes(1);
      expect(mockStellarService.mergeAccount).toHaveBeenCalledWith(walletId, NEW_KEY);
    });

    it('works without stellarService (graceful degradation)', async () => {
      const serviceNoStellar = new SocialRecoveryService(null);
      const walletId = await createWallet();
      await serviceNoStellar.setGuardians(walletId, [GUARDIAN_A], 1);
      const request = await serviceNoStellar.initiateRecovery(walletId, NEW_KEY);

      await Database.run(
        "UPDATE recovery_requests SET executeAfter = ? WHERE id = ?",
        [new Date(Date.now() - 1000).toISOString(), request.id]
      );

      const result = await serviceNoStellar.approveRecovery(walletId, request.id, GUARDIAN_A);
      expect(result.status).toBe('executed');
    });
  });

  // ── getRecoveryRequest ───────────────────────────────────────────────────

  describe('getRecoveryRequest()', () => {
    it('returns request with approval count', async () => {
      const walletId = await createWallet();
      await service.setGuardians(walletId, [GUARDIAN_A, GUARDIAN_B], 2);
      const request = await service.initiateRecovery(walletId, NEW_KEY);
      await service.approveRecovery(walletId, request.id, GUARDIAN_A);

      const result = await service.getRecoveryRequest(walletId, request.id);
      expect(result.approvalCount).toBe(1);
      expect(result.status).toBe('pending');
    });

    it('throws NotFoundError for unknown request', async () => {
      const walletId = await createWallet();
      await expect(service.getRecoveryRequest(walletId, 99999)).rejects.toThrow('not found');
    });
  });
});
