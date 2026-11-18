'use strict';

/**
 * Pledge model — thin data-access layer for the pledges table.
 */

const { v4: uuidv4 } = require('uuid');
const Database = require('../utils/database');
const { toStroops } = require('../utils/money');

const VALID_CONDITION_TYPES = ['campaign_goal_percent', 'date', 'manual'];

const TABLE = `
  CREATE TABLE IF NOT EXISTS pledges (
    id                 TEXT PRIMARY KEY,
    campaign_id        INTEGER,
    donor_wallet_id    TEXT NOT NULL,
    recipient_public_key TEXT,
    amount             INTEGER NOT NULL,
    status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK(status IN ('pending','fulfilled','expired','cancelled')),
    condition_type     TEXT NOT NULL DEFAULT 'campaign_goal_percent',
    condition_value    TEXT,
    condition_status   TEXT NOT NULL DEFAULT 'pending'
                       CHECK(condition_status IN ('pending','met','manual')),
    expires_at         DATETIME,
    fulfilled_at       DATETIME,
    cancel_reason      TEXT,
    cancelled_at       DATETIME,
    webhook_sent_at    DATETIME,
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
  )
`;

function normalizeConditionType(conditionType) {
  const normalized = (conditionType || 'campaign_goal_percent').toString().trim();
  if (!VALID_CONDITION_TYPES.includes(normalized)) {
    throw new Error(`Unsupported pledge condition: ${conditionType}`);
  }
  return normalized;
}

async function ensureSchema() {
  const existingColumns = await Database.query('PRAGMA table_info(pledges)');
  const existingNames = new Set((existingColumns || []).map((column) => column.name));

  const columnDefinitions = [
    ['campaign_id', 'ALTER TABLE pledges ADD COLUMN campaign_id INTEGER'],
    ['recipient_public_key', 'ALTER TABLE pledges ADD COLUMN recipient_public_key TEXT'],
    ['condition_type', "ALTER TABLE pledges ADD COLUMN condition_type TEXT NOT NULL DEFAULT 'campaign_goal_percent'"],
    ['condition_value', 'ALTER TABLE pledges ADD COLUMN condition_value TEXT'],
    ['condition_status', "ALTER TABLE pledges ADD COLUMN condition_status TEXT NOT NULL DEFAULT 'pending'"],
    ['fulfilled_at', 'ALTER TABLE pledges ADD COLUMN fulfilled_at DATETIME'],
    ['expires_at', 'ALTER TABLE pledges ADD COLUMN expires_at DATETIME'],
  ];

  for (const [columnName, statement] of columnDefinitions) {
    if (!existingNames.has(columnName)) {
      await Database.run(statement);
    }
  }
}

async function initTable() {
  await Database.run(TABLE);
  await ensureSchema();
  await Database.run(`CREATE INDEX IF NOT EXISTS idx_pledges_campaign ON pledges(campaign_id)`);
  await Database.run(`CREATE INDEX IF NOT EXISTS idx_pledges_status   ON pledges(status)`);
  await Database.run(`CREATE INDEX IF NOT EXISTS idx_pledges_expires  ON pledges(expires_at)`);
  await Database.run(`CREATE INDEX IF NOT EXISTS idx_pledges_webhook_sent_at ON pledges(webhook_sent_at) WHERE webhook_sent_at IS NULL`);
}

async function create({
  campaign_id,
  donor_wallet_id,
  recipient_public_key,
  recipient,
  amount,
  condition_type,
  condition_value,
  expires_at,
}) {
  const id = uuidv4();
  const amountStroops = toStroops(amount);
  const normalizedConditionType = normalizeConditionType(condition_type);

  if (normalizedConditionType === 'campaign_goal_percent') {
    const threshold = Number(condition_value ?? 100);
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 100) {
      throw new Error('campaign_goal_percent condition requires a value between 1 and 100');
    }
  }

  if (normalizedConditionType === 'date') {
    const parsed = new Date(condition_value || expires_at || Date.now());
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('date condition requires a valid ISO date');
    }
  }

  const resolvedRecipient = recipient_public_key || recipient || null;
  const resolvedExpiresAt = expires_at || null;
  const initialConditionStatus = normalizedConditionType === 'manual' ? 'manual' : 'pending';
  await Database.run(
    `INSERT INTO pledges (
      id, campaign_id, donor_wallet_id, recipient_public_key, amount,
      status, condition_type, condition_value, condition_status, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      campaign_id ?? null,
      donor_wallet_id,
      resolvedRecipient,
      amountStroops,
      'pending',
      normalizedConditionType,
      normalizedConditionType === 'manual' ? null : (condition_value ?? null),
      initialConditionStatus,
      resolvedExpiresAt,
    ]
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

/**
 * Get pledges that have expired but haven't had webhooks sent yet
 * @param {string} now - ISO timestamp
 * @returns {Promise<Object[]>}
 */
async function getNewlyExpiredPledges(now = new Date().toISOString()) {
  return Database.query(
    `SELECT * FROM pledges 
     WHERE status = 'expired' 
       AND expires_at < ?
       AND webhook_sent_at IS NULL`,
    [now]
  );
}

/**
 * Get pledges that have been fulfilled but haven't had webhooks sent yet
 * @param {number} campaignId
 * @returns {Promise<Object[]>}
 */
async function getNewlyFulfilledPledges(campaignId) {
  return Database.query(
    `SELECT * FROM pledges 
     WHERE campaign_id = ? 
       AND status = 'fulfilled'
       AND webhook_sent_at IS NULL`,
    [campaignId]
  );
}

/**
 * Mark webhook as sent for a pledge
 * @param {string} pledgeId
 * @returns {Promise<void>}
 */
async function markWebhookSent(pledgeId) {
  await Database.run(
    `UPDATE pledges SET webhook_sent_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [pledgeId]
  );
}

/**
 * Fetch a single pledge by its UUID.
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
async function findById(id) {
  return Database.get(`SELECT * FROM pledges WHERE id = ?`, [id]);
}

/**
 * List all pledges, optionally filtered by status.
 * @param {{ status?: string }} [opts]
 * @returns {Promise<Object[]>}
 */
async function listAll({ status } = {}) {
  if (status) {
    return Database.query(
      `SELECT * FROM pledges WHERE status = ? ORDER BY created_at DESC`,
      [status]
    );
  }
  return Database.query(`SELECT * FROM pledges ORDER BY created_at DESC`);
}

/**
 * Cancel a pledge by ID (only if currently pending).
 * @param {string} id
 * @param {string} [reason]
 * @returns {Promise<{changes: number}>}
 */
async function cancel(id, reason = null) {
  const now = new Date().toISOString();
  return Database.run(
    `UPDATE pledges
     SET status = 'cancelled', cancel_reason = ?, cancelled_at = ?
     WHERE id = ? AND status = 'pending'`,
    [reason, now, id]
  );
}

module.exports = {
  initTable,
  create,
  listByCampaign,
  getPendingByCampaign,
  fulfillAll,
  expireOverdue,
  getExpiredPledges,
  getNewlyExpiredPledges,
  getNewlyFulfilledPledges,
  markWebhookSent,
  findById,
  listAll,
  cancel,
};
