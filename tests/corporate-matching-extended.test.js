'use strict';

const request = require('supertest');
const app = require('../src/routes/app');
const { matchingService } = require('../src/routes/corporateMatching');

// Reset service state before each test
beforeEach(() => {
  matchingService.employers.clear();
  matchingService.claims.clear();
});

// ─── Helper ───────────────────────────────────────────────────────────────────

function addEmployer(overrides = {}) {
  return request(app)
    .post('/admin/corporate-matching/employers')
    .send({ employerId: 'acme', name: 'Acme Corp', matchRatio: 2, annualCap: 1000, ...overrides });
}

// ─── Employer Allowlist ───────────────────────────────────────────────────────

describe('POST /admin/corporate-matching/employers', () => {
  it('adds an employer with valid data', async () => {
    const res = await addEmployer();
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ employerId: 'acme', matchRatio: 2, annualCap: 1000 });
  });

  it('rejects missing employerId', async () => {
    const res = await addEmployer({ employerId: '' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('rejects invalid matchRatio', async () => {
    const res = await addEmployer({ matchRatio: 5 });
    expect(res.status).toBe(400);
  });

  it('rejects non-positive annualCap', async () => {
    const res = await addEmployer({ annualCap: 0 });
    expect(res.status).toBe(400);
  });

  it('overwrites an existing employer', async () => {
    await addEmployer();
    const res = await addEmployer({ matchRatio: 3, annualCap: 2000 });
    expect(res.status).toBe(201);
    expect(res.body.data.matchRatio).toBe(3);
  });
});

describe('GET /admin/corporate-matching/employers', () => {
  it('returns empty list initially', async () => {
    const res = await request(app).get('/admin/corporate-matching/employers');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('lists added employers', async () => {
    await addEmployer();
    const res = await request(app).get('/admin/corporate-matching/employers');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].employerId).toBe('acme');
  });
});

// ─── Claim Submission ─────────────────────────────────────────────────────────

describe('POST /corporate-matching/claim', () => {
  beforeEach(async () => { await addEmployer(); });

  it('submits a valid claim', async () => {
    const res = await request(app)
      .post('/corporate-matching/claim')
      .send({ donorId: 'donor1', employerId: 'acme', donationAmount: 100 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      donorId: 'donor1',
      employerId: 'acme',
      donationAmount: 100,
      matchAmount: 200,   // 2:1 ratio
      status: 'pending',
    });
  });

  it('rejects unknown employer', async () => {
    const res = await request(app)
      .post('/corporate-matching/claim')
      .send({ donorId: 'donor1', employerId: 'unknown', donationAmount: 50 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/allowlist/i);
  });

  it('rejects missing donorId', async () => {
    const res = await request(app)
      .post('/corporate-matching/claim')
      .send({ employerId: 'acme', donationAmount: 50 });
    expect(res.status).toBe(400);
  });

  it('rejects non-positive donationAmount', async () => {
    const res = await request(app)
      .post('/corporate-matching/claim')
      .send({ donorId: 'donor1', employerId: 'acme', donationAmount: 0 });
    expect(res.status).toBe(400);
  });

  it('caps matchAmount to remaining annual cap', async () => {
    // annualCap=1000, ratio=2 → max donation before cap = 500
    const res = await request(app)
      .post('/corporate-matching/claim')
      .send({ donorId: 'donor1', employerId: 'acme', donationAmount: 600 });
    expect(res.status).toBe(201);
    expect(res.body.data.matchAmount).toBe(1000); // capped at annualCap
  });

  it('rejects claim when annual cap is fully exhausted', async () => {
    // Manually inject an approved claim that fills the cap
    matchingService.claims.set('existing', {
      id: 'existing',
      donorId: 'donor1',
      employerId: 'acme',
      donationAmount: 500,
      matchAmount: 1000,
      status: 'approved',
      createdAt: new Date().toISOString(),
    });

    const res = await request(app)
      .post('/corporate-matching/claim')
      .send({ donorId: 'donor1', employerId: 'acme', donationAmount: 10 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/annual cap/i);
  });
});

// ─── Admin: List Claims ───────────────────────────────────────────────────────

describe('GET /admin/corporate-matching/claims', () => {
  beforeEach(async () => {
    await addEmployer();
    await request(app)
      .post('/corporate-matching/claim')
      .send({ donorId: 'donor1', employerId: 'acme', donationAmount: 50 });
  });

  it('lists all claims', async () => {
    const res = await request(app).get('/admin/corporate-matching/claims');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('filters by status=pending', async () => {
    const res = await request(app).get('/admin/corporate-matching/claims?status=pending');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe('pending');
  });

  it('returns empty when filtering by approved with no approved claims', async () => {
    const res = await request(app).get('/admin/corporate-matching/claims?status=approved');
    expect(res.body.data).toHaveLength(0);
  });
});

// ─── Admin: Approve Claim ─────────────────────────────────────────────────────

describe('POST /admin/corporate-matching/claims/:id/approve', () => {
  let claimId;

  beforeEach(async () => {
    await addEmployer();
    const claimRes = await request(app)
      .post('/corporate-matching/claim')
      .send({ donorId: 'donor1', employerId: 'acme', donationAmount: 50 });
    claimId = claimRes.body.data.id;
  });

  it('approves a pending claim and returns txId', async () => {
    const res = await request(app)
      .post(`/admin/corporate-matching/claims/${claimId}/approve`)
      .send({ sourcePublicKey: 'GACME123', donorPublicKey: 'GDONOR456' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
    expect(res.body.data.txId).toBeTruthy();
    expect(res.body.data.reviewedAt).toBeTruthy();
  });

  it('returns 404 for unknown claim', async () => {
    const res = await request(app)
      .post('/admin/corporate-matching/claims/nonexistent/approve')
      .send({ sourcePublicKey: 'G1', donorPublicKey: 'G2' });
    expect(res.status).toBe(404);
  });

  it('rejects double-approval', async () => {
    await request(app)
      .post(`/admin/corporate-matching/claims/${claimId}/approve`)
      .send({ sourcePublicKey: 'G1', donorPublicKey: 'G2' });

    const res = await request(app)
      .post(`/admin/corporate-matching/claims/${claimId}/approve`)
      .send({ sourcePublicKey: 'G1', donorPublicKey: 'G2' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already approved/i);
  });

  it('enforces annual cap at approval time', async () => {
    // Fill the cap with an already-approved claim
    matchingService.claims.set('pre', {
      id: 'pre',
      donorId: 'donor1',
      employerId: 'acme',
      donationAmount: 500,
      matchAmount: 1000,
      status: 'approved',
      createdAt: new Date().toISOString(),
    });

    const res = await request(app)
      .post(`/admin/corporate-matching/claims/${claimId}/approve`)
      .send({ sourcePublicKey: 'G1', donorPublicKey: 'G2' });
    expect(res.status).toBe(200);
    // Should be auto-rejected due to cap
    expect(res.body.data.status).toBe('rejected');
    expect(res.body.data.rejectReason).toMatch(/cap/i);
  });
});

// ─── Admin: Reject Claim ──────────────────────────────────────────────────────

describe('POST /admin/corporate-matching/claims/:id/reject', () => {
  let claimId;

  beforeEach(async () => {
    await addEmployer();
    const claimRes = await request(app)
      .post('/corporate-matching/claim')
      .send({ donorId: 'donor1', employerId: 'acme', donationAmount: 50 });
    claimId = claimRes.body.data.id;
  });

  it('rejects a pending claim', async () => {
    const res = await request(app)
      .post(`/admin/corporate-matching/claims/${claimId}/reject`)
      .send({ reason: 'Employment not verified' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('rejected');
    expect(res.body.data.rejectReason).toBe('Employment not verified');
  });

  it('rejects without a reason', async () => {
    const res = await request(app)
      .post(`/admin/corporate-matching/claims/${claimId}/reject`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('rejected');
  });

  it('returns 404 for unknown claim', async () => {
    const res = await request(app)
      .post('/admin/corporate-matching/claims/bad-id/reject')
      .send({});
    expect(res.status).toBe(404);
  });

  it('cannot reject an already-rejected claim', async () => {
    await request(app).post(`/admin/corporate-matching/claims/${claimId}/reject`).send({});
    const res = await request(app).post(`/admin/corporate-matching/claims/${claimId}/reject`).send({});
    expect(res.status).toBe(400);
  });
});

// ─── Service Unit Tests ───────────────────────────────────────────────────────

describe('CorporateMatchingService unit', () => {
  const CorporateMatchingService = require('../src/services/CorporateMatchingService');

  it('1:1 ratio computes correct matchAmount', () => {
    const svc = new CorporateMatchingService();
    svc.addEmployer('e1', 'E1', 1, 500);
    const claim = svc.submitClaim('d1', 'e1', 100);
    expect(claim.matchAmount).toBe(100);
  });

  it('3:1 ratio computes correct matchAmount', () => {
    const svc = new CorporateMatchingService();
    svc.addEmployer('e1', 'E1', 3, 10000);
    const claim = svc.submitClaim('d1', 'e1', 100);
    expect(claim.matchAmount).toBe(300);
  });

  it('getYearlyMatchedAmount only counts current year', () => {
    const svc = new CorporateMatchingService();
    svc.addEmployer('e1', 'E1', 1, 5000);
    // Inject a past-year approved claim
    svc.claims.set('old', {
      id: 'old', donorId: 'd1', employerId: 'e1',
      donationAmount: 100, matchAmount: 100,
      status: 'approved',
      createdAt: '2020-06-01T00:00:00.000Z',
    });
    expect(svc.getYearlyMatchedAmount('d1', 'e1')).toBe(0);
  });

  it('approveClaim without stellarService sets txId to null', async () => {
    const svc = new CorporateMatchingService(null);
    svc.addEmployer('e1', 'E1', 1, 500);
    const claim = svc.submitClaim('d1', 'e1', 50);
    const approved = await svc.approveClaim(claim.id, 'G1', 'G2');
    expect(approved.status).toBe('approved');
    expect(approved.txId).toBeNull();
  });

  it('throws on rejectClaim for non-existent claim', () => {
    const svc = new CorporateMatchingService();
    expect(() => svc.rejectClaim('nope')).toThrow(/not found/i);
  });
});
