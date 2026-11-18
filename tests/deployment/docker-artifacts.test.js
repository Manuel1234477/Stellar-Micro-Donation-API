'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function readFile(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

describe('Docker deployment artifacts (issue #765)', () => {
  describe('Dockerfile', () => {
    it('exists at the repository root', () => {
      expect(fileExists('Dockerfile')).toBe(true);
    });

    it('uses a Node.js base image', () => {
      const content = readFile('Dockerfile');
      expect(content).toMatch(/^FROM\s+node:/im);
    });

    it('sets a working directory', () => {
      const content = readFile('Dockerfile');
      expect(content).toMatch(/^WORKDIR\s+\S+/im);
    });

    it('installs dependencies', () => {
      const content = readFile('Dockerfile');
      expect(content).toMatch(/npm\s+(ci|install)/);
    });

    it('exposes the application port', () => {
      const content = readFile('Dockerfile');
      expect(content).toMatch(/^EXPOSE\s+\d+/im);
    });

    it('defines a start command', () => {
      const content = readFile('Dockerfile');
      expect(content).toMatch(/^(CMD|ENTRYPOINT)\s+/im);
    });
  });

  describe('docker-compose', () => {
    const composeCandidates = [
      'docker-compose.yml',
      'docker-compose.yaml',
      'compose.yml',
      'compose.yaml',
    ];

    function findComposeFile() {
      return composeCandidates.find((candidate) => fileExists(candidate));
    }

    it('exists at the repository root', () => {
      expect(findComposeFile()).toBeDefined();
    });

    it('declares a service for the application', () => {
      const composeFile = findComposeFile();
      expect(composeFile).toBeDefined();
      const content = readFile(composeFile);
      expect(content).toMatch(/^services:/m);
    });

    it('builds the application from the Dockerfile', () => {
      const composeFile = findComposeFile();
      expect(composeFile).toBeDefined();
      const content = readFile(composeFile);
      expect(content).toMatch(/build:/);
      expect(content).toMatch(/Dockerfile/);
    });

    it('maps the application port', () => {
      const composeFile = findComposeFile();
      expect(composeFile).toBeDefined();
      const content = readFile(composeFile);
      expect(content).toMatch(/ports:/);
    });
  });

  describe('.dockerignore', () => {
    it('exists at the repository root', () => {
      expect(fileExists('.dockerignore')).toBe(true);
    });

    it('excludes node_modules from the build context', () => {
      const content = readFile('.dockerignore');
      expect(content).toMatch(/node_modules/);
    });

    it('excludes test artifacts from the build context', () => {
      const content = readFile('.dockerignore');
      expect(content).toMatch(/tests?/);
    });
  });
});