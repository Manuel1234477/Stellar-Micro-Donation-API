'use strict';

const { escapeField, serialize } = require('../../src/utils/csvSerializer');

describe('csvSerializer', () => {
  describe('escapeField', () => {
    it('returns empty string for null', () => {
      expect(escapeField(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
      expect(escapeField(undefined)).toBe('');
    });

    it('passes through plain strings unchanged', () => {
      expect(escapeField('hello')).toBe('hello');
    });

    it('wraps fields containing a comma in double-quotes', () => {
      expect(escapeField('hello, world')).toBe('"hello, world"');
    });

    it('wraps fields containing a double-quote and escapes it', () => {
      expect(escapeField('say "hi"')).toBe('"say ""hi"""');
    });

    it('wraps fields containing a newline', () => {
      expect(escapeField('line1\nline2')).toBe('"line1\nline2"');
    });

    it('wraps fields containing a carriage return', () => {
      expect(escapeField('line1\rline2')).toBe('"line1\rline2"');
    });

    it('neutralizes = formula prefix', () => {
      expect(escapeField('=CMD')).toBe("'=CMD");
    });

    it('neutralizes + formula prefix', () => {
      expect(escapeField('+1')).toBe("'+1");
    });

    it('neutralizes - formula prefix', () => {
      expect(escapeField('-1')).toBe("'-1");
    });

    it('neutralizes @ formula prefix', () => {
      expect(escapeField('@SUM')).toBe("'@SUM");
    });

    it('serializes objects via JSON.stringify', () => {
      const obj = { key: 'val' };
      const result = escapeField(obj);
      expect(result).toContain('"key"');
      expect(result).toContain('"val"');
    });

    it('handles numbers', () => {
      expect(escapeField(42)).toBe('42');
    });

    it('handles booleans', () => {
      expect(escapeField(true)).toBe('true');
    });
  });

  describe('serialize', () => {
    const headers = ['id', 'name', 'amount'];
    const rows = [
      { id: 1, name: 'Alice', amount: 10.5 },
      { id: 2, name: 'Bob', amount: 20.0 },
    ];

    it('produces correct header row', () => {
      const csv = serialize(headers, rows);
      const lines = csv.split('\n');
      expect(lines[0]).toBe('id,name,amount');
    });

    it('produces correct data rows', () => {
      const csv = serialize(headers, rows);
      const lines = csv.split('\n');
      expect(lines[1]).toBe('1,Alice,10.5');
      expect(lines[2]).toBe('2,Bob,20');
    });

    it('handles empty rows array', () => {
      const csv = serialize(headers, []);
      expect(csv).toBe('id,name,amount');
    });

    it('handles missing fields as empty strings', () => {
      const csv = serialize(headers, [{ id: 1 }]);
      const lines = csv.split('\n');
      expect(lines[1]).toBe('1,,');
    });

    it('escapes embedded commas in data', () => {
      const csv = serialize(['name'], [{ name: 'Smith, John' }]);
      expect(csv).toBe('name\n"Smith, John"');
    });

    it('escapes embedded quotes in data', () => {
      const csv = serialize(['name'], [{ name: 'say "hi"' }]);
      expect(csv).toBe('name\n"say ""hi"""');
    });

    it('escapes embedded newlines in data', () => {
      const csv = serialize(['notes'], [{ notes: 'line1\nline2' }]);
      expect(csv).toBe('notes\n"line1\nline2"');
    });

    it('neutralizes formula-injection payloads', () => {
      const csv = serialize(['formula'], [{ formula: '=HYPERLINK("evil")' }]);
      expect(csv).toContain("'=");
    });

    it('prepends UTF-8 BOM when bom option is true', () => {
      const csv = serialize(headers, [], { bom: true });
      expect(csv.charCodeAt(0)).toBe(0xfeff);
    });

    it('respects custom delimiter', () => {
      const csv = serialize(headers, rows, { delimiter: ';' });
      const lines = csv.split('\n');
      expect(lines[0]).toBe('id;name;amount');
    });

    it('respects custom line ending', () => {
      const csv = serialize(headers, rows, { lineEnding: '\r\n' });
      expect(csv).toContain('\r\n');
    });
  });
});
