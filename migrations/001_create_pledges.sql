-- Migration: create pledges table (Issue #404)
CREATE TABLE IF NOT EXISTS pledges (
  id          TEXT PRIMARY KEY,          -- UUID
  campaign_id INTEGER NOT NULL,
  donor_wallet_id TEXT NOT NULL,         -- Stellar public key
  amount      REAL NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending','fulfilled','expired')),
  expires_at  DATETIME NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
);

CREATE INDEX IF NOT EXISTS idx_pledges_campaign ON pledges(campaign_id);
CREATE INDEX IF NOT EXISTS idx_pledges_status   ON pledges(status);
CREATE INDEX IF NOT EXISTS idx_pledges_expires  ON pledges(expires_at);
