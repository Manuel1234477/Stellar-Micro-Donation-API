/**
 * Admin Payment Channel Routes
 *
 * RESPONSIBILITY: Admin endpoints for payment channel management and monitoring
 * OWNER: Backend Team
 * DEPENDENCIES: PaymentChannelService
 */

const express = require('express');
const router = express.Router();
const { checkPermission } = require('../../middleware/rbac');
const { PERMISSIONS } = require('../../utils/permissions');
const asyncHandler = require('../../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../../middleware/payloadSizeLimiter');
const AuditLogService = require('../../services/AuditLogService');
const serviceContainer = require('../../config/serviceContainer');
const { ValidationError, NotFoundError } = require('../../utils/errors');

/**
 * GET /admin/payment-channels
 * List all active payment channels with pagination support
 * 
 * @query {string} [status] - Filter by status (open, closing, closed, settled, disputed)
 * @query {number} [limit=50] - Number of results per page
 * @query {number} [offset=0] - Pagination offset
 */
router.get('/', checkPermission(PERMISSIONS.ADMIN_ALL), asyncHandler(async (req, res) => {
  const paymentChannelService = serviceContainer.getPaymentChannelService();
  
  const { status } = req.query;
  const limit = parseInt(req.query.limit, 10) || 50;
  const offset = parseInt(req.query.offset, 10) || 0;

  // Validate status if provided
  const validStatuses = ['open', 'closing', 'closed', 'settled', 'disputed'];
  if (status && !validStatuses.includes(status)) {
    throw new ValidationError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
  }

  // Get all channels (filtered by status if provided)
  const allChannels = await paymentChannelService.listChannels(status || null);

  // Apply pagination
  const paginatedChannels = allChannels.slice(offset, offset + limit);

  // Transform to response format
  const channels = paginatedChannels.map(channel => {
    const remaining = channel.capacity - channel.balance;
    const expiresAt = channel.metadata?.expiresAt || null;
    
    return {
      id: channel.id,
      senderPublicKey: channel.senderKey,
      recipientPublicKey: channel.receiverKey,
      capacity: channel.capacity,
      used: channel.balance,
      remaining,
      status: channel.status,
      openedAt: channel.createdAt,
      expiresAt,
    };
  });

  res.json({
    success: true,
    data: channels,
    pagination: {
      limit,
      offset,
      total: allChannels.length,
      hasMore: offset + limit < allChannels.length,
    },
  });
}));

/**
 * GET /admin/payment-channels/stats
 * Returns aggregate statistics for payment channels
 */
router.get('/stats', checkPermission(PERMISSIONS.ADMIN_ALL), asyncHandler(async (req, res) => {
  const paymentChannelService = serviceContainer.getPaymentChannelService();
  
  const allChannels = await paymentChannelService.listChannels();
  const activeChannels = allChannels.filter(ch => ch.status === 'open');
  
  // Calculate totals
  const totalCapacityXLM = activeChannels.reduce((sum, ch) => sum + ch.capacity, 0);
  const totalUsedXLM = activeChannels.reduce((sum, ch) => sum + ch.balance, 0);
  
  // Find channels expiring soon (within 24 hours)
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const channelsExpiringSoon = activeChannels.filter(ch => {
    if (!ch.metadata?.expiresAt) return false;
    const expiresAt = new Date(ch.metadata.expiresAt).getTime();
    return expiresAt - now < oneDayMs && expiresAt > now;
  }).length;

  res.json({
    success: true,
    data: {
      activeChannels: activeChannels.length,
      totalCapacityXLM: totalCapacityXLM.toFixed(7),
      totalUsedXLM: totalUsedXLM.toFixed(7),
      channelsExpiringSoon,
      totalChannels: allChannels.length,
      byStatus: {
        open: allChannels.filter(ch => ch.status === 'open').length,
        closing: allChannels.filter(ch => ch.status === 'closing').length,
        closed: allChannels.filter(ch => ch.status === 'closed').length,
        settled: allChannels.filter(ch => ch.status === 'settled').length,
        disputed: allChannels.filter(ch => ch.status === 'disputed').length,
      },
    },
  });
}));

/**
 * GET /admin/payment-channels/:id
 * Returns full channel details including transaction history
 * 
 * @param {string} id - Channel UUID
 */
router.get('/:id', checkPermission(PERMISSIONS.ADMIN_ALL), asyncHandler(async (req, res) => {
  const paymentChannelService = serviceContainer.getPaymentChannelService();
  const { id } = req.params;

  const channel = await paymentChannelService.getChannel(id);
  
  if (!channel) {
    throw new NotFoundError(`Payment channel ${id} not found`);
  }

  // Build detailed response with transaction history
  const response = {
    id: channel.id,
    senderPublicKey: channel.senderKey,
    recipientPublicKey: channel.receiverKey,
    capacity: channel.capacity,
    balance: channel.balance,
    sequence: channel.sequence,
    status: channel.status,
    openedAt: channel.createdAt,
    updatedAt: channel.updatedAt,
    settledAt: channel.settledAt || null,
    closedAt: channel.closedAt || null,
    disputedAt: channel.disputedAt || null,
    disputeSequence: channel.disputeSeq || null,
    metadata: channel.metadata || {},
    transactionHistory: channel.signatures || [],
  };

  res.json({
    success: true,
    data: response,
  });
}));

/**
 * POST /admin/payment-channels/:id/close
 * Initiates a cooperative channel closure, settling the final balance on-chain
 * 
 * @param {string} id - Channel UUID
 * @body {string} senderSecret - Sender's secret key to authorize settlement
 */
router.post('/:id/close', checkPermission(PERMISSIONS.ADMIN_ALL), payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res) => {
  const paymentChannelService = serviceContainer.getPaymentChannelService();
  const { id } = req.params;
  const { senderSecret } = req.body;

  if (!senderSecret) {
    throw new ValidationError('senderSecret is required');
  }

  // Get channel before closing for audit log
  const channelBefore = await paymentChannelService.getChannel(id);

  // Close the channel
  const closedChannel = await paymentChannelService.closeChannel({
    channelId: id,
    senderSecret,
  });

  // Audit log
  AuditLogService.log({
    category: AuditLogService.CATEGORY.SYSTEM,
    action: 'PAYMENT_CHANNEL_CLOSED',
    severity: AuditLogService.SEVERITY.MEDIUM,
    result: 'SUCCESS',
    requestId: req.id,
    ipAddress: req.ip,
    resource: `/admin/payment-channels/${id}/close`,
    details: {
      channelId: id,
      balanceSettled: channelBefore.balance,
      senderKey: channelBefore.senderKey,
      receiverKey: channelBefore.receiverKey,
      stellarTxId: closedChannel.metadata?.stellarTxId || null,
    },
  }).catch(() => {});

  res.json({
    success: true,
    data: {
      id: closedChannel.id,
      status: closedChannel.status,
      settledAt: closedChannel.settledAt,
      balanceSettled: closedChannel.balance,
      stellarTxId: closedChannel.metadata?.stellarTxId || null,
    },
    message: 'Payment channel closed successfully',
  });
}));

module.exports = router;
