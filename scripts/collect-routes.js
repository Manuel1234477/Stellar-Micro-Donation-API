#!/usr/bin/env node
'use strict';

/**
 * Route Collector - Extract all mounted routes from the Express app
 * RESPONSIBILITY: Enumerate all actually-mounted routes (including nested admin routers)
 * and output them for verification against OpenAPI spec.
 */

/**
 * Extract the literal mount path from an Express 4 layer regexp source.
 *   "^\\/api\\/v1\\/?(?=\\/|$)"  -> "/api/v1"
 *   "^\\/?(?=\\/|$)"             -> ""
 * Parsing stops at the first regex metacharacter (groups, params, etc.).
 * @param {string} source - RegExp.source of layer.regexp
 * @returns {string}
 */
function mountPathFromRegexp(source) {
  const body = source.startsWith('^') ? source.slice(1) : source;
  const segments = [];
  // Each literal segment is written as "\/<name>"; stop at the first token that is not one.
  for (const piece of body.split('\\/').slice(1)) {
    const literal = piece.match(/^[A-Za-z0-9._~-]+/);
    if (!literal) break;
    segments.push(literal[0]);
  }
  return segments.length ? '/' + segments.join('/') : '';
}

/**
 * Recursively walk the Express router stack and collect all routes.
 * @param {ExpressRouter} router - The Express router or app
 * @param {string} prefix - Current path prefix
 * @returns {Array<{path: string, methods: string[], params: string[]}>}
 */
function collectRoutes(router, prefix = '') {
  const routes = [];

  if (!router.stack) return routes;

  for (const layer of router.stack) {
    // Skip middleware layers without a route
    if (!layer.route && !layer.handle?.stack) {
      continue;
    }

    // Extract the route path from the layer regex or path
    let routePath = '';
    if (layer.route) {
      routePath = layer.route.path;
    } else if (layer.regexp) {
      // Try to extract path from regexp for nested routers
      // Improved regex to handle various path patterns
      // Express 4 mount regexps look like  ^\/wallets\/?(?=\/|$)  (note the
      // leading "^"). Take the literal leading segments before any regex syntax.
      routePath = mountPathFromRegexp(layer.regexp.source);
    }

    const fullPath = prefix + routePath;

    // For a regular route (layer.route)
    if (layer.route) {
      const methods = Object.keys(layer.route.methods)
        .map(m => m.toUpperCase())
        .filter(m => m !== 'OPTIONS');
      routes.push({
        path: fullPath,
        methods,
      });
    }
    // For nested routers (layer.handle.stack)
    else if (layer.handle?.stack) {
      const nestedRoutes = collectRoutes(layer.handle, fullPath);
      routes.push(...nestedRoutes);
    }
  }

  return routes;
}

/**
 * Create a simple Express app and collect all mounted routes.
 */
function main() {
  try {
    // Import app to get the fully configured app
    const app = require('../src/app');

    // Collect all routes from app._router or app.stack
    const router = app._router || app;
    const routes = collectRoutes(router);

    // Sort and deduplicate
    const routeMap = new Map();
    for (const route of routes) {
      const key = route.path;
      if (!routeMap.has(key)) {
        routeMap.set(key, new Set());
      }
      for (const method of route.methods) {
        routeMap.get(key).add(method);
      }
    }

    // Output as JSON
    const result = Array.from(routeMap.entries())
      .map(([path, methods]) => ({
        path,
        methods: Array.from(methods).sort(),
      }))
      .sort((a, b) => a.path.localeCompare(b.path));

    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('ERROR collecting routes:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { collectRoutes };
