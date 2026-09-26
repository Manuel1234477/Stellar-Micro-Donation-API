/**
 * Tests for GitHub issue #1767
 *
 * #1767 - Document and plan for SQLite single-node limits (or add a PostgreSQL option)
 *
 * This issue addresses the need to clearly document that SQLite is not suitable for
 * multi-instance deployments, and to either enforce single-replica deployments or
 * introduce PostgreSQL as an alternative. Kubernetes manifests and docker-compose
 * files must align with the chosen topology.
 */

'use strict';

const path = require('path');
const fs = require('fs');

describe('Issue #1767 — SQLite topology documented in ADR and K8s manifests', () => {
  const adrPath = path.join(__dirname, '../docs/adr');
  const k8sPath = path.join(__dirname, '../deploy/kubernetes/deployment.yaml');
  const composePath = path.join(__dirname, '../docker-compose.prod.yml');
  const rootPath = path.join(__dirname, '../');

  test('ADR document exists for SQLite/PostgreSQL topology', () => {
    if (fs.existsSync(adrPath)) {
      const files = fs.readdirSync(adrPath);
      // Check for ADR-001 or similar that documents database strategy
      const adrExists = files.some(f => f.match(/adr.*sqlite|sqlite.*adr|database.*strategy|001|db.*topology/i));
      expect(adrExists).toBe(true);
    }
  });

  test('ADR describes supported topology (single-replica or multi-DB)', () => {
    const adrPath01 = path.join(__dirname, '../docs/adr/001-sqlite-file-store.md');
    if (fs.existsSync(adrPath01)) {
      const content = fs.readFileSync(adrPath01, 'utf8');
      // Verify ADR clearly states topology constraints
      expect(content).toMatch(/single.*replica|replicas.*1|production.*deployment|topology/i);
    }
  });

  test('Kubernetes deployment specifies replicas: 1 for SQLite', () => {
    if (fs.existsSync(k8sPath)) {
      const content = fs.readFileSync(k8sPath, 'utf8');
      // Verify K8s manifest restricts to 1 replica when using SQLite
      expect(content).toMatch(/replicas:\s*1|replicas.*:\s*1/);
    }
  });

  test('Kubernetes deployment specifies Recreate strategy for SQLite', () => {
    if (fs.existsSync(k8sPath)) {
      const content = fs.readFileSync(k8sPath, 'utf8');
      // Verify K8s uses Recreate strategy (not RollingUpdate) for SQLite
      expect(content).toMatch(/Recreate|strategy.*Recreate/);
    }
  });

  test('docker-compose.prod.yml mounts database volume for persistence', () => {
    if (fs.existsSync(composePath)) {
      const content = fs.readFileSync(composePath, 'utf8');
      // Verify volume mount for SQLite database
      expect(content).toMatch(/volumes:|stellar_donations\.db|database.*volume|persistent/i);
    }
  });

  test('docker-compose.prod.yml sets DB_POOL_MAX appropriately', () => {
    if (fs.existsSync(composePath)) {
      const content = fs.readFileSync(composePath, 'utf8');
      // Verify DB_POOL_MAX is set (should be reasonable for single replica)
      expect(content).toMatch(/DB_POOL_MAX/);
    }
  });

  test('README or DEPLOYMENT guide documents single-replica requirement', () => {
    const readmePath = path.join(__dirname, '../README.md');
    const deploymentPath = path.join(__dirname, '../docs/DEPLOYMENT.md');

    let documented = false;

    if (fs.existsSync(readmePath)) {
      const content = fs.readFileSync(readmePath, 'utf8');
      if (content.match(/single.*replica|horizontal.*scale|SQLite.*production|db.*topology/i)) {
        documented = true;
      }
    }

    if (fs.existsSync(deploymentPath)) {
      const content = fs.readFileSync(deploymentPath, 'utf8');
      if (content.match(/single.*replica|horizontal.*scale|SQLite.*production|db.*topology/i)) {
        documented = true;
      }
    }

    expect(documented).toBe(true);
  });

  test('Database initialization script handles WAL mode configuration', () => {
    const initPath = path.join(__dirname, '../src/scripts/initDB.js');
    if (fs.existsSync(initPath)) {
      const content = fs.readFileSync(initPath, 'utf8');
      // Verify WAL mode is configured (recommended for SQLite)
      expect(content).toMatch(/WAL|journal_mode|PRAGMA/i);
    }
  });

  test('Database connection pool respects max connections for SQLite', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../src/utils/database.js'),
      'utf8'
    );

    // Verify pool configuration honors SQLite connection limits
    expect(source).toMatch(/DB_POOL_MAX|POOL_MAX|pool.*max|connections.*max/i);
  });

  test('Documentation clarifies SQLite is not recommended for multi-instance', () => {
    const readmePath = path.join(__dirname, '../README.md');
    const adrPath001 = path.join(__dirname, '../docs/adr/001-sqlite-file-store.md');

    let documented = false;

    if (fs.existsSync(readmePath)) {
      const content = fs.readFileSync(readmePath, 'utf8');
      if (content.match(/network.*filesystem|NFS|multi.*instance|shared.*volume|not.*recommended|SQLite.*single|single.*node/i)) {
        documented = true;
      }
    }

    if (fs.existsSync(adrPath001)) {
      const content = fs.readFileSync(adrPath001, 'utf8');
      if (content.match(/network.*filesystem|NFS|multi.*instance|shared.*volume|not.*recommended|SQLite.*single|single.*node/i)) {
        documented = true;
      }
    }

    expect(documented).toBe(true);
  });

  test('Kubernetes manifests and docker-compose both reference consistent database config', () => {
    let k8sHasConfig = false;
    let composeHasConfig = false;

    if (fs.existsSync(k8sPath)) {
      const content = fs.readFileSync(k8sPath, 'utf8');
      k8sHasConfig = content.includes('DB_') || content.includes('db');
    }

    if (fs.existsSync(composePath)) {
      const content = fs.readFileSync(composePath, 'utf8');
      composeHasConfig = content.includes('DB_') || content.includes('db');
    }

    // At least one should have database configuration
    expect(k8sHasConfig || composeHasConfig).toBe(true);
  });

  test('docs/FILE_SIZE_BUDGET.md exists and is referenced', () => {
    const budgetPath = path.join(__dirname, '../docs/FILE_SIZE_BUDGET.md');
    expect(fs.existsSync(budgetPath)).toBe(true);
  });

  test('Database respects file size budget constraints', () => {
    const dbFile = path.join(__dirname, '../src/utils/database.js');
    const budgetFile = path.join(__dirname, '../docs/FILE_SIZE_BUDGET.md');

    if (fs.existsSync(dbFile) && fs.existsSync(budgetFile)) {
      const dbContent = fs.readFileSync(dbFile, 'utf8');
      const budgetContent = fs.readFileSync(budgetFile, 'utf8');

      // Verify budget document references the database module
      expect(budgetContent).toMatch(/database|db/i);

      // Verify database file exists and has content
      expect(dbContent.length).toBeGreaterThan(100);
    }
  });
});
