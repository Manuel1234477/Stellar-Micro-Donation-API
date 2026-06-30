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

- **ARCHITECTURE.md** - System architecture overview with diagrams
- **API flow diagram.txt** - API request/response flow

---

## 🔒 Security

**Location**: `docs/security/`

- **DONATION_FLOW_SECURITY_AUDIT.md** - Comprehensive security audit (42 vulnerabilities identified)
- **SECURITY_FIXES_IMPLEMENTATION_PLAN.md** - Actionable fixes with code examples
- **AUTHENTICATION_REQUIRED.md** - Authentication requirements
- **MEMO_SECURITY.md** - Memo field security considerations
- **ERROR_HANDLING.md** - Error handling best practices
- **STELLAR_ERROR_HANDLING.md** - Stellar-specific error handling
- **UNIFIED_ERROR_HANDLING_SUMMARY.md** - Error handling summary

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

- **QUICK_START.md** - Quick start guide
- **PRE_DEPLOYMENT_CHECKLIST.md** - Production deployment verification checklist
- **MOCK_STELLAR_GUIDE.md** - Using mock Stellar service for testing
- **MEMO_QUICK_REFERENCE.md** - Memo field quick reference
- **Improved Readme.md** - Enhanced README

---

## 🚀 Deployment

**Location**: `docs/deployment/`

- **MEMO_DEPLOYMENT.md** - Memo feature deployment
- **MIGRATION_GUIDE.md** - Database migration guide
- **DELIVERY_CHECKLIST.md** - Pre-deployment checklist
- **PUSH_INSTRUCTIONS.md** - Git push instructions
- **MANUAL_PUSH_STEPS.md** - Manual deployment steps
- **PULL_TROUBLESHOOTING.md** - Git pull troubleshooting

---

## 🧪 Testing

**Location**: `docs/testing/`

- **TEST_COVERAGE_REPORT.md** - Test coverage report
- **PERMISSIONS.md** - Permission system testing
- **PERMISSION_AUDIT_SUMMARY.md** - Permission audit results

---

## 📋 Templates

**Location**: `docs/templates/`

- **PULL_REQUEST_TEMPLATE.md** - Pull request template

---

## � Release & Versioning

**Location**: `docs/`

- **VERSIONING_STRATEGY.md** - SemVer rules, breaking vs. non-breaking change definitions, API URL versioning, release flow, hotfix procedure, deprecation policy, and changelog requirements

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
- [Quick Start Guide](guides/QUICK_START.md)
- [Local Dev Quickstart](quickstart.md) ⭐ NEW
- [Architecture Overview](architecture/ARCHITECTURE.md)
- [Database Schema & ER Diagram](DATABASE_SCHEMA.md) ⭐ NEW
- [SEP Compliance (SEP-10, SEP-2)](SEP_COMPLIANCE.md) ⭐ NEW
- [API Documentation](features/STATS_API.md)
- [Testing Guide](testing/TEST_COVERAGE_REPORT.md)
- [Versioning Strategy](VERSIONING_STRATEGY.md)

### For Release Management
- [Versioning Strategy](VERSIONING_STRATEGY.md) — SemVer rules, breaking vs. non-breaking changes, release flow, deprecation policy
- [Branch Protection & Merge Policy](BRANCH_PROTECTION.md)
- [CI Pipeline](CI_PIPELINE.md)

### For Security
- [Security Policy](../SECURITY.md) ⭐ NEW — vulnerability reporting & disclosure
- [Security Audit](security/DONATION_FLOW_SECURITY_AUDIT.md)
- [Security Fixes](security/SECURITY_FIXES_IMPLEMENTATION_PLAN.md)
- [Permission System](testing/PERMISSIONS.md)

### For Operations
- [Pre-Deployment Checklist](guides/PRE_DEPLOYMENT_CHECKLIST.md) ⭐ NEW
- [Deployment Guide](deployment/MIGRATION_GUIDE.md)
- [Deployment Checklist](deployment/DELIVERY_CHECKLIST.md)
- [Troubleshooting](deployment/PULL_TROUBLESHOOTING.md)
- [Kubernetes Liveness & Readiness Probes](KUBERNETES_PROBES.md)

### For Features
- [Idempotency](features/IDEMPOTENCY.md) ⭐ NEW
- [Recurring Donations](features/SCHEDULER_RESILIENCE_FEATURE.md)
- [Transaction Memos](features/MEMO_FEATURE.md)
- [Analytics](features/ANALYTICS_FEE_FEATURE.md)

---

## 📝 Documentation Standards

### File Naming
- Use UPPERCASE for main documents (e.g., `ARCHITECTURE.md`)
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
