/**
 * Feature Flags Admin Routes - Feature Flag Management API
 * 
 * RESPONSIBILITY: Admin endpoints for viewing and managing feature flags
 * OWNER: Platform Team
 * DEPENDENCIES: Feature flags utility, RBAC middleware, validation
 * 
 * Provides admin-only endpoints for:
 * - Viewing all flags and their states
 * - Creating/updating flags
 * - Deleting flags
 * - Bulk operations
 */

const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const featureFlagsUtil = require('../../utils/featureFlags');
const { checkPermission } = require('../../middleware/rbac');
const { PERMISSIONS } = require('../../utils/permissions');
const { ValidationError, NotFoundError } = require('../../utils/errors');
const { validateSchema } = require('../../middleware/schemaValidation');
const AuditLogService = require('../../services/AuditLogService');
const asyncHandler = require('../../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../../middleware/payloadSizeLimiter');

/**
 * GET /admin/feature-flags
 * List all feature flags with optional filtering
 * 
 * Query parameters:
 * - scope: Filter by scope (global, environment, api_key)
 * - scope_value: Filter by scope value
 * - name: Filter by flag name (partial match)
 * - enabled: Filter by enabled status (true/false)
 */
router.get('/', checkPermission(PERMISSIONS.ADMIN_ALL), asyncHandler(async (req, res, next) => {
  try {
    const { scope, scope_value, name, enabled } = req.query;

    let flags = await featureFlagsUtil.getAllFlags();

    // Apply filters
    if (scope) {
      flags = flags.filter(f => f.scope === scope);
    }

    if (scope_value) {
      flags = flags.filter(f => f.scope_value === scope_value);
    }

    if (name) {
      const nameLower = name.toLowerCase();
      flags = flags.filter(f => f.name.toLowerCase().includes(nameLower));
    }

    if (enabled !== undefined) {
      const enabledBool = enabled === 'true';
      flags = flags.filter(f => Boolean(f.enabled) === enabledBool);
    }

    // Audit log: Flags listed
    AuditLogService.log({
      category: AuditLogService.CATEGORY.ADMIN,
      action: AuditLogService.ACTION.FEATURE_FLAGS_LISTED,
      severity: AuditLogService.SEVERITY.LOW,
      result: 'SUCCESS',
      userId: req.user?.id,
      apiKeyId: req.apiKey?.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: req.path,
      details: {
        filterCount: Object.keys(req.query).length,
        resultCount: flags.length
      }
    }).catch(() => {});

    const flagData = flags.map(f => ({
      id: f.id,
      name: f.name,
      enabled: Boolean(f.enabled),
      scope: f.scope,
      scope_value: f.scope_value,
      description: f.description,
      created_at: f.created_at,
      updated_at: f.updated_at,
      updated_by: f.updated_by
    }));

    if (req.accepts(['html', 'json']) === 'html') {
      const rows = flagData.map(f => `
        <tr>
          <td>${escHtml(f.name)}</td>
          <td>${escHtml(f.scope)}${f.scope_value ? ': ' + escHtml(f.scope_value) : ''}</td>
          <td>${escHtml(f.description || '')}</td>
          <td>
            <label class="toggle">
              <input type="checkbox" data-name="${escHtml(f.name)}" data-scope="${escHtml(f.scope)}" data-scope-value="${escHtml(f.scope_value || '')}" ${f.enabled ? 'checked' : ''}>
              <span>${f.enabled ? 'ON' : 'OFF'}</span>
            </label>
          </td>
        </tr>`).join('');

      const apiKey = req.headers['x-api-key'] || '';
      const nonce = res.locals.cspNonce || '';
      const csrfToken = crypto.randomBytes(16).toString('hex');
      res.cookie('ff_csrf', csrfToken, { httpOnly: false, sameSite: 'strict' });

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Feature Flags Admin</title>
<style>
  body{font-family:sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem}
  h1{font-size:1.4rem}
  table{width:100%;border-collapse:collapse}
  th,td{text-align:left;padding:.5rem .75rem;border-bottom:1px solid #ddd}
  th{background:#f5f5f5}
  .toggle input{display:none}
  .toggle span{cursor:pointer;padding:.25rem .6rem;border-radius:3px;background:#ccc;color:#fff;font-size:.85rem;user-select:none}
  .toggle input:checked+span{background:#2a9d2a}
  #toast{position:fixed;bottom:1rem;right:1rem;padding:.6rem 1rem;border-radius:4px;display:none;color:#fff;font-size:.9rem}
  #toast.ok{background:#2a9d2a} #toast.err{background:#c0392b}
</style>
</head>
<body>
<h1>Feature Flags Admin</h1>
<table>
  <thead><tr><th>Name</th><th>Scope</th><th>Description</th><th>State</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<div id="toast"></div>
<script nonce="${nonce}">
const API_KEY = ${JSON.stringify(apiKey)};
const CSRF_TOKEN = ${JSON.stringify(csrfToken)};
function showToast(msg, ok) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = ok ? 'ok' : 'err'; t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 3000);
}
document.querySelectorAll('.toggle input').forEach(cb => {
  cb.addEventListener('change', async function() {
    const name = this.dataset.name, scope = this.dataset.scope, sv = this.dataset.scopeValue;
    const enabled = this.checked;
    const span = this.nextElementSibling;
    const prev = !enabled;
    try {
      const url = '/admin/feature-flags/' + encodeURIComponent(name) + '?scope=' + encodeURIComponent(scope) + (sv ? '&scope_value=' + encodeURIComponent(sv) : '');
      const r = await fetch(url, {
        method: 'PATCH',
        headers: {'Content-Type':'application/json','x-api-key': API_KEY,'x-csrf-token': CSRF_TOKEN},
        body: JSON.stringify({enabled})
      });
      if (!r.ok) throw new Error((await r.json()).error?.message || r.statusText);
      span.textContent = enabled ? 'ON' : 'OFF';
      showToast(name + ' ' + (enabled ? 'enabled' : 'disabled'), true);
    } catch(e) {
      this.checked = prev;
      span.textContent = prev ? 'ON' : 'OFF';
      showToast('Error: ' + e.message, false);
    }
  });
});
</script>
</body>
</html>`;
      return res.set('Content-Type', 'text/html').send(html);
    }

    res.json({
      success: true,
      data: { flags: flagData, total: flags.length }
    });
  } catch (error) {
    next(error);
  }
}));

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/**
 * GET /admin/feature-flags/:name
 * Get a specific feature flag by name
 * 
 * Returns all scopes for the given flag name
 */
router.get('/:name', checkPermission(PERMISSIONS.ADMIN_ALL), asyncHandler(async (req, res, next) => {
  try {
    const { name } = req.params;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      throw new ValidationError('Invalid flag name', { field: 'name' });
    }

    const flags = await featureFlagsUtil.getAllFlags();
    const matchingFlags = flags.filter(f => f.name === name);

    if (matchingFlags.length === 0) {
      throw new NotFoundError(`Feature flag not found: ${name}`);
    }

    // Audit log: Flag retrieved
    AuditLogService.log({
      category: AuditLogService.CATEGORY.ADMIN,
      action: AuditLogService.ACTION.FEATURE_FLAG_RETRIEVED,
      severity: AuditLogService.SEVERITY.LOW,
      result: 'SUCCESS',
      userId: req.user?.id,
      apiKeyId: req.apiKey?.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: req.path,
      details: { flagName: name, scopeCount: matchingFlags.length }
    }).catch(() => {});

    res.json({
      success: true,
      data: {
        name,
        scopes: matchingFlags.map(f => ({
          id: f.id,
          enabled: Boolean(f.enabled),
          scope: f.scope,
          scope_value: f.scope_value,
          description: f.description,
          created_at: f.created_at,
          updated_at: f.updated_at,
          updated_by: f.updated_by
        }))
      }
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * POST /admin/feature-flags
 * Create a new feature flag
 * 
 * Body:
 * {
 *   name: string (required),
 *   enabled: boolean (required),
 *   scope: 'global' | 'environment' | 'api_key' (required),
 *   scope_value: string (required for non-global scopes),
 *   description: string (optional)
 * }
 */
const createFlagSchema = validateSchema({
  body: {
    fields: {
      name: { type: 'string', required: true, trim: true, minLength: 1, maxLength: 255 },
      enabled: { type: 'boolean', required: true },
      scope: { type: 'string', required: true, enum: ['global', 'environment', 'api_key'] },
      scope_value: { type: 'string', required: false, maxLength: 255, nullable: true },
      description: { type: 'string', required: false, maxLength: 1000, nullable: true }
    }
  }
});

router.post('/', checkPermission(PERMISSIONS.ADMIN_ALL), createFlagSchema, payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    const { name, enabled, scope, scope_value, description } = req.body;

    // Validate scope_value requirement
    if (scope !== 'global' && !scope_value) {
      throw new ValidationError(
        'scope_value is required for non-global scopes',
        { field: 'scope_value' }
      );
    }

    // Check if flag already exists
    const existing = await featureFlagsUtil.getFlag(name, scope, scope_value);
    if (existing) {
      throw new ValidationError(
        'Feature flag already exists for this scope',
        { field: 'name', scope, scope_value }
      );
    }

    // Create the flag
    const flag = await featureFlagsUtil.setFlag(name, enabled, scope, scope_value, {
      description,
      updatedBy: `admin:${req.user?.id || 'unknown'}`
    });

    // Audit log: Flag created
    AuditLogService.log({
      category: AuditLogService.CATEGORY.ADMIN,
      action: AuditLogService.ACTION.FEATURE_FLAG_CREATED,
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      userId: req.user?.id,
      apiKeyId: req.apiKey?.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: req.path,
      details: {
        flagName: name,
        enabled,
        scope,
        scope_value
      }
    }).catch(() => {});

    res.status(201).json({
      success: true,
      data: {
        id: flag.id,
        name: flag.name,
        enabled: Boolean(flag.enabled),
        scope: flag.scope,
        scope_value: flag.scope_value,
        description: flag.description,
        created_at: flag.created_at,
        updated_at: flag.updated_at
      }
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * PATCH /admin/feature-flags/:name
 * Update a feature flag
 * 
 * Query parameters:
 * - scope: Scope of the flag to update (required)
 * - scope_value: Scope value (required for non-global scopes)
 * 
 * Body:
 * {
 *   enabled: boolean (optional),
 *   description: string (optional)
 * }
 */
const updateFlagSchema = validateSchema({
  body: {
    fields: {
      enabled: { type: 'boolean', required: false },
      description: { type: 'string', required: false, maxLength: 1000, nullable: true }
    }
  }
});

router.patch('/:name', checkPermission(PERMISSIONS.ADMIN_ALL), updateFlagSchema, payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    // CSRF double-submit cookie validation (applies when request originates from the HTML UI)
    const rawCookie = req.headers.cookie || '';
    const csrfCookie = rawCookie.split(';').reduce((acc, part) => {
      const [k, v] = part.trim().split('=');
      if (k === 'ff_csrf') acc = decodeURIComponent(v || '');
      return acc;
    }, '');
    const csrfHeader = req.headers['x-csrf-token'];
    if (csrfCookie && (!csrfHeader || csrfHeader !== csrfCookie)) {
      return res.status(403).json({ success: false, error: { code: 'CSRF_INVALID', message: 'CSRF token mismatch' } });
    }

    const { name } = req.params;
    const { scope, scope_value } = req.query;
    const { enabled, description } = req.body;

    if (!scope) {
      throw new ValidationError('scope query parameter is required', { field: 'scope' });
    }

    // Get existing flag
    const existing = await featureFlagsUtil.getFlag(name, scope, scope_value);
    if (!existing) {
      throw new NotFoundError(`Feature flag not found: ${name}`);
    }

    // Update the flag
    const flag = await featureFlagsUtil.setFlag(
      name,
      enabled !== undefined ? enabled : existing.enabled,
      scope,
      scope_value,
      {
        description: description !== undefined ? description : existing.description,
        updatedBy: `admin:${req.user?.id || 'unknown'}`
      }
    );

    // Audit log: Flag updated
    AuditLogService.log({
      category: AuditLogService.CATEGORY.ADMIN,
      action: AuditLogService.ACTION.FEATURE_FLAG_UPDATED,
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      userId: req.user?.id,
      apiKeyId: req.apiKey?.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: req.path,
      details: {
        flagName: name,
        scope,
        scope_value,
        changes: {
          enabled: enabled !== undefined ? `${existing.enabled} -> ${enabled}` : 'unchanged',
          description: description !== undefined ? 'updated' : 'unchanged'
        }
      }
    }).catch(() => {});

    res.json({
      success: true,
      data: {
        id: flag.id,
        name: flag.name,
        enabled: Boolean(flag.enabled),
        scope: flag.scope,
        scope_value: flag.scope_value,
        description: flag.description,
        created_at: flag.created_at,
        updated_at: flag.updated_at
      }
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * DELETE /admin/feature-flags/:name
 * Delete a feature flag
 * 
 * Query parameters:
 * - scope: Scope of the flag to delete (required)
 * - scope_value: Scope value (required for non-global scopes)
 */
router.delete('/:name', checkPermission(PERMISSIONS.ADMIN_ALL), asyncHandler(async (req, res, next) => {
  try {
    const { name } = req.params;
    const { scope, scope_value } = req.query;

    if (!scope) {
      throw new ValidationError('scope query parameter is required', { field: 'scope' });
    }

    // Delete the flag
    const deleted = await featureFlagsUtil.deleteFlag(
      name,
      scope,
      scope_value,
      `admin:${req.user?.id || 'unknown'}`
    );

    if (!deleted) {
      throw new NotFoundError(`Feature flag not found: ${name}`);
    }

    // Audit log: Flag deleted
    AuditLogService.log({
      category: AuditLogService.CATEGORY.ADMIN,
      action: AuditLogService.ACTION.FEATURE_FLAG_DELETED,
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      userId: req.user?.id,
      apiKeyId: req.apiKey?.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: req.path,
      details: {
        flagName: name,
        scope,
        scope_value
      }
    }).catch(() => {});

    res.json({
      success: true,
      message: `Feature flag deleted: ${name}`
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * POST /admin/feature-flags/:flag/enable
 * Enable a global feature flag (convenience endpoint)
 * 
 * Creates flag if it doesn't exist, sets enabled=true
 */
router.post('/:flag/enable', checkPermission(PERMISSIONS.ADMIN_ALL), payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    const { flag } = req.params;
    const { description } = req.body || {};

    if (!flag || typeof flag !== 'string' || flag.trim() === '') {
      throw new ValidationError('Invalid flag name', { field: 'flag' });
    }

    // Check if flag exists
    const existing = await featureFlagsUtil.getFlag(
      flag,
      featureFlagsUtil.FLAG_SCOPES.GLOBAL,
      null
    );

    // Set or update flag to enabled
    const flagRecord = await featureFlagsUtil.setFlag(
      flag,
      true,
      featureFlagsUtil.FLAG_SCOPES.GLOBAL,
      null,
      {
        description: description || existing?.description || `Enabled at ${new Date().toISOString()}`,
        updatedBy: `admin:${req.user?.id || 'unknown'}`
      }
    );

    // Audit log
    AuditLogService.log({
      category: AuditLogService.CATEGORY.ADMIN,
      action: AuditLogService.ACTION.FEATURE_FLAG_UPDATED,
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      userId: req.user?.id,
      apiKeyId: req.apiKey?.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: req.path,
      details: { flagName: flag, action: 'enable' }
    }).catch(() => {});

    res.json({
      success: true,
      message: `Feature flag enabled: ${flag}`,
      data: {
        name: flagRecord.name,
        enabled: true,
        scope: 'global'
      }
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * POST /admin/feature-flags/:flag/disable
 * Disable a global feature flag (convenience endpoint)
 * 
 * Creates flag if it doesn't exist, sets enabled=false
 */
router.post('/:flag/disable', checkPermission(PERMISSIONS.ADMIN_ALL), payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    const { flag } = req.params;
    const { description } = req.body || {};

    if (!flag || typeof flag !== 'string' || flag.trim() === '') {
      throw new ValidationError('Invalid flag name', { field: 'flag' });
    }

    // Check if flag exists
    const existing = await featureFlagsUtil.getFlag(
      flag,
      featureFlagsUtil.FLAG_SCOPES.GLOBAL,
      null
    );

    // Set or update flag to disabled
    const flagRecord = await featureFlagsUtil.setFlag(
      flag,
      false,
      featureFlagsUtil.FLAG_SCOPES.GLOBAL,
      null,
      {
        description: description || existing?.description || `Disabled at ${new Date().toISOString()}`,
        updatedBy: `admin:${req.user?.id || 'unknown'}`
      }
    );

    // Audit log
    AuditLogService.log({
      category: AuditLogService.CATEGORY.ADMIN,
      action: AuditLogService.ACTION.FEATURE_FLAG_UPDATED,
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      userId: req.user?.id,
      apiKeyId: req.apiKey?.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: req.path,
      details: { flagName: flag, action: 'disable' }
    }).catch(() => {});

    res.json({
      success: true,
      message: `Feature flag disabled: ${flag}`,
      data: {
        name: flagRecord.name,
        enabled: false,
        scope: 'global'
      }
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * POST /admin/feature-flags/:flag/override
 * Set a per-API-key flag override (for beta testing)
 * 
 * Body:
 * {
 *   api_key_id: string (required) - API key to override for
 *   enabled: boolean (required) - Whether to enable for this key
 *   description: string (optional)
 * }
 */
const overrideFlagSchema = validateSchema({
  body: {
    fields: {
      api_key_id: { type: 'string', required: true, trim: true, minLength: 1 },
      enabled: { type: 'boolean', required: true },
      description: { type: 'string', required: false, maxLength: 500, nullable: true }
    }
  }
});

router.post('/:flag/override', 
  checkPermission(PERMISSIONS.ADMIN_ALL), 
  overrideFlagSchema, 
  asyncHandler(async (req, res, next) => {
    try {
      const { flag } = req.params;
      const { api_key_id, enabled, description } = req.body;

      if (!flag || typeof flag !== 'string' || flag.trim() === '') {
        throw new ValidationError('Invalid flag name', { field: 'flag' });
      }

      // Set flag override for this API key
      const override = await featureFlagsUtil.setFlagOverrideForKey(
        flag,
        enabled,
        api_key_id,
        {
          description: description || `Override for ${api_key_id}`,
          updatedBy: `admin:${req.user?.id || 'unknown'}`
        }
      );

      // Audit log
      AuditLogService.log({
        category: AuditLogService.CATEGORY.ADMIN,
        action: AuditLogService.ACTION.FEATURE_FLAG_UPDATED,
        severity: AuditLogService.SEVERITY.MEDIUM,
        result: 'SUCCESS',
        userId: req.user?.id,
        apiKeyId: req.apiKey?.id,
        requestId: req.id,
        ipAddress: req.ip,
        resource: req.path,
        details: {
          flagName: flag,
          action: 'override',
          targetApiKeyId: api_key_id,
          enabled
        }
      }).catch(() => {});

      res.status(201).json({
        success: true,
        message: `Flag override set: ${flag} for API key ${api_key_id}`,
        data: {
          flag,
          api_key_id,
          enabled: Boolean(override.enabled),
          scope: 'api_key',
          description: override.description
        }
      });
    } catch (error) {
      next(error);
    }
  })
);

module.exports = router;
