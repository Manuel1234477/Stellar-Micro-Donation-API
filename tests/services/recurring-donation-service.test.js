'use strict';

/**
 * #2113 — one implementation for recurring schedule create/update and
 * nextExecutionDate, shared by /donations/recurring and the deprecated
 * /stream/schedules surface.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

const RecurringDonationService = require('../../src/services/RecurringDonationService');
const { RecurringDonationScheduler } = require('../../src/services/RecurringDonationScheduler');
const { deprecated, DEPRECATION_SUNSET } = require('../../src/middleware/deprecation');

const { RecurringScheduleError, CODES, computeNextExecutionDate } = RecurringDonationService;

describe('RecurringDonationService (#2113)', () => {
  describe('computeNextExecutionDate', () => {
    const from = new Date('2026-01-31T10:00:00.000Z');

    it('delegates to RecurringDonationScheduler.calculateNextExecution', () => {
      const spy = jest.spyOn(RecurringDonationScheduler, 'calculateNextExecution');
      computeNextExecutionDate('weekly', null, from);
      expect(spy).toHaveBeenCalledWith(from, 'weekly', undefined);
      spy.mockRestore();
    });

    it('matches the scheduler instance method for every frequency', () => {
      const scheduler = new RecurringDonationScheduler({ sendPayment: async () => {} });
      for (const freq of ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly']) {
        expect(computeNextExecutionDate(freq, null, from).toISOString())
          .toBe(scheduler.calculateNextExecutionDate(from, freq).toISOString());
      }
      expect(computeNextExecutionDate('custom', 10, from).toISOString()).toBe('2026-02-10T10:00:00.000Z');
    });

    it('uses calendar-aware monthly maths (Jan 31 -> Feb 28)', () => {
      expect(computeNextExecutionDate('monthly', null, from).toISOString()).toBe('2026-02-28T10:00:00.000Z');
    });
  });

  describe('create validation', () => {
    const base = {
      donorPublicKey: 'GDONOR',
      recipientPublicKey: 'GRECIPIENT',
      amount: 10,
      frequency: 'weekly',
    };

    async function expectCode(input, code) {
      await expect(RecurringDonationService.create(input)).rejects.toMatchObject({ code });
    }

    it('reports missing fields', () => expectCode({ amount: 1 }, CODES.MISSING_FIELDS));
    it('rejects an invalid amount', () => expectCode({ ...base, amount: -1 }, CODES.INVALID_AMOUNT));
    it('rejects an unknown frequency', () => expectCode({ ...base, frequency: 'hourly' }, CODES.INVALID_FREQUENCY));
    it('requires intervalDays for custom', () => expectCode({ ...base, frequency: 'custom' }, CODES.INVALID_INTERVAL));
    it('rejects a past startDate', () => expectCode({ ...base, startDate: '2000-01-01' }, CODES.INVALID_START_DATE));

    it('throws RecurringScheduleError instances', async () => {
      await expect(RecurringDonationService.create({})).rejects.toBeInstanceOf(RecurringScheduleError);
    });
  });

  describe('routers', () => {
    const SRC = path.join(__dirname, '..', '..', 'src', 'routes');

    it.each(['stream.js', 'recurringDonation.js'])('%s delegates create/update to the service', (file) => {
      const source = fs.readFileSync(path.join(SRC, file), 'utf8');
      expect(source).toMatch(/RecurringDonationService\.create\(/);
      expect(source).toMatch(/RecurringDonationService\.update\(/);
      expect(source).not.toMatch(/nextExecutionDate\.set(Date|Month)\(/);
    });
  });

  describe('deprecated stream paths', () => {
    it('advertise Deprecation, Sunset and successor Link headers', async () => {
      const app = express();
      app.use('/schedules', deprecated((req) => `/api/v1/donations/recurring${req.path === '/' ? '' : req.path}`));
      app.get('/schedules/:id', (req, res) => res.json({ ok: true }));

      const res = await request(app).get('/schedules/5');
      expect(res.headers.deprecation).toBe('true');
      expect(res.headers.sunset).toBe(DEPRECATION_SUNSET);
      expect(res.headers.link).toBe('</api/v1/donations/recurring/5>; rel="successor-version"');
    });
  });
});
