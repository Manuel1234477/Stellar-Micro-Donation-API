/**
 * Tests localisation of buildErrorResponse (src/utils/validationErrorFormatter.js).
 * Confirms locale is honoured, unsupported locales fall back to English, and
 * q-factor negotiation via a request object works.
 */

const { buildErrorResponse, formatError } = require('../../src/utils/validationErrorFormatter');

describe('validationErrorFormatter i18n', () => {
  test('defaults to English when no lang is given', () => {
    const { errors } = buildErrorResponse([{ code: 'MISSING_AMOUNT' }]);
    expect(errors[0].message).toBe('amount is required');
  });

  test('localises when a supported lang string is passed', () => {
    const { errors } = buildErrorResponse([{ code: 'MISSING_AMOUNT' }], 'es');
    expect(errors[0].message).toBe('el monto es obligatorio');
  });

  test('falls back to English for an unsupported locale', () => {
    const { errors } = buildErrorResponse([{ code: 'MISSING_AMOUNT' }], 'de');
    expect(errors[0].message).toBe('amount is required');
  });

  test('derives locale from a request object, respecting q-values', () => {
    const req = { headers: { 'accept-language': 'de;q=0.9, fr;q=0.8, en;q=0.5' } };
    const { errors } = buildErrorResponse([{ code: 'MISSING_RECIPIENT' }], req);
    expect(errors[0].message).toBe('le destinataire est requis');
  });

  test('formatError accepts an explicit lang and keeps other fields intact', () => {
    const err = formatError('MISSING_ADDRESS', undefined, {}, 'pt');
    expect(err.message).toBe('o endereço é obrigatório');
    expect(err.field).toBe('address');
    expect(err.code).toBe('MISSING_ADDRESS');
  });
});
