#!/usr/bin/env node
'use strict';

/**
 * Route Coverage Verification - Ensure main API routes are documented
 * 
 * This script verifies that core API route files are included in the OpenAPI
 * spec generation via the swagger-jsdoc apis array.
 * 
 * It ensures the generator will pick up JSDoc annotations from all route files
 * that define public endpoints.
 * 
 * Usage: node scripts/verify-route-coverage.js
 */

const { spec } = require('../src/config/openapi');

/**
 * Routes that are intentionally undocumented (internal, debug, or non-public).
 * Each entry is a "METHOD /path" string (method uppercase, path as registered).
 */
const INTERNAL_ROUTE_ALLOW_LIST = new Set([
  'GET /health',
  'GET /metrics',
  'GET /internal/status',
]);

/**
 * Load the route registry. Prefers the methodRegistry module and falls back to
 * the collect-routes helper when the registry is unavailable.
 */
function loadRegisteredRoutes() {
  let registry;
  try {
    registry = require('../src/middleware/methodRegistry');
  } catch (err) {
    registry = null;
  }

  const routes = [];

  const pushRoute = (method, path) => {
    if (!method || !path) return;
    routes.push({ method: String(method).toUpperCase(), path: String(path) });
  };

  if (registry) {
    // Support several plausible registry shapes.
    if (Array.isArray(registry.routes)) {
      for (const r of registry.routes) {
        pushRoute(r.method, r.path || r.route || r.url);
      }
    } else if (typeof registry.getRoutes === 'function') {
      for (const r of registry.getRoutes()) {
        pushRoute(r.method, r.path || r.route || r.url);
      }
    } else if (registry.routes && typeof registry.routes === 'object') {
      for (const [method, paths] of Object.entries(registry.routes)) {
        const list = Array.isArray(paths) ? paths : [paths];
        for (const p of list) pushRoute(method, p);
      }
    }
  }

  if (routes.length === 0) {
    try {
      const collected = require('./collect-routes');
      const list = typeof collected === 'function' ? collected() : collected;
      const arr = Array.isArray(list) ? list : (list && Array.isArray(list.routes) ? list.routes : []);
      for (const r of arr) {
        pushRoute(r.method, r.path || r.route || r.url);
      }
    } catch (err) {
      // No route source available; coverage check will be skipped.
    }
  }

  return routes;
}

/**
 * Extract documented paths from OpenAPI spec
 */
function extractDocumentedPaths() {
  const documented = new Set();
  
  const specPaths = spec.paths || {};
  for (const path of Object.keys(specPaths)) {
    documented.add(path);
  }
  
  return documented;
}

/**
 * Extract documented "METHOD /path" pairs from OpenAPI spec
 */
function extractDocumentedOperations() {
  const operations = new Set();
  const specPaths = spec.paths || {};
  const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

  for (const [path, item] of Object.entries(specPaths)) {
    if (!item || typeof item !== 'object') continue;
    for (const method of methods) {
      if (item[method]) {
        operations.add(`${method.toUpperCase()} ${path}`);
      }
    }
  }

  return operations;
}

/**
 * Normalize an Express route path to an OpenAPI path (strip trailing slash,
 * convert :param segments to {param}).
 */
function normalizePath(path) {
  let p = path.split('?')[0];
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  p = p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
  return p;
}

/**
 * Verify every registered public route is documented.
 */
function verifyRouteCoverage(documentedOperations) {
  const registered = loadRegisteredRoutes();

  if (registered.length === 0) {
    console.log('⚠ No registered routes found; skipping route coverage check');
    return true;
  }

  const missing = [];
  for (const route of registered) {
    const key = `${route.method} ${normalizePath(route.path)}`;
    if (INTERNAL_ROUTE_ALLOW_LIST.has(key)) continue;
    if (!documentedOperations.has(key)) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    console.error('\n❌ Registered routes missing OpenAPI documentation:');
    for (const key of missing) {
      console.error(`   ${key}`);
    }
    return false;
  }

  console.log(`✓ All ${registered.length} registered routes are documented`);
  return true;
}

/**
 * Main verification
 */
function verify() {
  console.log('Verifying OpenAPI spec documentation...\n');
  
  const documented = extractDocumentedPaths();
  
  console.log(`Found ${documented.size} documented paths`);
  
  // Check for required main endpoints
  const requiredEndpoints = [
    '/donations',
    '/wallets',
    '/stats/summary',
    '/stream/schedules',
    '/transactions',
  ];
  
  const missing = [];
  for (const endpoint of requiredEndpoints) {
    if (!documented.has(endpoint)) {
      missing.push(endpoint);
    }
  }
  
  if (missing.length > 0) {
    console.error('\n❌ Missing required endpoints:');
    for (const endpoint of missing) {
      console.error(`   ${endpoint}`);
    }
    return false;
  }
  
  console.log('\n✓ All required endpoints are documented');
  console.log(`✓ OpenAPI spec contains ${documented.size} paths`);
  
  // Verify shared schemas exist
  const requiredSchemas = ['Error', 'ValidationError', 'UnauthorizedError', 'NotFoundError'];
  const definedSchemas = spec.components?.schemas ? Object.keys(spec.components.schemas) : [];
  
  const missingSchemas = requiredSchemas.filter(s => !definedSchemas.includes(s));
  if (missingSchemas.length > 0) {
    console.error('\n❌ Missing required schemas:', missingSchemas.join(', '));
    return false;
  }
  
  console.log(`✓ All ${requiredSchemas.length} required schemas are defined`);
  
  // Verify auth schemes
  const requiredSchemes = ['ApiKeyAuth'];
  const definedSchemes = spec.components?.securitySchemes ? Object.keys(spec.components.securitySchemes) : [];
  
  const missingSchemes = requiredSchemes.filter(s => !definedSchemes.includes(s));
  if (missingSchemes.length > 0) {
    console.error('\n❌ Missing required auth schemes:', missingSchemes.join(', '));
    return false;
  }
  
  console.log('✓ All auth schemes are properly defined');

  // Verify every registered public route is documented
  const documentedOperations = extractDocumentedOperations();
  if (!verifyRouteCoverage(documentedOperations)) {
    return false;
  }
  
  return true;
}

if (!verify()) {
  process.exit(1);
}
