process.env.MOCK_STELLAR = 'true';

jest.mock('../src/utils/database', () => ({
  run: jest.fn(),
  get: jest.fn(),
  all: jest.fn(),
}));

jest.mock('fs/promises', () => ({
  mkdir: jest.fn(),
  writeFile: jest.fn(),
  unlink: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const db = require('../src/utils/database');
const fs = require('fs/promises');
const ExportService = require('../src/services/ExportService');
const { NotFoundError, ValidationError, ERROR_CODES } = require('../src/utils/errors');

describe('ExportService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each([
    ['donations', 'csv'],
    ['donations', 'json'],
    ['wallets', 'csv'],
    ['wallets', 'json'],
    ['audit_logs', 'csv'],
    ['audit_logs', 'json'],
  ])('initiates %s %s export successfully', async (type, format) => {
    db.run.mockResolvedValueOnce({ id: 99 }); // ensureStorage CREATE TABLE
    db.run.mockResolvedValueOnce({ id: 123 }); // INSERT export_jobs
    const spy = jest.spyOn(ExportService, 'generateExport').mockResolvedValueOnce();
    const setImmediateSpy = jest.spyOn(global, 'setImmediate').mockImplementation(() => 0);

    const exportId = await ExportService.initiateExport({
      type,
      format,
      dateRange: { startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-02-01T00:00:00.000Z' },
      requestedBy: 'apikey-1',
    });

    expect(exportId).toBe(123);
    expect(db.run).toHaveBeenCalledTimes(2);
    expect(spy).not.toHaveBeenCalled();
    setImmediateSpy.mockRestore();
    spy.mockRestore();
  });

  test('generateExport completes and stores CSV with headers/rows', async () => {
    db.run.mockResolvedValue({ id: 1 });
    db.get.mockResolvedValueOnce({
      id: 7,
      type: 'donations',
      format: 'csv',
      status: 'pending',
      dateStart: '2026-01-01T00:00:00.000Z',
      dateEnd: '2026-01-31T23:59:59.999Z',
    });
    db.all.mockResolvedValueOnce([
      { id: 10, amount: 2.5, memo: 'first', timestamp: '2026-01-02T00:00:00.000Z' },
      { id: 11, amount: 5, memo: 'second', timestamp: '2026-01-03T00:00:00.000Z' },
    ]);

    await ExportService.generateExport(7);

    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    const csvPayload = fs.writeFile.mock.calls[0][1];
    expect(csvPayload).toContain('id,amount,memo,timestamp');
    expect(csvPayload).toContain('10,2.5,first,2026-01-02T00:00:00.000Z');
    expect(csvPayload).toContain('11,5,second,2026-01-03T00:00:00.000Z');
    expect(db.run).toHaveBeenLastCalledWith(
      expect.stringContaining("SET status = 'completed'"),
      expect.arrayContaining([expect.any(String), expect.any(String), expect.any(String), expect.any(String), 7])
    );
  });

  test('generateExport completes and stores valid JSON output', async () => {
    db.run.mockResolvedValue({ id: 1 });
    db.get.mockResolvedValueOnce({
      id: 8,
      type: 'wallets',
      format: 'json',
      status: 'pending',
      dateStart: null,
      dateEnd: null,
    });
    db.all.mockResolvedValueOnce([
      { id: 1, publicKey: 'GABC', createdAt: '2026-01-01T00:00:00.000Z' },
    ]);

    await ExportService.generateExport(8);

    const jsonPayload = fs.writeFile.mock.calls[0][1];
    const parsed = JSON.parse(jsonPayload);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toMatchObject({ id: 1, publicKey: 'GABC' });
  });

  test('getExportStatus returns current status record', async () => {
    db.run.mockResolvedValue({ id: 1 });
    db.get.mockResolvedValueOnce({
      id: 5,
      status: 'pending',
      type: 'audit_logs',
      format: 'json',
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: null,
      downloadUrl: null,
    });

    const status = await ExportService.getExportStatus(5);
    expect(status.status).toBe('pending');
    expect(status.type).toBe('audit_logs');
  });

  test('getSignedDownloadUrl returns signed URL for completed export', async () => {
    db.run.mockResolvedValue({ id: 1 });
    db.get.mockResolvedValueOnce({ id: 6, status: 'completed' });

    const url = await ExportService.getSignedDownloadUrl(6);
    expect(url).toContain('/exports/6/download?expires=');
    expect(url).toContain('signature=');
  });

  test('getSignedDownloadUrl rejects pending export', async () => {
    db.run.mockResolvedValue({ id: 1 });
    db.get.mockResolvedValueOnce({ id: 6, status: 'pending' });
    await expect(ExportService.getSignedDownloadUrl(6)).rejects.toBeInstanceOf(ValidationError);
  });

  test('getSignedDownloadUrl rejects unknown export ID', async () => {
    db.run.mockResolvedValue({ id: 1 });
    db.get.mockResolvedValueOnce(undefined);
    await expect(ExportService.getSignedDownloadUrl(404)).rejects.toBeInstanceOf(NotFoundError);
  });

  test('generateExport marks failed on errors', async () => {
    db.run.mockResolvedValue({ id: 1 });
    db.get.mockResolvedValueOnce({ id: 9, type: 'donations', format: 'csv', status: 'pending' });
    db.all.mockRejectedValueOnce(new Error('query failed'));

    await expect(ExportService.generateExport(9)).rejects.toThrow('query failed');
    expect(db.run).toHaveBeenLastCalledWith(
      expect.stringContaining("SET status = 'failed'"),
      [expect.any(String), expect.any(String), 9]
    );
  });

  test('deleteExpiredExports removes only expired jobs and files', async () => {
    db.run.mockResolvedValue({ id: 1 });
    db.all.mockResolvedValueOnce([
      { id: 1, filePath: '/tmp/old-a.csv' },
      { id: 2, filePath: '/tmp/old-b.json' },
    ]);
    db.run.mockResolvedValueOnce({ changes: 2 });

    const deleted = await ExportService.deleteExpiredExports();
    expect(deleted).toBe(2);
    expect(fs.unlink).toHaveBeenCalledTimes(2);
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM export_jobs WHERE id IN'), [1, 2]);
  });

  test('deleteExpiredExports ignores missing files', async () => {
    db.run.mockResolvedValue({ id: 1 });
    db.all.mockResolvedValueOnce([{ id: 3, filePath: '/tmp/missing.csv' }]);
    fs.unlink.mockRejectedValueOnce({ code: 'ENOENT' });
    db.run.mockResolvedValueOnce({ changes: 1 });

    const deleted = await ExportService.deleteExpiredExports();
    expect(deleted).toBe(1);
  });

  test('signed URL expiry is one hour', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-25T00:00:00.000Z'));
    db.run.mockResolvedValue({ id: 1 });
    db.get.mockResolvedValueOnce({ id: 12, status: 'completed' });

    const url = await ExportService.getSignedDownloadUrl(12);
    const parsed = new URL(url);
    const expires = Number(parsed.searchParams.get('expires'));
    expect(expires).toBe(Date.parse('2026-03-25T01:00:00.000Z'));
    jest.useRealTimers();
  });
});

describe('Export routes', () => {
  let app;
  let service;

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../src/middleware/apiKey', () => (req, _res, next) => {
      req.user = { id: 'apikey-1', role: 'user' };
      next();
    });
    service = {
      initiateExport: jest.fn(),
      getExportStatus: jest.fn(),
      getSignedDownloadUrl: jest.fn(),
    };
    jest.doMock('../src/services/ExportService', () => service);

    const router = require('../src/routes/exports');
    app = express();
    app.use(express.json());
    app.use('/exports', router);
    app.use((err, req, res, next) => {
      void req; void next;
      res.status(err.statusCode || 500).json({ success: false, error: { message: err.message } });
    });
  });

  test('POST /exports returns pending response', async () => {
    service.initiateExport.mockResolvedValueOnce(101);

    const res = await request(app).post('/exports').send({ type: 'donations', format: 'csv' });
    expect(res.status).toBe(202);
    expect(res.body.data).toEqual({ exportId: 101, status: 'pending' });
  });

  test('POST /exports validates bad type/format/dates', async () => {
    const badType = await request(app).post('/exports').send({ type: 'bad', format: 'csv' });
    const badFormat = await request(app).post('/exports').send({ type: 'donations', format: 'xml' });
    const badDates = await request(app).post('/exports').send({
      type: 'donations',
      format: 'csv',
      startDate: '2026-02-02T00:00:00.000Z',
      endDate: '2026-01-01T00:00:00.000Z',
    });
    expect(badType.status).toBe(400);
    expect(badFormat.status).toBe(400);
    expect(badDates.status).toBe(400);
  });

  test('GET /exports/:id returns status at each stage', async () => {
    service.getExportStatus
      .mockResolvedValueOnce({ id: 1, status: 'pending' })
      .mockResolvedValueOnce({ id: 1, status: 'completed', downloadUrl: 'http://example.com/file' });

    const pending = await request(app).get('/exports/1');
    const done = await request(app).get('/exports/1');

    expect(pending.status).toBe(200);
    expect(pending.body.data.status).toBe('pending');
    expect(done.body.data.status).toBe('completed');
  });

  test('GET /exports/:id returns 404 for unknown IDs', async () => {
    service.getExportStatus.mockRejectedValueOnce(new NotFoundError('Export job not found', ERROR_CODES.NOT_FOUND));
    const res = await request(app).get('/exports/9999');
    expect(res.status).toBe(404);
  });

  test('GET /exports/:id/download returns signed URL when completed', async () => {
    service.getSignedDownloadUrl.mockResolvedValueOnce('http://example.com/signed');
    const res = await request(app).get('/exports/2/download');
    expect(res.status).toBe(200);
    expect(res.body.data.downloadUrl).toBe('http://example.com/signed');
  });

  test('GET /exports/:id/download returns 400 when pending', async () => {
    service.getSignedDownloadUrl.mockRejectedValueOnce(
      new ValidationError('Export is not ready for download', null, ERROR_CODES.INVALID_REQUEST)
    );
    const res = await request(app).get('/exports/2/download');
    expect(res.status).toBe(400);
  });

  test('GET /exports/:id/download returns 404 for unknown export IDs', async () => {
    service.getSignedDownloadUrl.mockRejectedValueOnce(
      new NotFoundError('Export job not found', ERROR_CODES.NOT_FOUND)
    );
    const res = await request(app).get('/exports/404/download');
    expect(res.status).toBe(404);
  });
});
