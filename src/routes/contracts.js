/**
 * Contracts Route
 * Exposes endpoints for Soroban smart contract invocation, simulation, state, and event monitoring.
 */

const express = require('express');
const { getStellarService } = require('../config/stellar');
const requireApiKey = require('../middleware/apiKey');
const { requireAdmin } = require('../middleware/rbac');
const AuditLogService = require('../services/AuditLogService');

const router = express.Router();

/**
 * POST /contracts/:contractId/invoke
 * Invoke a Soroban smart contract method on-chain.
 * Requires admin role. Logs the invocation for auditability.
 *
 * Body: { method: string, args: Array, sourceSecret?: string }
 * Responses:
 *   200 { success: true, data: { status, returnValue, transactionHash, ledger, events } }
 *   400 { success: false, error: { code: "VALIDATION_ERROR", message: string } }
 *   500 { success: false, error: { code: "INVOKE_FAILED", message: string } }
 */
router.post('/:contractId/invoke', requireApiKey, requireAdmin(), async (req, res) => {
  const { contractId } = req.params;
  const { method, args = [], sourceSecret } = req.body;

  if (!method) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'method is required' },
    });
  }
  if (!Array.isArray(args)) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'args must be an array' },
    });
  }

  try {
    const stellarService = getStellarService();
    const result = await stellarService.invokeContract(contractId, method, args, sourceSecret);

    await AuditLogService.log({
      category: 'FINANCIAL_OPERATION',
      action: 'CONTRACT_INVOKED',
      severity: 'MEDIUM',
      result: result.status === 'success' ? 'SUCCESS' : 'FAILURE',
      userId: req.user?.id || null,
      requestId: req.id || null,
      ipAddress: req.ip || null,
      resource: `contract:${contractId}`,
      details: { contractId, method, argCount: args.length },
    }).catch(() => {});

    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'INVOKE_FAILED', message: err.message },
    });
  }
});

/**
 * POST /contracts/:contractId/simulate
 * Dry-run a Soroban contract invocation without submitting to the network.
 * Requires admin role.
 *
 * Body: { method: string, args: Array }
 * Responses:
 *   200 { success: true, data: { status, returnValue, cost, footprint } }
 *   400 { success: false, error: { code: "VALIDATION_ERROR", message: string } }
 *   500 { success: false, error: { code: "SIMULATE_FAILED", message: string } }
 */
router.post('/:contractId/simulate', requireApiKey, requireAdmin(), async (req, res) => {
  const { contractId } = req.params;
  const { method, args = [] } = req.body;

  if (!method) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'method is required' },
    });
  }
  if (!Array.isArray(args)) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'args must be an array' },
    });
  }

  try {
    const stellarService = getStellarService();
    const result = await stellarService.simulateContractInvocation(contractId, method, args);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SIMULATE_FAILED', message: err.message },
    });
  }
});

/**
 * GET /contracts/:contractId/state
 * Read contract data entries for a given contract ID.
 * Requires admin role.
 *
 * Responses:
 *   200 { success: true, data: Array<{ key, value }>, count: number }
 *   500 { success: false, error: { code: "FETCH_STATE_FAILED", message: string } }
 */
router.get('/:contractId/state', requireApiKey, requireAdmin(), async (req, res) => {
  try {
    const stellarService = getStellarService();
    const data = await stellarService.getContractState(req.params.contractId);
    return res.status(200).json({ success: true, data, count: data.length });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'FETCH_STATE_FAILED', message: err.message },
    });
  }
});

/**
 * GET /contracts/:id/events
 * Retrieve stored contract events for a given contract ID.
 *
 * Query params:
 *   limit (optional) — positive integer, maximum number of events to return
 *
 * Responses:
 *   200 { success: true, data: ContractEvent[], count: number }
 *   400 { success: false, error: { code: "INVALID_REQUEST", message: string } }
 *   500 { success: false, error: { code: "FETCH_EVENTS_FAILED", message: string } }
 */
router.get('/:id/events', async (req, res) => {
  let limit;

  if (req.query.limit !== undefined) {
    const parsed = parseInt(req.query.limit, 10);
    if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== String(req.query.limit)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'limit must be a positive integer',
        },
      });
    }
    limit = parsed;
  }

  try {
    const stellarService = getStellarService();
    const data = await stellarService.getContractEvents(req.params.id, limit);
    return res.status(200).json({ success: true, data, count: data.length });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_EVENTS_FAILED',
        message: err.message,
      },
    });
  }
});

module.exports = router;
