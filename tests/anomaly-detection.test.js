'use strict';

/**
 * Tests for AnomalyDetectionService
 * Covers: new country, volume spike, off-hours access, webhook alert
 */

const { AnomalyDetectionService } = require('../src/services/AnomalyDetectionService');

// Helper: build N baseline events for a key (daytime, known country)
function buildBaseline(svc, keyId, n = 15) {
  const base = [];
  for (let i = 0; i < n; i++) {
    // Spread across hours 9–17 (business hours), country US
    const hour = 9 + (i % 9);
    const ts = Date.UTC(2024, 0, 1, hour, i, 0);
    base.push(svc.record(keyId, { ip: '1.2.3.4', country: 'US', endpoint: '/donations', timestamp: ts }));
  }
  return Promise.all(base);
}

describe('AnomalyDetectionService', () => {
  let svc;

  beforeEach(() => {
    svc = new AnomalyDetectionService();
  });

  // ── Cold-start ──────────────────────────────────────────────────────────────

  it('returns no anomalies when baseline is insufficient', async () => {
    // Only 5 events — below MIN_BASELINE_REQUESTS (10)
    for (let i = 0; i < 5; i++) {
      const result = await svc.record('key1', { ip: '9.9.9.9', country: 'RU', endpoint: '/', timestamp: Date.UTC(2024, 0, 1, 3, i) });
      expect(result).toEqual([]);
    }
  });

  // ── New country ─────────────────────────────────────────────────────────────

  it('detects a new country not seen in baseline', async () => {
    await buildBaseline(svc, 'key2');
    const result = await svc.record('key2', {
      ip: '5.5.5.5',
      country: 'CN',
      endpoint: '/donations',
      timestamp: Date.UTC(2024, 0, 2, 10, 0),
    });
    const types = result.map(a => a.type);
    expect(types).toContain('NEW_COUNTRY');
  });

  it('does NOT flag a country already in baseline', async () => {
    await buildBaseline(svc, 'key3');
    const result = await svc.record('key3', {
      ip: '1.2.3.5',
      country: 'US',
      endpoint: '/donations',
      timestamp: Date.UTC(2024, 0, 2, 10, 0),
    });
    const types = result.map(a => a.type);
    expect(types).not.toContain('NEW_COUNTRY');
  });

  // ── Volume spike ────────────────────────────────────────────────────────────

  it('detects a volume spike (>3x baseline hourly average)', async () => {
    // Build baseline: 1 request per hour across 12 hours
    for (let h = 9; h < 21; h++) {
      await svc.record('key4', { ip: '1.1.1.1', country: 'US', endpoint: '/', timestamp: Date.UTC(2024, 0, 1, h, 0) });
    }
    // Now flood hour 10 with many requests to trigger spike
    let lastResult = [];
    for (let m = 1; m <= 40; m++) {
      lastResult = await svc.record('key4', { ip: '1.1.1.1', country: 'US', endpoint: '/', timestamp: Date.UTC(2024, 0, 2, 10, m) });
    }
    const types = lastResult.map(a => a.type);
    expect(types).toContain('VOLUME_SPIKE');
  });

  // ── Off-hours access ────────────────────────────────────────────────────────

  it('detects off-hours access when baseline is daytime-only', async () => {
    await buildBaseline(svc, 'key5'); // all daytime (hours 9–17)
    const result = await svc.record('key5', {
      ip: '1.2.3.4',
      country: 'US',
      endpoint: '/donations',
      timestamp: Date.UTC(2024, 0, 2, 3, 0), // 03:00 UTC — off-hours
    });
    const types = result.map(a => a.type);
    expect(types).toContain('OFF_HOURS_ACCESS');
  });

  it('does NOT flag off-hours when baseline has significant off-hours activity', async () => {
    // Build baseline with >10% off-hours
    for (let i = 0; i < 15; i++) {
      const hour = i % 24; // includes off-hours
      await svc.record('key6', { ip: '1.1.1.1', country: 'US', endpoint: '/', timestamp: Date.UTC(2024, 0, 1, hour, i) });
    }
    const result = await svc.record('key6', {
      ip: '1.1.1.1',
      country: 'US',
      endpoint: '/',
      timestamp: Date.UTC(2024, 0, 2, 3, 0),
    });
    const types = result.map(a => a.type);
    expect(types).not.toContain('OFF_HOURS_ACCESS');
  });

  // ── Webhook alert ───────────────────────────────────────────────────────────

  it('calls webhook service when anomaly is detected', async () => {
    await buildBaseline(svc, 'key7');

    const alerts = [];
    svc._webhookService = {
      sendFailureNotification: jest.fn(async (url, payload) => {
        alerts.push(payload);
        return { delivered: true };
      }),
    };
    svc.webhookUrl = 'https://example.com/webhook';

    await svc.record('key7', {
      ip: '9.9.9.9',
      country: 'BR',
      endpoint: '/donations',
      timestamp: Date.UTC(2024, 0, 2, 10, 0),
    });

    expect(svc._webhookService.sendFailureNotification).toHaveBeenCalledTimes(1);
    expect(alerts[0].keyId).toBe('key7');
    expect(alerts[0].anomalies.some(a => a.type === 'NEW_COUNTRY')).toBe(true);
  });

  it('does NOT call webhook when no anomaly is detected', async () => {
    await buildBaseline(svc, 'key8');
    svc._webhookService = { sendFailureNotification: jest.fn() };
    svc.webhookUrl = 'https://example.com/webhook';

    await svc.record('key8', {
      ip: '1.2.3.4',
      country: 'US',
      endpoint: '/donations',
      timestamp: Date.UTC(2024, 0, 2, 10, 0),
    });

    expect(svc._webhookService.sendFailureNotification).not.toHaveBeenCalled();
  });

  // ── getAnomalies ────────────────────────────────────────────────────────────

  it('stores and retrieves anomaly history per key', async () => {
    await buildBaseline(svc, 'key9');
    await svc.record('key9', { ip: '5.5.5.5', country: 'JP', endpoint: '/', timestamp: Date.UTC(2024, 0, 2, 10, 0) });

    const anomalies = svc.getAnomalies('key9');
    expect(anomalies.length).toBeGreaterThan(0);
    expect(anomalies[0]).toHaveProperty('type');
    expect(anomalies[0]).toHaveProperty('timestamp');
  });

  it('returns empty array for key with no anomalies', () => {
    expect(svc.getAnomalies('nonexistent')).toEqual([]);
  });
});
