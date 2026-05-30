/**
 * GeographicStrategy
 *
 * Selects the recipient nearest to the donor using the Haversine formula.
 * Recipients without coordinates are excluded.
 * Tiebreaks by lexicographically smallest id.
 */

const { ValidationError, BusinessLogicError, ERROR_CODES } = require('../../utils/errors');

const EARTH_RADIUS_KM = 6371;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Haversine distance in kilometres between two lat/lon points.
 */
function haversine(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

class GeographicStrategy {
  /**
   * @param {Array<{id: string, latitude: number|null, longitude: number|null}>} pool
   * @param {{ donorLat: number, donorLon: number }} context
   * @returns {{ selectedId: string, excludedIds: string[] }}
   */
  select(pool, { donorLat, donorLon }) {
    if (donorLat == null || donorLon == null) {
      throw new ValidationError(
        'Donor coordinates are required for geographic routing',
        null,
        ERROR_CODES.DONOR_COORDINATES_REQUIRED
      );
    }

    const excludedIds = [];
    let minDist = Infinity;
    let selectedId = null;

    for (const recipient of pool) {
      if (recipient.latitude == null || recipient.longitude == null) {
        excludedIds.push(recipient.id);
        continue;
      }

      const dist = haversine(donorLat, donorLon, recipient.latitude, recipient.longitude);
      if (
        dist < minDist ||
        (dist === minDist && recipient.id < selectedId)
      ) {
        minDist = dist;
        selectedId = recipient.id;
      }
    }

    if (selectedId === null) {
      throw new BusinessLogicError(
        ERROR_CODES.NO_ELIGIBLE_RECIPIENTS,
        'No eligible recipients with coordinates found in pool'
      );
    }

    return { selectedId, excludedIds };
  }
}

module.exports = GeographicStrategy;
