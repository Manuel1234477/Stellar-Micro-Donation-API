'use strict';

const { serialize } = require('../../src/utils/csvSerializer');

// Fixture: donation memo / wallet label values crafted to trigger CSV formula
// injection (a.k.a. "CSV injection") in spreadsheet apps like Excel/LibreOffice.
const FORMULA_INJECTED_ROWS = [
  { id: 1, memo: '=HYPERLINK("http://attacker.com/","Click me")', label: 'Alice Wallet' },
  { id: 2, memo: '+1+1', label: 'Bob' },
  { id: 3, memo: '-2+3', label: 'Carol' },
  { id: 4, memo: '@SUM(1+1)', label: 'Dave' },
  { id: 5, memo: '\tmalicious', label: 'Eve' },
];

describe('csvSerializer formula-injection fixture (donation memo / wallet label)', () => {
  it('neutralizes formula-injected memo and label fields in exported CSV', () => {
    const csv = serialize(['id', 'memo', 'label'], FORMULA_INJECTED_ROWS);
    const lines = csv.split('\n').slice(1); // drop header row

    expect(lines[0]).toContain('"\'=HYPERLINK');
    expect(lines[1]).toContain("'+1+1");
    expect(lines[2]).toContain("'-2+3");
    expect(lines[3]).toContain("'@SUM(1+1)");
    expect(lines[4]).toContain("'\tmalicious");
  });

  it('does not mutate the original row data (export-only sanitisation)', () => {
    const original = { id: 1, memo: '=HYPERLINK("http://attacker.com/")', label: 'Alice' };
    const snapshot = { ...original };

    serialize(['id', 'memo', 'label'], [original]);

    expect(original).toEqual(snapshot);
  });
});
