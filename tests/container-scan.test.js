/**
 * Container Image Vulnerability Scan Tests (Issue #1759)
 *
 * Validates that:
 * - .trivyignore entries have justification comments and expiry dates
 * - Dockerfile follows security best practices
 * - Container scan configuration is properly documented
 */

const fs = require('fs');
const path = require('path');

describe('Container Image Vulnerability Scan', () => {
  describe('.trivyignore file validation', () => {
    let trivyignoreContent;
    let trivyignorePath;

    beforeAll(() => {
      trivyignorePath = path.join(__dirname, '../.trivyignore');
      if (fs.existsSync(trivyignorePath)) {
        trivyignoreContent = fs.readFileSync(trivyignorePath, 'utf-8');
      }
    });

    it('should have a .trivyignore file', () => {
      expect(fs.existsSync(trivyignorePath)).toBe(true);
    });

    it('should document all ignored vulnerabilities with justification', () => {
      if (!trivyignoreContent) {
        return;
      }

      const lines = trivyignoreContent.split('\n').filter(line => line.trim());
      const nonCommentLines = lines.filter(line => !line.trim().startsWith('#'));

      nonCommentLines.forEach((vulnId) => {
        const vulnIdIndex = trivyignoreContent.indexOf(vulnId);
        const beforeVulnId = trivyignoreContent.substring(Math.max(0, vulnIdIndex - 500), vulnIdIndex);

        expect(beforeVulnId).toMatch(/# Justification:|# Reason:|# CVE/i);
      });
    });

    it('should include expiry or review dates for ignored vulnerabilities', () => {
      if (!trivyignoreContent) {
        return;
      }

      const lines = trivyignoreContent.split('\n');
      const nonCommentLines = lines
        .map((line, idx) => ({ line: line.trim(), index: idx }))
        .filter(({ line }) => line && !line.startsWith('#'));

      nonCommentLines.forEach(({ line, index }) => {
        const beforeLine = lines.slice(Math.max(0, index - 5), index).join('\n');

        expect(beforeLine.toLowerCase()).toMatch(/review|expir|until|before|date/i);
      });
    });
  });

  describe('Dockerfile security practices', () => {
    let dockerfileContent;
    let dockerfilePath;

    beforeAll(() => {
      dockerfilePath = path.join(__dirname, '../Dockerfile');
      if (fs.existsSync(dockerfilePath)) {
        dockerfileContent = fs.readFileSync(dockerfilePath, 'utf-8');
      }
    });

    it('should have a Dockerfile', () => {
      expect(fs.existsSync(dockerfilePath)).toBe(true);
    });

    it('should use a specific base image version (not latest)', () => {
      expect(dockerfileContent).toMatch(/FROM\s+node:\d+(-alpine)?(@sha256)?/);
    });

    it('should not run as root', () => {
      expect(dockerfileContent).not.toMatch(/USER\s+root/i);
      expect(dockerfileContent).toMatch(/USER\s+\w+/i);
    });

    it('should not include secrets in Dockerfile', () => {
      expect(dockerfileContent).not.toMatch(/ARG.*PASSWORD|ARG.*SECRET|ARG.*KEY/i);
    });
  });

  describe('Workflow configuration', () => {
    let workflowContent;
    let workflowPath;

    beforeAll(() => {
      workflowPath = path.join(__dirname, '../.github/workflows/container-scan.yml');
      if (fs.existsSync(workflowPath)) {
        workflowContent = fs.readFileSync(workflowPath, 'utf-8');
      }
    });

    it('should have a container-scan workflow', () => {
      expect(fs.existsSync(workflowPath)).toBe(true);
    });

    it('should run scan on scheduled basis', () => {
      expect(workflowContent).toMatch(/schedule:/);
    });

    it('should produce scan results', () => {
      expect(workflowContent).toMatch(/trivy|scan/i);
    });
  });
});
