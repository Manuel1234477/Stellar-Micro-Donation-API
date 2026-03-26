/**
 * E2E Global Teardown - Post-Run Cleanup
 *
 * Runs once after the entire e2e suite completes. Restores the wallets.json
 * backup created during setup so the repository state is left clean.
 *
 * The test SQLite database is intentionally kept on disk after the run so
 * developers can inspect it for debugging. It is removed at the START of the
 * next setup run, not here.
 */

'use strict';

module.exports = async () => {
  const fs = require('fs');
  const path = require('path');

  const DATA_DIR = path.join(__dirname, '..', '..', 'data');
  const WALLETS_PATH = path.join(DATA_DIR, 'wallets.json');
  const WALLETS_BACKUP = path.join(DATA_DIR, 'wallets.e2e_backup.json');

  // Remove the wallets created during the e2e run
  if (fs.existsSync(WALLETS_PATH)) {
    fs.unlinkSync(WALLETS_PATH);
  }

  // Restore the pre-existing wallets.json if there was one
  if (fs.existsSync(WALLETS_BACKUP)) {
    fs.renameSync(WALLETS_BACKUP, WALLETS_PATH);
  }

  // eslint-disable-next-line no-console
  console.log('[e2e/teardown] Wallet store restored. E2E run complete.');
};
