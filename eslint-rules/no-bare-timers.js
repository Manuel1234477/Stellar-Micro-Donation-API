'use strict';

/**
 * ESLint rule: no-bare-timers
 *
 * Flags direct setInterval / setTimeout calls in src/ files.
 * All timers must go through src/utils/timerRegistry so they are tracked,
 * can be unref'd, and are cleared during graceful shutdown.
 *
 * Bad:  setInterval(fn, 1000)
 * Good: timerRegistry.createInterval(fn, 1000, 'label')
 *
 * Exceptions (file-level disable comment):
 *   eslint-disable local/no-bare-timers  — for timerRegistry.js itself,
 *   the graceful-shutdown forceExit fallback, and test helpers.
 */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require timers to be created via timerRegistry instead of bare setInterval/setTimeout',
      url: 'src/utils/timerRegistry.js',
    },
    messages: {
      noBarTimer:
        'Use timerRegistry.{{ fn }}() instead of bare {{ fn }}() ' +
        'so the handle is tracked and cleared at shutdown. ' +
        'See src/utils/timerRegistry.js.',
    },
    schema: [],
  },

  create(context) {
    const TIMER_FNS = new Set(['setInterval', 'setTimeout']);

    return {
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          TIMER_FNS.has(node.callee.name)
        ) {
          context.report({
            node,
            messageId: 'noBarTimer',
            data: { fn: node.callee.name },
          });
        }
      },
    };
  },
};
