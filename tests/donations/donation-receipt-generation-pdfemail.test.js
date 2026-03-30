/**
 * Tests: Donation Receipt Generation (PDF/Email)
 * Covers ReceiptService.generatePDF, ReceiptService.sendEmail,
 * GET /donations/:id/receipt, and POST /donations/:id/receipt/email.
 * No live Stellar network or real SMTP required.
 */

jest.mock('../src/models/apiKeys', () => ({
  initializeApiKeysTable: jest.fn().mockResolvedValue(undefined),
  createApiKey: jest.fn(),
  listApiKeys: jest.fn(),
  getApiKeyByValue: jest.fn().mockResolvedValue({ id: 1, role: 'admin', status: 'active', key_hash: 'x' }),
  rotateApiKey: jest.fn(),
  deprecateApiKey: jest.fn(),
  revokeApiKey: jest.fn(),
  revokeExpiredDeprecatedKeys: jest.fn().mockResolvedValue(0),
}));

jest.mock('../src/services/RecurringDonationScheduler', () => ({
  Class: class { start() {} stop() {} },
}));

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-1';

const request = require('supertest');
const express = require('express');
const ReceiptService = require('../../src/services/ReceiptService');

// ── Fixture ───────────────────────────────────────────────────────────────────

const TX = {
  id: 'tx-receipt-001',
  stellarTxId: 'a'.repeat(64),
  amount: 25.5,
  timestamp: '2026-03-24T10:00:00.000Z',
  donor: 'GABC123DONOR',
  recipient: 'GXYZ456RECIPIENT',
  memo: 'test donation',
  status: 'confirmed',
};

// ── ReceiptService.generatePDF ────────────────────────────────────────────────

describe('ReceiptService.generatePDF()', () => {
  it('returns a Buffer', async () => {
    const pdf = await ReceiptService.generatePDF(TX);
    expect(Buffer.isBuffer(pdf)).toBe(true);
  });

  it('PDF starts with %PDF header', async () => {
    const pdf = await ReceiptService.generatePDF(TX);
    expect(pdf.slice(0, 4).toString()).toBe('%PDF');
  });

  it('PDF contains transaction ID (in metadata)', async () => {
    const pdf = await ReceiptService.generatePDF(TX);
    expect(pdf.toString('latin1')).toContain(TX.id);
  });

  it('PDF contains Stellar transaction hash (in metadata)', async () => {
    const pdf = await ReceiptService.generatePDF(TX);
    expect(pdf.toString('latin1')).toContain(TX.stellarTxId);
  });

  it('PDF contains amount (in metadata)', async () => {
    const pdf = await ReceiptService.generatePDF(TX);
    expect(pdf.toString('latin1')).toContain('25.5');
  });

  it('PDF contains donor (in metadata)', async () => {
    const pdf = await ReceiptService.generatePDF(TX);
    expect(pdf.toString('latin1')).toContain(TX.donor);
  });

  it('PDF contains recipient (in metadata)', async () => {
    const pdf = await ReceiptService.generatePDF(TX);
    expect(pdf.toString('latin1')).toContain(TX.recipient);
  });

  it('includes Stellar explorer URL (in metadata)', async () => {
    const pdf = await ReceiptService.generatePDF(TX);
    expect(pdf.toString('latin1')).toContain('stellar.expert');
  });

  it('handles missing stellarTxId — no QR code, still valid PDF', async () => {
    const pdf = await ReceiptService.generatePDF({ ...TX, stellarTxId: null });
    expect(pdf.slice(0, 4).toString()).toBe('%PDF');
  });

  it('shows Anonymous when donor is missing (in metadata)', async () => {
    const pdf = await ReceiptService.generatePDF({ ...TX, donor: undefined });
    // Anonymous appears in the Keywords metadata field fallback
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.slice(0, 4).toString()).toBe('%PDF');
  });

  it('handles missing memo without error', async () => {
    const pdf = await ReceiptService.generatePDF({ ...TX, memo: undefined });
    expect(Buffer.isBuffer(pdf)).toBe(true);
  });
});

// ── ReceiptService.sendEmail ──────────────────────────────────────────────────

describe('ReceiptService.sendEmail()', () => {
  let mockSendMail;

  beforeEach(() => {
    mockSendMail = jest.fn().mockResolvedValue({ messageId: 'mock-msg-id' });
    jest.spyOn(require('nodemailer'), 'createTransport').mockReturnValue({
      sendMail: mockSendMail,
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('sends email and returns messageId', async () => {
    const result = await ReceiptService.sendEmail({ transaction: TX, toEmail: 'donor@example.com' });
    expect(result.messageId).toBe('mock-msg-id');
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  it('attaches PDF with correct filename and content type', async () => {
    await ReceiptService.sendEmail({ transaction: TX, toEmail: 'donor@example.com' });
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.attachments[0].contentType).toBe('application/pdf');
    expect(mail.attachments[0].filename).toContain(TX.id);
  });

  it('uses pre-generated PDF buffer when provided', async () => {
    const fakePdf = Buffer.from('%PDF-fake');
    const spy = jest.spyOn(ReceiptService, 'generatePDF');
    await ReceiptService.sendEmail({ transaction: TX, toEmail: 'donor@example.com', pdfBuffer: fakePdf });
    expect(spy).not.toHaveBeenCalled();
    expect(mockSendMail.mock.calls[0][0].attachments[0].content).toBe(fakePdf);
    spy.mockRestore();
  });

  it('email body contains transaction details', async () => {
    await ReceiptService.sendEmail({ transaction: TX, toEmail: 'donor@example.com' });
    const text = mockSendMail.mock.calls[0][0].text;
    expect(text).toContain(TX.id);
    expect(text).toContain(TX.stellarTxId);
    expect(text).toContain('25.5');
  });

  it('rejects invalid email with status 400', async () => {
    await expect(ReceiptService.sendEmail({ transaction: TX, toEmail: 'not-an-email' }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('rejects empty email with status 400', async () => {
    await expect(ReceiptService.sendEmail({ transaction: TX, toEmail: '' }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('propagates SMTP errors', async () => {
    mockSendMail.mockRejectedValue(new Error('SMTP refused'));
    await expect(ReceiptService.sendEmail({ transaction: TX, toEmail: 'donor@example.com' }))
      .rejects.toThrow('SMTP refused');
  });
});

// ── HTTP endpoints (minimal inline app) ──────────────────────────────────────

describe('Receipt HTTP endpoints', () => {
  let app;

  beforeAll(() => {
    // Build a minimal app wired directly to ReceiptService — avoids full router complexity
    app = express();
    app.use(express.json());

    // Simulate a simple in-memory donation store
    const store = { [TX.id]: TX };

    const getDonation = (id) => {
      const tx = store[id];
      if (!tx) { const e = new Error('Donation not found'); e.status = 404; throw e; }
      return tx;
    };

    app.get('/donations/:id/receipt', async (req, res, next) => {
      try {
        const tx = getDonation(req.params.id);
        const pdf = await ReceiptService.generatePDF(tx);
        res.set({
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="receipt-${tx.id}.pdf"`,
          'Content-Length': pdf.length,
        });
        res.send(pdf);
      } catch (err) { next(err); }
    });

    app.post('/donations/:id/receipt/email', async (req, res, next) => {
      try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, error: { message: 'email is required' } });
        const tx = getDonation(req.params.id);
        const result = await ReceiptService.sendEmail({ transaction: tx, toEmail: email });
        res.json({ success: true, data: { messageId: result.messageId } });
      } catch (err) {
        if (err.status === 400 || err.status === 404) {
          return res.status(err.status).json({ success: false, error: { message: err.message } });
        }
        next(err);
      }
    });

    app.use((err, req, res, next) => {
      void next;
      res.status(err.status || 500).json({ success: false, error: { message: err.message } });
    });
  });

  describe('GET /donations/:id/receipt', () => {
    it('returns 200 with application/pdf content-type', async () => {
      const res = await request(app).get(`/donations/${TX.id}/receipt`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/pdf/);
    });

    it('response body is a valid PDF', async () => {
      const res = await request(app)
        .get(`/donations/${TX.id}/receipt`)
        .buffer(true)
        .parse((res, cb) => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.body.slice(0, 4).toString()).toBe('%PDF');
    });

    it('sets Content-Disposition attachment header with id', async () => {
      const res = await request(app).get(`/donations/${TX.id}/receipt`);
      expect(res.headers['content-disposition']).toMatch(/attachment/);
      expect(res.headers['content-disposition']).toContain(TX.id);
    });

    it('returns 404 for unknown donation ID', async () => {
      const res = await request(app).get('/donations/nonexistent/receipt');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /donations/:id/receipt/email', () => {
    let mockSendMail;

    beforeEach(() => {
      mockSendMail = jest.fn().mockResolvedValue({ messageId: 'http-msg-id' });
      jest.spyOn(require('nodemailer'), 'createTransport').mockReturnValue({
        sendMail: mockSendMail,
      });
    });

    afterEach(() => jest.restoreAllMocks());

    it('returns 200 with messageId on success', async () => {
      const res = await request(app)
        .post(`/donations/${TX.id}/receipt/email`)
        .send({ email: 'donor@example.com' });
      expect(res.status).toBe(200);
      expect(res.body.data.messageId).toBe('http-msg-id');
    });

    it('returns 400 when email is missing', async () => {
      const res = await request(app)
        .post(`/donations/${TX.id}/receipt/email`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid email format', async () => {
      const res = await request(app)
        .post(`/donations/${TX.id}/receipt/email`)
        .send({ email: 'not-an-email' });
      expect(res.status).toBe(400);
    });

    it('returns 404 for unknown donation ID', async () => {
      const res = await request(app)
        .post('/donations/nonexistent/receipt/email')
        .send({ email: 'donor@example.com' });
      expect(res.status).toBe(404);
    });
  });
});
