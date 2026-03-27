'use strict';

/**
 * Pledge model — thin data-access layer for the pledges table.
 */

const { v4: uuidv4 } = require('uuid');
const Database = require('../utils/database');

const TABLE = `
  CREATE TABLE IF NOT EXISTS pledges (
    id              TEXT PRIMARY KEY,
    campaign_id     INTEGER NOT NULL,
    donor_wallet_id TEXT NOT NULL,
    amount          REAL NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                      CHECK(status IN ('pending','fulfilled','expired')),
    expires_at      DATETIME NOT NULL,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
  )
`;

async function initTable() {
  await Database.run(TABLE);
  await Database.run(`CREATE INDEX IF NOT EXISTS idx_pledges_campaign ON pledges(campaign_id)`);
  await Database.run(`CREATE INDEX IF NOT EXISTS idx_pledges_status   ON pledges(status)`);
  await Database.run(`CREATE INDEX IF NOT EXISTS idx_pledges_expires  ON pledges(expires_at)`);
}

async function create({ campaign_id, donor_wallet_id, amount, expires_at }) {
  const id = uuidv4();
  await Database.run(
    `INSERT INTO pledges (id, campaign_id, donor_wallet_id, amount, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, campaign_id, donor_wallet_id, amount, expires_at]
  );
  return Database.get(`SELECT * FROM pledges WHERE id = ?`, [id]);
}

async function listByCampaign(campaign_id) {
  return Database.query(`SELECT * FROM pledges WHERE campaign_id = ? ORDER BY created_at DESC`, [campaign_id]);
}

async function getPendingByCampaign(campaign_id) {
  return Database.query(
    `SELECT * FROM pledges WHERE campaign_id = ? AND status = 'pending'`,
    [campaign_id]
  );
}

async function fulfillAll(campaign_id) {
  await Database.run(
    `UPDATE pledges SET status = 'fulfilled' WHERE campaign_id = ? AND status = 'pending'`,
    [campaign_id]
  );
}

async function expireOverdue(now = new Date().toISOString()) {
  const result = await Database.run(
    `UPDATE pledges SET status = 'expired'
     WHERE status = 'pending' AND expires_at < ?`,
    [now]
  );
  return result.changes || 0;
}

async function getExpiredPledges(now = new Date().toISOString()) {
  return Database.query(
    `SELECT * FROM pledges WHERE status = 'expired' AND expires_at < ?`,
    [now]
  );
}

module.exports = { initTable, create, listByCampaign, getPendingByCampaign, fulfillAll, expireOverdue, getExpiredPledges };
