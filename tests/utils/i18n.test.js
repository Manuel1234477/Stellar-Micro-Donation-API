'use strict';

const { parseLanguage, getMessage, SUPPORTED_LANGUAGES } = require('../../src/utils/i18n');

// ---- parseLanguage ----
describe('parseLanguage', () => {
  test('returns en by default', () => {
    expect(parseLanguage(undefined)).toBe('en');
    expect(parseLanguage('')).toBe('en');
    expect(parseLanguage(null)).toBe('en');
  });

  test('detects Spanish', () => {
    expect(parseLanguage('es')).toBe('es');
    expect(parseLanguage('es-MX')).toBe('es');
    expect(parseLanguage('es-MX,es;q=0.9,en;q=0.8')).toBe('es');
  });

  test('detects French', () => {
    expect(parseLanguage('fr')).toBe('fr');
    expect(parseLanguage('fr-FR,fr;q=0.9')).toBe('fr');
  });

  test('detects Portuguese', () => {
    expect(parseLanguage('pt')).toBe('pt');
    expect(parseLanguage('pt-BR,pt;q=0.9')).toBe('pt');
  });

  test('falls back to English for unsupported language', () => {
    expect(parseLanguage('zh')).toBe('en');
    expect(parseLanguage('de,zh;q=0.9')).toBe('en');
  });

  test('respects quality factor ordering', () => {
    // en has higher q than es
    expect(parseLanguage('es;q=0.5,en;q=0.9')).toBe('en');
  });

  test('falls back to next supported language when first is unsupported', () => {
    expect(parseLanguage('zh,es;q=0.8')).toBe('es');
  });
});

// ---- getMessage ----
describe('getMessage', () => {
  const KEYS = [
    'VALIDATION_ERROR', 'INVALID_REQUEST', 'NOT_FOUND', 'UNAUTHORIZED',
    'ACCESS_DENIED', 'FORBIDDEN', 'INTERNAL_ERROR', 'DUPLICATE_ERROR',
    'RATE_LIMIT_EXCEEDED', 'ENDPOINT_NOT_FOUND',
  ];

  test('all keys have translations in all supported languages', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      for (const key of KEYS) {
        const msg = getMessage(key, lang);
        expect(msg).toBeTruthy();
        expect(typeof msg).toBe('string');
      }
    }
  });

  test('Spanish messages differ from English', () => {
    expect(getMessage('VALIDATION_ERROR', 'es')).not.toBe(getMessage('VALIDATION_ERROR', 'en'));
    expect(getMessage('NOT_FOUND', 'es')).not.toBe(getMessage('NOT_FOUND', 'en'));
  });

  test('French messages differ from English', () => {
    expect(getMessage('VALIDATION_ERROR', 'fr')).not.toBe(getMessage('VALIDATION_ERROR', 'en'));
  });

  test('Portuguese messages differ from English', () => {
    expect(getMessage('VALIDATION_ERROR', 'pt')).not.toBe(getMessage('VALIDATION_ERROR', 'en'));
  });

  test('falls back to English for unknown language', () => {
    expect(getMessage('VALIDATION_ERROR', 'zh')).toBe(getMessage('VALIDATION_ERROR', 'en'));
  });

  test('returns null for unknown key', () => {
    expect(getMessage('TOTALLY_UNKNOWN_KEY', 'en')).toBeNull();
  });
});

// ---- Content-Language header in error responses ----
describe('errorHandler Content-Language header', () => {
  const { errorHandler, notFoundHandler } = require('../../src/middleware/errorHandler');
  const { ValidationError } = require('../../src/utils/errors');

  function mockReq(acceptLanguage) {
    return {
      id: 'test-req-id',
      path: '/test',
      method: 'GET',
      ip: '127.0.0.1',
      get: () => 'test-agent',
      headers: acceptLanguage ? { 'accept-language': acceptLanguage } : {},
    };
  }

  function mockRes() {
    const headers = {};
    const res = {
      _headers: headers,
      _status: null,
      _body: null,
      set: jest.fn((k, v) => { headers[k.toLowerCase()] = v; return res; }),
      status: jest.fn((s) => { res._status = s; return res; }),
      json: jest.fn((b) => { res._body = b; return res; }),
    };
    return res;
  }

  test('sets Content-Language: es for Spanish request', () => {
    const req = mockReq('es');
    const res = mockRes();
    const err = new ValidationError('bad input');
    errorHandler(err, req, res, () => {});
    expect(res._headers['content-language']).toBe('es');
  });

  test('sets Content-Language: en by default', () => {
    const req = mockReq(undefined);
    const res = mockRes();
    const err = new ValidationError('bad input');
    errorHandler(err, req, res, () => {});
    expect(res._headers['content-language']).toBe('en');
  });

  test('translates AppError message to French', () => {
    const req = mockReq('fr');
    const res = mockRes();
    const err = new ValidationError('bad input');
    errorHandler(err, req, res, () => {});
    expect(res._body.error.message).toBe(getMessage('VALIDATION_ERROR', 'fr'));
  });

  test('notFoundHandler sets Content-Language header', () => {
    const req = mockReq('pt');
    const res = mockRes();
    notFoundHandler(req, res);
    expect(res._headers['content-language']).toBe('pt');
    expect(res._body.error.message).toBe(getMessage('ENDPOINT_NOT_FOUND', 'pt'));
  });
});
