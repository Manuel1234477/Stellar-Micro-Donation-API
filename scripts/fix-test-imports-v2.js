#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function updateImports(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;
  const relativePath = filePath.replace(/\\/g, '/');
  
  let depth;
  if (relativePath.includes('tests/unit/')) {
    depth = '../../../';
  } else if (relativePath.includes('tests/integration/')) {
    depth = '../../../';
  } else if (relativePath.includes('tests/e2e/')) {
    depth = '../../';
  } else {
    return;
  }

  // Fix require('../src/...') patterns
  content = content.replace(/require\(['"]\.\.\/+src\//g, `require('${depth}src/`);
  
  // Fix require('./helpers/...') patterns
  const helpersDepth = depth === '../../' ? '../' : '../../';
  content = content.replace(/require\(['"]\.\.?\/+helpers\//g, `require('${helpersDepth}helpers/`);
  
  // Fix jest.mock patterns
  content = content.replace(/jest\.mock\(['"]\.\.\/+src\//g, `jest.mock('${depth}src/`);

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Updated: ${filePath}`);
}

function processDirectory(dir) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      processDirectory(filePath);
    } else if (file.endsWith('.test.js')) {
      updateImports(filePath);
    }
  });
}

['tests/unit', 'tests/integration', 'tests/e2e'].forEach(dir => {
  if (fs.existsSync(dir)) processDirectory(dir);
});

console.log('Done!');
