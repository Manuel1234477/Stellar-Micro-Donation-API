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
} = require('graphql');

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
       * @returns {Promise<Array>} List of donation records
       */
      donations: {
        type: new GraphQLList(DonationType),
        resolve: () => donationService.getAllDonations(),
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
       * @param {object} _ - Parent (unused)
       * @param {object} args
       * @param {number} [args.limit=10] - Max records to return
       * @returns {Promise<Array>} Recent donation records
       */
      recentDonations: {
        type: new GraphQLList(DonationType),
        args: { limit: { type: GraphQLInt, defaultValue: 10 } },
        resolve: (_, { limit }) => donationService.getRecentDonations(limit),
      },

      /**
       * Fetch all wallets.
       * @returns {Array} List of wallet records
       */
      wallets: {
        type: new GraphQLList(WalletType),
        resolve: () => walletService.getAllWallets(),
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
       * Create a new donation record.
       * @param {object} _ - Parent (unused)
       * @param {object} args
       * @param {object} args.input - CreateDonationInput fields
       * @returns {Promise<object>} { success, donation, message }
       */
      createDonation: {
        type: CreateDonationResultType,
        args: { input: { type: new GraphQLNonNull(CreateDonationInput) } },
        resolve: async (_, { input }) => {
          const donation = await donationService.createDonationRecord(input);
          return { success: true, donation };
        },
      },

      /**
       * Update the status of an existing donation.
       * @param {object} _ - Parent (unused)
       * @param {object} args
       * @param {number} args.id - Donation ID
       * @param {string} args.status - New status value
       * @returns {object} { success, donation }
       */
      updateDonationStatus: {
        type: UpdateDonationStatusResultType,
        args: {
          id: { type: new GraphQLNonNull(GraphQLInt) },
          status: { type: new GraphQLNonNull(GraphQLString) },
        },
        resolve: (_, { id, status }) => {
          const donation = donationService.updateDonationStatus(id, status);
          return { success: true, donation };
        },
      },

      /**
       * Create a new wallet record.
       * @param {object} _ - Parent (unused)
       * @param {object} args
       * @param {string} args.address - Stellar public key
       * @param {string} [args.label] - Optional label
       * @param {string} [args.ownerName] - Optional owner name
       * @returns {Promise<object>} { success, wallet }
       */
      createWallet: {
        type: CreateWalletResultType,
        args: {
          address: { type: new GraphQLNonNull(GraphQLString) },
          label: { type: GraphQLString },
          ownerName: { type: GraphQLString },
        },
        resolve: async (_, args) => {
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
 * Clients subscribe to real-time transaction events via WebSocket.
 * The pubsub object must expose { asyncIterator(topic) }.
 * @param {object} pubsub - PubSub instance
 */
function buildSubscriptionType(pubsub) {
  return new GraphQLObjectType({
    name: 'Subscription',
    fields: () => ({
      /**
       * Subscribe to new transaction events.
       * Emits a TransactionEvent whenever a donation transaction is created.
       */
      transactionCreated: {
        type: TransactionEventType,
        subscribe: () => pubsub.asyncIterator('TRANSACTION_CREATED'),
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

module.exports = { buildSchema, TransactionEventType };
