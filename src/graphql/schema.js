/**
 * GraphQL Schema Definition
 *
 * RESPONSIBILITY: Define all GraphQL types, queries, mutations, and subscriptions
 * OWNER: Backend Team
 * DEPENDENCIES: graphql
 *
 * Exposes the same data and operations as the REST API through a typed GraphQL schema.
 * Backed by the existing service layer — no business logic lives here.
 */

const {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLString,
  GraphQLFloat,
  GraphQLInt,
  GraphQLBoolean,
  GraphQLList,
  GraphQLNonNull,
  GraphQLInputObjectType,
  GraphQLError,
} = require('graphql');

const { hasPermission } = require('../models/permissions');

// ─── Pagination constants ─────────────────────────────────────────────────────

/** Default number of records returned when the client supplies no limit. */
const DEFAULT_PAGE_LIMIT = 20;

/** Hard upper cap on client-supplied limit arguments to prevent resource exhaustion. (#1372) */
const MAX_PAGE_LIMIT = 100;

/**
 * Clamp a client-supplied limit value within [1, MAX_PAGE_LIMIT].
 * If no limit is provided, return DEFAULT_PAGE_LIMIT.
 * @param {number|null|undefined} clientLimit
 * @returns {number}
 */
function clampLimit(clientLimit) {
  if (clientLimit == null) return DEFAULT_PAGE_LIMIT;
  return Math.min(Math.max(1, clientLimit), MAX_PAGE_LIMIT);
}

// ─── RBAC helpers ─────────────────────────────────────────────────────────────

/**
 * Assert that the GraphQL context includes an authenticated API key with the
 * required permission.  Mirrors the checkPermission() Express middleware used
 * by the equivalent REST routes. (#1371)
 *
 * @param {{ apiKey?: { role?: string } } | null} context - GraphQL resolver context
 * @param {string} permission - Required permission string (e.g. 'donations:create')
 * @throws {GraphQLError} UNAUTHENTICATED if no apiKey; FORBIDDEN if insufficient role
 */
function assertPermission(context, permission) {
  if (!context || !context.apiKey) {
    throw new GraphQLError('Authentication required.', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }

  const role = context.apiKey.role || 'guest';
  if (!hasPermission(role, permission)) {
    throw new GraphQLError(`Insufficient permissions. Required: ${permission}`, {
      extensions: { code: 'FORBIDDEN' },
    });
  }
}

// ─── Scalar / shared types ────────────────────────────────────────────────────

/** Represents a single donation transaction */
const DonationType = new GraphQLObjectType({
  name: 'Donation',
  fields: () => ({
    id: { type: GraphQLInt },
    senderId: { type: GraphQLInt },
    receiverId: { type: GraphQLInt },
    amount: { type: GraphQLFloat },
    memo: { type: GraphQLString },
    status: { type: GraphQLString },
    stellar_tx_id: { type: GraphQLString },
    timestamp: { type: GraphQLString },
    currency: { type: GraphQLString },
    tags: { type: GraphQLString },
  }),
});

/** Represents a wallet record */
const WalletType = new GraphQLObjectType({
  name: 'Wallet',
  fields: () => ({
    id: { type: GraphQLInt },
    address: { type: GraphQLString },
    label: { type: GraphQLString },
    ownerName: { type: GraphQLString },
    createdAt: { type: GraphQLString },
    funded: { type: GraphQLBoolean },
    sponsored: { type: GraphQLBoolean },
  }),
});

/** Daily donation statistics */
const DailyStatType = new GraphQLObjectType({
  name: 'DailyStat',
  fields: () => ({
    date: { type: GraphQLString },
    totalVolume: { type: GraphQLFloat },
    transactionCount: { type: GraphQLInt },
  }),
});

/** Summary statistics */
const SummaryStatType = new GraphQLObjectType({
  name: 'SummaryStat',
  fields: () => ({
    totalDonations: { type: GraphQLInt },
    totalVolume: { type: GraphQLFloat },
    uniqueDonors: { type: GraphQLInt },
    uniqueRecipients: { type: GraphQLInt },
    averageDonation: { type: GraphQLFloat },
  }),
});

/** Mutation result for creating a donation */
const CreateDonationResultType = new GraphQLObjectType({
  name: 'CreateDonationResult',
  fields: () => ({
    success: { type: new GraphQLNonNull(GraphQLBoolean) },
    donation: { type: DonationType },
    message: { type: GraphQLString },
  }),
});

/** Mutation result for updating donation status */
const UpdateDonationStatusResultType = new GraphQLObjectType({
  name: 'UpdateDonationStatusResult',
  fields: () => ({
    success: { type: new GraphQLNonNull(GraphQLBoolean) },
    donation: { type: DonationType },
  }),
});

/** Mutation result for creating a wallet */
const CreateWalletResultType = new GraphQLObjectType({
  name: 'CreateWalletResult',
  fields: () => ({
    success: { type: new GraphQLNonNull(GraphQLBoolean) },
    wallet: { type: WalletType },
  }),
});

/** Subscription event payload for new transactions */
const TransactionEventType = new GraphQLObjectType({
  name: 'TransactionEvent',
  fields: () => ({
    id: { type: GraphQLInt },
    senderId: { type: GraphQLInt },
    receiverId: { type: GraphQLInt },
    amount: { type: GraphQLFloat },
    memo: { type: GraphQLString },
    status: { type: GraphQLString },
    stellar_tx_id: { type: GraphQLString },
    timestamp: { type: GraphQLString },
  }),
});

/** Subscription event payload for donation lifecycle events */
const DonationEventType = new GraphQLObjectType({
  name: 'DonationEvent',
  fields: () => ({
    id: { type: GraphQLString },
    donor: { type: GraphQLString },
    recipient: { type: GraphQLString },
    amount: { type: GraphQLFloat },
    status: { type: GraphQLString },
    stellarTxId: { type: GraphQLString },
    campaign_id: { type: GraphQLInt },
    timestamp: { type: GraphQLString },
  }),
});

/** Subscription event payload for recurring donation execution */
const RecurringDonationEventType = new GraphQLObjectType({
  name: 'RecurringDonationEvent',
  fields: () => ({
    scheduleId: { type: GraphQLInt },
    donor: { type: GraphQLString },
    recipient: { type: GraphQLString },
    amount: { type: GraphQLFloat },
    txHash: { type: GraphQLString },
    executionCount: { type: GraphQLInt },
    timestamp: { type: GraphQLString },
  }),
});

// ─── Input types ──────────────────────────────────────────────────────────────

const CreateDonationInput = new GraphQLInputObjectType({
  name: 'CreateDonationInput',
  fields: () => ({
    senderId: { type: new GraphQLNonNull(GraphQLInt) },
    receiverId: { type: new GraphQLNonNull(GraphQLInt) },
    amount: { type: new GraphQLNonNull(GraphQLFloat) },
    memo: { type: GraphQLString },
    currency: { type: GraphQLString },
  }),
});

// ─── Query ────────────────────────────────────────────────────────────────────

/**
 * Build the root Query type backed by the provided services.
 * @param {object} services - { donationService, walletService, statsService }
 */
function buildQueryType({ donationService, walletService, statsService }) {
  return new GraphQLObjectType({
    name: 'Query',
    fields: () => ({
      /**
       * Fetch all donations.
       * Accepts optional limit/offset for pagination. Defaults to DEFAULT_PAGE_LIMIT
       * records; hard-capped at MAX_PAGE_LIMIT to prevent resource exhaustion. (#1372)
       * @param {object} _ - Parent (unused)
       * @param {object} args
       * @param {number} [args.limit] - Max records to return (default 20, max 100)
       * @param {number} [args.offset] - Number of records to skip
       * @returns {Promise<Array>} List of donation records
       */
      donations: {
        type: new GraphQLList(DonationType),
        args: {
          limit: { type: GraphQLInt, defaultValue: DEFAULT_PAGE_LIMIT },
          offset: { type: GraphQLInt, defaultValue: 0 },
        },
        resolve: async (_, { limit, offset }) => {
          const safeLimit = clampLimit(limit);
          const safeOffset = Math.max(0, offset ?? 0);
          const all = await donationService.getAllDonations();
          return all.slice(safeOffset, safeOffset + safeLimit);
        },
      },

      /**
       * Fetch a single donation by ID.
       * @param {object} _ - Parent (unused)
       * @param {object} args
       * @param {number} args.id - Donation ID
       * @returns {Promise<object>} Donation record
       */
      donation: {
        type: DonationType,
        args: { id: { type: new GraphQLNonNull(GraphQLInt) } },
        resolve: (_, { id }) => donationService.getDonationById(id),
      },

      /**
       * Fetch recent donations.
       * Defaults to DEFAULT_PAGE_LIMIT; hard-capped at MAX_PAGE_LIMIT to prevent
       * resource exhaustion. (#1372)
       * @param {object} _ - Parent (unused)
       * @param {object} args
       * @param {number} [args.limit] - Max records to return (default 20, max 100)
       * @returns {Promise<Array>} Recent donation records
       */
      recentDonations: {
        type: new GraphQLList(DonationType),
        args: { limit: { type: GraphQLInt, defaultValue: DEFAULT_PAGE_LIMIT } },
        resolve: (_, { limit }) => donationService.getRecentDonations(clampLimit(limit)),
      },

      /**
       * Fetch all wallets.
       * Accepts optional limit/offset for pagination. Defaults to DEFAULT_PAGE_LIMIT
       * records; hard-capped at MAX_PAGE_LIMIT to prevent resource exhaustion. (#1372)
       * @param {object} _ - Parent (unused)
       * @param {object} args
       * @param {number} [args.limit] - Max records to return (default 20, max 100)
       * @param {number} [args.offset] - Number of records to skip
       * @returns {Array} List of wallet records
       */
      wallets: {
        type: new GraphQLList(WalletType),
        args: {
          limit: { type: GraphQLInt, defaultValue: DEFAULT_PAGE_LIMIT },
          offset: { type: GraphQLInt, defaultValue: 0 },
        },
        resolve: (_, { limit, offset }) => {
          const safeLimit = clampLimit(limit);
          const safeOffset = Math.max(0, offset ?? 0);
          const all = walletService.getAllWallets();
          return all.slice(safeOffset, safeOffset + safeLimit);
        },
      },

      /**
       * Fetch a single wallet by ID.
       * @param {object} _ - Parent (unused)
       * @param {object} args
       * @param {number} args.id - Wallet ID
       * @returns {object} Wallet record
       */
      wallet: {
        type: WalletType,
        args: { id: { type: new GraphQLNonNull(GraphQLInt) } },
        resolve: (_, { id }) => walletService.getWalletById(id),
      },

      /**
       * Fetch daily donation statistics.
       * @param {object} _ - Parent (unused)
       * @param {object} args
       * @param {string} args.startDate - ISO date string
       * @param {string} args.endDate - ISO date string
       * @returns {Array} Daily stats
       */
      dailyStats: {
        type: new GraphQLList(DailyStatType),
        args: {
          startDate: { type: new GraphQLNonNull(GraphQLString) },
          endDate: { type: new GraphQLNonNull(GraphQLString) },
        },
        resolve: (_, { startDate, endDate }) =>
          statsService.getDailyStats(new Date(startDate), new Date(endDate)),
      },

      /**
       * Fetch summary statistics.
       * @param {object} _ - Parent (unused)
       * @param {object} args
       * @param {string} [args.startDate] - ISO date string
       * @param {string} [args.endDate] - ISO date string
       * @returns {object} Summary stats
       */
      summaryStats: {
        type: SummaryStatType,
        args: {
          startDate: { type: GraphQLString },
          endDate: { type: GraphQLString },
        },
        resolve: (_, { startDate, endDate }) =>
          statsService.getSummaryStats(
            startDate ? new Date(startDate) : null,
            endDate ? new Date(endDate) : null
          ),
      },
    }),
  });
}

// ─── Mutation ─────────────────────────────────────────────────────────────────

/**
 * Build the root Mutation type backed by the provided services.
 * @param {object} services - { donationService, walletService }
 */
function buildMutationType({ donationService, walletService }) {
  return new GraphQLObjectType({
    name: 'Mutation',
    fields: () => ({
      /**
       * Create a custodial donation between two users.
       * Requires donations:create permission (matching REST POST /donations/send). (#1371)
       * Uses the same service contract as the REST custodial route (#1693).
       * @param {object} _ - Parent (unused)
       * @param {object} args
       * @param {object} args.input - CreateDonationInput fields
       * @param {object} context - GraphQL context; must contain authenticated apiKey
       * @returns {Promise<object>} { success, donation, message }
       */
      createDonation: {
        type: CreateDonationResultType,
        args: { input: { type: new GraphQLNonNull(CreateDonationInput) } },
        resolve: async (_, { input }, context) => {
          assertPermission(context, 'donations:create');
          const { senderId, receiverId, amount, memo, currency } = input;
          // The custodial path settles in XLM only, matching REST POST /donations/send.
          if (currency != null && currency.toUpperCase() !== 'XLM') {
            throw new GraphQLError(`Unsupported currency: ${currency}. Only XLM is supported.`, {
              extensions: { code: 'BAD_USER_INPUT' },
            });
          }
          // senderId/receiverId are user IDs, so this is the custodial contract;
          // createDonationRecord is the non-custodial (wallet address) path.
          const params = { senderId, receiverId, amount };
          if (memo != null) params.memo = memo;
          const result = await donationService.sendCustodialDonation(params);
          const donation = {
            ...result,
            senderId,
            receiverId,
            memo: memo ?? null,
            stellar_tx_id: result.stellarTxId ?? null,
            currency: 'XLM',
          };
          return { success: true, donation };
        },
      },

      /**
       * Update the status of an existing donation.
       * Requires donations:update permission (matching REST PATCH /donations/:id/status). (#1371)
       * @param {object} _ - Parent (unused)
       * @param {object} args
       * @param {number} args.id - Donation ID
       * @param {string} args.status - New status value
       * @param {object} context - GraphQL context; must contain authenticated apiKey
       * @returns {object} { success, donation }
       */
      updateDonationStatus: {
        type: UpdateDonationStatusResultType,
        args: {
          id: { type: new GraphQLNonNull(GraphQLInt) },
          status: { type: new GraphQLNonNull(GraphQLString) },
        },
        resolve: (_, { id, status }, context) => {
          assertPermission(context, 'donations:update');
          const donation = donationService.updateDonationStatus(id, status);
          return { success: true, donation };
        },
      },

      /**
       * Create a new wallet record.
       * Requires wallets:create permission (matching REST POST /wallets). (#1371)
       * @param {object} _ - Parent (unused)
       * @param {object} args
       * @param {string} args.address - Stellar public key
       * @param {string} [args.label] - Optional label
       * @param {string} [args.ownerName] - Optional owner name
       * @param {object} context - GraphQL context; must contain authenticated apiKey
       * @returns {Promise<object>} { success, wallet }
       */
      createWallet: {
        type: CreateWalletResultType,
        args: {
          address: { type: new GraphQLNonNull(GraphQLString) },
          label: { type: GraphQLString },
          ownerName: { type: GraphQLString },
        },
        resolve: async (_, args, context) => {
          assertPermission(context, 'wallets:create');
          const wallet = await walletService.createWallet(args);
          return { success: true, wallet };
        },
      },
    }),
  });
}

// ─── Subscription ─────────────────────────────────────────────────────────────

/**
 * Build the root Subscription type.
 * Clients subscribe to real-time donation lifecycle events via WebSocket.
 * All subscriptions support optional filters: walletAddress, campaignId, minAmount.
 * @param {object} pubsub - PubSub instance
 */
function buildSubscriptionType(pubsub) {
  /** Shared filter args for all donation subscriptions */
  const filterArgs = {
    walletAddress: { type: GraphQLString },
    campaignId: { type: GraphQLInt },
    minAmount: { type: GraphQLFloat },
  };

  return new GraphQLObjectType({
    name: 'Subscription',
    fields: () => ({
      /** Legacy: subscribe to raw transaction creation events */
      transactionCreated: {
        type: TransactionEventType,
        subscribe: () => pubsub.asyncIterator('TRANSACTION_CREATED'),
        resolve: (payload) => payload,
      },

      /** Subscribe to new donation creation events */
      donationCreated: {
        type: DonationEventType,
        args: filterArgs,
        subscribe: (_, args) => pubsub.filteredIterator(pubsub.TOPICS.DONATION_CREATED, args),
        resolve: (payload) => payload,
      },

      /** Subscribe to donation completion (confirmed) events */
      donationCompleted: {
        type: DonationEventType,
        args: filterArgs,
        subscribe: (_, args) => pubsub.filteredIterator(pubsub.TOPICS.DONATION_COMPLETED, args),
        resolve: (payload) => payload,
      },

      /** Subscribe to recurring donation execution events */
      recurringDonationExecuted: {
        type: RecurringDonationEventType,
        args: {
          walletAddress: { type: GraphQLString },
          minAmount: { type: GraphQLFloat },
        },
        subscribe: (_, args) => pubsub.filteredIterator(pubsub.TOPICS.RECURRING_DONATION_EXECUTED, args),
        resolve: (payload) => payload,
      },
    }),
  });
}

// ─── Schema factory ───────────────────────────────────────────────────────────

/**
 * Build and return the complete GraphQL schema.
 * @param {object} services - { donationService, walletService, statsService, pubsub }
 * @returns {GraphQLSchema}
 */
function buildSchema({ donationService, walletService, statsService, pubsub }) {
  return new GraphQLSchema({
    query: buildQueryType({ donationService, walletService, statsService }),
    mutation: buildMutationType({ donationService, walletService }),
    subscription: buildSubscriptionType(pubsub),
  });
}

module.exports = { buildSchema, TransactionEventType, DonationEventType, RecurringDonationEventType };
