/**
 * CorporateMatchingService
 * Manages employer allowlist, match ratios, annual caps, and the claim workflow.
 */

const crypto = require('crypto');

class CorporateMatchingService {
  constructor(stellarService = null) {
    /** @type {Map<string, {name: string, matchRatio: number, annualCap: number, addedAt: string}>} */
    this.employers = new Map();

    /** @type {Map<string, {id: string, donorId: string, employerId: string, donationAmount: number, matchAmount: number, status: string, createdAt: string, reviewedAt?: string, txId?: string}>} */
    this.claims = new Map();

    this.stellarService = stellarService;
  }

  // ─── Employer Management ────────────────────────────────────────────────────

  /**
   * Add or update an employer in the allowlist.
   * @param {string} employerId - Unique employer identifier
   * @param {string} name - Display name
   * @param {1|2|3} matchRatio - Match ratio (1, 2, or 3)
   * @param {number} annualCap - Maximum XLM matched per employee per year
   * @returns {{employerId: string, name: string, matchRatio: number, annualCap: number}}
   */
  addEmployer(employerId, name, matchRatio, annualCap) {
    if (!employerId || !name) throw new Error('employerId and name are required');
    if (![1, 2, 3].includes(matchRatio)) throw new Error('matchRatio must be 1, 2, or 3');
    if (!annualCap || annualCap <= 0) throw new Error('annualCap must be a positive number');

    const employer = { name, matchRatio, annualCap, addedAt: new Date().toISOString() };
    this.employers.set(employerId, employer);
    return { employerId, ...employer };
  }

  /**
   * Get all employers in the allowlist.
   * @returns {Array}
   */
  listEmployers() {
    return Array.from(this.employers.entries()).map(([employerId, e]) => ({ employerId, ...e }));
  }

  /**
   * Check if an employer is in the allowlist.
   * @param {string} employerId
   * @returns {boolean}
   */
  isEmployerAllowed(employerId) {
    return this.employers.has(employerId);
  }

  // ─── Annual Cap Tracking ─────────────────────────────────────────────────────

  /**
   * Calculate total matched amount for a donor+employer pair in the current calendar year.
   * @param {string} donorId
   * @param {string} employerId
   * @returns {number}
   */
  getYearlyMatchedAmount(donorId, employerId) {
    const year = new Date().getFullYear();
    let total = 0;
    for (const claim of this.claims.values()) {
      if (
        claim.donorId === donorId &&
        claim.employerId === employerId &&
        claim.status === 'approved' &&
        new Date(claim.createdAt).getFullYear() === year
      ) {
        total += claim.matchAmount;
      }
    }
    return total;
  }

  // ─── Claim Workflow ──────────────────────────────────────────────────────────

  /**
   * Submit a match claim for a donation.
   * @param {string} donorId - Donor identifier
   * @param {string} employerId - Employer identifier (must be in allowlist)
   * @param {number} donationAmount - Original donation amount in XLM
   * @returns {Object} Created claim
   */
  submitClaim(donorId, employerId, donationAmount) {
    if (!donorId) throw new Error('donorId is required');
    if (!this.isEmployerAllowed(employerId)) throw new Error(`Employer '${employerId}' is not in the allowlist`);
    if (!donationAmount || donationAmount <= 0) throw new Error('donationAmount must be a positive number');

    const employer = this.employers.get(employerId);
    const matchAmount = donationAmount * employer.matchRatio;

    // Check annual cap
    const alreadyMatched = this.getYearlyMatchedAmount(donorId, employerId);
    const remaining = employer.annualCap - alreadyMatched;
    if (remaining <= 0) {
      throw new Error(`Annual cap of ${employer.annualCap} XLM reached for employer '${employerId}'`);
    }

    const effectiveMatch = Math.min(matchAmount, remaining);
    const id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');

    const claim = {
      id,
      donorId,
      employerId,
      donationAmount,
      matchAmount: effectiveMatch,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    this.claims.set(id, claim);
    return { ...claim };
  }

  /**
   * List claims, optionally filtered by status.
   * @param {string} [status] - Filter by status ('pending', 'approved', 'rejected')
   * @returns {Array}
   */
  listClaims(status) {
    const all = Array.from(this.claims.values());
    return status ? all.filter(c => c.status === status) : all;
  }

  /**
   * Approve a claim and execute the matching donation on-chain.
   * @param {string} claimId
   * @param {string} sourcePublicKey - Employer's Stellar public key for the match payment
   * @param {string} donorPublicKey - Donor's Stellar public key to receive the match
   * @returns {Promise<Object>} Updated claim with txId
   */
  async approveClaim(claimId, sourcePublicKey, donorPublicKey) {
    const claim = this.claims.get(claimId);
    if (!claim) throw new Error(`Claim '${claimId}' not found`);
    if (claim.status !== 'pending') throw new Error(`Claim is already ${claim.status}`);

    // Re-check annual cap at approval time (guard against race conditions)
    const employer = this.employers.get(claim.employerId);
    const alreadyMatched = this.getYearlyMatchedAmount(claim.donorId, claim.employerId);
    if (alreadyMatched + claim.matchAmount > employer.annualCap) {
      claim.status = 'rejected';
      claim.reviewedAt = new Date().toISOString();
      claim.rejectReason = 'Annual cap exceeded at approval time';
      return { ...claim };
    }

    // Execute on-chain
    let txId = null;
    if (this.stellarService) {
      const result = await this.stellarService.sendPayment(
        sourcePublicKey,
        donorPublicKey,
        claim.matchAmount,
        `Corporate match for donation by ${claim.donorId}`
      );
      txId = result.hash || result.transactionId;
    }

    claim.status = 'approved';
    claim.reviewedAt = new Date().toISOString();
    claim.txId = txId;
    return { ...claim };
  }

  /**
   * Reject a claim.
   * @param {string} claimId
   * @param {string} [reason]
   * @returns {Object} Updated claim
   */
  rejectClaim(claimId, reason) {
    const claim = this.claims.get(claimId);
    if (!claim) throw new Error(`Claim '${claimId}' not found`);
    if (claim.status !== 'pending') throw new Error(`Claim is already ${claim.status}`);

    claim.status = 'rejected';
    claim.reviewedAt = new Date().toISOString();
    if (reason) claim.rejectReason = reason;
    return { ...claim };
  }
}

module.exports = CorporateMatchingService;
