/**
 * Suspicious Pattern Detection Tests
 * 
 * Tests for soft alert system that detects suspicious usage patterns
 * without blocking legitimate requests.
 */

const suspiciousPatternDetector = require('../src/utils/suspiciousPatternDetector');
const log = require('../src/utils/log');

// Mock logger to capture alerts
jest.mock('../src/utils/log');

describe('Suspicious Pattern Detection', () => {
  beforeEach(() => {
    // Clear all tracking state
    suspiciousPatternDetector.velocityTracking.clear();
    suspiciousPatternDetector.amountPatterns.clear();
    suspiciousPatternDetector.recipientPatterns.clear();
    suspiciousPatternDetector.sequentialFailures.clear();
    suspiciousPatternDetector.timePatterns.clear();
    
    // Clear mock calls
    jest.clearAllMocks();
  });

  afterAll(() => {
    suspiciousPatternDetector.stop();
  });

  describe('High Velocity Detection', () => {
    it('should detect rapid succession donations', () => {
      const ip = '192.168.1.100';
      const donationData = { amount: 10, recipient: 'RECIPIENT1' };

      // Simulate rapid donations
      for (let i = 0; i < 6; i++) {
        suspiciousPatternDetector.detectHighVelocity(ip, donationData);
      }

      expect(log.warn).toHaveBeenCalledWith(
        'SUSPICIOUS_PATTERN',
        expect.stringContaining('high_velocity_donations'),
        expect.objectContaining({
          signal: 'high_velocity_donations',
          pattern: 'rapid_succession',
          count: expect.any(Number)
        })
      );
    });

    it('should not alert below velocity threshold', () => {
      const ip = '192.168.1.101';
      const donationData = { amount: 10, recipient: 'RECIPIENT1' };

      // Below threshold
      for (let i = 0; i < 3; i++) {
        suspiciousPatternDetector.detectHighVelocity(ip, donationData);
      }

      expect(log.warn).not.toHaveBeenCalled();
    });

    it('should reset velocity window after expiration', () => {
      const ip = '192.168.1.102';
      const donationData = { amount: 10, recipient: 'RECIPIENT1' };

      suspiciousPatternDetector.detectHighVelocity(ip, donationData);
      
      const tracking = suspiciousPatternDetector.velocityTracking.get(ip);
      tracking.windowStart = Date.now() - suspiciousPatternDetector.thresholds.velocityWindow - 1000;

      suspiciousPatternDetector.detectHighVelocity(ip, donationData);

      const updated = suspiciousPatternDetector.velocityTracking.get(ip);
      expect(updated.donations.length).toBe(1);
    });

    it('should handle null IP gracefully', () => {
      expect(() => {
        suspiciousPatternDetector.detectHighVelocity(null, { amount: 10 });
      }).not.toThrow();
    });
  });

  describe('Identical Amount Pattern Detection', () => {
    it('should detect repeated identical amounts', () => {
      const ip = '192.168.1.103';
      const amount = 5.5;

      // Repeat same amount
      for (let i = 0; i < 4; i++) {
        suspiciousPatternDetector.detectIdenticalAmounts(ip, amount);
      }

      expect(log.warn).toHaveBeenCalledWith(
        'SUSPICIOUS_PATTERN',
        expect.stringContaining('identical_amount_pattern'),
        expect.objectContaining({
          signal: 'identical_amount_pattern',
          pattern: 'automation_suspected',
          amount: 5.5
        })
      );
    });

    it('should not alert for varied amounts', () => {
      const ip = '192.168.1.104';

      suspiciousPatternDetector.detectIdenticalAmounts(ip, 5);
      suspiciousPatternDetector.detectIdenticalAmounts(ip, 10);
      suspiciousPatternDetector.detectIdenticalAmounts(ip, 15);

      expect(log.warn).not.toHaveBeenCalled();
    });

    it('should clean old entries outside window', () => {
      const ip = '192.168.1.105';

      suspiciousPatternDetector.detectIdenticalAmounts(ip, 10);
      
      const tracking = suspiciousPatternDetector.amountPatterns.get(ip);
      tracking.timestamps[0] = Date.now() - suspiciousPatternDetector.thresholds.identicalAmountWindow - 1000;

      suspiciousPatternDetector.detectIdenticalAmounts(ip, 10);

      const updated = suspiciousPatternDetector.amountPatterns.get(ip);
      expect(updated.amounts.length).toBe(1);
    });

    it('should handle null amount gracefully', () => {
      expect(() => {
        suspiciousPatternDetector.detectIdenticalAmounts('192.168.1.106', null);
      }).not.toThrow();
    });
  });

  describe('Recipient Diversity Detection', () => {
    it('should detect high recipient diversity', () => {
      const donor = 'DONOR_PUBLIC_KEY';

      // Send to many different recipients
      for (let i = 0; i < 11; i++) {
        suspiciousPatternDetector.detectRecipientDiversity(donor, `RECIPIENT_${i}`);
      }

      expect(log.warn).toHaveBeenCalledWith(
        'SUSPICIOUS_PATTERN',
        expect.stringContaining('high_recipient_diversity'),
        expect.objectContaining({
          signal: 'high_recipient_diversity',
          pattern: 'distribution_suspected',
          uniqueRecipients: 11
        })
      );
    });

    it('should not alert for normal recipient count', () => {
      const donor = 'DONOR_PUBLIC_KEY_2';

      for (let i = 0; i < 5; i++) {
        suspiciousPatternDetector.detectRecipientDiversity(donor, `RECIPIENT_${i}`);
      }

      expect(log.warn).not.toHaveBeenCalled();
    });

    it('should track unique recipients only', () => {
      const donor = 'DONOR_PUBLIC_KEY_3';

      // Same recipient multiple times
      for (let i = 0; i < 5; i++) {
        suspiciousPatternDetector.detectRecipientDiversity(donor, 'SAME_RECIPIENT');
      }

      const recipients = suspiciousPatternDetector.recipientPatterns.get(donor);
      expect(recipients.size).toBe(1);
    });

    it('should handle null values gracefully', () => {
      expect(() => {
        suspiciousPatternDetector.detectRecipientDiversity(null, 'RECIPIENT');
        suspiciousPatternDetector.detectRecipientDiversity('DONOR', null);
      }).not.toThrow();
    });
  });

  describe('Sequential Failure Detection', () => {
    it('should detect sequential failures', () => {
      const ip = '192.168.1.107';

      // Simulate sequential failures
      for (let i = 0; i < 6; i++) {
        suspiciousPatternDetector.detectSequentialFailures(ip, 'AUTH_FAILED');
      }

      expect(log.warn).toHaveBeenCalledWith(
        'SUSPICIOUS_PATTERN',
        expect.stringContaining('sequential_failures'),
        expect.objectContaining({
          signal: 'sequential_failures',
          pattern: 'probing_suspected',
          errorType: 'AUTH_FAILED'
        })
      );
    });

    it('should reset counter after time gap', () => {
      const ip = '192.168.1.108';

      suspiciousPatternDetector.detectSequentialFailures(ip, 'ERROR');
      
      const tracking = suspiciousPatternDetector.sequentialFailures.get(ip);
      tracking.lastFailure = Date.now() - 70000; // > 1 minute

      suspiciousPatternDetector.detectSequentialFailures(ip, 'ERROR');

      const updated = suspiciousPatternDetector.sequentialFailures.get(ip);
      expect(updated.count).toBe(1);
    });

    it('should reset failures on success', () => {
      const ip = '192.168.1.109';

      suspiciousPatternDetector.detectSequentialFailures(ip, 'ERROR');
      expect(suspiciousPatternDetector.sequentialFailures.has(ip)).toBe(true);

      suspiciousPatternDetector.resetFailures(ip);
      expect(suspiciousPatternDetector.sequentialFailures.has(ip)).toBe(false);
    });

    it('should handle null IP gracefully', () => {
      expect(() => {
        suspiciousPatternDetector.detectSequentialFailures(null, 'ERROR');
        suspiciousPatternDetector.resetFailures(null);
      }).not.toThrow();
    });
  });

  describe('Off-Hours Activity Detection', () => {
    it('should detect excessive off-hours activity', () => {
      const ip = '192.168.1.110';
      
      // Mock date to be in off-hours (3 AM UTC)
      const realDate = Date;
      const mockTime = new Date('2026-02-26T03:00:00Z').getTime();
      global.Date = class extends Date {
        constructor() {
          super();
          return new realDate(mockTime);
        }
        static now() {
          return mockTime;
        }
        getUTCHours() {
          return 3;
        }
      };

      // Simulate many off-hours requests
      for (let i = 0; i < 21; i++) {
        suspiciousPatternDetector.detectOffHoursActivity(ip);
      }

      expect(log.warn).toHaveBeenCalledWith(
        'SUSPICIOUS_PATTERN',
        expect.stringContaining('off_hours_activity'),
        expect.objectContaining({
          signal: 'off_hours_activity',
          pattern: 'unusual_timing'
        })
      );

      global.Date = realDate;
    });

    it('should not track during normal hours', () => {
      const ip = '192.168.1.111';
      
      // Mock date to be in normal hours (10 AM UTC)
      const realDate = Date;
      const mockTime = new Date('2026-02-26T10:00:00Z').getTime();
      global.Date = class extends Date {
        constructor() {
          super();
          return new realDate(mockTime);
        }
        static now() {
          return mockTime;
        }
        getUTCHours() {
          return 10;
        }
      };

      for (let i = 0; i < 25; i++) {
        suspiciousPatternDetector.detectOffHoursActivity(ip);
      }

      expect(log.warn).not.toHaveBeenCalled();

      global.Date = realDate;
    });
  });

  describe('Severity Calculation', () => {
    it('should assign correct severity levels', () => {
      const ip = '192.168.1.112';

      // Trigger high severity alert
      for (let i = 0; i < 11; i++) {
        suspiciousPatternDetector.detectRecipientDiversity(`DONOR_${ip}`, `RECIPIENT_${i}`);
      }

      expect(log.warn).toHaveBeenCalledWith(
        'SUSPICIOUS_PATTERN',
        expect.any(String),
        expect.objectContaining({
          severity: 'high'
        })
      );
    });
  });

  describe('Metrics and Observability', () => {
    it('should return current metrics', () => {
      suspiciousPatternDetector.detectHighVelocity('192.168.1.113', { amount: 10 });
      suspiciousPatternDetector.detectIdenticalAmounts('192.168.1.114', 5);
      suspiciousPatternDetector.detectRecipientDiversity('DONOR1', 'RECIPIENT1');

      const metrics = suspiciousPatternDetector.getMetrics();

      expect(metrics).toEqual({
        velocityTracking: expect.any(Number),
        amountPatterns: expect.any(Number),
        recipientPatterns: expect.any(Number),
        sequentialFailures: expect.any(Number),
        timePatterns: expect.any(Number)
      });

      expect(metrics.velocityTracking).toBeGreaterThan(0);
      expect(metrics.amountPatterns).toBeGreaterThan(0);
      expect(metrics.recipientPatterns).toBeGreaterThan(0);
    });
  });

  describe('Cleanup', () => {
    it('should remove old velocity tracking entries', () => {
      const ip = '192.168.1.115';

      suspiciousPatternDetector.detectHighVelocity(ip, { amount: 10 });
      
      const tracking = suspiciousPatternDetector.velocityTracking.get(ip);
      tracking.windowStart = Date.now() - suspiciousPatternDetector.thresholds.velocityWindow * 3;

      suspiciousPatternDetector.cleanup();

      expect(suspiciousPatternDetector.velocityTracking.has(ip)).toBe(false);
    });

    it('should remove old amount pattern entries', () => {
      const ip = '192.168.1.116';

      suspiciousPatternDetector.detectIdenticalAmounts(ip, 10);
      
      const tracking = suspiciousPatternDetector.amountPatterns.get(ip);
      tracking.timestamps[0] = Date.now() - suspiciousPatternDetector.thresholds.identicalAmountWindow * 3;

      suspiciousPatternDetector.cleanup();

      expect(suspiciousPatternDetector.amountPatterns.has(ip)).toBe(false);
    });

    it('should remove old sequential failure entries', () => {
      const ip = '192.168.1.117';

      suspiciousPatternDetector.detectSequentialFailures(ip, 'ERROR');
      
      const tracking = suspiciousPatternDetector.sequentialFailures.get(ip);
      tracking.lastFailure = Date.now() - 3700000; // > 1 hour

      suspiciousPatternDetector.cleanup();

      expect(suspiciousPatternDetector.sequentialFailures.has(ip)).toBe(false);
    });

    it('should keep recent entries', () => {
      const ip = '192.168.1.118';

      suspiciousPatternDetector.detectHighVelocity(ip, { amount: 10 });
      suspiciousPatternDetector.cleanup();

      expect(suspiciousPatternDetector.velocityTracking.has(ip)).toBe(true);
    });
  });

  describe('No False Positives', () => {
    it('should not alert on normal donation patterns', () => {
      const ip = '192.168.1.119';

      // Normal usage: varied amounts, reasonable pace
      suspiciousPatternDetector.detectHighVelocity(ip, { amount: 5, recipient: 'R1' });
      suspiciousPatternDetector.detectIdenticalAmounts(ip, 5);
      
      suspiciousPatternDetector.detectHighVelocity(ip, { amount: 10, recipient: 'R2' });
      suspiciousPatternDetector.detectIdenticalAmounts(ip, 10);

      expect(log.warn).not.toHaveBeenCalled();
    });

    it('should not alert on legitimate recipient diversity', () => {
      const donor = 'LEGITIMATE_DONOR';

      // Normal: donating to a few different recipients
      for (let i = 0; i < 5; i++) {
        suspiciousPatternDetector.detectRecipientDiversity(donor, `RECIPIENT_${i}`);
      }

      expect(log.warn).not.toHaveBeenCalled();
    });

    it('should not alert on isolated failures', () => {
      const ip = '192.168.1.120';

      // Single failure
      suspiciousPatternDetector.detectSequentialFailures(ip, 'NETWORK_ERROR');

      expect(log.warn).not.toHaveBeenCalled();
    });
  });

  describe('Non-Blocking Behavior', () => {
    it('should never throw errors that could block requests', () => {
      expect(() => {
        suspiciousPatternDetector.detectHighVelocity(undefined, null);
        suspiciousPatternDetector.detectIdenticalAmounts(null, undefined);
        suspiciousPatternDetector.detectRecipientDiversity(undefined, undefined);
        suspiciousPatternDetector.detectSequentialFailures(null, null);
        suspiciousPatternDetector.detectOffHoursActivity(undefined);
      }).not.toThrow();
    });

    it('should handle malformed data gracefully', () => {
      expect(() => {
        suspiciousPatternDetector.detectHighVelocity('ip', { invalid: 'data' });
        suspiciousPatternDetector.detectIdenticalAmounts('ip', 'not-a-number');
        suspiciousPatternDetector.detectRecipientDiversity({}, []);
      }).not.toThrow();
    });
  });
});
