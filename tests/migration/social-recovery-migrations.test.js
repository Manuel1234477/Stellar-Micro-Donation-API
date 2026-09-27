'use strict';

/**
 * Social recovery schema — migration-level test (#1695)
 *
 * Applies the real migrations that define the social recovery schema
 * (001 users, 006 recovery tables, 045 guardian email / expiresAt / notifiedAt)
 * to a brand-new SQLite file, then drives SocialRecoveryService against it.
 * This catches drift between the columns the service writes and the columns
 * the migrations actually create, which the shared test bootstrap schema
 * cannot detect.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const MIGRATIONS = [
  '001_initial_schema',
  '006_social_recovery',
  '045_recovery_guardian_notifications',
];

const GUARDIAN_A = 'GAMIGRATIONGUARDIANAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const GUARDIAN_B = 'GAMIGRATIONGUARDIANBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const GUARDIAN_C = 'GAMIGRATIONGUARDIANCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
const NEW_KEY = 'GAMIGRATIONNEWKEYNEWKEYNEWKEYNEWKEYNEWKEYNEWKEYNEWKEYNEWK';

describe('social recovery on a freshly migrated database', () => {
  let tmpDir;
  let originalDbPath;
  let Database;
  let SocialRecoveryService;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-recovery-migrations-'));
    originalDbPath = process.env.DB_PATH;
    // The database layer resolves DB_PATH at load time, so load an isolated
    // copy of it (and the service that uses it) pointed at the fresh file.
    process.env.DB_PATH = path.join(tmpDir, 'fresh.db');

    jest.isolateModules(() => {
      Database = require('../../src/utils/database');
      SocialRecoveryService = require('../../src/services/SocialRecoveryService');
    });

    await Database.initialize();
    for (const name of MIGRATIONS) {
      await require(`../../src/migrations/${name}`).up(Database);
    }
  });

  afterAll(async () => {
    await Database.close();
    process.env.DB_PATH = originalDbPath;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function createWallet() {
    const publicKey = 'GAMIGRATIONWALLET' + Math.random().toString(36).slice(2);
    const result = await Database.run('INSERT INTO users (publicKey) VALUES (?)', [publicKey]);
    return result.id;
  }

  it('creates every column SocialRecoveryService reads and writes', async () => {
    const columns = async (table) =>
      (await Database.query(`PRAGMA table_info(${table})`)).map((c) => c.name);

    expect(await columns('recovery_guardians')).toEqual(
      expect.arrayContaining(['walletId', 'guardianPublicKey', 'guardianEmail', 'threshold'])
    );
    expect(await columns('recovery_requests')).toEqual(
      expect.arrayContaining(['walletId', 'newPublicKey', 'status', 'threshold', 'executeAfter', 'expiresAt', 'notifiedAt', 'executedAt'])
    );
  });

  it('setGuardians succeeds and replaces the previous set', async () => {
    const service = new SocialRecoveryService(null);
    const walletId = await createWallet();

    await service.setGuardians(walletId, [{ publicKey: GUARDIAN_A, email: 'guardian@example.com' }], 1);
    await service.setGuardians(walletId, [GUARDIAN_B, GUARDIAN_C], 2);

    expect(await service.getGuardians(walletId)).toEqual([GUARDIAN_B, GUARDIAN_C]);
  });

  it('runs a full recovery flow end to end', async () => {
    const service = new SocialRecoveryService(null);
    const walletId = await createWallet();
    await service.setGuardians(walletId, [GUARDIAN_A, GUARDIAN_B], 2);

    const request = await service.initiateRecovery(walletId, NEW_KEY);
    expect(request.expiresAt).toBeTruthy();

    await service.approveRecovery(walletId, request.id, GUARDIAN_A);
    const result = await service.approveRecovery(walletId, request.id, GUARDIAN_B);

    expect(result.status).toBe('executed');
  });
});
