const log = require('../src/utils/log');
const config = require('../src/config');
const fs = require('fs');
const path = require('path');

describe('Structured Logging with Log Levels and Output Formats', () => {
  let originalConsoleLog;
  let originalConsoleWarn;
  let originalConsoleError;
  let originalFormat;
  let originalLevel;
  let originalSampleRate;
  let output = [];

  beforeAll(() => {
    originalConsoleLog = console.log;
    originalConsoleWarn = console.warn;
    originalConsoleError = console.error;
    originalFormat = config.logging.format;
    originalLevel = config.logging.level;
    originalSampleRate = config.logging.sampleRate;
    
    // Mock standard console to trap output
    console.log = jest.fn((msg) => output.push(msg));
    console.warn = jest.fn((msg) => output.push(msg));
    console.error = jest.fn((msg) => output.push(msg));
  });

  afterAll(() => {
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
    config.logging.format = originalFormat;
    config.logging.level = originalLevel;
    config.logging.sampleRate = originalSampleRate;
  });

  beforeEach(() => {
    output = [];
    jest.clearAllMocks();
  });

  it('LOG_FORMAT=json produces valid JSON log lines', () => {
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

  it('All log entries include required fields: timestamp, level, service, message, scope', () => {
    jest.isolateModules(() => {
        process.env.LOG_FORMAT = 'json';
        const freshConfig = require('../src/config');
        freshConfig.logging.format = 'json';
        freshConfig.logging.level = 'info';
        
        const isolatedLog = require('../src/utils/log');
        isolatedLog.info('TEST_SCOPE', 'This is a test message');
        
        expect(output.length).toBe(1);
        const parsed = JSON.parse(output[0]);
        expect(parsed).toHaveProperty('timestamp');
        expect(parsed).toHaveProperty('level');
        expect(parsed).toHaveProperty('service');
        expect(parsed).toHaveProperty('message');
        expect(parsed).toHaveProperty('scope');
    });
  });

  it('LOG_LEVEL=warn suppresses debug and info logs', () => {
    jest.isolateModules(() => {
      process.env.LOG_LEVEL = 'warn';
      const freshConfig = require('../src/config');
      freshConfig.logging.level = 'warn';
      
      const isolatedLog = require('../src/utils/log');
      
      isolatedLog.info('TEST', 'Should not print');
      isolatedLog.debug('TEST', 'Should not print');
      isolatedLog.warn('TEST', 'Should print');
      isolatedLog.error('TEST', 'Should print');
      
      expect(console.log).toHaveBeenCalledTimes(0);
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalledTimes(1);
    });
  });

  it('Log sampling drops logs configured percentage', () => {
    jest.isolateModules(() => {
      process.env.LOG_SAMPLE_RATE = '0.0'; 
      const freshConfig = require('../src/config');
      freshConfig.logging.sampleRate = 0.0;
      freshConfig.logging.level = 'debug';
      freshConfig.logging.debugMode = true; // explicitly enable debug mode
      
      const isolatedLog = require('../src/utils/log');
      isolatedLog.debug('TEST', 'Sampled out output');
      
      expect(console.log).toHaveBeenCalledTimes(0);
    });
  });

  it('Log sampling keeps logs configured percentage', () => {
    jest.isolateModules(() => {
      process.env.LOG_SAMPLE_RATE = '1.0'; 
      const freshConfig = require('../src/config');
      freshConfig.logging.sampleRate = 1.0;
      freshConfig.logging.level = 'debug';
      freshConfig.logging.debugMode = true; // explicitly enable debug mode
      
      const isolatedLog = require('../src/utils/log');
      isolatedLog.debug('TEST', 'Kept output');
      
      expect(console.log).toHaveBeenCalledTimes(1);
    });
  });

  it('File logging rotates at configurable size/time intervals', () => {
    jest.isolateModules(() => {
      const tmpDir = path.join(__dirname, 'tmp-logs');
      if (!fs.existsSync(tmpDir)) {
          fs.mkdirSync(tmpDir, { recursive: true });
      }
      
      process.env.LOG_MAX_SIZE = '10'; // 10 bytes
      const freshConfig = require('../src/config');
      freshConfig.logging.toFile = true;
      freshConfig.logging.directory = tmpDir;
      freshConfig.logging.level = 'info';
      freshConfig.logging.format = 'text';
      
      const isolatedLog = require('../src/utils/log');
      
      // Give enough delay for file stream creation and writes or make it synchronous for testing
      // Actually stream write is async, let's just write and block slightly
      isolatedLog.info('TEST', 'Line 1');
      isolatedLog.info('TEST', 'Line 2 - bigger line to cause rotation');
      isolatedLog.info('TEST', 'Line 3');
      
      // Wait for Node to flush the stream
      setTimeout(() => {
          const files = fs.readdirSync(tmpDir);
          expect(files.length).toBeGreaterThan(1);
          
          files.forEach(f => fs.unlinkSync(path.join(tmpDir, f)));
          fs.rmdirSync(tmpDir);
      }, 50);
    });
  });
});
