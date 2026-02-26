# Design Document: Request Replay Detection

## Overview

The Request Replay Detection system provides observability into repeated identical requests that may indicate client misconfiguration, replay attacks, or accidental duplicate submissions. This is a non-blocking, observability-focused feature that logs suspicious patterns without impacting request processing.

The system works by computing a fingerprint (hash) of each incoming request based on its body, endpoint, and HTTP method. It tracks these fingerprints in an in-memory store with timestamps, and when a fingerprint appears more than a configurable threshold within a time window, it logs a replay event and adds observability headers to the response.

Key design principles:
- **Non-blocking**: Never reject or delay requests based on replay detection
- **Minimal overhead**: Target <5ms processing time per request
- **Memory-bounded**: Automatic cleanup prevents unbounded memory growth
- **Observable**: Rich logging and response headers for investigation
- **Configurable**: Thresholds and windows adjustable via environment variables

## Architecture

The replay detection system is implemented as Express middleware that integrates into the existing request processing pipeline. It operates independently from idempotency and abuse detection middleware, though all three can coexist in the middleware chain.

```
Request Flow:
┌─────────────┐
│   Request   │
└──────┬──────┘
       │
       ▼
┌─────────────────────┐
│ Existing Middleware │
│ (logger, auth, etc) │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│ Replay Detection    │◄──── Tracking Store (in-memory)
│ Middleware          │
└──────┬──────────────┘
       │
       ├─── Compute fingerprint
       ├─── Record in store
       ├─── Check threshold
       ├─── Log if replay detected
       └─── Add headers if replay
       │
       ▼
┌─────────────────────┐
│ Downstream          │
│ Middleware & Routes │
└──────┬──────────────┘
       │
       ▼
┌─────────────┐
│  Response   │
└─────────────┘

Background Process:
┌─────────────────────┐
│ Cleanup Timer       │
│ (every 60s default) │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│ Remove old entries  │
│ from Tracking Store │
└─────────────────────┘
```

The system consists of:
1. **Middleware component**: Intercepts requests, computes fingerprints, checks for replays
2. **Tracking store**: In-memory Map storing fingerprints → array of timestamps
3. **Cleanup process**: Periodic timer that removes stale entries
4. **Admin endpoint**: Route handler that returns statistics
5. **Configuration module**: Loads and validates environment variables

## Components and Interfaces

### 1. Replay Detection Middleware (`src/middleware/replayDetection.js`)

The main middleware function that processes each request:

```javascript
function replayDetectionMiddleware(req, res, next) {
  // 1. Compute request fingerprint
  // 2. Record fingerprint with timestamp
  // 3. Check if threshold exceeded
  // 4. If replay detected:
  //    - Log replay event
  //    - Add response headers
  // 5. Call next() to continue processing
}
```

**Interface:**
- Input: Express request, response, next function
- Output: Calls next() to continue middleware chain
- Side effects: Updates tracking store, logs events, modifies response headers

**Error Handling:**
- Catches all errors during processing
- Logs errors but always calls next() to avoid blocking requests
- Uses try-catch around fingerprint computation and store operations

### 2. Fingerprint Generator (`src/utils/replayDetector.js`)

Computes a unique hash for each request:

```javascript
function computeFingerprint(req) {
  const components = {
    method: req.method,
    path: req.path,
    body: req.body || ''
  };
  
  // Serialize to stable JSON string
  const payload = JSON.stringify(components, Object.keys(components).sort());
  
  // Compute SHA-256 hash
  return crypto.createHash('sha256').update(payload).digest('hex');
}
```

**Interface:**
- Input: Express request object
- Output: 64-character hex string (SHA-256 hash)
- Pure function: No side effects

**Design decisions:**
- Uses SHA-256 for cryptographic strength and collision resistance
- Includes method, path, and body to uniquely identify requests
- Sorts JSON keys for stable serialization
- Handles empty/missing body gracefully

### 3. Tracking Store (`src/utils/replayDetector.js`)

In-memory data structure tracking fingerprints and timestamps:

```javascript
class TrackingStore {
  constructor() {
    this.store = new Map(); // fingerprint -> [timestamps]
  }
  
  record(fingerprint, timestamp) {
    // Add timestamp to array for this fingerprint
  }
  
  getCount(fingerprint, windowMs) {
    // Return count of timestamps within window
  }
  
  getTimestamps(fingerprint, windowMs) {
    // Return array of timestamps within window
  }
  
  cleanup(windowMs) {
    // Remove timestamps older than window
    // Remove fingerprints with no timestamps
  }
  
  getStats() {
    // Return statistics for admin endpoint
  }
}
```

**Interface:**
- `record(fingerprint, timestamp)`: Adds a timestamp for a fingerprint
- `getCount(fingerprint, windowMs)`: Returns count within time window
- `getTimestamps(fingerprint, windowMs)`: Returns timestamps within window
- `cleanup(windowMs)`: Removes stale data
- `getStats()`: Returns statistics object

**Data structure:**
```javascript
{
  "abc123...": [1234567890000, 1234567891000, 1234567892000],
  "def456...": [1234567890500, 1234567891500]
}
```

**Memory management:**
- Each fingerprint: 64 bytes (hex string)
- Each timestamp: 8 bytes (number)
- Cleanup removes entries older than window
- Bounded by: (requests per second) × (window duration) × (fingerprint + timestamp size)

### 4. Configuration Module (`src/config/replayDetection.js`)

Loads and validates configuration from environment variables:

```javascript
function loadConfig() {
  const config = {
    threshold: parseInt(process.env.REPLAY_THRESHOLD) || 3,
    windowSeconds: parseInt(process.env.REPLAY_WINDOW_SECONDS) || 60,
    cleanupIntervalSeconds: parseInt(process.env.REPLAY_CLEANUP_INTERVAL_SECONDS) || 60
  };
  
  // Validate constraints
  if (config.threshold < 2) {
    log.warn('Invalid REPLAY_THRESHOLD, using default 3');
    config.threshold = 3;
  }
  
  if (config.windowSeconds < 10) {
    log.warn('Invalid REPLAY_WINDOW_SECONDS, using default 60');
    config.windowSeconds = 60;
  }
  
  return config;
}
```

**Interface:**
- Input: Environment variables
- Output: Configuration object with validated values
- Side effects: Logs warnings for invalid values

### 5. Admin Endpoint (`src/routes/admin.js`)

Provides replay statistics for monitoring:

```javascript
router.get('/admin/replay-stats', requireAdmin, (req, res) => {
  const stats = trackingStore.getStats();
  res.json({
    totalFingerprints: stats.totalFingerprints,
    totalTimestamps: stats.totalTimestamps,
    topFingerprints: stats.topFingerprints, // Top 10 by count
    oldestTimestamp: stats.oldestTimestamp,
    newestTimestamp: stats.newestTimestamp,
    windowSeconds: config.windowSeconds,
    threshold: config.threshold
  });
});
```

**Interface:**
- HTTP GET /admin/replay-stats
- Requires admin authentication
- Returns JSON with statistics

### 6. Cleanup Process (`src/utils/replayDetector.js`)

Background timer that removes stale data:

```javascript
function startCleanup(store, config) {
  const intervalMs = config.cleanupIntervalSeconds * 1000;
  const windowMs = config.windowSeconds * 1000;
  
  const timer = setInterval(() => {
    const before = store.getStats();
    store.cleanup(windowMs);
    const after = store.getStats();
    
    log.info('Replay detection cleanup completed', {
      fingerprintsRemoved: before.totalFingerprints - after.totalFingerprints,
      timestampsRemoved: before.totalTimestamps - after.totalTimestamps
    });
  }, intervalMs);
  
  return timer;
}
```

**Interface:**
- Input: Tracking store, configuration
- Output: Timer reference (for cleanup on shutdown)
- Side effects: Modifies tracking store, logs cleanup events

## Data Models

### Request Fingerprint

A SHA-256 hash representing a unique request:

```javascript
{
  fingerprint: "a3f5b8c9d2e1f4a7b6c5d8e9f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0",
  components: {
    method: "POST",
    path: "/api/users",
    body: { "name": "John", "email": "john@example.com" }
  }
}
```

### Tracking Entry

An entry in the tracking store:

```javascript
{
  fingerprint: "a3f5b8c9...",
  timestamps: [
    1234567890000,  // First occurrence
    1234567891000,  // Second occurrence
    1234567892000   // Third occurrence
  ]
}
```

### Replay Event Log

Structure of logged replay events:

```javascript
{
  level: "warn",
  message: "Replay detected",
  fingerprint: "a3f5b8c9...",
  count: 3,
  threshold: 3,
  method: "POST",
  path: "/api/users",
  windowSeconds: 60,
  timeElapsedMs: 2000,
  timestamps: [1234567890000, 1234567891000, 1234567892000],
  apiKey: "key_abc123" // if present
}
```

### Statistics Response

Response from admin endpoint:

```javascript
{
  totalFingerprints: 42,
  totalTimestamps: 156,
  topFingerprints: [
    {
      fingerprint: "a3f5b8c9...",
      count: 15,
      method: "POST",
      path: "/api/users"
    },
    // ... top 10
  ],
  oldestTimestamp: 1234567890000,
  newestTimestamp: 1234567999000,
  windowSeconds: 60,
  threshold: 3
}
```

### Configuration Object

Runtime configuration:

```javascript
{
  threshold: 3,              // Minimum replays to trigger detection
  windowSeconds: 60,         // Time window for counting replays
  cleanupIntervalSeconds: 60 // How often to run cleanup
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*


### Property 1: Fingerprint Determinism and Uniqueness

*For any* two requests, if they have identical body content, endpoint path, and HTTP method, then their computed fingerprints should be identical; and if they differ in any of these components, then their fingerprints should be different.

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Fingerprint Computation Always Succeeds

*For any* request (including those with empty bodies, missing fields, or unusual content), the fingerprint computation should complete successfully and return a valid hash string.

**Validates: Requirements 1.1, 1.5**

### Property 3: Recording Preserves Fingerprints

*For any* request fingerprint and timestamp, after recording it in the tracking store, querying the store should return that timestamp in the list for that fingerprint.

**Validates: Requirements 2.1**

### Property 4: Replay Detection Threshold Logic

*For any* fingerprint and sequence of timestamps, if the count of timestamps within the replay window exceeds the configured threshold, then a replay event should be detected; otherwise, no replay event should be detected.

**Validates: Requirements 2.2, 2.5**

### Property 5: Configuration Validation

*For any* configuration values (threshold, window, cleanup interval), if they violate constraints (threshold < 2, window < 10 seconds), then the system should use default values and log a warning; otherwise, the provided values should be used.

**Validates: Requirements 2.3, 2.4, 8.4, 8.5**

### Property 6: Replay Event Logging Completeness

*For any* replay event, the logged entry should contain all required fields: fingerprint, count, endpoint, method, time window, time elapsed, and all timestamps within the window; and if an API key is present in the request, it should be included in the log.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

### Property 7: Non-Blocking Request Processing

*For any* request (including those that trigger replay detection or cause processing errors), the middleware should always call next() to allow the request to proceed, and should never throw uncaught exceptions.

**Validates: Requirements 4.1, 4.2, 4.3**

### Property 8: Response Headers for Replay Events

*For any* request that triggers replay detection, the response should include headers "X-Replay-Detected" (value "true"), "X-Replay-Count" (with the occurrence count), and "X-Replay-Window" (with the window in seconds); and for requests that don't trigger detection, these headers should not be present.

**Validates: Requirements 5.1, 5.2, 5.3, 5.4**

### Property 9: Statistics Response Completeness

*For any* state of the tracking store, the statistics response should include all required fields (totalFingerprints, totalTimestamps, topFingerprints, oldestTimestamp, newestTimestamp, windowSeconds, threshold) and should be valid JSON.

**Validates: Requirements 6.2, 6.5**

### Property 10: Statistics Sorting

*For any* tracking store state, the topFingerprints array in the statistics response should be sorted in descending order by occurrence count.

**Validates: Requirements 6.3**

### Property 11: Cleanup Removes Old Timestamps

*For any* tracking store state and replay window, after cleanup runs, all timestamps older than the window should be removed from all fingerprint entries.

**Validates: Requirements 7.1, 7.3**

### Property 12: Cleanup Removes Empty Fingerprints

*For any* fingerprint in the tracking store, if all of its timestamps are removed during cleanup, then the fingerprint entry itself should be removed from the store.

**Validates: Requirements 7.4**

### Property 13: Cleanup Logging

*For any* cleanup operation, a log entry should be created containing statistics about the number of fingerprints and timestamps removed.

**Validates: Requirements 7.5**

## Error Handling

The replay detection system is designed to never block or fail requests, even when errors occur during processing. All error handling follows the principle: **log and continue**.

### Error Scenarios and Handling

1. **Fingerprint Computation Errors**
   - Scenario: Request body cannot be serialized, or hashing fails
   - Handling: Catch exception, log error with request details, call next() to continue
   - Impact: Request proceeds without replay detection for that request

2. **Tracking Store Errors**
   - Scenario: Memory exhausted, Map operations fail
   - Handling: Catch exception, log error, call next() to continue
   - Impact: Request proceeds, but replay data may be incomplete

3. **Configuration Errors**
   - Scenario: Invalid environment variable values
   - Handling: Use default values, log warning at startup
   - Impact: System runs with defaults instead of invalid config

4. **Cleanup Errors**
   - Scenario: Cleanup timer fails or cleanup operation throws
   - Handling: Catch exception, log error, continue with next cleanup cycle
   - Impact: Old data may persist longer, but system continues operating

5. **Admin Endpoint Errors**
   - Scenario: Statistics computation fails
   - Handling: Return 500 error with error message
   - Impact: Statistics unavailable, but request processing unaffected

6. **Logging Errors**
   - Scenario: Logging system fails
   - Handling: Silently continue (logging is best-effort)
   - Impact: Some events may not be logged, but requests proceed

### Error Handling Pattern

All middleware operations follow this pattern:

```javascript
function replayDetectionMiddleware(req, res, next) {
  try {
    // Replay detection logic
    const fingerprint = computeFingerprint(req);
    trackingStore.record(fingerprint, Date.now());
    // ... rest of logic
  } catch (error) {
    log.error('Replay detection error', {
      error: error.message,
      stack: error.stack,
      path: req.path,
      method: req.method
    });
  } finally {
    // Always call next() to continue processing
    next();
  }
}
```

### Graceful Degradation

The system degrades gracefully under various failure conditions:

- **Partial failures**: If fingerprint computation fails for some requests, others continue to be tracked
- **Memory pressure**: Cleanup runs more frequently if needed (configurable)
- **Configuration issues**: Falls back to safe defaults
- **Logging failures**: Request processing continues even if logging fails

## Testing Strategy

The replay detection system requires comprehensive testing using both unit tests and property-based tests. These approaches are complementary: unit tests verify specific examples and edge cases, while property tests verify universal correctness across many generated inputs.

### Property-Based Testing

Property-based testing is the primary approach for verifying correctness properties. We will use **fast-check** (for JavaScript/Node.js) as the property-based testing library.

**Configuration:**
- Each property test must run a minimum of 100 iterations
- Each test must be tagged with a comment referencing the design property
- Tag format: `// Feature: request-replay-detection, Property N: [property text]`

**Property Test Coverage:**

1. **Fingerprint Properties** (Properties 1-2)
   - Generate random requests with varying bodies, paths, methods
   - Test determinism: same request → same fingerprint
   - Test uniqueness: different requests → different fingerprints
   - Test edge cases: empty bodies, large bodies, special characters

2. **Tracking Store Properties** (Property 3)
   - Generate random fingerprints and timestamps
   - Test that recorded data is retrievable
   - Test that counts are accurate within time windows

3. **Replay Detection Properties** (Property 4)
   - Generate random sequences of timestamps
   - Test threshold logic across various counts and windows
   - Test boundary conditions (exactly at threshold, just below, just above)

4. **Configuration Properties** (Property 5)
   - Generate random configuration values (valid and invalid)
   - Test validation logic and default fallbacks
   - Test constraint enforcement

5. **Logging Properties** (Property 6)
   - Generate random replay events
   - Test that all required fields are present in logs
   - Test conditional fields (API key presence)

6. **Non-Blocking Properties** (Property 7)
   - Generate random requests (including malformed ones)
   - Test that next() is always called
   - Test error handling paths

7. **Response Header Properties** (Property 8)
   - Generate requests that do and don't trigger replays
   - Test header presence/absence
   - Test header values match detection results

8. **Statistics Properties** (Properties 9-10)
   - Generate random tracking store states
   - Test response completeness and JSON validity
   - Test sorting of top fingerprints

9. **Cleanup Properties** (Properties 11-13)
   - Generate random tracking stores with old and new data
   - Test that old timestamps are removed
   - Test that empty fingerprints are removed
   - Test cleanup logging

### Unit Testing

Unit tests complement property tests by verifying specific examples, integration points, and edge cases:

**Unit Test Coverage:**

1. **Specific Examples**
   - Test a concrete request produces expected fingerprint
   - Test a specific sequence triggers replay detection
   - Test admin endpoint returns expected format

2. **Edge Cases**
   - Empty request body
   - Very large request body (>1MB)
   - Null or undefined fields
   - Special characters in paths
   - Concurrent requests with same fingerprint

3. **Integration Points**
   - Middleware integrates with Express app
   - Uses existing logging utility correctly
   - Admin endpoint requires authentication
   - Cleanup timer starts and stops correctly

4. **Error Conditions**
   - Fingerprint computation throws error
   - Tracking store operations fail
   - Invalid configuration values
   - Logging system unavailable

### Test Organization

```
tests/
├── unit/
│   ├── fingerprint.test.js
│   ├── trackingStore.test.js
│   ├── middleware.test.js
│   ├── config.test.js
│   ├── cleanup.test.js
│   └── adminEndpoint.test.js
└── property/
    ├── fingerprint.property.test.js
    ├── replayDetection.property.test.js
    ├── configuration.property.test.js
    ├── logging.property.test.js
    ├── headers.property.test.js
    ├── statistics.property.test.js
    └── cleanup.property.test.js
```

### Testing Tools

- **Unit tests**: Jest or Mocha
- **Property tests**: fast-check
- **Mocking**: sinon for timers, logging, and Express objects
- **Coverage**: nyc or Jest coverage
- **Target coverage**: >90% line coverage, 100% of correctness properties tested

### Performance Testing

While not part of property-based testing, performance should be validated:

- Benchmark fingerprint computation time (target: <1ms)
- Benchmark middleware overhead (target: <5ms per request)
- Load test with high request rates (1000+ req/s)
- Memory profiling to verify cleanup effectiveness
- Stress test with many unique fingerprints (10,000+)

### Continuous Integration

All tests should run in CI:
- Unit tests on every commit
- Property tests on every commit (100 iterations minimum)
- Performance tests on release branches
- Coverage reports published to PR comments
