'use strict';

/**
 * Social Recovery Tests
 *
 * Covers:
 * - Guardian designation
 * - Recovery initiation creates pending request
 * - Guardian approval accumulates correctly
 * - Recovery executes as soon as the M-th approval is registered
 * - 72-hour expiration window enforced
 * - Signer swap (add new signer, remove old) on success
 */

const SocialRecoveryService = require('../../src/services/SocialRecoveryService');
const Database = require('../../src/utils/database');

// ─── Helpers ────────────────────────────────────────────────────────────────

const GUARDIAN_A = 'GAguardian1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const GUARDIAN_B = 'GAguardian2BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const GUARDIAN_C = 'GAguardian3CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
const NEW_KEY    = 'GANEWPUBLICKEYNEWPUBLICKEYNEWPUBLICKEYNEWPUBLICKEYNEWPUB';

async function createWallet(publicKey = 'GATEST' + Math.random().toString(36).slice(2), encryptedSecret = null) {
  const result = await Database.run(
    'INSERT INTO users (publicKey, encryptedSecret) VALUES (?, ?)',
    [publicKey, encryptedSecret]
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SocialRecoveryService', () => {
  let service;
  let mockStellarService;

  beforeEach(() => {
    mockStellarService = {
      addSigner: jest.fn().mockResolvedValue({ success: true }),
      removeSigner: jest.fn().mockResolvedValue({ success: true }),
    };
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

    it('stores guardian notification emails', async () => {
      const walletId = await createWallet();
      await service.setGuardians(walletId, [{ publicKey: GUARDIAN_A, email: 'a@example.com' }, GUARDIAN_B], 1);
      const rows = await Database.query(
        'SELECT guardianPublicKey, guardianEmail FROM recovery_guardians WHERE walletId = ? ORDER BY id',
        [walletId]
      );
      expect(rows).toEqual([
        { guardianPublicKey: GUARDIAN_A, guardianEmail: 'a@example.com' },
        { guardianPublicKey: GUARDIAN_B, guardianEmail: null },
      ]);
    });

    it('rejects duplicate guardian keys without touching the existing set', async () => {
      const walletId = await createWallet();
      await service.setGuardians(walletId, [GUARDIAN_A], 1);
      await expect(service.setGuardians(walletId, [GUARDIAN_B, GUARDIAN_B], 1)).rejects.toThrow('unique');
      expect(await service.getGuardians(walletId)).toEqual([GUARDIAN_A]);
    });

    it('rolls back the replacement when an insert fails', async () => {
      const walletId = await createWallet();
      await service.setGuardians(walletId, [GUARDIAN_A], 1);

      const realRunTransaction = Database.runTransaction.bind(Database);
      const spy = jest.spyOn(Database, 'runTransaction').mockImplementation((callback) =>
        realRunTransaction(async (tx) => {
          let inserts = 0;
          const failingTx = {
            ...tx,
            run: (sql, params) => {
              if (sql.startsWith('INSERT') && ++inserts === 2) {
                return Promise.reject(new Error('simulated insert failure'));
              }
              return tx.run(sql, params);
            },
          };
          return callback(failingTx);
        })
      );

      try {
        await expect(service.setGuardians(walletId, [GUARDIAN_B, GUARDIAN_C], 2)).rejects.toThrow('simulated');
      } finally {
        spy.mockRestore();
      }

      expect(await service.getGuardians(walletId)).toEqual([GUARDIAN_A]);
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

    it('sets expiresAt 72 hours in the future', async () => {
      const walletId = await createWallet();
      await service.setGuardians(walletId, [GUARDIAN_A], 1);

      const before = Date.now();
      const request = await service.initiateRecovery(walletId, NEW_KEY);
      const after = Date.now();

      const expiresAt = new Date(request.expiresAt).getTime();
      expect(expiresAt).toBeGreaterThanOrEqual(before + 72 * 60 * 60 * 1000);
      expect(expiresAt).toBeLessThanOrEqual(after + 72 * 60 * 60 * 1000);
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

  // ── Threshold & Expiration ───────────────────────────────────────────────

  describe('threshold and 72-hour expiration', () => {
    it('executes recovery as soon as the threshold is met', async () => {
      const walletId = await createWallet();
      await service.setGuardians(walletId, [GUARDIAN_A], 1);
      const request = await service.initiateRecovery(walletId, NEW_KEY);

      const result = await service.approveRecovery(walletId, request.id, GUARDIAN_A);

      expect(result.status).toBe('executed');
    });

    it('does not execute when threshold not yet met', async () => {
      const walletId = await createWallet(undefined, 'encrypted-secret');
      await service.setGuardians(walletId, [GUARDIAN_A, GUARDIAN_B], 2);
      const request = await service.initiateRecovery(walletId, NEW_KEY);

      const result = await service.approveRecovery(walletId, request.id, GUARDIAN_A);

      expect(result.status).toBe('pending');
      expect(mockStellarService.addSigner).not.toHaveBeenCalled();
    });

    it('rejects approvals once the request has expired', async () => {
      const walletId = await createWallet();
      await service.setGuardians(walletId, [GUARDIAN_A], 1);
      const request = await service.initiateRecovery(walletId, NEW_KEY);

      await Database.run(
        'UPDATE recovery_requests SET expiresAt = ? WHERE id = ?',
        [new Date(Date.now() - 1000).toISOString(), request.id]
      );

      await expect(
        service.approveRecovery(walletId, request.id, GUARDIAN_A)
      ).rejects.toThrow('expired');

      const updated = await Database.get('SELECT status FROM recovery_requests WHERE id = ?', [request.id]);
      expect(updated.status).toBe('expired');
    });
  });

  // ── Execution & Signer Swap ──────────────────────────────────────────────

  describe('recovery execution', () => {
    it('leaves the wallet address unchanged (only the signer is swapped)', async () => {
      const walletId = await createWallet();
      const { publicKey } = await Database.get('SELECT publicKey FROM users WHERE id = ?', [walletId]);
      await service.setGuardians(walletId, [GUARDIAN_A], 1);
      const request = await service.initiateRecovery(walletId, NEW_KEY);

      await service.approveRecovery(walletId, request.id, GUARDIAN_A);

      const wallet = await Database.get('SELECT publicKey FROM users WHERE id = ?', [walletId]);
      expect(wallet.publicKey).toBe(publicKey);
    });

    it('marks request as executed with executedAt timestamp', async () => {
      const walletId = await createWallet();
      await service.setGuardians(walletId, [GUARDIAN_A], 1);
      const request = await service.initiateRecovery(walletId, NEW_KEY);

      await service.approveRecovery(walletId, request.id, GUARDIAN_A);

      const updated = await Database.get('SELECT * FROM recovery_requests WHERE id = ?', [request.id]);
      expect(updated.status).toBe('executed');
      expect(updated.executedAt).not.toBeNull();
    });

    it('adds the new key as signer and removes the old one', async () => {
      const walletId = await createWallet(undefined, 'encrypted-secret');
      const { publicKey } = await Database.get('SELECT publicKey FROM users WHERE id = ?', [walletId]);
      await service.setGuardians(walletId, [GUARDIAN_A], 1);
      const request = await service.initiateRecovery(walletId, NEW_KEY);

      await service.approveRecovery(walletId, request.id, GUARDIAN_A);

      expect(mockStellarService.addSigner).toHaveBeenCalledWith('encrypted-secret', NEW_KEY, 1);
      expect(mockStellarService.removeSigner).toHaveBeenCalledWith('encrypted-secret', publicKey);
    });

    it('works without stellarService (graceful degradation)', async () => {
      const serviceNoStellar = new SocialRecoveryService(null);
      const walletId = await createWallet();
      await serviceNoStellar.setGuardians(walletId, [GUARDIAN_A], 1);
      const request = await serviceNoStellar.initiateRecovery(walletId, NEW_KEY);

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
