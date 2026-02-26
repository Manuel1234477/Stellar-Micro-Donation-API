# Test Organization Refactor Spec

## Overview
This spec outlines the refactoring of 70+ test files from a flat structure into a logical, maintainable hierarchy that mirrors the source code organization.

## Spec Files

### [requirements.md](./requirements.md)
Defines the user stories, acceptance criteria, and success metrics for the refactoring effort.

**Key Requirements:**
- Organize tests by domain/feature
- Implement consistent naming conventions
- Mirror source code structure
- Preserve all test logic (zero changes)
- Improve discoverability and maintainability

### [design.md](./design.md)
Provides detailed design including:
- Complete directory structure
- File-by-file mapping (old → new locations)
- Import path update patterns
- Migration strategy (5 phases)
- Correctness properties
- Risk mitigation strategies

**Proposed Structure:**
```
tests/
├── unit/          # Unit tests mirroring src/ structure
├── integration/   # Integration tests by domain
├── e2e/          # End-to-end tests
├── helpers/      # Shared test utilities
└── setup.js      # Test configuration
```

### [tasks.md](./tasks.md)
Breaks down implementation into actionable tasks across 5 phases:

1. **Phase 1**: Preparation and Setup
2. **Phase 2**: Unit Tests Migration (config, middleware, services, utils, models)
3. **Phase 3**: Integration Tests Migration (api, donation, security, stellar, logging, validation, regression)
4. **Phase 4**: E2E Tests Migration
5. **Phase 5**: Cleanup and Documentation

## Quick Start

To begin implementation:

1. Review the requirements document to understand goals
2. Study the design document for the complete migration plan
3. Follow the tasks document phase by phase
4. Use `git mv` to preserve file history
5. Update import paths after each move
6. Run tests after each phase to verify

## Key Principles

- **Zero Logic Changes**: Only move files and update imports
- **Incremental Migration**: Move and verify in phases
- **Test Everything**: Run tests after each phase
- **Preserve History**: Use `git mv` for all moves
- **Document Everything**: Update docs as you go

## Success Metrics

- ✅ All 70+ test files moved to new locations
- ✅ All tests pass (same results as baseline)
- ✅ No test logic modified
- ✅ Import paths correctly updated
- ✅ Coverage unchanged
- ✅ CI/CD pipeline successful
- ✅ Documentation complete

## Estimated Timeline

- Phase 1: 1 hour
- Phase 2: 2 hours
- Phase 3: 3 hours
- Phase 4: 30 minutes
- Phase 5: 1 hour
- **Total**: ~7.5 hours

## Next Steps

1. Get approval on requirements
2. Review design document
3. Begin Phase 1: Preparation and Setup
4. Execute migration following tasks document
5. Verify all success criteria met
