const {
  TRANSACTION_STATES,
  normalizeState,
  canTransition,
  assertValidState,
  assertValidTransition,
} = require('../src/utils/transactionStateMachine');

describe('Transaction State Machine', () => {
  test('should normalize legacy states', () => {
    expect(normalizeState('completed')).toBe(TRANSACTION_STATES.CONFIRMED);
    expect(normalizeState('cancelled')).toBe(TRANSACTION_STATES.FAILED);
  });

  test('should validate known states', () => {
    expect(() => assertValidState(TRANSACTION_STATES.PENDING)).not.toThrow();
    expect(() => assertValidState(TRANSACTION_STATES.SUBMITTED)).not.toThrow();
    expect(() => assertValidState(TRANSACTION_STATES.CONFIRMED)).not.toThrow();
    expect(() => assertValidState(TRANSACTION_STATES.FAILED)).not.toThrow();
  });

  test('should reject unknown states', () => {
    expect(() => assertValidState('cancelled')).toThrow('Invalid transaction state');
  });

  test('should allow valid transitions', () => {
    expect(canTransition('pending', 'submitted')).toBe(true);
    expect(canTransition('submitted', 'confirmed')).toBe(true);
    expect(canTransition('submitted', 'failed')).toBe(true);
  });

  test('should block invalid transitions', () => {
    expect(canTransition('failed', 'confirmed')).toBe(false);
    expect(() => assertValidTransition('failed', 'confirmed')).toThrow('Invalid transaction state transition');
  });
});
