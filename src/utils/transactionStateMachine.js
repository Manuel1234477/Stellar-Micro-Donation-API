const { ValidationError, ERROR_CODES } = require('./errors');

const TRANSACTION_STATES = Object.freeze({
  PENDING: 'pending',
  QUEUED: 'queued',
  SUBMITTED: 'submitted',
  PENDING_CONFIRMATION: 'pending_confirmation',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
  EXPIRED: 'expired',
});

const LEGACY_STATE_ALIASES = Object.freeze({
  completed: TRANSACTION_STATES.CONFIRMED,
  cancelled: TRANSACTION_STATES.FAILED,
});

const VALID_TRANSITIONS = Object.freeze({
  [TRANSACTION_STATES.PENDING]: new Set([
    TRANSACTION_STATES.QUEUED,
    TRANSACTION_STATES.SUBMITTED,
    TRANSACTION_STATES.PENDING_CONFIRMATION,
    TRANSACTION_STATES.CONFIRMED,
    TRANSACTION_STATES.FAILED,
  ]),
  [TRANSACTION_STATES.QUEUED]: new Set([
    TRANSACTION_STATES.SUBMITTED,
    TRANSACTION_STATES.FAILED,
  ]),
  [TRANSACTION_STATES.SUBMITTED]: new Set([
    TRANSACTION_STATES.PENDING_CONFIRMATION,
    TRANSACTION_STATES.CONFIRMED,
    TRANSACTION_STATES.FAILED,
  ]),
  [TRANSACTION_STATES.PENDING_CONFIRMATION]: new Set([
    TRANSACTION_STATES.CONFIRMED,
    TRANSACTION_STATES.FAILED,
  ]),
  // confirmed → failed is allowed for reconciliation scenarios (e.g. a
  // transaction later found to have failed on-network)
  [TRANSACTION_STATES.CONFIRMED]: new Set([
    TRANSACTION_STATES.FAILED,
  ]),
  [TRANSACTION_STATES.FAILED]: new Set(),
  [TRANSACTION_STATES.EXPIRED]: new Set(),
});

const normalizeState = (state) => {
  if (!state) {
    return TRANSACTION_STATES.PENDING;
  }

  const normalized = String(state).toLowerCase().trim();
  return LEGACY_STATE_ALIASES[normalized] || normalized;
};

const isValidState = (state) => Object.values(TRANSACTION_STATES).includes(state);

const assertValidState = (state, context = 'state') => {
  if (!isValidState(state)) {
    throw new ValidationError(
      `Invalid transaction ${context}: "${state}". Valid states: ${Object.values(TRANSACTION_STATES).join(', ')}`,
      { context, state, validStates: Object.values(TRANSACTION_STATES) },
      ERROR_CODES.INVALID_REQUEST
    );
  }
};

const canTransition = (fromState, toState) => {
  if (fromState === toState) {
    return true;
  }
  return VALID_TRANSITIONS[fromState] && VALID_TRANSITIONS[fromState].has(toState);
};

const assertValidTransition = (fromState, toState) => {
  if (!canTransition(fromState, toState)) {
    const { BusinessLogicError } = require('./errors');
    throw new BusinessLogicError(
      ERROR_CODES.INVALID_STATE_TRANSITION,
      `Invalid transaction state transition: ${fromState} → ${toState}`,
      {
        fromState,
        toState,
        allowedTransitions: Array.from(VALID_TRANSITIONS[fromState] || []),
      }
    );
  }
};

module.exports = {
  TRANSACTION_STATES,
  VALID_TRANSITIONS,
  normalizeState,
  isValidState,
  assertValidState,
  canTransition,
  assertValidTransition,
};
