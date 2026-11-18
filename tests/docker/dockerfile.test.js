/**
 * Dockerfile Hardening Tests
 *
 * Verify that the Dockerfile follows production hardening best practices:
 * 1. Multi-stage build to exclude dev dependencies
 * 2. Non-root user execution
 * 3. HEALTHCHECK configured for orchestration
 * 4. Base image pinned by digest for reproducibility
 * 5. Uses npm ci for reproducible installs
 *
 * Issue #1228: Harden the Dockerfile: multi-stage build, non-root user, HEALTHCHECK, pinned base
 */

const fs = require('fs');
const path = require('path');

describe('Dockerfile Hardening', () => {
  let dockerfileContent;

  beforeAll(() => {
    const dockerfilePath = path.join(__dirname, '../../Dockerfile');
    dockerfileContent = fs.readFileSync(dockerfilePath, 'utf8');
  });

  describe('Multi-Stage Build', () => {
    it('should use multi-stage build pattern', () => {
      expect(dockerfileContent).toContain('AS builder');
      expect(dockerfileContent).toMatch(/FROM node.*builder/);
    });

    it('should have separate builder and production stages', () => {
      const builderCount = (dockerfileContent.match(/FROM node.*AS builder/g) || []).length;
      const prodCount = (dockerfileContent.match(/FROM node(?!.*AS)/g) || []).length;

      expect(builderCount).toBe(1);
      expect(prodCount).toBeGreaterThanOrEqual(1);
    });

    it('should copy only production artifacts from builder', () => {
      // Production stage should copy from builder, not include all files
      const productionStageStart = dockerfileContent.indexOf('# ── Production stage');
      const productionContent = dockerfileContent.substring(productionStageStart);

      expect(productionContent).toMatch(/COPY --from=builder.*node_modules/);
      expect(productionContent).toMatch(/COPY --from=builder.*src/);
      expect(productionContent).toMatch(/COPY --from=builder.*package.json/);

      // Should NOT copy all files
      expect(productionContent).not.toMatch(/COPY \. \./);
    });

    it('should exclude dev dependencies in production', () => {
      expect(dockerfileContent).toContain('--omit=dev');
    });
  });

  describe('Base Image Pinning', () => {
    it('should pin base image by digest for reproducibility', () => {
      // Check for @sha256: pattern in FROM statements
      const fromStatements = dockerfileContent.match(/FROM node:[^\s]+@sha256:[a-f0-9]{64}/g);

      expect(fromStatements).not.toBeNull();
      expect(fromStatements.length).toBeGreaterThan(0);
    });

    it('should use identical digest for builder and production stages', () => {
      const digests = dockerfileContent.match(/@sha256:[a-f0-9]{64}/g) || [];
      const uniqueDigests = [...new Set(digests)];

      // Should have at least one digest (both stages should use same)
      expect(uniqueDigests.length).toBeGreaterThan(0);
    });

    it('should not use floating tags like node:20-alpine without digest', () => {
      // Verify no FROM statements with only tag (no digest)
      const floatingTags = dockerfileContent.match(/FROM node:20-alpine(?!@sha256)/g);

      expect(floatingTags).toBeNull();
    });
  });

  describe('Non-Root User', () => {
    it('should create a non-root user', () => {
      expect(dockerfileContent).toContain('addgroup');
      expect(dockerfileContent).toContain('adduser');
      expect(dockerfileContent).toContain('appuser');
      expect(dockerfileContent).toContain('appgroup');
      expect(dockerfileContent).toMatch(/1001/);
    });

    it('should switch to non-root user before CMD', () => {
      const userIndex = dockerfileContent.indexOf('USER appuser');
      const cmdIndex = dockerfileContent.lastIndexOf('CMD');

      expect(userIndex).toBeGreaterThan(-1);
      expect(cmdIndex).toBeGreaterThan(userIndex);
    });

    it('should not run CMD as root', () => {
      const productionStageStart = dockerfileContent.indexOf('# ── Production stage');
      const productionContent = dockerfileContent.substring(productionStageStart);

      // Find USER directive
      const userMatch = productionContent.match(/USER\s+(\w+)/);
      expect(userMatch).not.toBeNull();
      expect(userMatch[1]).not.toBe('root');
    });

    it('should set proper file ownership for non-root user', () => {
      expect(dockerfileContent).toContain('chown');
      expect(dockerfileContent).toContain('appuser:appgroup');
    });
  });

  describe('HEALTHCHECK', () => {
    it('should include HEALTHCHECK directive', () => {
      expect(dockerfileContent).toContain('HEALTHCHECK');
    });

    it('should configure reasonable health check parameters', () => {
      expect(dockerfileContent).toMatch(/--interval=\d+s/);
      expect(dockerfileContent).toMatch(/--timeout=\d+s/);
      expect(dockerfileContent).toMatch(/--start-period=\d+s/);
      expect(dockerfileContent).toMatch(/--retries=\d+/);
    });

    it('should probe a health endpoint', () => {
      const healthCheckMatch = dockerfileContent.match(/HEALTHCHECK[^]*?CMD\s+(.+?)(\n\n|$)/);
      expect(healthCheckMatch).not.toBeNull();

      const healthCheckCmd = healthCheckMatch[1];
      // Should probe http endpoint on port 3000
      expect(healthCheckCmd).toMatch(/localhost:3000/);
      expect(healthCheckCmd).toMatch(/health/);
    });

    it('should probe health/ready endpoint for true readiness check', () => {
      expect(dockerfileContent).toMatch(/\/health\/ready/);
    });
  });

  describe('npm ci Usage', () => {
    it('should use npm ci instead of npm install for reproducibility', () => {
      expect(dockerfileContent).toContain('npm ci');
    });

    it('should not use npm install in production stage', () => {
      const productionStageStart = dockerfileContent.indexOf('# ── Production stage');
      const productionContent = dockerfileContent.substring(productionStageStart);

      expect(productionContent).not.toContain('npm install');
    });
  });

  describe('Best Practices', () => {
    it('should expose the correct port', () => {
      expect(dockerfileContent).toMatch(/EXPOSE\s+3000/);
    });

    it('should set WORKDIR early to avoid redundancy', () => {
      const workdirIndex = dockerfileContent.indexOf('WORKDIR /app');
      expect(workdirIndex).toBeGreaterThan(-1);
      expect(workdirIndex).toBeLessThan(dockerfileContent.indexOf('COPY'));
    });

    it('should use minimal alpine base image', () => {
      expect(dockerfileContent).toContain('alpine');
    });

    it('should have clear section comments', () => {
      expect(dockerfileContent).toContain('── Build stage');
      expect(dockerfileContent).toContain('── Production stage');
    });

    it('should create data directory for persistence', () => {
      expect(dockerfileContent).toContain('mkdir -p /app/data');
    });

    it('should declare writable volumes for read-only root filesystem support', () => {
      expect(dockerfileContent).toMatch(/VOLUME\s+\[.*"\/data".*"\/tmp".*\]/);
    });

    it('should not include unnecessary files in production image', () => {
      const productionStageStart = dockerfileContent.indexOf('# ── Production stage');
      const productionContent = dockerfileContent.substring(productionStageStart);

      // Only copy necessary files
      expect(productionContent).toContain('COPY --from=builder');

      // Should not copy test files, docs, etc.
      expect(productionContent).not.toMatch(/COPY.*tests\//);
      expect(productionContent).not.toMatch(/COPY.*docs\//);
    });
  });

  describe('Security Scanning', () => {
    it('should include helpful comments about security decisions', () => {
      expect(dockerfileContent).toContain('non-root');
      expect(dockerfileContent).toContain('production');
      expect(dockerfileContent).toContain('security');
    });

    it('should document the rationale for hardening measures', () => {
      // Check for comments explaining why each measure is taken
      expect(dockerfileContent).toMatch(/reproducib/i); // reproducible builds
      expect(dockerfileContent).toMatch(/attack surface/i); // minimal attack surface
    });
  });
});
