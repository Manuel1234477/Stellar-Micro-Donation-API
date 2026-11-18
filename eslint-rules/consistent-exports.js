'use strict';

/**
 * ESLint rule: consistent-exports
 *
 * Enforces the module export patterns described in docs/EXPORT_CONVENTIONS.md:
 * - All modules: do not mix `module.exports = ...` with `exports.x = ...`
 * - Services: export the class/instance or a service object directly; do not
 *   wrap a single class in an object literal (`module.exports = { Foo }`)
 * - Utilities: named exports object, or a direct singleton/class/function
 * - Routes: export the router directly, or an object that includes `router`
 *   (e.g. `{ router, setService }` for test hooks). `helpers.js` files under
 *   src/routes hold schemas/helpers and follow the utility convention.
 * - Migrations: `exports.name`, `exports.up` and `exports.down`
 *
 * A module can opt out with an `EXPORT_CONVENTION_EXCEPTION` comment placed
 * directly above its `module.exports` assignment.
 */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Enforce consistent export patterns by module type',
      url: 'docs/EXPORT_CONVENTIONS.md',
    },
    messages: {
      mixedExports:
        'Do not mix `module.exports = ...` with `exports.x = ...` in the same module. ' +
        'See docs/EXPORT_CONVENTIONS.md',
      inconsistentService:
        'Service modules should export a single class directly, not wrapped in an object literal. ' +
        'Change: module.exports = {{name}}; See docs/EXPORT_CONVENTIONS.md',
      inconsistentUtil:
        'Utility modules should export named functions in an object, or a singleton/class/function directly. ' +
        'See docs/EXPORT_CONVENTIONS.md',
      inconsistentRoute:
        'Route modules should export a router directly, or an object that includes `router`. ' +
        'See docs/EXPORT_CONVENTIONS.md',
      inconsistentMigration:
        'Migration modules should use named exports (exports.name, exports.up, exports.down). ' +
        'See docs/EXPORT_CONVENTIONS.md',
      missingMigrationExport:
        'Migration modules must export `{{name}}` (exports.{{name}} = ...). See docs/EXPORT_CONVENTIONS.md',
    },
    schema: [],
  },

  create(context) {
    const filename = context.getFilename();

    const isRouteHelperModule = /src\/routes\//.test(filename) && /\/helpers\.js$/.test(filename);
    const isServiceModule = /src\/services\//.test(filename);
    const isUtilityModule = /src\/utils\//.test(filename) || isRouteHelperModule;
    const isRouteModule = /src\/routes\//.test(filename) && !isRouteHelperModule;
    const isMigrationModule = /src\/migrations\//.test(filename);

    const classNames = new Set();
    let moduleExportNode = null;
    const exportsAssignments = new Set();
    let firstExportsNode = null;

    function isModuleExports(node) {
      return (
        node.type === 'MemberExpression' &&
        node.object.type === 'Identifier' &&
        node.object.name === 'module' &&
        !node.computed &&
        node.property.name === 'exports'
      );
    }

    function propertyName(prop) {
      if (prop.type !== 'Property' || prop.computed) return null;
      if (prop.key.type === 'Identifier') return prop.key.name;
      if (prop.key.type === 'Literal') return String(prop.key.value);
      return null;
    }

    function hasExceptionComment(node) {
      // The assignment's parent is the ExpressionStatement that carries comments.
      const target = node.parent && node.parent.type === 'ExpressionStatement' ? node.parent : node;
      return sourceCode
        .getCommentsBefore(target)
        .some((c) => c.value.includes('EXPORT_CONVENTION_EXCEPTION'));
    }

    return {
      ClassDeclaration(node) {
        if (node.id) classNames.add(node.id.name);
      },

      AssignmentExpression(node) {
        if (isModuleExports(node.left)) {
          moduleExportNode = node;
          return;
        }

        if (
          node.left.type === 'MemberExpression' &&
          node.left.object.type === 'Identifier' &&
          node.left.object.name === 'exports' &&
          !node.left.computed
        ) {
          exportsAssignments.add(node.left.property.name);
          if (!firstExportsNode) firstExportsNode = node;
        }
      },

      'Program:exit'(program) {
        // Skip this rule for test files
        if (/\.test\.js$/.test(filename)) {
          return;
        }

        if (moduleExportNode && hasExceptionComment(moduleExportNode)) {
          return;
        }

        // Mixing styles: `exports.x` is dropped once module.exports is reassigned.
        if (moduleExportNode && firstExportsNode) {
          context.report({ node: firstExportsNode, messageId: 'mixedExports' });
          return;
        }

        if (isMigrationModule) {
          if (moduleExportNode) {
            context.report({ node: moduleExportNode, messageId: 'inconsistentMigration' });
            return;
          }
          for (const name of ['name', 'up', 'down']) {
            if (!exportsAssignments.has(name)) {
              context.report({ node: program, messageId: 'missingMigrationExport', data: { name } });
            }
          }
          return;
        }

        if (!moduleExportNode) return;
        const exportValue = moduleExportNode.right;

        if (isServiceModule && exportValue.type === 'ObjectExpression') {
          const props = exportValue.properties;
          if (props.length === 1) {
            const name = propertyName(props[0]);
            if (name && classNames.has(name)) {
              context.report({ node: moduleExportNode, messageId: 'inconsistentService', data: { name } });
            }
          }
        }

        if (isUtilityModule) {
          const allowed = [
            'ObjectExpression',
            'Identifier',
            'NewExpression',
            'ClassExpression',
            'FunctionExpression',
            'ArrowFunctionExpression',
            'CallExpression',
            'MemberExpression',
          ];
          if (!allowed.includes(exportValue.type)) {
            context.report({ node: moduleExportNode, messageId: 'inconsistentUtil' });
          }
        }

        if (isRouteModule && exportValue.type === 'ObjectExpression') {
          const hasRouter = exportValue.properties.some((p) => propertyName(p) === 'router');
          if (!hasRouter) {
            context.report({ node: moduleExportNode, messageId: 'inconsistentRoute' });
          }
        }
      },
    };
  },
};
