const request = require('supertest');
const app = require('../../src/routes/app');
const Transaction = require('../../src/routes/models/transaction');
const StellarSdk = require('stellar-sdk');

describe('Stellar XDR Inspection (Task #423)', () => {
    let testTransaction;

    beforeAll(async () => {
        // Create a mock transaction in the system
        testTransaction = Transaction.create({
            donor: 'GD...',
            recipient: 'GB...',
            amount: 100,
            status: 'completed',
            stellarTxId: 'abc123...',
            envelopeXdr: 'AAAAAgAAAACV+l3XvX+6Xv8A...' // A valid-looking Base64 (may need the real one to parse)
        });
    });

    afterAll(async () => {
        Transaction._clearAllData();
    });

    describe('POST /tools/decode-transaction', () => {
        it('should decode a valid Stellar payment transaction envelope when xdr is provided', async () => {
            // Generate a real XDR to test decoding
            const pair = StellarSdk.Keypair.random();
            const tx = new StellarSdk.TransactionBuilder(
                new StellarSdk.Account(pair.publicKey(), '100'),
                { fee: '100', networkPassphrase: StellarSdk.Networks.TESTNET }
            )
            .addOperation(StellarSdk.Operation.payment({
                destination: StellarSdk.Keypair.random().publicKey(),
                asset: StellarSdk.Asset.native(),
                amount: '10.5'
            }))
            .setTimeout(30)
            .build();
            
            tx.sign(pair);
            const xdr = tx.toEnvelope().toXDR('base64');

            const res = await request(app)
                .post('/tools/decode-transaction')
                .send({ xdr });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.sourceAccount).toBe(pair.publicKey());
            expect(res.body.data.operations).toHaveLength(1);
            expect(res.body.data.operations[0].type).toBe('payment');
            expect(res.body.data.operations[0].details.amount).toBe('10.5');
            expect(res.body.data.signatures).toHaveLength(1);
        });

        it('should return error 400 when xdr is missing', async () => {
            const res = await request(app)
                .post('/tools/decode-transaction')
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('should return error 400 when invalid XDR is provided', async () => {
            const res = await request(app)
                .post('/tools/decode-transaction')
                .send({ xdr: 'INVALID_BASE64' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('INVALID_XDR');
        });
    });

    describe('GET /transactions/:id/envelope', () => {
        it('should retrieve stored envelope XDR when transaction exists', async () => {
            const res = await request(app)
                .get(`/transactions/${testTransaction.id}/envelope`)
                .set('X-Api-Key', 'test-api-key'); // Assuming middleware logic allows "test-api-key"

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.envelopeXdr).toBe(testTransaction.envelopeXdr);
        });

        it('should return 404 when transaction ID is unknown', async () => {
            const res = await request(app)
                .get('/transactions/unknown-id/envelope')
                .set('X-Api-Key', 'test-api-key');

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('TRANSACTION_NOT_FOUND');
        });

        it('should return 404 when transaction has no stored envelope', async () => {
            const txNoXdr = Transaction.create({ donor: 'GD...', recipient: 'GB...', amount: 50 });
            
            const res = await request(app)
                .get(`/transactions/${txNoXdr.id}/envelope`)
                .set('X-Api-Key', 'test-api-key');

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('ENVELOPE_NOT_FOUND');
        });
    });
});
