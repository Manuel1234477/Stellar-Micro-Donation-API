'use strict';

/**
 * ESLint rule: require-async-handler
 *
 * Flags async functions passed directly as route handler arguments to
 * router.METHOD() or app.METHOD() without being wrapped in asyncHandler().
 *
 * Bad:  router.get('/path', async (req, res) => { ... })
 * Good: router.get('/path', asyncHandler(async (req, res) => { ... }))
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require asyncHandler() wrapper for async Express route handlers',
      url: 'docs/ASYNC_HANDLER_MIGRATION.md',
    },
    messages: {
      missingWrapper:
        'Async route handler must be wrapped with asyncHandler(). ' +
        'See docs/ASYNC_HANDLER_MIGRATION.md',
    },
    schema: [],
  },

  create(context) {
    const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'use']);

    function isRouteCall(node) {
      return (
        node.type === 'CallExpression' &&
        node.callee.type === 'MemberExpression' &&
        HTTP_METHODS.has(node.callee.property.name)
      );
    }

    function isAsyncFn(node) {
      return (
        (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') &&
        node.async === true
      );
    }

    function isWrappedInAsyncHandler(node) {
      return (
        node.type === 'CallExpression' &&
        node.callee.type === 'Identifier' &&
        node.callee.name === 'asyncHandler'
      );
    }

    return {
      CallExpression(node) {
        if (!isRouteCall(node)) return;

        for (const arg of node.arguments) {
          if (isAsyncFn(arg)) {
            context.report({ node: arg, messageId: 'missingWrapper' });
          }
        }
      },
    };
  },
};
