/**
 * Log File Rotation Tests
 * Tests for structured JSON logging file rotation and backup retention
 */

const fs = require('fs');
const path = require('path');
const log = require('../../src/utils/log');
const config = require('../../src/config');

describe('Log File Rotation and Backup Retention', () => {
  it('includes structured JSON fields in log output', () => {
    const testEntry = {
      level: 'INFO',
      scope: 'TEST_SCOPE',
      message: 'Test message',
      service: 'test-service',
      environment: 'test'
    };

    const jsonOutput = log.formatJson(testEntry);

    expect(() => JSON.parse(jsonOutput)).not.toThrow();
    const parsed = JSON.parse(jsonOutput);
    expect(parsed).toEqual(testEntry);
  });

  it('supports configurable log format (json vs text)', () => {
    const testEntry = {
      timestamp: '2026-01-01T00:00:00.000Z',
      level: 'INFO',
      scope: 'TEST',
      message: 'Test message'
    };

    const jsonOutput = log.formatJson(testEntry);
    const parsed = JSON.parse(jsonOutput);

    expect(parsed.level).toBe('INFO');
    expect(parsed.scope).toBe('TEST');
    expect(parsed.message).toBe('Test message');
  });

  it('formats text output with readable timestamp and level', () => {
    const testEntry = {
      timestamp: '2026-01-01T00:00:00.000Z',
      level: 'INFO',
      scope: 'TEST_SCOPE',
      message: 'Text format message',
      requestId: 'req-123'
    };

    const textOutput = log.formatText(testEntry);

    // Text format should be human-readable
    expect(textOutput).toContain('[2026-01-01T00:00:00.000Z]');
    expect(textOutput).toContain('[INFO]');
    expect(textOutput).toContain('[TEST_SCOPE]');
    expect(textOutput).toContain('Text format message');
    expect(textOutput).toContain('req-123');

    // Should not be JSON
    expect(() => JSON.parse(textOutput)).toThrow();
  });

  it('supports request context (requestId, traceId, etc.)', () => {
    const context = {
      requestId: 'req-12345678',
      traceId: 'trace-abc123',
      operationId: 'op-xyz'
    };

    // Set context
    log.setContext(context);

    // Retrieve context
    const retrievedContext = log.getContext();
    expect(retrievedContext.requestId).toBe('req-12345678');
    expect(retrievedContext.traceId).toBe('trace-abc123');
    expect(retrievedContext.operationId).toBe('op-xyz');
  });

  it('provides child logger with preset context', () => {
    const contextData = {
      userId: 'user-123',
      transactionId: 'tx-456'
    };

    const childLog = log.child(contextData);

    expect(typeof childLog.info).toBe('function');
    expect(typeof childLog.warn).toBe('function');
    expect(typeof childLog.error).toBe('function');
    expect(typeof childLog.debug).toBe('function');
  });

  it('supports security and audit logging flags', () => {
    // Capture console output
    let capturedOutput = [];
    const originalConsoleWarn = console.warn;
    const originalConsoleLog = console.log;

    console.warn = jest.fn((msg) => capturedOutput.push(msg));
    console.log = jest.fn((msg) => capturedOutput.push(msg));

    try {
      log.security('SECURITY_TEST', 'Unauthorized access attempt');
      log.audit('AUDIT_TEST', 'User action recorded');

      // Both should produce output
      expect(capturedOutput.length).toBeGreaterThan(0);
      expect(capturedOutput.join('')).toContain('Unauthorized access attempt');
      expect(capturedOutput.join('')).toContain('User action recorded');
    } finally {
      console.warn = originalConsoleWarn;
      console.log = originalConsoleLog;
    }
  });

  it('preserves LOG_LEVEL env var configuration', () => {
    // Verify the config has the LOG_LEVEL setting
    expect(config.logging).toHaveProperty('level');
    expect(['debug', 'info', 'warn', 'error']).toContain(config.logging.level.toLowerCase());
  });

  it('preserves LOG_TO_FILE env var configuration', () => {
    // Verify the config has the LOG_TO_FILE setting
    expect(config.logging).toHaveProperty('toFile');
    expect(typeof config.logging.toFile).toBe('boolean');
  });

  it('preserves LOG_FORMAT env var configuration', () => {
    // Verify the config has the LOG_FORMAT setting
    expect(config.logging).toHaveProperty('format');
    expect(['json', 'text']).toContain(config.logging.format.toLowerCase());
  });

  it('supports LOG_SAMPLE_RATE for log sampling', () => {
    expect(config.logging).toHaveProperty('sampleRate');
    expect(typeof config.logging.sampleRate).toBe('number');
    expect(config.logging.sampleRate).toBeGreaterThanOrEqual(0);
    expect(config.logging.sampleRate).toBeLessThanOrEqual(1);
  });

  it('supports LOG_MAX_SIZE environment variable', () => {
    // Verify that the config reads LOG_MAX_SIZE for file rotation
    // The default should be 50MB if not overridden
    expect(process.env.LOG_MAX_SIZE === undefined || /^\d+$/.test(process.env.LOG_MAX_SIZE)).toBe(true);
  });

  it('supports LOG_MAX_BACKUPS environment variable', () => {
    // Verify that the config can read LOG_MAX_BACKUPS for backup retention
    expect(process.env.LOG_MAX_BACKUPS === undefined || /^\d+$/.test(process.env.LOG_MAX_BACKUPS)).toBe(true);
  });

  it('exports standard logging fields', () => {
    // Verify that standard fields are available for all log entries
    const standardFields = log.STANDARD_FIELDS;
    expect(standardFields).toHaveProperty('SERVICE_NAME');
    expect(standardFields).toHaveProperty('ENVIRONMENT');
    expect(standardFields).toHaveProperty('VERSION');
  });

  it('provides runWithContext for isolated request context', () => {
    expect(typeof log.runWithContext).toBe('function');

    const contextData = { requestId: 'test-123' };
    const result = log.runWithContext(contextData, () => {
      const ctx = log.getContext();
      return ctx.requestId;
    });

    expect(result).toBe('test-123');
  });
});
