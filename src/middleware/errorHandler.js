/**
 * Global Error Handler Middleware
 * Catches unhandled errors and promise rejections
 */

const errorHandler = (err, req, res, next) => {
  // Log detailed error internally
  console.error('[ErrorHandler]', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });

  // Handle Stellar errors (already formatted)
  if (err.status && err.code) {
    return res.status(err.status).json({
      success: false,
      error: {
        code: err.code,
        message: err.message
      }
    });
  }

  // Default error response
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred. Please try again later.'
    }
  });
};

module.exports = errorHandler;
