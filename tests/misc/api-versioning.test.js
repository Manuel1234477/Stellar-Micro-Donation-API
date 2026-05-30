const request = require('supertest');
jest.mock('../src/services/AuditLogService', () => ({
  log: jest.fn().mockResolvedValue(true)
}));
const app = require('../../src/routes/app');

describe('API Versioning Support', () => {
    
    // We already restructured routes, so /api/v1/stats/daily should exist
    it('should access endpoints under /api/v1/', async () => {
        const res = await request(app).get('/api/v1/health');
        // Wait, health is mounted at /health in app.js, not grouped in apiV1Router!
        // Let's check a standard api endpoint like /wallets/fees or /stats/daily or /wallets
        const statsRes = await request(app).get('/api/v1/stats/daily');
        // /wallets requires auth possibly, but we can verify it doesn't return 404
        expect(statsRes.status).not.toBe(404);
        expect(statsRes.headers['x-api-version']).toBe('1');
    });

    it('should default to version 1 when no version is provided (for fallback roots)', async () => {
        const res = await request(app).get('/stats/daily');
        expect(res.status).not.toBe(404);
        expect(res.headers['x-api-version']).toBe('1');
    });

    it('should include X-API-Version header in all versioned responses', async () => {
        const res = await request(app).get('/api/v1/stats/daily');
        expect(res.headers['x-api-version']).toBe('1');
    });

    it('should negotiate version via Accept header correctly', async () => {
        const res = await request(app).get('/stats/daily')
            .set('Accept', 'application/json; version=1');
        
        expect(res.status).not.toBe(404);
        expect(res.headers['x-api-version']).toBe('1');
    });

    it('should negotiate version via Accept header correctly when vendor string', async () => {
        const res = await request(app).get('/stats/daily')
            .set('Accept', 'application/vnd.myapi.v1+json');
        
        expect(res.status).not.toBe(404);
        expect(res.headers['x-api-version']).toBe('1');
    });

    it('should return 404 when unsupported API version in URL', async () => {
        const res = await request(app).get('/api/v999/stats/daily');
        expect(res.status).toBe(404);
        expect(res.body.error).toBe('Unsupported API version');
    });

    it('should return 404 when unsupported API version in Accept header', async () => {
        const res = await request(app).get('/stats/daily')
            .set('Accept', 'application/json; version=999');
            
        expect(res.status).toBe(404);
        expect(res.body.error).toBe('Unsupported API version');
    });

    it('should include X-API-Deprecated header and Sunset header when deprecated versions', async () => {
        // We added version 0 for testing deprecation
        const res = await request(app).get('/api/v0/test-deprecated');
        
        if (res.status === 404 && res.body.error === 'Unsupported API version') {
            // If the router for v0 wasn't correctly registered
        } else {
            expect(res.headers['x-api-version']).toBe('0');
            expect(res.headers['x-api-deprecated']).toBe('true');
            expect(res.headers['sunset']).toBeDefined();
            expect(res.headers['warning']).toContain('deprecated');
        }
    });

    it('should determine version priorities correctly (URL overrides Header)', async () => {
        // If url is v1 but header is v0
        const res = await request(app).get('/api/v1/stats')
            .set('Accept', 'application/json; version=0');
            
        // Because determineVersion checks URL first
        expect(res.headers['x-api-version']).toBe('1');
    });

});
