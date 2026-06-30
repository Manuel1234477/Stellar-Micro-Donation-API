# Design Document: Return 405 for Unsupported Methods on Known Routes

## Overview

This design implements proper HTTP semantics for method handling by distinguishing between unknown routes (404 Not Found) and unsupported methods on known routes (405 Method Not Allowed with Allow header). The system currently returns 404 for both cases, which is misleading for API consumers.

The implementation will be router-level, ensuring consistent behavior across all routes without per-route configuration. When a client requests a known path with an unsupported method, the router will return 405 with an Allow header listing all supported methods for that path.

## Architecture

### High-Level Flow

```
Request → Router → Method Check
                     ↓
        Known Route? ────→ No → 404 Not Found
                     ↓
                    Yes
                     ↓
        Method Supported? → No → 405 Method Not Allowed + Allow Header
                     ↓
                    Yes
                     ↓
              Route Handler
```

### Integration Points

1. **Route Registration**: Modified to track supported methods per path
2. **Request Processing**: New middleware intercepts requests before 404 handler
3. **Error Handling**: Extends existing error handler to format 405 responses

## Components and Interfaces

### Method Registry

A data structure tracking which HTTP methods are supported for each registered route path.

```javascript
// Structure: Map<routePath, Set<method>>
const methodRegistry = new Map();

// Example:
methodRegistry.set('/api/v1/wallets', new Set(['GET', 'POST']));
methodRegistry.set('/api/v1/wallets/:id', new Set(['GET', 'PATCH']));
```

### Route Registration Wrapper

Wraps Express router methods to automatically populate the method registry.

```javascript
function registerRoute(router, method, path, ...handlers) {
  // Normalize path (remove trailing slashes, resolve params)
  const normalizedPath = normalizePath(path);
  
  // Track method for this path
  if (!methodRegistry.has(normalizedPath)) {
    methodRegistry.set(normalizedPath, new Set(['OPTIONS']));
  }
  methodRegistry.get(normalizedPath).add(method.toUpperCase());
  
  // Register route normally
  router[method](path, ...handlers);
}
```

### Method Checking Middleware

Middleware inserted before the 404 handler to check if a path is known and return 405 if the method is unsupported.

```javascript
function methodNotAllowedHandler(req, res, next) {
  const requestPath = normalizePath(req.path);
  const requestMethod = req.method.toUpperCase();
  
  // Check if path exists in registry (accounting for route parameters)
  const matchedRoute = findMatchingRoute(requestPath, methodRegistry);
  
  if (!matchedRoute) {
    // Unknown route → proceed to 404 handler
    return next();
  }
  
  const allowedMethods = methodRegistry.get(matchedRoute);
  
  if (allowedMethods.has(requestMethod)) {
    // Method is supported → proceed to route handler
    return next();
  }
  
  // Known route, unsupported method → 405
  const allowHeader = Array.from(allowedMethods).sort().join(', ');
  res.set('Allow', allowHeader);
  
  return res.status(405).json({
    success: false,
    error: {
      code: 'METHOD_NOT_ALLOWED',
      numericCode: 3006,
      message: `Method ${requestMethod} not allowed. Allowed methods: ${allowHeader}`,
      requestId: req.id,
      timestamp: new Date().toISOString()
    }
  });
}
```

### Path Normalization

Normalizes request paths and route patterns for consistent matching.

```javascript
function normalizePath(path) {
  // Remove trailing slashes
  path = path.replace(/\/+$/, '');
  // Ensure leading slash
  if (!path.startsWith('/')) {
    path = '/' + path;
  }
  return path || '/';
}
```

### Route Matching

Matches a request path against registered routes, handling parameterized routes.

```javascript
function findMatchingRoute(requestPath, registry) {
  // Direct match
  if (registry.has(requestPath)) {
    return requestPath;
  }
  
  // Try pattern matching for parameterized routes
  for (const [registeredPath] of registry) {
    if (matchesRoutePattern(requestPath, registeredPath)) {
      return registeredPath;
    }
  }
  
  return null;
}

function matchesRoutePattern(requestPath, routePattern) {
  // Convert Express route pattern to regex
  // /wallets/:id → /\/wallets\/[^\/]+/
  const pattern = routePattern
    .replace(/:[^\/]+/g, '[^\/]+')
    .replace(/\//g, '\\/');
  
  const regex = new RegExp(`^${pattern}$`);
  return regex.test(requestPath);
}
```

### OPTIONS Handler

Automatic OPTIONS support for all known routes.

```javascript
function optionsHandler(req, res, next) {
  const requestPath = normalizePath(req.path);
  const matchedRoute = findMatchingRoute(requestPath, methodRegistry);
  
  if (!matchedRoute) {
    return next(); // Unknown route → 404
  }
  
  const allowedMethods = methodRegistry.get(matchedRoute);
  const allowHeader = Array.from(allowedMethods).sort().join(', ');
  
  res.set('Allow', allowHeader);
  res.status(200).end();
}
```

## Data Models

### Error Code Addition

Add new error code to `src/utils/errors.js`:

```javascript
const ERROR_CODES = {
  // ... existing codes ...
  
  // Method errors (3006)
  METHOD_NOT_ALLOWED: { code: 'METHOD_NOT_ALLOWED', numeric: 3006 },
};
```

### Registry Data Structure

```javascript
// Global registry tracking methods per route
const methodRegistry = new Map();
// Key: normalized route path (string)
// Value: Set of HTTP method names (Set<string>)
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Known routes with unsupported methods return 405 with accurate Allow header

*For any* registered route and any HTTP method not registered for that route, the system should return HTTP 405 Method Not Allowed with an Allow header that contains exactly the registered methods for that route, formatted as a comma-separated list in sorted order.

**Validates: Requirements 1.1, 2.1, 2.2, 2.3, 2.4**

### Property 2: Unknown routes return 404 without Allow header

*For any* request path that is not registered in the routing table, the system should return HTTP 404 Not Found without an Allow header, regardless of the HTTP method used.

**Validates: Requirements 3.1, 3.2**

### Property 3: Supported methods are processed normally

*For any* registered route and any HTTP method registered for that route, the request should be routed to the appropriate handler and not intercepted by the 405 middleware.

**Validates: Requirements 1.2**

### Property 4: OPTIONS returns 200 with accurate Allow header

*For any* known route, an OPTIONS request should return HTTP 200 OK with an Allow header that lists all supported methods for that route (including OPTIONS itself), formatted as a comma-separated list in sorted order.

**Validates: Requirements 5.1, 5.2, 5.3**

## Error Handling

### 405 Method Not Allowed Response

```javascript
{
  "success": false,
  "error": {
    "code": "METHOD_NOT_ALLOWED",
    "numericCode": 3006,
    "message": "Method DELETE not allowed. Allowed methods: GET, PATCH, POST",
    "requestId": "req_abc123",
    "timestamp": "2024-01-15T10:30:00.000Z"
  }
}
```

**Headers:**
- `Allow: GET, PATCH, POST`
- `Content-Type: application/json`

### Edge Cases

1. **Empty Method Set**: Should never occur if registration is correct, but if it does, return 405 with empty Allow header
2. **Malformed Paths**: Normalized before lookup; invalid characters handled by Express
3. **Case Sensitivity**: HTTP methods are case-insensitive per RFC 7231; always uppercase in registry
4. **Duplicate Registrations**: Set data structure prevents duplicates automatically

### Interaction with Existing Error Handling

- 405 middleware runs **before** notFoundHandler
- 405 responses bypass the general errorHandler
- Request ID and timestamp formatting remain consistent with existing error responses

## Testing Strategy

### Dual Testing Approach

This feature requires both unit tests and property-based tests for comprehensive coverage:

- **Unit tests**: Verify specific examples and integration with Express routing
- **Property tests**: Verify universal properties across all routes and methods

### Unit Testing Focus

1. **Specific route examples**:
   - GET /api/v1/wallets (supported) → 200
   - DELETE /api/v1/wallets (unsupported) → 405 with Allow: GET, POST
   - GET /api/v1/fake-route (unknown) → 404

2. **Edge cases**:
   - Trailing slashes: /wallets vs /wallets/
   - Parameterized routes: /wallets/:id with various IDs
   - Case sensitivity: get vs GET vs Get

3. **Integration points**:
   - Middleware ordering (405 handler before 404 handler)
   - Allow header format (comma-separated, sorted)
   - OPTIONS method support

4. **Representative route coverage**:
   - Read-only routes (GET only)
   - Write-only routes (POST only)
   - Mixed routes (GET, POST, PATCH, DELETE)

### Property-Based Testing Focus

- Use **fast-check** (JavaScript property testing library)
- Minimum **100 iterations** per property test
- Each test tagged with: `Feature: return-405-for-unsupported-methods, Property N`

1. **Property 1**: Known routes with unsupported methods return 405
   - Generate: random registered routes, random unsupported methods
   - Assert: status 405, Allow header present and accurate

2. **Property 2**: Unknown routes return 404
   - Generate: random paths not in registry
   - Assert: status 404, no Allow header

3. **Property 3**: Supported methods process normally
   - Generate: random registered routes with their supported methods
   - Assert: request reaches handler (not intercepted by 405 middleware)

4. **Property 4**: Allow header correctness
   - Generate: random routes with random method sets
   - Assert: Allow header contains exactly the registered methods, sorted

5. **Property 5**: OPTIONS support
   - Generate: random registered routes
   - Assert: OPTIONS returns 200 with correct Allow header

6. **Property 6**: Path normalization
   - Generate: paths with/without trailing slashes, various parameter values
   - Assert: treated as same route

### Test Configuration

```javascript
// jest.config.js or test file
const fc = require('fast-check');

test('Property 1: Known routes return 405 for unsupported methods', () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...knownRoutes),
      fc.constantFrom('GET', 'POST', 'PUT', 'PATCH', 'DELETE'),
      (route, method) => {
        // Feature: return-405-for-unsupported-methods, Property 1
        if (!route.supportedMethods.includes(method)) {
          const response = makeRequest(route.path, method);
          expect(response.status).toBe(405);
          expect(response.headers.allow).toBe(
            route.supportedMethods.sort().join(', ')
          );
        }
      }
    ),
    { numRuns: 100 }
  );
});
```

## Implementation Notes

### Bootstrap Integration

The method checking middleware must be inserted in `src/bootstrap/routes.js` immediately before the `notFoundHandler`:

```javascript
// After all route registrations
app.use(methodNotAllowedHandler);
app.use(notFoundHandler);
app.use(errorHandler);
```

### Route Registration

Existing route files (`src/routes/*.js`) use standard Express patterns:
```javascript
router.get('/path', handler);
router.post('/path', handler);
```

The wrapper can either:
1. **Option A**: Wrap the router returned from route files
2. **Option B**: Provide a custom router factory used by all route files

Option A is preferred for minimal disruption.

### Performance Considerations

- Registry lookups are O(1) for exact matches, O(n) for parameterized routes where n = number of registered routes
- Consider caching pattern-matching results if performance becomes an issue
- Registry is populated once at startup, no runtime overhead

### Backward Compatibility

- No breaking changes to existing route definitions
- Clients currently receiving 404 will now receive 405 for known routes
- This is technically a bug fix (404 was incorrect per HTTP spec)
