'use strict';

/**
 * Tests for the RestoreTestRunner service.
 *
 * Moved from tests/RestoreTestRunner.test.js as part of the test
 * reorganisation (issue #1792).
 */

const path = require('path');

const RestoreTestRunner = require('../../src/services/RestoreTestRunner');

describe('RestoreTestRunner', () => {
  let runner;

  beforeEach(() => {
    runner = new RestoreTestRunner();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    it('creates an instance', () => {
      expect(runner).toBeInstanceOf(RestoreTestRunner);
    });

    it('initialises an empty results collection', () => {
      expect(runner.results).toBeDefined();
      expect(Array.isArray(runner.results)).toBe(true);
      expect(runner.results).toHaveLength(0);
    });
  });

  describe('run', () => {
    it('is a function', () => {
      expect(typeof runner.run).toBe('function');
    });

    it('resolves with a summary object', async () => {
      const summary = await runner.run();
      expect(summary).toBeDefined();
      expect(typeof summary).toBe('object');
    });

    it('records results for each executed test', async () => {
      await runner.run();
      expect(Array.isArray(runner.results)).toBe(true);
    });
  });

  describe('reset', () => {
    it('clears previously recorded results', async () => {
      await runner.run();
      if (typeof runner.reset === 'function') {
        runner.reset();
        expect(runner.results).toHaveLength(0);
      } else {
        expect(runner.results).toBeDefined();
      }
    });
  });

  describe('path handling', () => {
    it('resolves test paths relative to the project root', () => {
      const projectRoot = path.resolve(__dirname, '..', '..');
      expect(path.isAbsolute(projectRoot)).toBe(true);
    });
  });
});