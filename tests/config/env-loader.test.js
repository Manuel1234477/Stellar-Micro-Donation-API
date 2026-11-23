'use strict';

/**
 * Environment file loading (#1943, #2112)
 *
 * Only src/config/env.js may load the repository .env file (from an absolute
 * repo-root path), and a stray src/.env must be ignored with a warning.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');

describe('src/config/env .env loading (#1943, #2112)', () => {
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
      require(path.join(SRC, 'config', 'env'));
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
      require(path.join(SRC, 'config', 'env'));
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

describe('dotenv is loaded in exactly one place (#2112)', () => {
  const ROOT = path.join(SRC, '..');

  function collectJsFiles(dir, files = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collectJsFiles(full, files);
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full);
    }
    return files;
  }

  it('only src/config/env.js references dotenv under src/ and scripts/', () => {
    const offenders = [...collectJsFiles(SRC), ...collectJsFiles(path.join(ROOT, 'scripts'))]
      .filter((file) => /dotenv/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file).split(path.sep).join('/'));
    expect(offenders).toEqual(['src/config/env.js']);
  });

  it('loads the .env file from an absolute repo-root path', () => {
    const { ROOT_ENV_PATH } = require(path.join(SRC, 'config', 'env'));
    expect(path.isAbsolute(ROOT_ENV_PATH)).toBe(true);
    expect(ROOT_ENV_PATH).toBe(path.join(ROOT, '.env'));
  });
});
