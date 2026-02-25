# Design Document: Event-Based Donation Lifecycle Hooks

## Overview

This design introduces an event-driven architecture for the donation lifecycle using Node.js's built-in EventEmitter. The system will emit events at key points in the donation flow (created, submitted, confirmed, failed), allowing developers to register hooks that execute custom logic without modifying core donation code.

The design maintains backward compatibility with existing APIs while providing a clean extension mechanism. The core donation flow remains simple and focused on request handling, while business logic is delegated to registered hooks.

## Architecture

### High-Level Architecture

```
┌─────────────────┐
│  Route Handler  │
│   (donation.js) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐      emits      ┌──────────────────┐
│  Transaction    │─────────────────▶│  Event Emitter   │
│     Model       │                  │ (DonationEvents) │
└─────────────────┘                  └────────┬─────────┘
                                              │
                                              │ notifies
                                              ▼
                                     ┌─────────────────┐
                                     │  Registered     │
                                     │     Hooks       │
                                     └─────────────────┘
```

### Component Responsibilities

1. **DonationEvents (Event Emitter)**
   - Extends Node.js EventEmitter
   - Defines lifecycle event constants
   - Provides hook registration methods
   - Emits events with consistent payload structure
   - Handles hook execution errors gracefully

2. **Transaction Model**
   - Maintains data persistence responsibilities
   - Emits lifecycle events at appropriate points
   - Remains focused on CRUD operations
   - Does not contain business logic

3. **Route Handlers**
   - Validate incoming requests
   - Coordinate transaction operations
   - Emit events for verification flow
   - Format and return responses
   - Remain thin and focused

4. **Hooks (Extension Points)**
   - Registered by application code
   - Execute custom business logic
   - Receive event payloads
   - Handle errors internally
   - Do not block core flow

## Components and Interfaces

### DonationEvents Class

```javascript
class DonationEvents extends EventEmitter {
  // Event name constants
  static EVENTS = {
    CREATED: 'donation.created',
    SUBMITTED: 'donation.submitted',
    CONFIRMED: 'donation.confirmed',
    FAILED: 'donation.failed'
  };

  /**
   * Register a hook for a lifecycle event
   * @param {string} eventName - One of DonationEvents.EVENTS
   * @param {Function} handler - Callback function (payload) => void
   * @throws {Error} If eventName is not a valid lifecycle event
   */
  registerHook(eventName, handler);

  /**
   * Emit a lifecycle event with payload
   * @param {string} eventName - Event to emit
   * @param {Object} payload - Event data
   */
  emitLifecycleEvent(eventName, payload);

  /**
   * Get all registered hooks for an event
   * @param {string} eventName - Event name
   * @returns {Function[]} Array of registered handlers
   */
  getHooks(eventName);
}
```

### Event Payload Structures

```javascript
// donation.created payload
{
  eventType: 'donation.created',
  timestamp: '2024-01-15T10:30:00.000Z',
  transaction: {
    id: '1234567890',
    amount: 100.50,
    donor: 'John Doe',
    recipient: 'Charity ABC',
    status: 'completed',
    timestamp: '2024-01-15T10:30:00.000Z',
    stellarTxId: null
  }
}

// donation.submitted payload
{
  eventType: 'donation.submitted',
  timestamp: '2024-01-15T10:31:00.000Z',
  transactionHash: 'abc123def456',
  transactionId: '1234567890'
}

// donation.confirmed payload
{
  eventType: 'donation.confirmed',
  timestamp: '2024-01-15T10:32:00.000Z',
  transactionHash: 'abc123def456',
  transactionId: '1234567890',
  verified: true,
  verificationDetails: { /* Stellar verification data */ }
}

// donation.failed payload
{
  eventType: 'donation.failed',
  timestamp: '2024-01-15T10:32:00.000Z',
  errorCode: 'VERIFICATION_FAILED',
  errorMessage: 'Transaction not found on network',
  context: {
    transactionHash: 'abc123def456',
    transactionId: '1234567890',
    stage: 'verification' // or 'creation'
  }
}
```

### Modified Transaction Model Interface

```javascript
class Transaction {
  /**
   * Set the event emitter instance
   * @param {DonationEvents} emitter - Event emitter to use
   */
  static setEventEmitter(emitter);

  /**
   * Create a new transaction and emit donation.created event
   * @param {Object} transactionData - Transaction details
   * @returns {Object} Created transaction
   * @throws {Error} If creation fails (also emits donation.failed)
   */
  static create(transactionData);

  // Existing methods remain unchanged
  static getAll();
  static getById(id);
  static getByDateRange(startDate, endDate);
}
```

### Route Handler Integration

```javascript
// Example: POST /donations endpoint
router.post('/', validateDonationCreate, (req, res) => {
  try {
    const { amount, donor, recipient } = req.body;
    
    // Transaction.create now emits donation.created event
    const transaction = Transaction.create({
      amount: parseFloat(amount),
      donor: donor || 'Anonymous',
      recipient
    });

    res.status(201).json({
      success: true,
      data: transaction
    });
  } catch (error) {
    // Error already emitted as donation.failed by Transaction.create
    res.status(500).json({
      success: false,
      error: {
        code: 'DONATION_FAILED',
        message: error.message
      }
    });
  }
});
```

## Data Models

### Event Emitter Singleton

The DonationEvents instance will be a singleton exported from a dedicated module:

```javascript
// src/events/donationEvents.js
const { EventEmitter } = require('events');

class DonationEvents extends EventEmitter {
  // Implementation details
}

// Export singleton instance
module.exports = new DonationEvents();
```

### Hook Registration Storage

Hooks are stored internally by Node.js EventEmitter using the standard event listener mechanism. No additional storage is required.

### Event Payload Schema

All event payloads follow this base structure:

```javascript
{
  eventType: string,      // One of DonationEvents.EVENTS values
  timestamp: string,      // ISO 8601 timestamp
  ...eventSpecificData    // Additional fields based on event type
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*


### Property 1: Transaction creation emits complete event data

*For any* valid transaction data, when a donation is created, the donation.created event should be emitted with a payload containing the complete transaction object, timestamp, and eventType.

**Validates: Requirements 2.1, 2.2, 8.1, 8.2, 8.3**

### Property 2: Transaction persistence precedes event emission

*For any* transaction creation, when the donation.created event is emitted, the transaction should already be retrievable from storage by its ID.

**Validates: Requirements 2.4**

### Property 3: Creation errors emit failure events

*For any* transaction creation that throws an error, the donation.failed event should be emitted with error details including errorCode, errorMessage, and context.

**Validates: Requirements 2.3, 8.6**

### Property 4: Verification submission emits events

*For any* transaction hash submitted for verification, the donation.submitted event should be emitted with a payload containing the transaction hash, transaction ID, timestamp, and eventType.

**Validates: Requirements 3.1, 8.1, 8.2, 8.4**

### Property 5: Successful verification emits confirmation

*For any* verification that succeeds, the donation.confirmed event should be emitted with a payload containing the transaction hash, verification status, transaction ID, timestamp, and eventType.

**Validates: Requirements 3.2, 8.1, 8.2, 8.5**

### Property 6: Failed verification emits failure events

*For any* verification that fails, the donation.failed event should be emitted with error details including errorCode, errorMessage, context, timestamp, and eventType.

**Validates: Requirements 3.3, 8.6**

### Property 7: Invalid event names are rejected

*For any* string that is not a valid lifecycle event name, attempting to register a hook with that name should throw an error or return false.

**Validates: Requirements 4.2**

### Property 8: Hooks execute in registration order

*For any* set of hooks registered for the same event in a specific order, when that event is emitted, the hooks should execute in the same order they were registered.

**Validates: Requirements 4.3**

### Property 9: All hooks receive event payload

*For any* registered hook and any emitted event matching that hook's event type, the hook function should be called with the complete event payload as its argument.

**Validates: Requirements 4.4**

### Property 10: Hook errors don't block other hooks

*For any* set of registered hooks where one or more throw errors, all hooks should still be executed, and errors should be logged without stopping execution of subsequent hooks.

**Validates: Requirements 4.5**

### Property 11: Backward compatibility of responses

*For any* existing API request (donation creation or verification), the response format should match the original format regardless of whether hooks are registered.

**Validates: Requirements 7.2**

### Property 12: Events without hooks don't cause errors

*For any* lifecycle event emitted when no hooks are registered for that event, the system should continue normal operation without throwing errors or affecting the response.

**Validates: Requirements 7.4**

## Error Handling

### Event Emission Errors

The system handles errors at multiple levels:

1. **Transaction Creation Errors**
   - Caught in Transaction.create()
   - donation.failed event emitted with error details
   - Error re-thrown to route handler for HTTP response
   - Storage remains consistent (no partial writes)

2. **Hook Execution Errors**
   - Caught by DonationEvents.emitLifecycleEvent()
   - Logged with error details and hook context
   - Remaining hooks continue execution
   - Core donation flow unaffected

3. **Event Registration Errors**
   - Invalid event names throw Error immediately
   - Non-function handlers throw TypeError
   - Validation occurs before registration
   - No partial registration state

### Error Payload Structure

All donation.failed events include:

```javascript
{
  eventType: 'donation.failed',
  timestamp: string,
  errorCode: string,        // Machine-readable error identifier
  errorMessage: string,     // Human-readable error description
  context: {
    stage: string,          // 'creation' or 'verification'
    ...additionalContext    // Stage-specific context data
  }
}
```

### Graceful Degradation

- System operates normally with zero registered hooks
- Hook failures don't affect HTTP responses
- Event emission failures are logged but don't crash the process
- Invalid hook registrations fail fast with clear error messages

## Testing Strategy

### Dual Testing Approach

This feature requires both unit tests and property-based tests to ensure comprehensive coverage:

- **Unit tests**: Verify specific examples, edge cases, and integration points
- **Property tests**: Verify universal properties across randomized inputs

### Unit Testing Focus

Unit tests should cover:

1. **Specific Examples**
   - Registering a hook and verifying it executes
   - Creating a donation and checking the created event fires
   - Verifying a donation and checking the confirmed event fires

2. **Edge Cases**
   - Emitting events with no registered hooks
   - Registering multiple hooks for the same event
   - Hook execution with empty payloads

3. **Integration Points**
   - Route handler → Transaction model → Event emission flow
   - Event emission → Hook execution → Logging flow
   - Error in transaction creation → Failed event emission

4. **Error Conditions**
   - Invalid event name registration attempts
   - Hook throwing an error during execution
   - Transaction creation failure scenarios

### Property-Based Testing Configuration

Property tests should use **fast-check** (JavaScript property-based testing library) with the following configuration:

- **Minimum 100 iterations per test** (due to randomization)
- Each test must reference its design document property
- Tag format: `Feature: event-based-donation-lifecycle-hooks, Property {number}: {property_text}`

### Property Test Implementation

Each correctness property must be implemented as a single property-based test:

1. **Property 1**: Generate random transaction data, create donations, verify event payload completeness
2. **Property 2**: Generate random transactions, verify storage retrieval succeeds when event fires
3. **Property 3**: Generate invalid transaction data, verify failed events are emitted
4. **Property 4**: Generate random transaction hashes, verify submitted events fire
5. **Property 5**: Generate random verification scenarios, verify confirmed events for successes
6. **Property 6**: Generate failing verification scenarios, verify failed events fire
7. **Property 7**: Generate random invalid event names, verify registration rejection
8. **Property 8**: Generate random hook sets, verify execution order matches registration order
9. **Property 9**: Generate random hooks and events, verify payload delivery
10. **Property 10**: Generate hooks that throw errors, verify all hooks still execute
11. **Property 11**: Generate random API requests, verify response format consistency
12. **Property 12**: Generate random events with no hooks, verify no errors occur

### Test Organization

```
tests/
  unit/
    donationEvents.test.js       # Unit tests for event emitter
    transaction.events.test.js   # Unit tests for transaction event emission
    hooks.integration.test.js    # Integration tests for hook execution
  
  property/
    eventEmission.property.test.js    # Properties 1-6
    hookRegistration.property.test.js # Properties 7-10
    compatibility.property.test.js    # Properties 11-12
```

### Testing Best Practices

1. **Isolation**: Each test should set up its own event emitter instance
2. **Cleanup**: Remove all hooks after each test to prevent cross-test pollution
3. **Mocking**: Mock file system operations in Transaction model for faster tests
4. **Assertions**: Verify both event emission and payload structure in each test
5. **Coverage**: Aim for 100% coverage of DonationEvents class and event emission paths
