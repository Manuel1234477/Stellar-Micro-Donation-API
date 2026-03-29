/**
 * Tests: Fee Installment Payments
 *
 * Covers:
 *  - Creating a fee record for a student
 *  - Recording multiple installment payments
 *  - Correct outstanding balance calculation after each payment
 *  - Full payment marks fee as paid
 *  - Overpayment rejection (422)
 *  - Validation errors for bad inputs
 *  - GET fee with payment history
 *  - GET fees by student
 *  - Auth: admin-only fee creation
 */

const request = require('supertest');
const app = require('../../src/routes/app');
const FeeService = require('../../src/services/FeeService');
const Database = require('../../src/utils/database');

const ADMIN_KEY = 'admin-test-key';
const USER_KEY = 'test-key-1';

afterEach(async () => {
  await Database.run('DELETE FROM fee_payments');
  await Database.run('DELETE FROM student_fees');
});

// ─── FeeService unit tests ────────────────────────────────────────────────────

describe('FeeService.createFee', () => {
  test('creates a fee with correct initial balance', async () => {
    const fee = await FeeService.createFee('student-1', 'Term 1 Tuition', 500);
    expect(fee.studentId).toBe('student-1');
    expect(fee.totalAmount).toBe(500);
    expect(fee.paidAmount).toBe(0);
    expect(fee.remainingBalance).toBe(500);
    expect(fee.isPaid).toBe(false);
    expect(fee.id).toBeDefined();
  });

  test('rejects missing studentId', async () => {
    await expect(FeeService.createFee('', 'Tuition', 100)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  test('rejects missing description', async () => {
    await expect(FeeService.createFee('s1', '', 100)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  test('rejects zero totalAmount', async () => {
    await expect(FeeService.createFee('s1', 'Tuition', 0)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  test('rejects negative totalAmount', async () => {
    await expect(FeeService.createFee('s1', 'Tuition', -50)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  test('rejects non-numeric totalAmount', async () => {
    await expect(FeeService.createFee('s1', 'Tuition', 'abc')).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

describe('FeeService.recordPayment', () => {
  test('records a single installment and updates balance', async () => {
    const created = await FeeService.createFee('student-2', 'Lab Fee', 300);
    const updated = await FeeService.recordPayment(created.id, 100);

    expect(updated.paidAmount).toBe(100);
    expect(updated.remainingBalance).toBe(200);
    expect(updated.isPaid).toBe(false);
  });

  test('multiple installments aggregate correctly', async () => {
    const fee = await FeeService.createFee('student-3', 'Annual Fee', 1000);

    await FeeService.recordPayment(fee.id, 300);
    await FeeService.recordPayment(fee.id, 400);
    const final = await FeeService.recordPayment(fee.id, 300);

    expect(final.paidAmount).toBe(1000);
    expect(final.remainingBalance).toBe(0);
    expect(final.isPaid).toBe(true);
  });

  test('exact final payment marks fee as paid', async () => {
    const fee = await FeeService.createFee('student-4', 'Exam Fee', 200);
    await FeeService.recordPayment(fee.id, 150);
    const result = await FeeService.recordPayment(fee.id, 50);

    expect(result.isPaid).toBe(true);
    expect(result.remainingBalance).toBe(0);
  });

  test('rejects payment exceeding outstanding balance (422)', async () => {
    const fee = await FeeService.createFee('student-5', 'Sports Fee', 100);
    await FeeService.recordPayment(fee.id, 80);

    await expect(FeeService.recordPayment(fee.id, 30)).rejects.toMatchObject({
      statusCode: 422,
      message: expect.stringContaining('outstanding balance'),
    });
  });

  test('rejects payment on fully paid fee (422)', async () => {
    const fee = await FeeService.createFee('student-6', 'Library Fee', 50);
    await FeeService.recordPayment(fee.id, 50);

    await expect(FeeService.recordPayment(fee.id, 1)).rejects.toMatchObject({
      statusCode: 422,
    });
  });

  test('rejects zero payment amount', async () => {
    const fee = await FeeService.createFee('student-7', 'Activity Fee', 100);
    await expect(FeeService.recordPayment(fee.id, 0)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  test('rejects negative payment amount', async () => {
    const fee = await FeeService.createFee('student-8', 'Activity Fee', 100);
    await expect(FeeService.recordPayment(fee.id, -10)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  test('rejects payment for non-existent fee (404)', async () => {
    await expect(FeeService.recordPayment(999999, 50)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  test('stores optional note on payment', async () => {
    const fee = await FeeService.createFee('student-9', 'Tuition', 500);
    await FeeService.recordPayment(fee.id, 100, 'First installment');

    const full = await FeeService.getFee(fee.id);
    expect(full.payments[0].note).toBe('First installment');
  });
});

describe('FeeService.getFee', () => {
  test('returns fee with payment history', async () => {
    const fee = await FeeService.createFee('student-10', 'Tuition', 600);
    await FeeService.recordPayment(fee.id, 200, 'Jan');
    await FeeService.recordPayment(fee.id, 200, 'Feb');

    const result = await FeeService.getFee(fee.id);
    expect(result.payments).toHaveLength(2);
    expect(result.paidAmount).toBe(400);
    expect(result.remainingBalance).toBe(200);
  });

  test('returns empty payments array for new fee', async () => {
    const fee = await FeeService.createFee('student-11', 'Tuition', 300);
    const result = await FeeService.getFee(fee.id);
    expect(result.payments).toHaveLength(0);
  });

  test('throws 404 for non-existent fee', async () => {
    await expect(FeeService.getFee(999999)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('FeeService.getFeesForStudent', () => {
  test('returns all fees for a student', async () => {
    await FeeService.createFee('student-12', 'Term 1', 400);
    await FeeService.createFee('student-12', 'Term 2', 500);

    const fees = await FeeService.getFeesForStudent('student-12');
    expect(fees).toHaveLength(2);
  });

  test('returns empty array for student with no fees', async () => {
    const fees = await FeeService.getFeesForStudent('no-such-student');
    expect(fees).toEqual([]);
  });

  test('does not return fees for other students', async () => {
    await FeeService.createFee('student-A', 'Fee', 100);
    await FeeService.createFee('student-B', 'Fee', 200);

    const fees = await FeeService.getFeesForStudent('student-A');
    expect(fees).toHaveLength(1);
    expect(fees[0].studentId).toBe('student-A');
  });

  test('rejects empty studentId', async () => {
    await expect(FeeService.getFeesForStudent('')).rejects.toMatchObject({ statusCode: 400 });
  });
});

// ─── HTTP endpoint tests ──────────────────────────────────────────────────────

describe('POST /fees', () => {
  test('admin creates a fee — 201', async () => {
    const res = await request(app)
      .post('/fees')
      .set('x-api-key', ADMIN_KEY)
      .send({ studentId: 'stu-001', description: 'Term 1', totalAmount: 750 });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalAmount).toBe(750);
    expect(res.body.data.remainingBalance).toBe(750);
    expect(res.body.data.isPaid).toBe(false);
  });

  test('non-admin gets 403', async () => {
    const res = await request(app)
      .post('/fees')
      .set('x-api-key', USER_KEY)
      .send({ studentId: 'stu-002', description: 'Fee', totalAmount: 100 });

    expect(res.status).toBe(403);
  });

  test('unauthenticated gets 401', async () => {
    const res = await request(app)
      .post('/fees')
      .send({ studentId: 'stu-003', description: 'Fee', totalAmount: 100 });

    expect(res.status).toBe(401);
  });

  test('missing studentId returns 400', async () => {
    const res = await request(app)
      .post('/fees')
      .set('x-api-key', ADMIN_KEY)
      .send({ description: 'Fee', totalAmount: 100 });

    expect(res.status).toBe(400);
  });

  test('zero totalAmount returns 400', async () => {
    const res = await request(app)
      .post('/fees')
      .set('x-api-key', ADMIN_KEY)
      .send({ studentId: 'stu-004', description: 'Fee', totalAmount: 0 });

    expect(res.status).toBe(400);
  });
});

describe('POST /fees/:id/payments', () => {
  test('records installment and returns updated balance', async () => {
    const fee = await FeeService.createFee('stu-http-1', 'Tuition', 500);

    const res = await request(app)
      .post(`/fees/${fee.id}/payments`)
      .set('x-api-key', USER_KEY)
      .send({ amount: 200 });

    expect(res.status).toBe(200);
    expect(res.body.data.paidAmount).toBe(200);
    expect(res.body.data.remainingBalance).toBe(300);
  });

  test('multiple installments accumulate correctly', async () => {
    const fee = await FeeService.createFee('stu-http-2', 'Annual Fee', 900);

    await request(app)
      .post(`/fees/${fee.id}/payments`)
      .set('x-api-key', USER_KEY)
      .send({ amount: 300 });

    await request(app)
      .post(`/fees/${fee.id}/payments`)
      .set('x-api-key', USER_KEY)
      .send({ amount: 300 });

    const res = await request(app)
      .post(`/fees/${fee.id}/payments`)
      .set('x-api-key', USER_KEY)
      .send({ amount: 300 });

    expect(res.status).toBe(200);
    expect(res.body.data.paidAmount).toBe(900);
    expect(res.body.data.remainingBalance).toBe(0);
    expect(res.body.data.isPaid).toBe(true);
  });

  test('overpayment returns 422', async () => {
    const fee = await FeeService.createFee('stu-http-3', 'Fee', 100);

    const res = await request(app)
      .post(`/fees/${fee.id}/payments`)
      .set('x-api-key', USER_KEY)
      .send({ amount: 200 });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  test('invalid fee ID returns 400', async () => {
    const res = await request(app)
      .post('/fees/abc/payments')
      .set('x-api-key', USER_KEY)
      .send({ amount: 50 });

    expect(res.status).toBe(400);
  });

  test('non-existent fee returns 404', async () => {
    const res = await request(app)
      .post('/fees/999999/payments')
      .set('x-api-key', USER_KEY)
      .send({ amount: 50 });

    expect(res.status).toBe(404);
  });

  test('zero amount returns 400', async () => {
    const fee = await FeeService.createFee('stu-http-4', 'Fee', 100);

    const res = await request(app)
      .post(`/fees/${fee.id}/payments`)
      .set('x-api-key', USER_KEY)
      .send({ amount: 0 });

    expect(res.status).toBe(400);
  });
});

describe('GET /fees/:id', () => {
  test('returns fee with payment history', async () => {
    const fee = await FeeService.createFee('stu-get-1', 'Tuition', 600);
    await FeeService.recordPayment(fee.id, 150, 'First');
    await FeeService.recordPayment(fee.id, 150, 'Second');

    const res = await request(app)
      .get(`/fees/${fee.id}`)
      .set('x-api-key', USER_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data.paidAmount).toBe(300);
    expect(res.body.data.remainingBalance).toBe(300);
    expect(res.body.data.payments).toHaveLength(2);
  });

  test('returns 404 for non-existent fee', async () => {
    const res = await request(app)
      .get('/fees/999999')
      .set('x-api-key', USER_KEY);

    expect(res.status).toBe(404);
  });

  test('returns 400 for invalid fee ID', async () => {
    const res = await request(app)
      .get('/fees/abc')
      .set('x-api-key', USER_KEY);

    expect(res.status).toBe(400);
  });
});

describe('GET /fees/student/:studentId', () => {
  test('returns all fees for a student', async () => {
    await FeeService.createFee('stu-list-1', 'Term 1', 400);
    await FeeService.createFee('stu-list-1', 'Term 2', 500);

    const res = await request(app)
      .get('/fees/student/stu-list-1')
      .set('x-api-key', USER_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.count).toBe(2);
  });

  test('returns empty array for student with no fees', async () => {
    const res = await request(app)
      .get('/fees/student/no-such-student')
      .set('x-api-key', USER_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.count).toBe(0);
  });
});

// ─── Balance accuracy edge cases ─────────────────────────────────────────────

describe('Balance accuracy', () => {
  test('remainingBalance never goes below 0', async () => {
    const fee = await FeeService.createFee('stu-edge-1', 'Fee', 100);
    await FeeService.recordPayment(fee.id, 100);
    const result = await FeeService.getFee(fee.id);
    expect(result.remainingBalance).toBe(0);
  });

  test('partial payment leaves correct remainder', async () => {
    const fee = await FeeService.createFee('stu-edge-2', 'Fee', 1000);
    await FeeService.recordPayment(fee.id, 333);
    await FeeService.recordPayment(fee.id, 333);
    const result = await FeeService.getFee(fee.id);
    expect(result.paidAmount).toBe(666);
    expect(result.remainingBalance).toBe(334);
  });

  test('isPaid is false until fully paid', async () => {
    const fee = await FeeService.createFee('stu-edge-3', 'Fee', 200);
    const p1 = await FeeService.recordPayment(fee.id, 199);
    expect(p1.isPaid).toBe(false);
    const p2 = await FeeService.recordPayment(fee.id, 1);
    expect(p2.isPaid).toBe(true);
  });
});
