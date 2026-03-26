/**
 * Overpayment Detector Utility
 *
 * RESPONSIBILITY: Detect and quantify overpayments relative to an expected fee
 * OWNER: Backend Team
 * DEPENDENCIES: None
 *
 * Compares the amount received against the expected total (donation + analytics fee).
 * When the received amount exceeds the expected total, the surplus is recorded and
 * the transaction is flagged as an overpayment for review.
 */

/**
 * Precision helper — round to 7 decimal places (Stellar max precision).
 * @param {number} value
 * @returns {number}
 */
function round7(value) {
  return parseFloat(value.toFixed(7));
}

/**
 * Detect whether a received amount constitutes an overpayment.
 *
 * The "expected total" is the donation amount plus the calculated analytics fee.
 * Any amount above that threshold is considered excess.
 *
 * @param {number} receivedAmount   - The amount actually sent by the donor
 * @param {number} donationAmount   - The intended donation amount
 * @param {number} expectedFee      - The analytics fee calculated for this donation
 * @returns {{
 *   isOverpayment: boolean,
 *   expectedTotal: number,
 *   receivedAmount: number,
 *   excessAmount: number,
 *   overpaymentPercentage: number
 * }}
 */
function detectOverpayment(receivedAmount, donationAmount, expectedFee) {
  if (typeof receivedAmount !== 'number' || !Number.isFinite(receivedAmount)) {
    throw new Error('receivedAmount must be a finite number');
  }
  if (typeof donationAmount !== 'number' || !Number.isFinite(donationAmount)) {
    throw new Error('donationAmount must be a finite number');
  }
  if (typeof expectedFee !== 'number' || !Number.isFinite(expectedFee)) {
    throw new Error('expectedFee must be a finite number');
  }

  const expectedTotal = round7(donationAmount + expectedFee);
  const excess = round7(receivedAmount - expectedTotal);
  const isOverpayment = excess > 0;
  const overpaymentPercentage = isOverpayment
    ? round7((excess / expectedTotal) * 100)
    : 0;

  return {
    isOverpayment,
    expectedTotal,
    receivedAmount: round7(receivedAmount),
    excessAmount: isOverpayment ? excess : 0,
    overpaymentPercentage,
  };
}

/**
 * Build the overpayment metadata object to attach to a transaction record.
 * Returns null when there is no overpayment.
 *
 * @param {number} receivedAmount
 * @param {number} donationAmount
 * @param {number} expectedFee
 * @returns {Object|null}
 */
function buildOverpaymentRecord(receivedAmount, donationAmount, expectedFee) {
  const result = detectOverpayment(receivedAmount, donationAmount, expectedFee);
  if (!result.isOverpayment) return null;

  return {
    flagged: true,
    expectedTotal: result.expectedTotal,
    receivedAmount: result.receivedAmount,
    excessAmount: result.excessAmount,
    overpaymentPercentage: result.overpaymentPercentage,
    detectedAt: new Date().toISOString(),
  };
}

module.exports = {
  detectOverpayment,
  buildOverpaymentRecord,
  round7,
};
