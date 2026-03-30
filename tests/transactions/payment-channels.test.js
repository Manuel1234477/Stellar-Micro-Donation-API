/**
 * Payment Channels Route Integration Tests
 *
 * Covers full channel lifecycle via HTTP endpoints:
 *  - open channel
 *  - list open channels
 *  - apply off-chain updates
 *  - close channel on-chain
 *  - prevent double-closing
 */

'use strict';

process.env.MOCK_STELLAR = 'true';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../../src/routes/app');
const { issueAccessToken } = require('../../src/services/JwtService');
const { buildStateMessage, signState } = require('../../src/services/PaymentChannelService');

const adminToken = `Bearer ${issueAccessToken({ sub: 'admin-user', role: 'admin' })}`;

let channel;

describe('Payment channel HTTP endpoints', () => {
  test('POST /channels/open creates a payment channel with an initial deposit', async () => {
    const response = await request(app)
      .post('/channels/open')
      .set('Authorization', adminToken)
      .send({
        senderKey: 'GSENDER_PUBLIC_KEY_ABCDE',
        receiverKey: 'GRECEIVER_PUBLIC_KEY_FGHIJ',
        capacity: 100,
        sourceSecret: 'SFAKE_SOURCE_SECRET',
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      senderKey: 'GSENDER_PUBLIC_KEY_ABCDE',
      receiverKey: 'GRECEIVER_PUBLIC_KEY_FGHIJ',
      capacity: 100,
      balance: 0,
      status: 'open',
    });
    expect(response.body.data.id).toBeDefined();
    channel = response.body.data;
  });

  test('GET /channels lists open channels by default', async () => {
    const response = await request(app)
      .get('/channels')
      .set('Authorization', adminToken);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data.some((c) => c.id === channel.id)).toBe(true);
  });

  test('POST /channels/:id/update updates off-chain balance', async () => {
    const nextSequence = channel.sequence + 1;
    const nextBalance = 10;
    const message = buildStateMessage(channel.id, nextSequence, nextBalance);
    const senderSig = signState(message, 'SENDER_SECRET_KEY');
    const receiverSig = signState(message, 'RECEIVER_SECRET_KEY');

    const response = await request(app)
      .post(`/channels/${channel.id}/update`)
      .set('Authorization', adminToken)
      .send({
        amount: nextBalance,
        senderSecret: 'SENDER_SECRET_KEY',
        receiverSecret: 'RECEIVER_SECRET_KEY',
        senderSig,
        receiverSig,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.balance).toBe(nextBalance);
    expect(response.body.data.sequence).toBe(nextSequence);
    channel = response.body.data;
  });

  test('POST /channels/:id/close settles the final balance on-chain', async () => {
    const response = await request(app)
      .post(`/channels/${channel.id}/close`)
      .set('Authorization', adminToken)
      .send({ senderSecret: 'SFAKE_SOURCE_SECRET' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('settled');
  });

  test('POST /channels/:id/close returns 409 for an already-closed channel', async () => {
    const response = await request(app)
      .post(`/channels/${channel.id}/close`)
      .set('Authorization', adminToken)
      .send({ senderSecret: 'SFAKE_SOURCE_SECRET' });

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('RESOURCE_CONFLICT');
  });
});
