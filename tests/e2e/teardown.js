/**
 * E2E Global Teardown - Post-Run Cleanup
 *
 * Runs once after the entire e2e suite completes. This teardown intentionally
 * does NOT touch anything under `data/` — the e2e suite no longer uses the old
 * JSON persistence, so there is nothing to back up or restore.
 *
 * The test SQLite database is intentionally kept on disk after the run so
 * developers can inspect it for debugging. It is removed at the START of the
 * next setup run, not here.
 */

'use strict';

module.exports = async () => {
  // eslint-disable-next-line no-console
  console.log('[e2e/teardown] E2E run complete. Test DB left on disk for inspection.');
};