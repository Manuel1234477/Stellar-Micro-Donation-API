# Static Security Analysis

This document describes the static security analysis tools and processes used in the Stellar Micro-Donation API project.

## Overview

Static security analysis runs automatically on every pull request to detect common security issues before code is merged.

## Tools

### ESLint with Security Plugins

We use ESLint with the following security-focused plugins:

- **eslint-plugin-security**: Detects common security anti-patterns
- **eslint-plugin-no-secrets**: Prevents accidental commit of secrets and high-entropy strings

## What We Check

### Security Issues Detected

1. **Unsafe Patterns**
   - Use of `eval()` or `new Function()`
   - Unsafe regular expressions (ReDoS vulnerabilities)
   - Insecure random number generation
   - Buffer operations without assertions

2. **Secret Detection**
   - High-entropy strings that may be API keys or tokens
   - Hardcoded credentials
   - Private keys in code

3. **Injection Vulnerabilities**
   - Non-literal file system paths
   - Non-literal require statements
   - Object injection sinks
   - Possible timing attacks

4. **Code Quality Issues**
   - Unused variables
   - Unreachable code
   - Loss of precision in numbers

## Running Locally

```bash
# Run security linting
npm run lint:security

# Run all linting
npm run lint
```

## CI Integration

Static security analysis runs automatically on:
- Pull requests to `main` or `develop` branches
- Pushes to `main` or `develop` branches

The workflow is defined in `.github/workflows/static-security.yml`.

## Handling Warnings

### Legitimate Cases

Some warnings are expected and acceptable:

1. **Object Injection Warnings**: Often false positives when accessing object properties with validated keys
2. **Non-literal FS Paths**: Acceptable when paths are constructed from validated configuration
3. **Test Keys**: Development/test Stellar keys trigger secret detection but are not real secrets

### Suppressing Warnings

Use inline comments sparingly and only for legitimate cases:

```javascript
// eslint-disable-next-line no-secrets/no-secrets -- Explanation
const testKey = 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJMUC5XNODMZTQYBB5XYZXYUU';
```

Or for blocks:

```javascript
/* eslint-disable no-secrets/no-secrets */
// Test keys for development
const keys = [...];
/* eslint-enable no-secrets/no-secrets */
```

## Exit Codes

- **0**: No errors (warnings are acceptable)
- **1**: Errors found (blocks CI)

## Configuration Files

- `.eslintrc.js`: ESLint configuration with security rules
- `.eslintignore`: Files/directories excluded from linting
- `.github/workflows/static-security.yml`: CI workflow

## Best Practices

1. **Never commit real secrets**: Use environment variables
2. **Review warnings**: Even if they don't block CI, they may indicate issues
3. **Keep dependencies updated**: Security plugins are regularly updated
4. **Document suppressions**: Always explain why a warning is suppressed

## Current Status

As of the latest run:
- **Errors**: 0
- **Warnings**: 37 (mostly false positives for object injection)
- **Status**: ✅ Passing

## Related Documentation

- [Security Notes](../SECURITY_NOTES.md)
- [Dependency Security Scanning](../docs/CI_TESTING.md)
- [Contributing Guidelines](../CONTRIBUTING.md)
