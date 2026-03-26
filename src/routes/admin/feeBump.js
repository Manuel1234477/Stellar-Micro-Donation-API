/**
 * Fee Bump Admin Routes - Manual Fee Bump API
 *
 * RESPONSIBILITY: Admin endpoint for manually applying fee bumps to stuck transactions
 * OWNER: Backend Team
 * DEPENDENCIES: FeeBumpService, RBAC middleware
 */

const express = require('express');
const { checkPermission } = require('../../middleware/rbac');
const { PERMISSIONS } = require('../../utils/permissions');

/**
 * Create fee bump router with injected FeeBumpService.
 * @param {Object} feeBumpService - FeeBumpService instance
 * @returns {express.Router}
 */
function createFeeBumpRouter(feeBumpService) {
  const router = express.Router();

  /**
   * POST /admin/transactions/:id/fee-bump
   * Manually apply a fee bump to a stuck transaction.
   *
   * @param {string} req.params.id - Transaction ID
   * @param {number} [req.body.fee] - Fee in stroops (optional; uses network estimate if omitted)
   * @returns {{ success: boolean, data: { transactionId, originalFee, newFee, feeBumpCount, hash } }}
   */
  router.post('/:id/fee-bump', checkPermission(PERMISSIONS.ADMIN_ALL), async (req, res, next) => {
    try {
      const { id } = req.params;
      const fee = req.body.fee !== undefined ? Number(req.body.fee) : null;

      const result = await feeBumpService.feeBump(id, fee);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = createFeeBumpRouter;
