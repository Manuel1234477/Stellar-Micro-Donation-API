/**
 * Response Sanitizer Utility
 * 
 * RESPONSIBILITY: Enforce strict schemas for API responses
 * OWNER: Backend Team
 * 
 * Prevents accidental exposure of sensitive fields (like encryptedSecret, private keys)
 * by explicitly whitelisting allowed properties for outbound API payloads.
 */

/**
 * Sanitizes a wallet object for public API response.
 * explicitly whitelists safe fields and excludes everything else.
 * 
 * @param {Object} wallet - Raw wallet object from DB or service
 * @returns {Object|null} Sanitized wallet response object
 */
function toWalletResponse(wallet) {
  if (!wallet) return wallet;

  // Explicitly whitelist fields
  const allowed = {
    id: wallet.id,
    publicKey: wallet.publicKey || wallet.address,
    address: wallet.address || wallet.publicKey,
    label: wallet.label,
    ownerName: wallet.ownerName,
    createdAt: wallet.createdAt,
    updatedAt: wallet.updatedAt,
    funded: wallet.funded,
    sponsored: wallet.sponsored,
    sponsorshipRevokedAt: wallet.sponsorshipRevokedAt,
    sponsoredAt: wallet.sponsoredAt,
    homeDomain: wallet.homeDomain,
  };

  // Remove undefined properties to keep response clean
  return Object.fromEntries(
    Object.entries(allowed).filter(([_, v]) => v !== undefined)
  );
}

module.exports = {
  toWalletResponse,
};
