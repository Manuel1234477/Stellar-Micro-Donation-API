# Implementation Plan: Event-Based Donation Lifecycle Hooks

## Overview

This implementation plan breaks down the event-based donation lifecycle hooks feature into discrete coding tasks. The approach follows a bottom-up strategy: first building the event emitter infrastructure, then integrating it into the transaction model, and finally wiring it into the route handlers. Each task builds incrementally on previous work, with property-based tests placed close to implementation to catch errors early.

## Tasks

- [x] 1. Create DonationEvents event emitter class
  - Create `src/events/donationEvents.js` file
  - Implement DonationEvents class extending EventEmitter
  - Define EVENTS constant object with four lifecycle event names
  - Implement registerHook() method with event name validation
  - Implement emitLifecycleEvent() method with error handling for hooks
  - Implement getHooks() method to retrieve registered handlers
  - Export singleton instance
  - _Requirements: 1.1, 4.1, 4.2, 4.5_

- [ ]* 1.1 Write property test for invalid event name rejection
  - **Property 7: Invalid event names are rejected**
  - **Validates: Requirements 4.2**

- [ ]* 1.2 Write property test for hook execution order
  - **Property 8: Hooks execute in registration order**
  - **Validates: Requirements 4.3**

- [ ]* 1.3 Write property test for payload delivery to hooks
  - **Property 9: All hooks receive event payload**
  - **Validates: Requirements 4.4**

- [ ]* 1.4 Write property test for hook error isolation
  - **Property 10: Hook errors don't block other hooks**
  - **Validates: Requirements 4.5**

- [ ]* 1.5 Write unit tests for DonationEvents class
  - Test hook registration with valid event names
  - Test hook registration with invalid event names throws error
  - Test emitting events with no registered hooks
  - Test emitting events with multiple registered hooks
  - _Requirements: 4.1, 4.2, 4.5_

- [x] 2. Integrate event emission into Transaction model
  - [x] 2.1 Add event emitter integration to Transaction class
    - Import donationEvents singleton
    - Add static setEventEmitter() method (for testing)
    - Modify create() method to emit donation.created event after persistence
    - Add try-catch to emit donation.failed event on creation errors
    - Ensure event payload includes timestamp, eventType, and complete transaction object
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 8.1, 8.2, 8.3, 8.6_

  - [ ]* 2.2 Write property test for transaction creation event emission
    - **Property 1: Transaction creation emits complete event data**
    - **Validates: Requirements 2.1, 2.2, 8.1, 8.2, 8.3**

  - [ ]* 2.3 Write property test for persistence before event emission
    - **Property 2: Transaction persistence precedes event emission**
    - **Validates: Requirements 2.4**

  - [ ]* 2.4 Write property test for creation error events
    - **Property 3: Creation errors emit failure events**
    - **Validates: Requirements 2.3, 8.6**

  - [ ]* 2.5 Write unit tests for Transaction event emission
    - Test successful creation emits donation.created with correct payload
    - Test creation error emits donation.failed with error details
    - Test event payload structure matches schema
    - Test transaction is retrievable when created event fires
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Add event emission to donation verification flow
  - [x] 4.1 Modify POST /donations/verify route handler
    - Import donationEvents singleton
    - Emit donation.submitted event when verification request received
    - Emit donation.confirmed event on successful verification
    - Emit donation.failed event on verification failure
    - Ensure events are emitted before sending HTTP response
    - Maintain existing response format for backward compatibility
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 7.2, 8.4, 8.5, 8.6_

  - [ ]* 4.2 Write property test for verification submission events
    - **Property 4: Verification submission emits events**
    - **Validates: Requirements 3.1, 8.1, 8.2, 8.4**

  - [ ]* 4.3 Write property test for successful verification events
    - **Property 5: Successful verification emits confirmation**
    - **Validates: Requirements 3.2, 8.1, 8.2, 8.5**

  - [ ]* 4.4 Write property test for failed verification events
    - **Property 6: Failed verification emits failure events**
    - **Validates: Requirements 3.3, 8.6**

  - [ ]* 4.5 Write unit tests for verification event emission
    - Test submitted event fires when verification request received
    - Test confirmed event fires on successful verification
    - Test failed event fires on verification failure
    - Test event timing (before HTTP response)
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 5. Add backward compatibility tests
  - [ ]* 5.1 Write property test for response format consistency
    - **Property 11: Backward compatibility of responses**
    - **Validates: Requirements 7.2**

  - [ ]* 5.2 Write property test for events without hooks
    - **Property 12: Events without hooks don't cause errors**
    - **Validates: Requirements 7.4**

  - [ ]* 5.3 Write integration tests for backward compatibility
    - Test POST /donations returns same response format
    - Test POST /donations/verify returns same response format
    - Test GET /donations returns same response format
    - Test GET /donations/:id returns same response format
    - Test all endpoints work with no hooks registered
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 6. Create documentation and examples
  - Create `docs/LIFECYCLE_HOOKS.md` documentation file
  - Document all four lifecycle events with timing and payload structure
  - Provide code examples for registering hooks for each event type
  - Document hook function signature and parameters
  - Document error handling best practices for hooks
  - Include example hook implementations (logging, notifications, analytics)
  - Document how to test custom hooks
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 7. Create example hook implementations
  - Create `src/hooks/examples/` directory
  - Implement loggingHook.js (logs all donation events)
  - Implement analyticsHook.js (tracks donation metrics)
  - Implement notificationHook.js (sends notifications on events)
  - Register example hooks in a separate initialization file
  - Add comments explaining hook patterns and best practices
  - _Requirements: 6.2, 6.4_

- [ ] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The design uses JavaScript/Node.js as specified in the existing codebase
- Property-based tests use fast-check library with minimum 100 iterations
- Each property test references its corresponding design document property
- Event emission is integrated at the model level to keep route handlers thin
- Backward compatibility is maintained throughout - all existing APIs work unchanged
- Documentation and examples help future developers extend the system
