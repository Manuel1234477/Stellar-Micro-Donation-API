'use strict';

/**
 * Environment file loading (#1943)
 *
 * Only src/config/loadEnv.js may load the repository .env file, and a stray
 * src/.env must be ignored with a warning.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');

describe('src/config/loadEnv (#1943)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('warns when a legacy src/.env file exists', () => {
    const warn = jest.spyOn(process, 'emitWarning').mockImplementation(() => {});
    const realExists = fs.existsSync;
    jest.spyOn(fs, 'existsSync').mockImplementation((p) =>
      String(p).endsWith(path.join('src', '.env')) ? true : realExists(p),
    );

    jest.isolateModules(() => {
      require(path.join(SRC, 'config', 'loadEnv'));
    });

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Ignoring'),
      expect.objectContaining({ code: 'LEGACY_SRC_ENV_IGNORED' }),
    );
  });

  it('does not warn when no legacy src/.env file exists', () => {
    const warn = jest.spyOn(process, 'emitWarning').mockImplementation(() => {});
    const realExists = fs.existsSync;
    jest.spyOn(fs, 'existsSync').mockImplementation((p) =>
      String(p).endsWith(path.join('src', '.env')) ? false : realExists(p),
    );

    jest.isolateModules(() => {
      require(path.join(SRC, 'config', 'loadEnv'));
    });

    expect(warn).not.toHaveBeenCalled();
  });
});

describe('database module does not load environment files (#1943)', () => {
  it('contains no dotenv call', () => {
    const source = fs.readFileSync(path.join(SRC, 'utils', 'database.js'), 'utf8');
    expect(source).not.toMatch(/require\(['"]dotenv['"]\)/);
    expect(source).not.toMatch(/src\/\.env/);
  });
});
