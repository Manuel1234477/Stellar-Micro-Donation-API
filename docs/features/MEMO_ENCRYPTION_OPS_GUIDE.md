# Memo Encryption Extended - Deployment & Operations Checklist

## Pre-Deployment (Staging Environment)

### Code Review & Testing
- [ ] All 54 tests passing: `npm test -- tests/memo-encryption-extended.test.js`
- [ ] Code coverage report reviewed: `npm test -- tests/memo-encryption-extended.test.js --coverage`
- [ ] ESLint passes: `npm run lint`
- [ ] Security linter passes: `npm run lint:security`
- [ ] Manual code review completed by security team
- [ ] Documentation reviewed for accuracy and completeness

### Functional Testing
- [ ] POST /transactions/:id/decrypt-memo endpoint working correctly
- [ ] Wrong secret key properly rejected (403 error)
- [ ] Tampered memos properly detected (403 error)
- [ ] POST /admin/encryption/memo-rotate creates new key version
- [ ] Key rotation identifies correct memos for re-encryption
- [ ] Re-encryption batch job completes without error
- [ ] Old key versions remain usable during rotation
- [ ] Encryption metadata properly stored in database

### Security Testing
- [ ] Verify forward secrecy (different ephemeral keys for each encryption)
- [ ] Verify AEAD authentication (tampering detected)
- [ ] Verify recipient-binding (only recipient's secret key works)
- [ ] Confirm no plaintext leakage in logs
- [ ] Confirm no key material in responses
- [ ] Verify permission checks on endpoints

### Performance Testing
- [ ] Encryption completes within 100ms per memo
- [ ] Decryption completes within 100ms per memo
- [ ] Key rotation initiates within 50ms
- [ ] Batch re-encryption handles 1000+ memos efficiently
- [ ] No memory leaks observed under load
- [ ] Database queries optimized

### Data Integrity Testing
- [ ] Encrypt/decrypt round-trip with various memo types
- [ ] Unicode and special characters preserved
- [ ] Long memos (>1000 chars) handled correctly
- [ ] Empty memos rejected appropriately
- [ ] Database schema compatible with new fields
- [ ] Backwards compatibility with existing unencrypted memos

### Integration Testing
- [ ] Stellar transaction creation with MEMO_HASH works
- [ ] API key permissions properly enforced
- [ ] RBAC checks work correctly
- [ ] Audit logging captures encryption operations
- [ ] Webhooks trigger correctly for encrypted memos
- [ ] Multi-wallet scenarios handled properly

### Database Backup & Migration
- [ ] Backup existing transaction data
- [ ] Test data migration scripts
- [ ] Verify `data/memo-keys/keys.json` creation
- [ ] Test backup/restore procedures
- [ ] Confirm no data loss in any scenario
- [ ] Document migration steps

---

## Production Deployment

### Pre-Deployment Steps
- [ ] Announce maintenance window to users (24hr notice)
- [ ] Final backup of entire database
- [ ] Final backup of secrets (if any stored locally)
- [ ] Test rollback procedure
- [ ] Brief support team on new functionality
- [ ] Create runbook for common issues
- [ ] Set up monitoring/alerting

### Deployment Steps
- [ ] Deploy code to production servers
- [ ] Run database migrations: `npm run migrate`
- [ ] Initialize key storage: `memoKeyManager.initializeKeyStorage()`
- [ ] Verify all 54 tests pass in production environment
- [ ] Verify endpoints are accessible and responding
- [ ] Check error logs for any startup issues
- [ ] Verify encryption status endpoint returns correct metrics

### Post-Deployment Validation
- [ ] Monitor error logs for 24 hours
- [ ] Check CPU/memory usage patterns
- [ ] Verify decryption endpoint working for sample memos
- [ ] Verify key rotation endpoint accessible (admin only)
- [ ] Confirm audit logs recording operations
- [ ] Test with sample donation including encrypted memo
- [ ] Verify recipients can decrypt their memos

---

## Operations: Key Rotation

### Planning a Key Rotation
- [ ] Schedule rotation during low-traffic period
- [ ] Identify number of memos to re-encrypt
- [ ] Estimate time for batch re-encryption
- [ ] Prepare batch job infrastructure (parallel processing)
- [ ] Notify support team of rotation timing
- [ ] Create detailed runbook of rotation steps

### Executing Rotation (Admin)

**Phase 1: Initiation**
```bash
curl -X POST http://localhost:3000/admin/encryption/memo-rotate \
  -H "Authorization: Bearer ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```
- [ ] Response indicates new version created
- [ ] Previous version marked as 'retired'
- [ ] Memo IDs returned for re-encryption
- [ ] Log rotation event with timestamp

**Phase 2: Re-encryption (Batch Job)**
- [ ] Retrieve recipient secrets securely
- [ ] Process memos in batches (e.g., 50 at a time)
- [ ] Log each successful re-encryption
- [ ] Alert on any decryption failures
- [ ] Retry failed memos with exponential backoff
- [ ] Monitor total time and throughput
- [ ] Track success/failure statistics

**Phase 3: Verification**
- [ ] All memos updated to new version
- [ ] Spot-check: decrypt sample memos with new key
- [ ] Check encryption status: all memosUsingOldVersions = 0
- [ ] Verify no decryption errors in logs
- [ ] Confirm new memos using new version

**Phase 4: Cleanup (Optional)**
- [ ] Retire old key version (mark for deletion)
- [ ] Archive old key material securely
- [ ] Document rotation completion
- [ ] Update runbook with lessons learned

**Phase 5: Monitoring**
- [ ] Monitor for 7 days post-rotation
- [ ] Alert on any decryption failures
- [ ] Check for any retroactive key errors
- [ ] Verify no operational impact

---

## Operations: Monitor & Respond

### Daily Monitoring
- [ ] Check encryption status: `MemoEncryptionService.getEncryptionStatus()`
- [ ] Review error logs for encryption failures
- [ ] Monitor POST /transactions/:id/decrypt-memo response times
- [ ] Verify key file integrity: `stat data/memo-keys/keys.json`
- [ ] Check disk usage for key storage directory

### Alerts to Configure
- [ ] Decryption failure rate > 1% : Page on-call engineer
- [ ] POST /transactions/:id/decrypt-memo response time > 500ms: Alert
- [ ] Key storage file modification without rotation initiated: Alert
- [ ] Unauthorized decrypt attempts: Log and alert
- [ ] Old key version used for encryption (should not happen): Alert

### Common Issues & Resolution

**Issue**: "Decryption failed: invalid key or tampered ciphertext"
- **Cause**: Wrong recipient secret or corrupted memo
- **Resolution**: 
  - Verify recipient address matches memo recipient
  - Check database for memo integrity
  - Re-encrypt memo if corrupted

**Issue**: Key rotation stuck/incomplete
- **Cause**: Batch job failure or service restart
- **Resolution**:
  - Check logs for specific memo IDs that failed
  - Retry failed memos individually
  - Use `getMemosToReencrypt()` to find remaining memos

**Issue**: "Key version X not found"
- **Cause**: Keys JSON corrupted or incomplete
- **Resolution**:
  - Restore from backup: `cp data/memo-keys/keys.json.backup data/memo-keys/keys.json`
  - Restart service
  - Investigate backup procedures

**Issue**: Performance degradation during batch re-encryption
- **Cause**: High CPU/memory usage
- **Resolution**:
  - Reduce batch size (smaller transactions per iteration)
  - Increase parallelism if CPU capacity available
  - Run during off-peak hours

---

## Operations: Backup & Disaster Recovery

### Backup Schedule

**Daily Backups** (0 UTC)
```bash
cp data/memo-keys/keys.json data/memo-keys/keys.json.backup.$(date +%Y%m%d)
```

**Weekly Backups** (Sunday 0 UTC)
- Full database backup including transactions with encrypted memos
- Encrypt backup with AES-256
- Store in secure offsite location

**Monthly Backups** (1st of month, 0 UTC)
- Full database backup
- All key versions backup
- Store in geographic different location

### Backup Verification
- [ ] Monthly: Restore from backup to test environment
- [ ] Encrypt Stellar credentials used for decryption tests
- [ ] Verify all memos decrypt correctly
- [ ] Check data integrity (SHA-256 hashes)
- [ ] Document any issues found
- [ ] Update recovery runbook if needed

### Recovery Procedures

**Scenario: Key file corrupted**
1. Stop application
2. Restore from latest backup: `cp data/memo-keys/keys.json.backup data/memo-keys/keys.json`
3. Verify file integrity
4. Restart application
5. Verify encryption status endpoint

**Scenario: Database corruption (encrypted memos)**
1. Stop application
2. Restore database from backup
3. Verify transaction table integrity
4. Test decryption on sample memos
5. Restart application
6. Monitor logs for any anomalies

**Scenario: Lost old key version**
1. Impact: Cannot decrypt memos encrypted with lost version
2. Mitigation: Maintain all key versions indefinitely
3. Prevention: Daily backup with verification
4. Recovery: If no backup, memos unrecoverable (data loss)

---

## Operations: Security Audit

### Monthly Audit
- [ ] Review all decryption access logs
- [ ] Check for unauthorized decode attempts
- [ ] Verify no secret key leakage in logs
- [ ] Audit key storage file permissions
- [ ] Verify all old key versions accounted for
- [ ] Check for any unplanned key generation

### Quarterly Audit
- [ ] Full security review of encryption implementation
- [ ] Penetration testing of decrypt endpoint
- [ ] Review key rotation procedures and logs
- [ ] Update threat model if needed
- [ ] Compliance checklist review
- [ ] Document findings and remediation

### Annual Audit
- [ ] Full codebase review by external security firm
- [ ] Cryptographic strength validation
- [ ] Performance and scalability assessment
- [ ] Disaster recovery readiness review
- [ ] Update documentation and runbooks
- [ ] Security training for operations team

---

## Compliance Checklist

### Data Protection Regulations
- [ ] GDPR: Right to be forgotten - can old memos be securely deleted?
- [ ] CCPA: Verify encryption does not prevent data access by owner
- [ ] PCI DSS: If payment-related, verify encryption meets standards
- [ ] SOC 2: Encryption controls documented and reviewed

### Industry Standards
- [ ] NIST: AES-256-GCM meets cryptographic standards
- [ ] OWASP: Follows secure encryption best practices
- [ ] CWE: No common weaknesses in implementation
- [ ] SANS: Encryption meets security guidance

### Documentation for Auditors
- [ ] Encryption architecture document created
- [ ] Threat model documented
- [ ] Key management procedures documented
- [ ] Testing results archived
- [ ] Security review findings archived
- [ ] Change logs maintained

---

## Scaling & Future Enhancements

### Current Capacity
- 10-50 concurrent encryptions/decryptions
- Up to 100,000 encrypted memos
- Key storage: <10MB for 1000+ versions
- Response time: <100ms per operation

### Scaling Triggers
- [ ] Upgrade to database storage if >500,000 encrypted memos
- [ ] Implement key sharding if >10,000 keys
- [ ] Add caching layer if decrypt latency exceeds 200ms
- [ ] Implement batching if throughput >100 ops/sec

### Future Enhancements to Consider
1. Database-backed key storage (vs. JSON file)
2. AWS KMS or HSM integration
3. Key expiration and auto-retirement
4. Multi-region key replication
5. Hardware Security Module (HSM) backend
6. Audit logging to immutable ledger
7. Public key cryptography for key exchange

---

## Support & Escalation

### Level 1 - Tier Services
- [ ] Respond to decryption failures in <1 hour
- [ ] Check encryption status metrics
- [ ] Consult runbooks

### Level 2 - Engineering Team
- [ ] Debug encryption/decryption issues
- [ ] Review logs and metrics
- [ ] May need access to recipient secrets (secured)
- [ ] Retry operations or trigger re-encryption

### Level 3 - Security Team
- [ ] Review cryptographic concerns
- [ ] Investigate potential compromises
- [ ] Manage key rotation procedures
- [ ] Audit and compliance issues

### Emergency Contacts
- Security Team Lead: [contact]
- On-Call Engineer: Pagerduty
- Database Admin: [contact]

---

**Version**: 1.0.0  
**Last Updated**: March 29, 2026  
**Maintainer**: Operations & Security Teams
