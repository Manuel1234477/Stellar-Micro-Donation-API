# Documentation Index

Welcome to the Stellar Micro-Donation API documentation. This directory contains comprehensive documentation organized by category.

## 📁 Directory Structure

```
docs/
├── architecture/       # System architecture and design
├── security/          # Security audits and guidelines
├── features/          # Feature documentation
├── guides/            # How-to guides and tutorials
├── deployment/        # Deployment and operations
├── testing/           # Testing documentation
├── templates/         # Document templates
└── summaries/         # Project summaries and status
```

---

## 🏗️ Architecture

**Location**: `docs/architecture/`

- **architecture.md** - System architecture overview with diagrams
- **API flow diagram.txt** - API request/response flow

---

## 🔒 Security

**Location**: `docs/security/`

- **DONATION_FLOW_SECURITY_AUDIT.md** - Comprehensive security audit (42 vulnerabilities identified)
- **SECURITY_FIXES_IMPLEMENTATION_PLAN.md** - Actionable fixes with code examples
- **authentication-required.md** - Authentication requirements
- **memo-security.md** - Memo field security considerations
- **error-handling.md** - Error handling best practices
- **stellar-error-handling.md** - Stellar-specific error handling
- **unified-error-handling-summary.md** - Error handling summary

---

## ✨ Features

**Location**: `docs/features/`

### Core Features
- **IDEMPOTENCY.md** - Idempotency implementation for duplicate prevention
- **ANALYTICS_FEE_FEATURE.md** - Analytics fee calculation
- **LOGGING_FEATURE.md** - Logging system
- **MEMO_FEATURE.md** - Transaction memo support
- **NETWORK_SWITCHING.md** - Network switching (testnet/mainnet)
- **RECENT_DONATIONS_ENDPOINT.md** - Recent donations API
- **SCHEDULER_RESILIENCE_FEATURE.md** - Recurring donation scheduler
- **STATS_API.md** - Statistics and analytics API
- **TRANSACTION_SYNC_CONSISTENCY.md** - Transaction synchronization
- **README_MEMO_FEATURE.md** - Memo feature overview

---

## 📖 Guides

**Location**: `docs/guides/`

- **quick-start.md** - Quick start guide
- **pre-deployment-checklist.md** - Production deployment verification checklist
- **mock-stellar-guide.md** - Using mock Stellar service for testing
- **MEMO_QUICK_REFERENCE.md** - Memo field quick reference
- **Improved Readme.md** - Enhanced README

---

## 🚀 Deployment

**Location**: `docs/deployment/`

- **MEMO_DEPLOYMENT.md** - Memo feature deployment
- **migration-guide.md** - Database migration guide
- **DELIVERY_CHECKLIST.md** - Pre-deployment checklist
- **PUSH_INSTRUCTIONS.md** - Git push instructions
- **MANUAL_PUSH_STEPS.md** - Manual deployment steps
- **PULL_TROUBLESHOOTING.md** - Git pull troubleshooting

---

## 🧪 Testing

**Location**: `docs/testing/`

- **TEST_COVERAGE_REPORT.md** - Test coverage report
- **permissions.md** - Permission system testing
- **PERMISSION_AUDIT_SUMMARY.md** - Permission audit results

---

## 📋 Templates

**Location**: `docs/templates/`

- **PULL_REQUEST_TEMPLATE.md** - Pull request template

---

## � Release & Versioning

**Location**: `docs/`

- **versioning-strategy.md** - SemVer rules, breaking vs. non-breaking change definitions, API URL versioning, release flow, hotfix procedure, deprecation policy, and changelog requirements

---

## �📊 Summaries

**Location**: `docs/summaries/`

- **BRANCH_READY_SUMMARY.md** - Branch readiness summary
- **CHANGELOG_MEMO.md** - Memo feature changelog
- **FILES_DELIVERED.md** - Delivered files list
- **FINAL_STATUS.md** - Final project status
- **IMPLEMENTATION_SUMMARY.md** - Implementation summary
- **MEMO_IMPLEMENTATION_SUMMARY.md** - Memo implementation summary

---

## 🔍 Quick Links

### For Developers
- [Quick Start Guide](guides/quick-start.md)
- [Local Dev Quickstart](quickstart.md) ⭐ NEW
- [Architecture Overview](architecture/architecture.md)
- [Database Schema & ER Diagram](database-schema.md) ⭐ NEW
- [SEP Compliance (SEP-10, SEP-2)](sep-compliance.md) ⭐ NEW
- API Documentation
- Testing Guide
- [Versioning Strategy](versioning-strategy.md)

### For Release Management
- [Versioning Strategy](versioning-strategy.md) — SemVer rules, breaking vs. non-breaking changes, release flow, deprecation policy
- Branch Protection & Merge Policy
- [CI Pipeline](ci-pipeline.md)

### For Security
- [Security Policy](../SECURITY.md) ⭐ NEW — vulnerability reporting & disclosure
- Security Audit
- Security Fixes
- [Permission System](permissions.md)

### For Operations
- [Pre-Deployment Checklist](guides/pre-deployment-checklist.md) ⭐ NEW
- [Deployment Guide](migration-guide.md)
- Deployment Checklist
- Troubleshooting
- [Kubernetes Liveness & Readiness Probes](kubernetes-probes.md)

### For Features
- Idempotency ⭐ NEW
- Recurring Donations
- Transaction Memos
- Analytics

---

## 📝 Documentation Standards

### File Naming
- Use UPPERCASE for main documents (e.g., `architecture.md`)
- Use descriptive names that indicate content
- Include feature name in feature docs

### Structure
- Start with overview/summary
- Include table of contents for long documents
- Use clear headings and sections
- Include code examples where applicable
- Add diagrams for complex concepts

### Maintenance
- Update documentation with code changes
- Keep examples current
- Review and update quarterly
- Archive outdated documents

---

## 🤝 Contributing

When adding new documentation:

1. Choose appropriate directory
2. Follow naming conventions
3. Include in this index
4. Add cross-references
5. Update related documents

---

## 📅 Last Updated

**Date**: February 22, 2026  
**Version**: 1.0.0  
**Maintainer**: Development Team

---

## 📧 Contact

For documentation questions or suggestions:
- Create an issue in the repository
- Contact the development team
- Submit a pull request with improvements
