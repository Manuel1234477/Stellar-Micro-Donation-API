# Known Security Issues

## sqlite3 Build Dependencies (High Severity)

The sqlite3 package has high-severity vulnerabilities in its build-time dependencies (node-gyp, tar, minimatch). These only affect the installation process, not runtime security.

### Impact
- **Risk Level**: Low (build-time only, not runtime)
- **Affected**: sqlite3 installation process
- **Runtime**: No runtime security impact

### CI Configuration
The security workflow audits at `critical` level to focus on runtime vulnerabilities. Build-time high-severity issues are documented but don't block PRs.

### Mitigation
- Use trusted npm registry
- Install in controlled environments
- Monitor for sqlite3 updates

### Alternative
Consider better-sqlite3 (pure JS, no native build) if build security is a concern.
