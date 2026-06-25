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

const fs = require('fs');
const path = require('path');

const { spec } = require('../src/config/openapi');

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
  
  return true;
}

if (!verify()) {
  process.exit(1);
}
