const { getPermissionsByRole } = require('../models/permissions');

exports.checkPermission = (permission) => {
  return (req, res, next) => {
    
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userRole = req.user.role;
    const userPermissions = getPermissionsByRole(userRole);

    
    if (!userPermissions.includes(permission)) {
      return res.status(403).json({ error: "Access denied" });
    }

    next();
  };
};