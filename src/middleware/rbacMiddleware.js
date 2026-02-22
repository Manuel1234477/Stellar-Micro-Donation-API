const { UnauthorizedError, ForbiddenError } = require('../utils/errors');
const { getPermissionsByRole } = require('../models/permissions');

exports.checkPermission = (permission) => {
  return (req, res, next) => {
    
    if (!req.user) {
      throw new UnauthorizedError();
    }

    const userRole = req.user.role;
    const userPermissions = getPermissionsByRole(userRole);

    
    if (!userPermissions.includes(permission)) {
      throw new ForbiddenError('Insufficient permissions for this action');
    }

    next();
  };
};