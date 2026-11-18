# CI Caching and Testing Strategy

This document describes the CI/CD pipeline's caching strategy and Node.js version testing matrix.

## Overview

The CI pipeline uses GitHub Actions with:
- Automated npm dependency caching
- Multi-version Node.js testing matrix
- Efficient build times through caching

## Dependency Caching

### How It Works

GitHub Actions caches npm dependencies based on the lockfile:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: '20'
    cache: 'npm'  # Automatically uses package-lock.json as cache key
```

The cache key is automatically generated from:
- `package-lock.json` file hash
- Node.js version
- Runner OS

### Benefits

1. **Faster CI runs**: Subsequent runs skip `npm ci` when dependencies haven't changed
2. **Reduced bandwidth**: No need to download packages from npm registry on every run
3. **Consistent installations**: Uses exact versions from package-lock.json
4. **Automatic invalidation**: Cache automatically invalidates when lockfile changes

### Cache Management

GitHub Actions automatically manages cache with:
- **Retention**: 7 days (default)
- **Size limit**: 5 GB total per repository
- **Eviction**: LRU (least recently used) when limit exceeded

To manually clear cache:
```bash
# Via GitHub CLI
gh actions-cache delete "<cache-key>" -R <owner>/<repo> --all
```

## Node.js Version Matrix

### Supported Versions

The project supports the following Node.js LTS versions as defined in `package.json`:

```json
{
  "engines": {
    "node": ">=20.0.0",
    "npm": ">=10.0.0"
  }
}
```

### Testing Matrix

The CI pipeline runs tests against:
- **Node.js 20.x** (LTS, Active - target development version)
- **Node.js 22.x** (LTS, current - forward compatibility)

### Why This Matrix?

1. **Coverage**: Tests all actively supported LTS versions
2. **Forward compatibility**: Catches breaking changes in newer versions early
3. **Stability**: Ensures library versions work across major Node versions
4. **User base**: Most production deployments use these LTS versions

### Adding New Versions

To add a new Node.js version to the testing matrix:

1. Update `package.json` engines field if minimum version changes
2. Update `.github/workflows/ci.yml`:
   ```yaml
   strategy:
     matrix:
       node-version: ['20.x', '22.x', '24.x']  # Add new version
   ```
3. Test locally with nvm or similar:
   ```bash
   nvm install 22
   nvm use 22
   npm ci && npm test
   ```

## CI Pipeline Details

### Jobs

The CI pipeline consists of three jobs:

#### 1. Lint Job
- **Node Version**: 20.x (stable)
- **Purpose**: 
  - Check code style and security
  - Validate migration IDs
  - Enforce ESLint rules
- **Cache**: Yes (npm dependencies)
- **Duration**: ~30 seconds

#### 2. Test Job (Matrix)
- **Node Versions**: 20.x, 22.x
- **Purpose**: 
  - Run full test suite
  - Generate coverage reports
  - Validate configuration
  - Audit dependencies
- **Cache**: Yes (npm dependencies)
- **Duration**: ~2-3 minutes per version
- **Parallelization**: Versions run in parallel

#### 3. Smoke Tests
- **Node Version**: 20.x
- **Purpose**: 
  - Quick functional verification
  - Mock Stellar network tests
- **Cache**: Yes (npm dependencies)
- **Duration**: ~1 minute

### Cache Behavior

**First run (no cache):**
```
1. Setup Node.js (10s)
2. npm ci (30-60s) - downloads all packages
3. Run tests (120s)
Total: ~2-3 minutes
```

**Subsequent runs (with cache):**
```
1. Setup Node.js (10s)
2. Restore cache (5-10s)
3. npm ci (5s) - uses cached packages
4. Run tests (120s)
Total: ~2-2.5 minutes
```

**Cache hit rate**: ~95% on normal development (only cache miss when dependencies change)

## Best Practices

### For Developers

1. **Keep package-lock.json consistent**
   ```bash
   # Always use npm ci instead of npm install
   npm ci
   
   # When updating packages, commit the new lock file
   npm update
   git add package-lock.json
   ```

2. **Test locally with target versions**
   ```bash
   nvm install 20 && nvm use 20
   npm ci && npm test
   
   nvm install 22 && nvm use 22
   npm ci && npm test
   ```

3. **Check for version-specific issues**
   - Some native modules may not work on all versions
   - Test with `--verbose` flag to see compilation details

### For Maintainers

1. **Monitor cache effectiveness**
   - Check CI run times for cache hits/misses
   - Review GitHub Actions cache usage

2. **Update versions proactively**
   - Add new LTS versions when released
   - Remove EOL versions 6 months after end-of-life

3. **Document version requirements**
   - Keep package.json engines field up-to-date
   - Document any version-specific configuration

## Troubleshooting

### Cache Miss on Small Changes

If cache misses occur frequently:

1. **Check lockfile stability**
   ```bash
   npm ci
   git diff package-lock.json
   ```
   
   If lockfile changes unnecessarily, it may indicate:
   - Incorrect npm version
   - Local dependency conflicts
   - Corrupted node_modules

2. **Verify cache key**
   - Cache key is based on `package-lock.json` and node-version
   - Changing either invalidates cache

3. **Clear and rebuild**
   ```bash
   # Via GitHub CLI
   gh actions-cache delete "<key>" -R <owner>/<repo>
   ```

### Version-Specific Test Failures

If tests fail on only one Node.js version:

1. **Run locally with that version**
   ```bash
   nvm use 22
   npm ci && npm test
   ```

2. **Check version-specific issues**
   ```bash
   # Node.js changelog
   https://nodejs.org/en/download/releases/
   
   # Check package compatibility
   npm view <package> engines.node
   ```

3. **Update dependencies**
   ```bash
   npm update
   npm audit fix
   ```

## Performance Metrics

### Typical CI Run Times

| Scenario | Duration | Cache |
|----------|----------|-------|
| Fresh checkout | 3-4 min | Miss |
| Dev changes only | 2-2.5 min | Hit |
| Dependency update | 2.5-3 min | Miss |
| Node 20 + 22 (parallel) | 2-3 min | Hit |

### Optimization Opportunities

1. **Parallel test execution** (current: sequential per version)
   - Consider splitting test suites across multiple jobs
   - Estimated savings: 30-40 seconds

2. **Test result caching**
   - Cache specific test results for unchanged code
   - Requires careful implementation to avoid false positives

3. **Dependency pre-warming**
   - Build container image with pre-installed dependencies
   - Useful for frequent deployments

## Related Documentation

- **CI Pipeline**: See `docs/ci-pipeline.md`
- **Testing Guide**: See `docs/TESTING_GUIDE.md`
- **Dependency Management**: See `CONTRIBUTING.md`
- **Node.js Support**: See `package.json` engines field
