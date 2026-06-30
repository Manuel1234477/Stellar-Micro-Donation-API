/**
 * Changelog REST Endpoints
 * Feature: machine-readable-api-changelog
 *
 * Exposes the machine-readable CHANGELOG.json via HTTP.
 * Enabled only when ENABLE_CHANGELOG_ENDPOINT=true.
 *
 * GET /changelog
 *   Returns all Change_Entry records, sorted newest first.
 *   Query params:
 *     ?since={version}   — only entries after this version
 *     ?type={type}       — filter by Change_Type
 *     ?endpoint={path}   — filter by affected endpoint path
 *
 * GET /deprecations
 *   Returns Change_Entry records with type === "deprecated",
 *   sorted by sunsetDate ascending (soonest sunset first).
 */
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const CHANGELOG_JSON_PATH = path.join(__dirname, '../../CHANGELOG.json');

const VALID_CHANGE_TYPES = new Set([
  'added', 'changed', 'deprecated', 'removed', 'fixed', 'security',
]);

/**
 * Load and parse CHANGELOG.json.
 * Throws if the file is missing or malformed.
 */
function loadChangelog() {
  if (!fs.existsSync(CHANGELOG_JSON_PATH)) {
    const err = new Error('CHANGELOG.json not found');
    err.statusCode = 503;
    err.code = 'CHANGELOG_UNAVAILABLE';
    throw err;
  }
  return JSON.parse(fs.readFileSync(CHANGELOG_JSON_PATH, 'utf8'));
}

/**
 * Simple semver-like version comparison: returns true if `a` > `b`.
 * Falls back to string lexicographic order for non-semver values.
 */
function isVersionAfter(candidate, since) {
  if (candidate === 'Unreleased') return true;
  if (since === 'Unreleased') return false;
  const parse = (v) => v.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const a = parse(candidate);
  const b = parse(since);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

// ── GET /changelog ────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  let changelog;
  try {
    changelog = loadChangelog();
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      error: { code: err.code || 'CHANGELOG_ERROR', message: err.message },
    });
  }

  let changes = [...(changelog.changes || [])];

  // Filter: ?since=version
  if (req.query.since) {
    changes = changes.filter(c => isVersionAfter(c.version, req.query.since));
  }

  // Filter: ?type=added|fixed|…
  if (req.query.type) {
    if (!VALID_CHANGE_TYPES.has(req.query.type)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_CHANGE_TYPE',
          message: `Invalid type "${req.query.type}". Must be one of: ${[...VALID_CHANGE_TYPES].join(', ')}`,
        },
      });
    }
    changes = changes.filter(c => c.type === req.query.type);
  }

  // Filter: ?endpoint=/path
  if (req.query.endpoint) {
    const search = req.query.endpoint.toLowerCase();
    changes = changes.filter(c =>
      Array.isArray(c.affectedEndpoints) &&
      c.affectedEndpoints.some(ep => ep.path && ep.path.toLowerCase().includes(search))
    );
  }

  // Sort: timestamp descending (newest first)
  changes.sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return tb - ta;
  });

  return res.json({
    success: true,
    schemaVersion: changelog.schemaVersion,
    data: changes,
    count: changes.length,
  });
});

// ── GET /deprecations ─────────────────────────────────────────────────────────

router.get('/deprecations', (req, res) => {
  let changelog;
  try {
    changelog = loadChangelog();
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      error: { code: err.code || 'CHANGELOG_ERROR', message: err.message },
    });
  }

  let deprecations = (changelog.changes || []).filter(c => c.type === 'deprecated');

  // Sort by sunsetDate ascending (soonest first); entries without sunsetDate go last
  deprecations.sort((a, b) => {
    if (!a.sunsetDate && !b.sunsetDate) return 0;
    if (!a.sunsetDate) return 1;
    if (!b.sunsetDate) return -1;
    return new Date(a.sunsetDate) - new Date(b.sunsetDate);
  });

  return res.json({
    success: true,
    schemaVersion: changelog.schemaVersion,
    data: deprecations,
    count: deprecations.length,
  });
});

module.exports = router;
