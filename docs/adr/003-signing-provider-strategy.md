# ADR-003: Pluggable Signing-Provider Strategy

**Status:** Accepted  
**Date:** 2024-03-10  
**Deciders:** Core team, Security team

---

## Context

The application signs Stellar transactions and internal data exports. For development and
small-scale deployments, keeping the signing key in an environment variable is
acceptable. For high-value production deployments, operators need the option to store
signing keys in a Hardware Security Module (HSM) or a cloud Key Management Service (KMS)
where private key material never leaves the secure boundary.

Hardcoding a single signing strategy would require future operators to fork the codebase
or maintain a patch to add HSM/KMS support.

## Decision

We will implement a **pluggable signing-provider abstraction** controlled by the
`SIGNING_PROVIDER` environment variable:

| Value | Implementation | Key storage |
|---|---|---|
| `local` (default) | In-process signing using `ENCRYPTION_KEY` / `SERVICE_SECRET_KEY` | Environment variable |
| `hsm` | PKCS#11 via `HSM_SLOT_ID` + `HSM_PIN` | Hardware Security Module |
| `kms` | Cloud KMS via `KMS_PROVIDER` + `KMS_KEY_ID` | AWS KMS or GCP Cloud KMS |

All application code calls the signing interface; it never directly accesses key material
beyond what the local provider requires.

## Alternatives Considered

| Alternative | Why rejected |
|---|---|
| Single local-only implementation | Blocks enterprise/regulated deployments. HSM support was an explicit stakeholder request |
| Separate code branches per environment | Maintenance burden; risk of drift between branches |
| Third-party secrets manager (Vault) | Adds a hard runtime dependency. Vault is one option under the `kms` adapter but is not the only one |

## Consequences

**Positive:**
- Local development and CI use the default `local` provider with zero extra
  configuration.
- Operators can upgrade to HSM/KMS signing at deployment time with no code changes.
- The abstraction allows future providers (e.g. Azure Key Vault) to be added without
  touching application code.

**Negative / trade-offs:**
- HSM and KMS paths require provider-specific dependencies that are not installed by
  default (`pkcs11js`, AWS SDK, GCP SDK). Operators must install them separately.
- The abstraction adds indirection that can complicate debugging signing failures.
  Clear error messages in the provider implementations are essential.
- Key rotation procedures differ per provider and must be documented separately.

**Follow-on tasks:**
- [x] Document `SIGNING_PROVIDER`, `HSM_SLOT_ID`, `HSM_PIN`, `KMS_PROVIDER`,
  `KMS_KEY_ID` in `docs/configuration.md`
- [ ] Add a `SIGNING_PROVIDER=gcp` implementation
- [ ] Document HSM setup in `docs/secrets-lifecycle.md`

---

*See also: `src/services/signing/`, `docs/configuration.md#20-signing-providers-hsm--kms`,
`docs/secrets-lifecycle.md`*
