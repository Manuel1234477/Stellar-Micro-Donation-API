'use strict';

/**
 * Issue #1939: the in-memory EscrowContract simulation must never be reachable
 * over HTTP, and the docs must say how funds are actually held.
 *
 * Static checks only (no DB or network), so they run in any environment.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../src');
const ESCROW_MODULE = path.join(SRC, 'contracts/EscrowContract.js');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

describe('EscrowContract is not exposed over HTTP (#1939)', () => {
  it('no route, controller, bootstrap or app module requires EscrowContract', () => {
    const httpLayers = ['routes', 'controllers', 'bootstrap', 'graphql', 'app.js'];
    const offenders = [];
    for (const layer of httpLayers) {
      const target = path.join(SRC, layer);
      const files = fs.statSync(target).isDirectory()
        ? walk(target)
        : [target];
      for (const file of files) {
        const source = fs.readFileSync(file, 'utf8');
        if (/require\(\s*['"][^'"]*EscrowContract['"]\s*\)/.test(source)) {
          offenders.push(path.relative(SRC, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the Soroban contracts route does not require EscrowContract', () => {
    const source = fs.readFileSync(path.join(SRC, 'routes/contracts.js'), 'utf8');
    expect(source).not.toMatch(/require\(\s*['"][^'"]*EscrowContract['"]\s*\)/);
  });

  it('EscrowContract states it is in-memory and not a production escrow', () => {
    const source = fs.readFileSync(ESCROW_MODULE, 'utf8');
    expect(source).toMatch(/NOT a production escrow/);
    expect(source).toMatch(/in-memory/i);
    expect(source).toMatch(/Nothing is deployed on-chain/);
  });
});

describe('escrow funds model is documented on the campaign routes (#1939)', () => {
  const campaigns = fs.readFileSync(path.join(SRC, 'routes/campaigns.js'), 'utf8');

  it('pledge endpoint states that funds go to a Stellar escrow account', () => {
    expect(campaigns).toMatch(/How funds are held:[\s\S]*service escrow account/);
  });

  it('escrow state endpoint says it is backed by the database and Stellar, not EscrowContract', () => {
    expect(campaigns).toMatch(/GET \/campaigns\/:id\/escrow[\s\S]*does not use the in-memory EscrowContract/);
  });
});
