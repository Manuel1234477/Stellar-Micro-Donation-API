/**
 * Tests: Donation Receipt PDF Generation & Email Delivery
 * Covers:
 *   - ReceiptService.generatePDF()
 *   - ReceiptService.sendEmail()
 *   - POST /donations/:id/receipt
 *   - GET  /donations/:id/receipt/status
 */

jest.mock('../src/models/apiKeys', () => ({
  initializeApiKeysTable: jest.fn().mockResolvedValue(undefined),
  createApiKey: jest.fn(),
  listApiKeys: jest.fn(),
  getApiKeyByValue: jest.fn().mockResolvedValue({ id: 1, role: 'admin', status: 'active', key_hash: 'x' }),
  validateApiKey: jest.fn().mockResolvedValue({ id: 1, role: 'admin', status: 'active', scopes: [] }),
  validateKey: jest.fn().mockResolvedValue({ id: 1, role: 'admin', status: 'active', scopes: [] }),
  rotateApiKey: jest.fn(),
  deprecateApiKey: jest.fn(),
  revokeApiKey: jest.fn(),
  revokeExpiredDeprecatedKeys: jest.fn().mockResolvedValue(0),
}));

jest.mock('../src/services/RecurringDonationScheduler', () => ({
  Class: class { start() {} stop() {} },
}));

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-receipt-key';

const request = require('supertest');
const express = require('express');
const ReceiptService = require('../../src/services/ReceiptService');
const Transaction = require('../../src/routes/models/transaction');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CONFIRMED_TX = {
  id: 'receipt-test-confirmed-001',
  stellarTxId: 'b'.repeat(64),
  amount: 10.0,
  timestamp: '2026-03-29T10:00:00.000Z',
  donor: 'GDONOR123',
  recipient: 'GRECIPIENT456',
  memo: 'test receipt',
  status: 'confirmed',
};

const PENDING_TX = {
  id: 'receipt-test-pending-001',
  stellarTxId: null,
  amount: 5.0,
  timestamp: '2026-03-29T11:00:00.000Z',
  donor: 'GDONOR123',
  recipient: 'GRECIPIENT456',
  memo: '',
  status: 'pending',
};

// ── ReceiptService.generatePDF ────────────────────────────────────────────────

describe('ReceiptService.generatePDF()', () => {
  it('returns a Buffer', async () => {
    const pdf = await ReceiptService.generatePDF(CONFIRMED_TX);
    expect(Buffer.isBuffer(pdf)).toBe(true);
  });

  it('PDF starts with %PDF header', async () => {
    const pdf = await ReceiptService.generatePDF(CONFIRMED_TX);
    expect(pdf.slice(0, 4).toString()).toBe('%PDF');
  });

  it('PDF metadata contains transaction ID', async () => {
    const pdf = await ReceiptService.generatePDF(CONFIRMED_TX);
    expect(pdf.toString('latin1')).toContain(CONFIRMED_TX.id);
  });

  it('PDF metadata contains Stellar transaction hash', async () => {
    const pdf = await ReceiptService.generatePDF(CONFIRMED_TX);
    expect(pdf.toString('latin1')).toContain(CONFIRMED_TX.stellarTxId);
  });

  it('PDF metadata contains amount', async () => {
    const pdf = await ReceiptService.generatePDF(CONFIRMED_TX);
    expect(pdf.toString('latin1')).toContain('10');
  });

  it('PDF metadata contains donor', async () => {
    const pdf = await ReceiptService.generatePDF(CONFIRMED_TX);
    expect(pdf.toString('latin1')).toContain(CONFIRMED_TX.donor);
  });

  it('PDF metadata contains recipient', async () => {
    const pdf = await ReceiptService.generatePDF(CONFIRMED_TX);
    expect(pdf.toString('latin1')).toContain(CONFIRMED_TX.recipient);
  });

  it('PDF metadata contains Stellar explorer URL', async () => {
    const pdf = await ReceiptService.generatePDF(CONFIRMED_TX);
    expect(pdf.toString('latin1')).toContain('stellar.expert');
  });

  it('handles missing stellarTxId — still valid PDF, no QR code error', async () => {
    const pdf = await ReceiptService.generatePDF({ ...CONFIRMED_TX, stellarTxId: null });
    expect(pdf.slice(0, 4).toString()).toBe('%PDF');
  });

  it('handles missing donor — still valid PDF', async () => {
    const pdf = await ReceiptService.generatePDF({ ...CONFIRMED_TX, donor: undefined });
    expect(Buffer.isBuffer(pdf)).toBe(true);
  });

  it('handles missing memo — still valid PDF', async () => {
    const pdf = await ReceiptService.generatePDF({ ...CONFIRMED_TX, memo: undefined });
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
    const result = await ReceiptService.sendEmail({ transaction: CONFIRMED_TX, toEmail: 'donor@example.com' });
    expect(result.messageId).toBe('mock-msg-id');
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  it('attaches PDF with correct filename and content type', async () => {
    await ReceiptService.sendEmail({ transaction: CONFIRMED_TX, toEmail: 'donor@example.com' });
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.attachments[0].contentType).toBe('application/pdf');
    expect(mail.attachments[0].filename).toContain(CONFIRMED_TX.id);
  });

  it('uses pre-generated PDF buffer when provided', async () => {
    const fakePdf = Buffer.from('%PDF-fake');
    const spy = jest.spyOn(ReceiptService, 'generatePDF');
    await ReceiptService.sendEmail({ transaction: CONFIRMED_TX, toEmail: 'donor@example.com', pdfBuffer: fakePdf });
    expect(spy).not.toHaveBeenCalled();
    expect(mockSendMail.mock.calls[0][0].attachments[0].content).toBe(fakePdf);
    spy.mockRestore();
  });

  it('email body contains transaction details', async () => {
    await ReceiptService.sendEmail({ transaction: CONFIRMED_TX, toEmail: 'donor@example.com' });
    const text = mockSendMail.mock.calls[0][0].text;
    expect(text).toContain(CONFIRMED_TX.id);
    expect(text).toContain(CONFIRMED_TX.stellarTxId);
    expect(text).toContain('10');
  });

  it('rejects invalid email with status 400', async () => {
    await expect(
      ReceiptService.sendEmail({ transaction: CONFIRMED_TX, toEmail: 'not-an-email' })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects empty email with status 400', async () => {
    await expect(
      ReceiptService.sendEmail({ transaction: CONFIRMED_TX, toEmail: '' })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('propagates SMTP errors', async () => {
    mockSendMail.mockRejectedValue(new Error('SMTP connection refused'));
    await expect(
      ReceiptService.sendEmail({ transaction: CONFIRMED_TX, toEmail: 'donor@example.com' })
    ).rejects.toThrow('SMTP connection refused');
  });
});

// ── HTTP endpoints ────────────────────────────────────────────────────────────

describe('Receipt HTTP endpoints', () => {
  let app;
  let receiptRouter;
  const API_KEY = 'test-receipt-key';

  // Helper to attach API key header
  const withKey = (req) => req.set('X-API-Key', API_KEY);

  beforeAll(() => {
    // Seed in-memory transaction store
    const origGetById = Transaction.getById.bind(Transaction);
    jest.spyOn(Transaction, 'getById').mockImplementation((id) => {
      if (id === CONFIRMED_TX.id) return CONFIRMED_TX;
      if (id === PENDING_TX.id) return PENDING_TX;
      return origGetById(id);
    });

    receiptRouter = require('../../src/routes/receipt');
    receiptRouter._receiptLog.clear();

    const { attachUserRole } = require('../../src/middleware/rbac');

    app = express();
    app.use(express.json());
    // attachUserRole reads req.apiKey (set by requireApiKey) to populate req.user
    app.use(attachUserRole());
    app.use('/donations', receiptRouter);

    app.use((err, req, res, next) => {
      void next;
      res.status(err.status || err.statusCode || 500).json({
        success: false,
        error: { message: err.message, code: err.code },
      });
    });
  });

  afterAll(() => {
    // Restore Transaction.getById spy
    Transaction.getById.mockRestore && Transaction.getById.mockRestore();
  });

  // ── POST /donations/:id/receipt ──────────────────────────────────────────

  describe('POST /donations/:id/receipt', () => {
    beforeEach(() => {
      receiptRouter._receiptLog.clear();
    });

    it('returns 200 with application/pdf content-type for confirmed donation', async () => {
      const res = await withKey(request(app).post(`/donations/${CONFIRMED_TX.id}/receipt`)).send({});
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/pdf/);
    });

    it('response body is a valid PDF', async () => {
      const res = await withKey(
        request(app)
          .post(`/donations/${CONFIRMED_TX.id}/receipt`)
          .buffer(true)
          .parse((res, cb) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => cb(null, Buffer.concat(chunks)));
          })
      ).send({});
      expect(res.body.slice(0, 4).toString()).toBe('%PDF');
    });

    it('sets Content-Disposition attachment header with donation id', async () => {
      const res = await withKey(request(app).post(`/donations/${CONFIRMED_TX.id}/receipt`)).send({});
      expect(res.headers['content-disposition']).toMatch(/attachment/);
      expect(res.headers['content-disposition']).toContain(CONFIRMED_TX.id);
    });

    it('returns 400 for pending donation', async () => {
      const res = await withKey(request(app).post(`/donations/${PENDING_TX.id}/receipt`)).send({});
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/confirmed/i);
    });

    it('returns 404 for unknown donation ID', async () => {
      const res = await withKey(request(app).post('/donations/nonexistent-id/receipt')).send({});
      expect(res.status).toBe(404);
    });

    it('records receipt generation in the log', async () => {
      await withKey(request(app).post(`/donations/${CONFIRMED_TX.id}/receipt`)).send({});
      const entry = receiptRouter._receiptLog.get(CONFIRMED_TX.id);
      expect(entry).toBeDefined();
      expect(entry.generatedAt).toBeTruthy();
    });
  });

  // ── POST /donations/:id/receipt with email ───────────────────────────────

  describe('POST /donations/:id/receipt with email delivery', () => {
    let mockSendMail;
    let transporterSpy;

    beforeEach(() => {
      receiptRouter._receiptLog.clear();
      mockSendMail = jest.fn().mockResolvedValue({ messageId: 'email-msg-id' });
      transporterSpy = jest.spyOn(require('nodemailer'), 'createTransport').mockReturnValue({
        sendMail: mockSendMail,
      });
    });

    afterEach(() => {
      transporterSpy.mockRestore();
    });

    it('sends email when email field is provided', async () => {
      const res = await withKey(request(app).post(`/donations/${CONFIRMED_TX.id}/receipt`))
        .send({ email: 'donor@example.com' });
      expect(res.status).toBe(200);
      expect(mockSendMail).toHaveBeenCalledTimes(1);
    });

    it('sets X-Email-Message-Id header when email is sent', async () => {
      const res = await withKey(request(app).post(`/donations/${CONFIRMED_TX.id}/receipt`))
        .send({ email: 'donor@example.com' });
      expect(res.headers['x-email-message-id']).toBe('email-msg-id');
    });

    it('records emailedTo in the receipt log', async () => {
      await withKey(request(app).post(`/donations/${CONFIRMED_TX.id}/receipt`))
        .send({ email: 'donor@example.com' });
      const entry = receiptRouter._receiptLog.get(CONFIRMED_TX.id);
      expect(entry.emailedTo).toBe('donor@example.com');
    });

    it('returns 400 for invalid email format', async () => {
      const res = await withKey(request(app).post(`/donations/${CONFIRMED_TX.id}/receipt`))
        .send({ email: 'not-an-email' });
      expect(res.status).toBe(400);
    });

    it('does not send email when email field is absent', async () => {
      await withKey(request(app).post(`/donations/${CONFIRMED_TX.id}/receipt`)).send({});
      expect(mockSendMail).not.toHaveBeenCalled();
    });
  });

  // ── GET /donations/:id/receipt/status ────────────────────────────────────

  describe('GET /donations/:id/receipt/status', () => {
    beforeEach(() => {
      receiptRouter._receiptLog.clear();
    });

    it('returns generated: false when no receipt has been generated', async () => {
      const res = await withKey(request(app).get(`/donations/${CONFIRMED_TX.id}/receipt/status`));
      expect(res.status).toBe(200);
      expect(res.body.data.generated).toBe(false);
      expect(res.body.data.generatedAt).toBeNull();
    });

    it('returns generated: true after receipt is generated', async () => {
      await withKey(request(app).post(`/donations/${CONFIRMED_TX.id}/receipt`)).send({});
      const res = await withKey(request(app).get(`/donations/${CONFIRMED_TX.id}/receipt/status`));
      expect(res.status).toBe(200);
      expect(res.body.data.generated).toBe(true);
      expect(res.body.data.generatedAt).toBeTruthy();
    });

    it('returns emailedTo when receipt was emailed', async () => {
      const spy = jest.spyOn(require('nodemailer'), 'createTransport').mockReturnValue({
        sendMail: jest.fn().mockResolvedValue({ messageId: 'x' }),
      });
      await withKey(request(app).post(`/donations/${CONFIRMED_TX.id}/receipt`))
        .send({ email: 'donor@example.com' });
      const res = await withKey(request(app).get(`/donations/${CONFIRMED_TX.id}/receipt/status`));
      expect(res.body.data.emailedTo).toBe('donor@example.com');
      spy.mockRestore();
    });

    it('returns 404 for unknown donation ID', async () => {
      const res = await withKey(request(app).get('/donations/nonexistent-id/receipt/status'));
      expect(res.status).toBe(404);
    });

    it('returns donationId in response', async () => {
      const res = await withKey(request(app).get(`/donations/${CONFIRMED_TX.id}/receipt/status`));
      expect(res.body.data.donationId).toBe(CONFIRMED_TX.id);
    });
  });
});
