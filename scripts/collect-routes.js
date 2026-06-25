#!/usr/bin/env node
'use strict';

/**
 * Route Collector - Extract all mounted routes from the Express app
 * RESPONSIBILITY: Enumerate all actually-mounted routes (including nested admin routers)
 * and output them for verification against OpenAPI spec.
 */

const path = require('path');

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
      const source = layer.regexp.source;
      let match = source.match(/^\\\/(.+?)(\\\/|$|\?|\|)/);
      if (!match) {
        match = source.match(/^\\\/(.+?)$/);
      }
      if (match) {
        routePath = '/' + match[1]
          .replace(/\\\//g, '/')
          .replace(/\\\./g, '.')
          .replace(/\\-/g, '-')
          .replace(/\(\?:/g, '')
          .replace(/\)/g, '');
      }
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

main();
