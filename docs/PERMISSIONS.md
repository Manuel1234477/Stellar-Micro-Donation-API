# Permission and Access Control System

## Overview

The Stellar Micro-Donation API implements a Role-Based Access Control (RBAC) system to manage user permissions and secure API endpoints.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     API Request                              │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              attachUserRole Middleware                       │
│         (Extracts user role from API key/JWT)               │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│            checkPermission Middleware                        │
│         (Validates user has required permission)            │
└────────────────────────┬────────────────────────────────────┘
                         │
                    ┌────┴────┐
                    │         │
              Allowed      Denied
                    │         │
                    ▼         ▼
            Route Handler   403 Forbidden
```

## Roles

### Admin
- **Description**: Full system access
- **Permissions**: All permissions (wildcard `*`)
- **Use Case**: System administrators, super users

### User
- **Description**: Regular authenticated user
- **Permissions**:
  - `donations:create` - Create donations
  - `donations:read` - View donations
  - `donations:verify` - Verify transactions
  - `wallets:create` - Create wallet metadata
  - `wallets:read` - View wallet information
  - `wallets:update` - Update wallet metadata
  - `stream:create` - Create recurring donation schedules
  - `stream:read` - View recurring schedules
  - `stream:update` - Update schedules
  - `stream:delete` - Cancel schedules
  - `stats:read` - View statistics

### Guest
- **Description**: Unauthenticated or read-only access
- **Permissions**:
  - `donations:read` - View donations
  - `stats:read` - View statistics

## Permission Format

Permissions follow the format: `resource:action`

Examples:
- `donations:create`
- `wallets:read`
- `stream:delete`
- `*` (wildcard - all permissions)
- `donations:*` (all donation permissions)

## Middleware Functions

### checkPermission(permission)

Checks if the user has a specific permission.

```javascript
const { checkPermission } = require('./middleware/rbacMiddleware');
const { PERMISSIONS } = require('./utils/permissions');

router.post('/donations', 
  checkPermission(PERMISSIONS.DONATIONS_CREATE),
  donationController.create
);
```

### checkAnyPermission(permissions)

Checks if the user has ANY of the specified permissions.

```javascript
router.get('/data', 
  checkAnyPermission([
    PERMISSIONS.DONATIONS_READ,
    PERMISSIONS.STATS_READ
  ]),
  dataController.get
);
```

### checkAllPermissions(permissions)

Checks if the user has ALL of the specified permissions.

```javascript
router.post('/admin/action', 
  checkAllPermissions([
    PERMISSIONS.DONATIONS_CREATE,
    PERMISSIONS.WALLETS_CREATE
  ]),
  adminController.action
);
```

### requireAdmin()

Checks if the user has admin role.

```javascript
router.delete('/admin/purge', 
  requireAdmin(),
  adminController.purge
);
```

### attachUserRole()

Attaches user role to the request object based on authentication.

```javascript
app.use(attachUserRole());
```

## Usage Examples

### Protecting a Route

```javascript
const express = require('express');
const router = express.Router();
const { checkPermission } = require('../middleware/rbacMiddleware');
const { PERMISSIONS } = require('../utils/permissions');

// Only authenticated users can create donations
router.post('/', 
  checkPermission(PERMISSIONS.DONATIONS_CREATE),
  async (req, res) => {
    // Handle donation creation
  }
);

// Anyone can read donations (including guests)
router.get('/', 
  checkPermission(PERMISSIONS.DONATIONS_READ),
  async (req, res) => {
    // Handle donation listing
  }
);
```

### Multiple Permission Checks

```javascript
// User needs either permission
router.get('/reports', 
  checkAnyPermission([
    PERMISSIONS.STATS_READ,
    PERMISSIONS.STATS_ADMIN
  ]),
  reportController.get
);

// User needs both permissions
router.post('/bulk-action', 
  checkAllPermissions([
    PERMISSIONS.DONATIONS_CREATE,
    PERMISSIONS.WALLETS_CREATE
  ]),
  bulkController.action
);
```

## Authentication

Currently, the system uses API keys for authentication (development mode):

- **Admin Key**: `admin-key-123` → Admin role
- **Any other key**: → User role
- **No key**: → Guest role

### Making Authenticated Requests

```bash
# As admin
curl -H "x-api-key: admin-key-123" http://localhost:3000/donations

# As user
curl -H "x-api-key: user-key-456" http://localhost:3000/donations

# As guest (no key)
curl http://localhost:3000/donations
```

## Production Considerations

For production deployment, replace the mock `attachUserRole` middleware with proper authentication:

1. **JWT Authentication**:
```javascript
const jwt = require('jsonwebtoken');

exports.attachUserRole = () => {
  return (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      req.user = { role: 'guest' };
      return next();
    }
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = {
        id: decoded.userId,
        role: decoded.role,
        name: decoded.name
      };
      next();
    } catch (error) {
      req.user = { role: 'guest' };
      next();
    }
  };
};
```

2. **Session-Based Authentication**:
```javascript
exports.attachUserRole = () => {
  return (req, res, next) => {
    if (req.session && req.session.user) {
      req.user = req.session.user;
    } else {
      req.user = { role: 'guest' };
    }
    next();
  };
};
```

## Error Responses

### 401 Unauthorized
Returned when authentication is required but not provided.

```json
{
  "success": false,
  "error": "Authentication required"
}
```

### 403 Forbidden
Returned when user is authenticated but lacks required permissions.

```json
{
  "success": false,
  "error": "Insufficient permissions. Required: donations:create"
}
```

## Adding New Permissions

1. **Update roles.json**:
```json
{
  "roles": [
    {
      "name": "user",
      "permissions": [
        "existing:permission",
        "new:permission"
      ]
    }
  ]
}
```

2. **Add constant to permissions.js**:
```javascript
const PERMISSIONS = {
  // ... existing
  NEW_PERMISSION: 'new:permission'
};
```

3. **Apply to routes**:
```javascript
router.post('/new-endpoint', 
  checkPermission(PERMISSIONS.NEW_PERMISSION),
  controller.action
);
```

## Testing Permissions

Run the permission tests:

```bash
npm test tests/permissions.test.js
npm test tests/rbac-middleware.test.js
```

## Security Best Practices

1. **Always authenticate sensitive endpoints**
2. **Use least privilege principle** - Grant minimum required permissions
3. **Validate permissions on every request** - Don't cache permission checks
4. **Log permission denials** - Monitor for potential security issues
5. **Use HTTPS in production** - Protect API keys and tokens in transit
6. **Rotate API keys regularly** - Implement key rotation policy
7. **Implement rate limiting** - Prevent brute force attacks
8. **Audit permission changes** - Log all role and permission modifications

## Troubleshooting

### Permission Denied Errors

1. Check user role: `console.log(req.user.role)`
2. Verify permission exists in roles.json
3. Ensure middleware is applied in correct order
4. Check for typos in permission strings

### User Not Authenticated

1. Verify API key is being sent in headers
2. Check `attachUserRole` middleware is applied
3. Ensure middleware runs before permission checks

## Future Enhancements

- [ ] Database-backed roles and permissions
- [ ] Dynamic permission assignment
- [ ] Permission inheritance
- [ ] Resource-level permissions (e.g., "can edit own donations")
- [ ] Time-based permissions
- [ ] IP-based access control
- [ ] Two-factor authentication
- [ ] OAuth2 integration
