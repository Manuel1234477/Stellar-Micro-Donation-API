# Donation Lifecycle Hooks Documentation

## Overview

The donation lifecycle hooks system provides an event-driven architecture for extending donation functionality without modifying core code. The system emits events at key points in the donation flow, allowing developers to register hooks that execute custom logic.

## Lifecycle Events

The system defines four lifecycle events that occur during donation processing:

### 1. donation.created

**When:** Emitted after a donation transaction is successfully created and persisted to storage.

**Payload Structure:**
```javascript
{
  eventType: 'donation.created',
  timestamp: '2026-02-25T10:30:00.000Z',  // ISO 8601 timestamp
  transaction: {
    id: '1234567890',
    amount: 100.50,
    donor: 'John Doe',
    recipient: 'Charity ABC',
    status: 'completed',
    timestamp: '2026-02-25T10:30:00.000Z',
    stellarTxId: null
  }
}
```

**Use Cases:**
- Logging donation creation
- Sending confirmation emails
- Updating analytics dashboards
- Triggering notifications

### 2. donation.submitted

**When:** Emitted when a donation verification request is received.

**Payload Structure:**
```javascript
{
  eventType: 'donation.submitted',
  timestamp: '2026-02-25T10:31:00.000Z',
  transactionHash: 'abc123def456',
  transactionId: '1234567890'
}
```

**Use Cases:**
- Tracking verification requests
- Logging verification attempts
- Updating transaction status

### 3. donation.confirmed

**When:** Emitted when a donation verification succeeds.

**Payload Structure:**
```javascript
{
  eventType: 'donation.confirmed',
  timestamp: '2026-02-25T10:32:00.000Z',
  transactionHash: 'abc123def456',
  transactionId: '1234567890',
  verified: true,
  verificationDetails: { /* Stellar verification data */ }
}
```

**Use Cases:**
- Sending success notifications
- Updating donation status
- Recording successful verifications
- Triggering reward systems

### 4. donation.failed

**When:** Emitted when donation creation or verification fails.

**Payload Structure:**
```javascript
{
  eventType: 'donation.failed',
  timestamp: '2026-02-25T10:32:00.000Z',
  errorCode: 'VERIFICATION_FAILED',
  errorMessage: 'Transaction not found on network',
  context: {
    transactionHash: 'abc123def456',
    transactionId: '1234567890',
    stage: 'verification'  // or 'creation'
  }
}
```

**Use Cases:**
- Error logging and monitoring
- Sending failure notifications
- Triggering retry mechanisms
- Recording failed attempts

## Event Flow

### Normal Donation Flow
```
1. POST /donations
   ↓
2. Transaction.create()
   ↓
3. donation.created event emitted
   ↓
4. POST /donations/verify
   ↓
5. donation.submitted event emitted
   ↓
6. Verification succeeds
   ↓
7. donation.confirmed event emitted
```

### Error Flow
```
1. POST /donations
   ↓
2. Transaction.create() fails
   ↓
3. donation.failed event emitted (stage: 'creation')

OR

1. POST /donations/verify
   ↓
2. donation.submitted event emitted
   ↓
3. Verification fails
   ↓
4. donation.failed event emitted (stage: 'verification')
```

## Registering Hooks

### Basic Hook Registration

```javascript
const donationEvents = require('./events/donationEvents');

// Register a hook for donation.created event
donationEvents.registerHook(
  donationEvents.constructor.EVENTS.CREATED,
  (payload) => {
    console.log('Donation created:', payload.transaction.id);
    console.log('Amount:', payload.transaction.amount);
    console.log('Donor:', payload.transaction.donor);
  }
);
```

### Hook Function Signature

All hook functions receive a single parameter: the event payload.

```javascript
function hookHandler(payload) {
  // payload contains:
  // - eventType: string
  // - timestamp: string (ISO 8601)
  // - ...event-specific data
}
```

### Registering Multiple Hooks

You can register multiple hooks for the same event. They will execute in registration order.

```javascript
// First hook - logging
donationEvents.registerHook(
  donationEvents.constructor.EVENTS.CREATED,
  (payload) => {
    console.log('Log: Donation created', payload.transaction.id);
  }
);

// Second hook - analytics
donationEvents.registerHook(
  donationEvents.constructor.EVENTS.CREATED,
  (payload) => {
    analytics.track('donation_created', {
      amount: payload.transaction.amount,
      donor: payload.transaction.donor
    });
  }
);
```

## Hook Examples

### Example 1: Logging Hook

```javascript
const donationEvents = require('./events/donationEvents');

function loggingHook(payload) {
  const timestamp = new Date(payload.timestamp).toLocaleString();
  console.log(`[${timestamp}] ${payload.eventType}:`, JSON.stringify(payload, null, 2));
}

// Register for all events
Object.values(donationEvents.constructor.EVENTS).forEach(eventName => {
  donationEvents.registerHook(eventName, loggingHook);
});
```

### Example 2: Analytics Hook

```javascript
const donationEvents = require('./events/donationEvents');

function analyticsHook(payload) {
  switch (payload.eventType) {
    case 'donation.created':
      // Track donation creation
      console.log('Analytics: Donation created', {
        amount: payload.transaction.amount,
        donor: payload.transaction.donor,
        recipient: payload.transaction.recipient
      });
      break;
    
    case 'donation.confirmed':
      // Track successful verification
      console.log('Analytics: Donation confirmed', {
        transactionHash: payload.transactionHash
      });
      break;
    
    case 'donation.failed':
      // Track failures
      console.log('Analytics: Donation failed', {
        errorCode: payload.errorCode,
        stage: payload.context.stage
      });
      break;
  }
}

// Register for relevant events
donationEvents.registerHook(
  donationEvents.constructor.EVENTS.CREATED,
  analyticsHook
);
donationEvents.registerHook(
  donationEvents.constructor.EVENTS.CONFIRMED,
  analyticsHook
);
donationEvents.registerHook(
  donationEvents.constructor.EVENTS.FAILED,
  analyticsHook
);
```

### Example 3: Notification Hook

```javascript
const donationEvents = require('./events/donationEvents');

async function notificationHook(payload) {
  try {
    switch (payload.eventType) {
      case 'donation.created':
        // Send confirmation email
        console.log(`Sending email to ${payload.transaction.donor}`);
        // await emailService.send({
        //   to: payload.transaction.donor,
        //   subject: 'Donation Received',
        //   body: `Thank you for your donation of $${payload.transaction.amount}`
        // });
        break;
      
      case 'donation.confirmed':
        // Send verification success notification
        console.log('Sending verification success notification');
        break;
      
      case 'donation.failed':
        // Send error notification
        console.log('Sending error notification:', payload.errorMessage);
        break;
    }
  } catch (error) {
    console.error('Notification hook error:', error);
  }
}

// Register for all events
Object.values(donationEvents.constructor.EVENTS).forEach(eventName => {
  donationEvents.registerHook(eventName, notificationHook);
});
```

## Error Handling Best Practices

### 1. Always Use Try-Catch

Hooks should handle their own errors to prevent affecting other hooks or the core flow.

```javascript
donationEvents.registerHook(
  donationEvents.constructor.EVENTS.CREATED,
  (payload) => {
    try {
      // Your hook logic here
      riskyOperation(payload);
    } catch (error) {
      console.error('Hook error:', error);
      // Log to error tracking service
      // errorTracker.log(error);
    }
  }
);
```

### 2. Don't Block the Event Loop

Avoid long-running synchronous operations in hooks. Use async operations when needed.

```javascript
// Bad - blocks event loop
donationEvents.registerHook(
  donationEvents.constructor.EVENTS.CREATED,
  (payload) => {
    const result = heavySyncOperation(); // Blocks!
  }
);

// Good - async operation
donationEvents.registerHook(
  donationEvents.constructor.EVENTS.CREATED,
  async (payload) => {
    try {
      await asyncOperation(payload);
    } catch (error) {
      console.error('Async hook error:', error);
    }
  }
);
```

### 3. Validate Payload Data

Always validate that expected data exists in the payload.

```javascript
donationEvents.registerHook(
  donationEvents.constructor.EVENTS.CREATED,
  (payload) => {
    if (!payload.transaction || !payload.transaction.id) {
      console.error('Invalid payload: missing transaction data');
      return;
    }
    
    // Safe to use payload.transaction now
    processTransaction(payload.transaction);
  }
);
```

### 4. Log Errors Appropriately

Log errors with context to help debugging.

```javascript
donationEvents.registerHook(
  donationEvents.constructor.EVENTS.CREATED,
  (payload) => {
    try {
      processPayload(payload);
    } catch (error) {
      console.error('Hook execution failed:', {
        eventType: payload.eventType,
        transactionId: payload.transaction?.id,
        error: error.message,
        stack: error.stack
      });
    }
  }
);
```

## Testing Hooks

### Unit Testing Individual Hooks

```javascript
const donationEvents = require('./events/donationEvents');

describe('Logging Hook', () => {
  let logSpy;
  
  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation();
  });
  
  afterEach(() => {
    logSpy.mockRestore();
    // Clear all hooks
    donationEvents.removeAllListeners();
  });
  
  test('should log donation creation', () => {
    const loggingHook = (payload) => {
      console.log('Donation created:', payload.transaction.id);
    };
    
    donationEvents.registerHook(
      donationEvents.constructor.EVENTS.CREATED,
      loggingHook
    );
    
    const payload = {
      eventType: 'donation.created',
      timestamp: new Date().toISOString(),
      transaction: { id: '123', amount: 100 }
    };
    
    donationEvents.emitLifecycleEvent(
      donationEvents.constructor.EVENTS.CREATED,
      payload
    );
    
    expect(logSpy).toHaveBeenCalledWith('Donation created:', '123');
  });
});
```

### Integration Testing with Routes

```javascript
const request = require('supertest');
const app = require('./routes/app');
const donationEvents = require('./events/donationEvents');

describe('Donation Creation with Hooks', () => {
  let hookCalled = false;
  
  beforeEach(() => {
    hookCalled = false;
    donationEvents.removeAllListeners();
  });
  
  test('should trigger hook on donation creation', async () => {
    donationEvents.registerHook(
      donationEvents.constructor.EVENTS.CREATED,
      (payload) => {
        hookCalled = true;
        expect(payload.transaction).toBeDefined();
        expect(payload.transaction.amount).toBe(100);
      }
    );
    
    const response = await request(app)
      .post('/donations')
      .set('X-API-Key', 'test-key')
      .send({
        amount: 100,
        donor: 'Test Donor',
        recipient: 'Test Recipient'
      });
    
    expect(response.status).toBe(201);
    expect(hookCalled).toBe(true);
  });
});
```

## Advanced Patterns

### Conditional Hook Execution

```javascript
donationEvents.registerHook(
  donationEvents.constructor.EVENTS.CREATED,
  (payload) => {
    // Only process large donations
    if (payload.transaction.amount >= 1000) {
      console.log('Large donation alert:', payload.transaction.amount);
      // Send special notification
    }
  }
);
```

### Hook Composition

```javascript
function createComposedHook(...hooks) {
  return (payload) => {
    hooks.forEach(hook => {
      try {
        hook(payload);
      } catch (error) {
        console.error('Composed hook error:', error);
      }
    });
  };
}

const logHook = (payload) => console.log('Log:', payload.eventType);
const analyticsHook = (payload) => console.log('Analytics:', payload.eventType);
const notifyHook = (payload) => console.log('Notify:', payload.eventType);

const composedHook = createComposedHook(logHook, analyticsHook, notifyHook);

donationEvents.registerHook(
  donationEvents.constructor.EVENTS.CREATED,
  composedHook
);
```

### Async Hook with Retry

```javascript
async function retryableHook(payload, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await externalApiCall(payload);
      return; // Success
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error.message);
      if (attempt === maxRetries) {
        console.error('All retry attempts failed');
      } else {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
}

donationEvents.registerHook(
  donationEvents.constructor.EVENTS.CREATED,
  (payload) => retryableHook(payload)
);
```

## API Reference

### DonationEvents Class

#### Static Properties

- `EVENTS.CREATED`: 'donation.created'
- `EVENTS.SUBMITTED`: 'donation.submitted'
- `EVENTS.CONFIRMED`: 'donation.confirmed'
- `EVENTS.FAILED`: 'donation.failed'

#### Methods

##### registerHook(eventName, handler)

Register a hook for a lifecycle event.

**Parameters:**
- `eventName` (string): One of DonationEvents.EVENTS values
- `handler` (function): Callback function that receives the event payload

**Throws:**
- `Error`: If eventName is not a valid lifecycle event
- `TypeError`: If handler is not a function

**Example:**
```javascript
donationEvents.registerHook(
  donationEvents.constructor.EVENTS.CREATED,
  (payload) => console.log(payload)
);
```

##### emitLifecycleEvent(eventName, payload)

Emit a lifecycle event with payload. This method is used internally by the system.

**Parameters:**
- `eventName` (string): Event to emit
- `payload` (object): Event data

**Example:**
```javascript
donationEvents.emitLifecycleEvent(
  donationEvents.constructor.EVENTS.CREATED,
  {
    eventType: 'donation.created',
    timestamp: new Date().toISOString(),
    transaction: { /* transaction data */ }
  }
);
```

##### getHooks(eventName)

Get all registered hooks for an event.

**Parameters:**
- `eventName` (string): Event name

**Returns:**
- `Function[]`: Array of registered handler functions

**Example:**
```javascript
const hooks = donationEvents.getHooks(
  donationEvents.constructor.EVENTS.CREATED
);
console.log(`${hooks.length} hooks registered`);
```

## Troubleshooting

### Hook Not Executing

1. **Check event name**: Ensure you're using the correct event constant
   ```javascript
   // Wrong
   donationEvents.registerHook('created', handler);
   
   // Correct
   donationEvents.registerHook(
     donationEvents.constructor.EVENTS.CREATED,
     handler
   );
   ```

2. **Verify registration timing**: Register hooks before events are emitted
   ```javascript
   // Register hooks during app initialization
   // src/routes/app.js or a dedicated hooks initialization file
   ```

3. **Check for errors**: Look for error logs from hook execution
   ```javascript
   // The system logs hook errors to console
   // Check your application logs
   ```

### Hook Errors Affecting Performance

1. **Use async operations**: Don't block the event loop
2. **Add timeouts**: Prevent hooks from running too long
3. **Monitor hook execution time**: Log timing information

```javascript
donationEvents.registerHook(
  donationEvents.constructor.EVENTS.CREATED,
  async (payload) => {
    const start = Date.now();
    try {
      await yourOperation(payload);
    } finally {
      const duration = Date.now() - start;
      if (duration > 1000) {
        console.warn(`Hook took ${duration}ms - consider optimization`);
      }
    }
  }
);
```

## Migration Guide

### Migrating Inline Logic to Hooks

**Before (inline logic):**
```javascript
router.post('/', validateDonationCreate, (req, res) => {
  try {
    const transaction = Transaction.create(req.body);
    
    // Inline logging
    console.log('Donation created:', transaction.id);
    
    // Inline analytics
    analytics.track('donation_created', transaction);
    
    // Inline notification
    sendEmail(transaction.donor, 'Thank you!');
    
    res.status(201).json({ success: true, data: transaction });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
```

**After (using hooks):**
```javascript
// Route handler - clean and focused
router.post('/', validateDonationCreate, (req, res) => {
  try {
    const transaction = Transaction.create(req.body);
    // Events are emitted automatically by Transaction.create()
    res.status(201).json({ success: true, data: transaction });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Hooks - in separate initialization file
donationEvents.registerHook(
  donationEvents.constructor.EVENTS.CREATED,
  (payload) => {
    console.log('Donation created:', payload.transaction.id);
  }
);

donationEvents.registerHook(
  donationEvents.constructor.EVENTS.CREATED,
  (payload) => {
    analytics.track('donation_created', payload.transaction);
  }
);

donationEvents.registerHook(
  donationEvents.constructor.EVENTS.CREATED,
  (payload) => {
    sendEmail(payload.transaction.donor, 'Thank you!');
  }
);
```

## Best Practices Summary

1. ✅ Register hooks during application initialization
2. ✅ Use try-catch in all hooks to handle errors
3. ✅ Keep hooks focused on a single responsibility
4. ✅ Use async operations for I/O-bound tasks
5. ✅ Validate payload data before using it
6. ✅ Log errors with context for debugging
7. ✅ Test hooks in isolation and integration
8. ✅ Monitor hook execution time
9. ❌ Don't modify the payload object
10. ❌ Don't block the event loop with heavy sync operations
11. ❌ Don't throw errors from hooks (catch and log instead)
12. ❌ Don't rely on hook execution order across different events

## Support

For questions or issues with the lifecycle hooks system:
1. Check this documentation
2. Review example implementations in `src/hooks/examples/`
3. Check application logs for hook errors
4. Review the source code in `src/events/donationEvents.js`
