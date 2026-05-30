const { ValidationError, ERROR_CODES } = require('./errors');
const { validateInteger, validateEnum } = require('./validationHelpers');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const PAGINATION_DIRECTIONS = ['next', 'prev'];

/**
 * @fileoverview Cursor-based pagination utilities.
 *
 * ## Concurrent-Insert Consistency Limitation
 *
 * The cursor mechanism uses a composite (timestamp, id) position to mark the
 * client's place in the result set.  Because records are ordered by timestamp
 * descending, each page request fetches records whose timestamp/id is strictly
 * less than (or greater than, for `prev`) the cursor value.
 *
 * **Known limitation — concurrent inserts:**
 *
 * If a new record is inserted *between* two page requests with a timestamp
 * that falls *before* the current cursor (i.e. an older timestamp), that
 * record will never appear in any page the client receives — the client has
 * already moved past that position.  Conversely, a record inserted with a
 * timestamp *after* the cursor may appear on the next page even though it did
 * not exist when the client started paginating.
 *
 * **Implication for batch processing / reconciliation:**
 *
 * Clients that rely on pagination to process *every* record (e.g. nightly
 * reconciliation jobs) may silently miss records that were inserted during
 * their pagination session.
 *
 * **Mitigation — `snapshotAt` parameter:**
 *
 * Pass an ISO 8601 timestamp as `snapshotAt` on the *first* request and
 * repeat it on every subsequent page request.  The implementation will add
 * `AND timestamp <= :snapshotAt` to every query, ensuring that only records
 * that existed at the snapshot moment are ever returned.  This gives the
 * client a consistent, point-in-time view of the data for the duration of
 * the pagination session.
 *
 * Example:
 * ```
 * GET /donations?snapshotAt=2026-05-30T12:00:00.000Z&limit=20
 * GET /donations?snapshotAt=2026-05-30T12:00:00.000Z&limit=20&cursor=<next_cursor>
 * ```
 */

/**
 * Encode a cursor payload as a URL-safe opaque string.
 * @param {Object} payload - Cursor payload containing sortable values.
 * @returns {string} Base64url-encoded cursor.
 */
function encodeCursor(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Decode and validate an opaque cursor string.
 * @param {string|undefined|null} cursor - Encoded cursor from the client.
 * @returns {{ timestamp: string, id: string }|null} Decoded cursor payload or null.
 * @throws {ValidationError} If the cursor is malformed.
 */
function decodeCursor(cursor) {
  if (cursor === undefined || cursor === null || cursor === '') {
    return null;
  }

  if (typeof cursor !== 'string') {
    throw new ValidationError('Invalid cursor parameter', null, ERROR_CODES.INVALID_REQUEST);
  }

  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!decoded || typeof decoded !== 'object') {
      throw new Error('Cursor payload must be an object');
    }

    if (typeof decoded.timestamp !== 'string' || decoded.timestamp.trim().length === 0) {
      throw new Error('Cursor timestamp is required');
    }

    if (typeof decoded.id !== 'string' && typeof decoded.id !== 'number') {
      throw new Error('Cursor id is required');
    }

    const parsedDate = new Date(decoded.timestamp);
    if (Number.isNaN(parsedDate.getTime())) {
      throw new Error('Cursor timestamp is invalid');
    }

    return {
      timestamp: parsedDate.toISOString(),
      id: String(decoded.id),
    };
  } catch (error) {
    throw new ValidationError('Invalid cursor parameter', null, ERROR_CODES.INVALID_REQUEST);
  }
}

/**
 * Parse and validate an optional ISO 8601 snapshotAt timestamp.
 *
 * When provided, callers should add `AND <timestampColumn> <= :snapshotAt` to
 * their queries so that every page in a pagination session sees the same
 * consistent set of records (see the module-level JSDoc for the full
 * concurrent-insert explanation).
 *
 * @param {string|undefined|null} value - Raw query-string value.
 * @returns {string|null} ISO 8601 string or null when not supplied.
 * @throws {ValidationError} If the value is present but not a valid date.
 */
function parseSnapshotAt(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw new ValidationError('Invalid snapshotAt parameter', null, ERROR_CODES.INVALID_REQUEST);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(
      'Invalid snapshotAt parameter: must be a valid ISO 8601 timestamp',
      null,
      ERROR_CODES.INVALID_REQUEST
    );
  }

  return parsed.toISOString();
}

/**
 * Parse and strictly validate cursor pagination query parameters.
 *
 * Supports an optional `snapshotAt` ISO 8601 timestamp that clients can use
 * to obtain a consistent, point-in-time view across multiple page requests.
 * See the module-level JSDoc for a full explanation of the concurrent-insert
 * limitation and how `snapshotAt` mitigates it.
 *
 * @param {Object} query - Express request query object.
 * @returns {{ cursor: { timestamp: string, id: string }|null, limit: number, direction: string, snapshotAt: string|null }}
 */
function parseCursorPaginationQuery(query = {}) {
  const limitResult = validateInteger(query.limit, {
    min: 1,
    max: MAX_LIMIT,
    default: DEFAULT_LIMIT,
  });

  if (!limitResult.valid) {
    throw new ValidationError(
      `Invalid limit parameter: ${limitResult.error}`,
      null,
      ERROR_CODES.INVALID_LIMIT
    );
  }

  let direction = 'next';
  if (query.direction !== undefined && query.direction !== null && query.direction !== '') {
    const directionResult = validateEnum(query.direction, PAGINATION_DIRECTIONS);
    if (!directionResult.valid) {
      throw new ValidationError(
        `Invalid direction parameter: ${directionResult.error}`,
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }
    direction = directionResult.value;
  }

  return {
    cursor: decodeCursor(query.cursor),
    limit: limitResult.value,
    direction,
    snapshotAt: parseSnapshotAt(query.snapshotAt),
  };
}

/**
 * Build a stable cursor from a record.
 * @param {Object} item - Record to encode.
 * @param {string} timestampField - Field containing the sortable timestamp.
 * @param {string} idField - Field containing the unique identifier.
 * @returns {string|null} Encoded cursor or null when item is missing.
 */
function createCursorFromItem(item, timestampField, idField = 'id') {
  if (!item) {
    return null;
  }

  return encodeCursor({
    timestamp: new Date(item[timestampField]).toISOString(),
    id: String(item[idField]),
  });
}

/**
 * Compare two records for descending timestamp/id ordering.
 * @param {Object} left - Left record.
 * @param {Object} right - Right record.
 * @param {string} timestampField - Timestamp field name.
 * @param {string} idField - Identifier field name.
 * @returns {number} Sort comparator value.
 */
function compareItemsDescending(left, right, timestampField, idField = 'id') {
  const leftTimestamp = new Date(left[timestampField]).getTime();
  const rightTimestamp = new Date(right[timestampField]).getTime();

  if (leftTimestamp !== rightTimestamp) {
    return rightTimestamp - leftTimestamp;
  }

  return String(right[idField]).localeCompare(String(left[idField]), 'en', { numeric: true });
}

/**
 * Paginate a sorted in-memory collection using cursor semantics.
 *
 * When `snapshotAt` is provided, only records whose timestamp field is ≤ the
 * snapshot value are considered.  This gives callers a consistent,
 * point-in-time view across multiple page requests and prevents the
 * concurrent-insert skip/duplicate problem described in the module-level
 * JSDoc.
 *
 * @param {Object[]} items - Records to paginate.
 * @param {Object} options - Pagination options.
 * @param {{ timestamp: string, id: string }|null} options.cursor - Decoded cursor.
 * @param {number} options.limit - Requested page size.
 * @param {string} options.direction - Pagination direction.
 * @param {string} options.timestampField - Timestamp field name.
 * @param {string} options.idField - Identifier field name.
 * @param {string|null} [options.snapshotAt] - Optional ISO 8601 upper-bound timestamp for consistent pagination.
 * @returns {{ data: Object[], totalCount: number, meta: { limit: number, direction: string, next_cursor: string|null, prev_cursor: string|null } }}
 */
function paginateCollection(items, {
  cursor = null,
  limit = DEFAULT_LIMIT,
  direction = 'next',
  timestampField,
  idField = 'id',
  snapshotAt = null,
}) {
  // Apply snapshot filter before sorting so totalCount reflects the snapshot.
  const snapshotMs = snapshotAt ? new Date(snapshotAt).getTime() : null;
  const filteredItems = snapshotMs !== null
    ? items.filter((item) => new Date(item[timestampField]).getTime() <= snapshotMs)
    : items;

  const sortedItems = [...filteredItems].sort((left, right) => compareItemsDescending(left, right, timestampField, idField));
  const totalCount = sortedItems.length;

  let startIndex = 0;
  let endIndex = limit;

  if (cursor) {
    const cursorIndex = sortedItems.findIndex((item) => (
      new Date(item[timestampField]).toISOString() === cursor.timestamp
      && String(item[idField]) === cursor.id
    ));

    if (cursorIndex === -1) {
      throw new ValidationError('Invalid cursor parameter', null, ERROR_CODES.INVALID_REQUEST);
    }

    if (direction === 'next') {
      startIndex = cursorIndex + 1;
      endIndex = startIndex + limit;
    } else {
      endIndex = cursorIndex;
      startIndex = Math.max(0, endIndex - limit);
    }
  }

  const pageItems = sortedItems.slice(startIndex, endIndex);
  const firstItem = pageItems[0] || null;
  const lastItem = pageItems[pageItems.length - 1] || null;
  const hasPreviousItems = startIndex > 0;
  const hasNextItems = endIndex < totalCount;

  return {
    data: pageItems,
    totalCount,
    meta: {
      limit,
      direction,
      next_cursor: hasNextItems ? createCursorFromItem(lastItem, timestampField, idField) : null,
      prev_cursor: hasPreviousItems ? createCursorFromItem(firstItem, timestampField, idField) : null,
    },
  };
}

/**
 * Build a SQL cursor filter clause for deterministic timestamp/id pagination.
 *
 * When `snapshotAt` is provided, an additional `AND <timestampColumn> <=
 * :snapshotAt` predicate is appended.  Clients should pass the same
 * `snapshotAt` value on every page request to obtain a consistent,
 * point-in-time view and avoid the concurrent-insert skip/duplicate problem
 * described in the module-level JSDoc.
 *
 * @param {Object} options - Clause options.
 * @param {{ timestamp: string, id: string }|null} options.cursor - Decoded cursor.
 * @param {string} options.direction - Pagination direction.
 * @param {string} options.timestampColumn - Timestamp column name.
 * @param {string} options.idColumn - Identifier column name.
 * @param {string|null} [options.snapshotAt] - Optional ISO 8601 upper-bound timestamp for consistent pagination.
 * @returns {{ clause: string, params: Array<string> }} SQL clause fragment and parameters.
 */
function buildCursorWhereClause({
  cursor,
  direction = 'next',
  timestampColumn,
  idColumn = 'id',
  snapshotAt = null,
}) {
  const snapshotClause = snapshotAt ? ` AND ${timestampColumn} <= ?` : '';
  const snapshotParams = snapshotAt ? [snapshotAt] : [];

  if (!cursor) {
    return { clause: snapshotClause, params: snapshotParams };
  }

  if (direction === 'prev') {
    return {
      clause: ` AND ((${timestampColumn} > ?) OR (${timestampColumn} = ? AND ${idColumn} > ?))${snapshotClause}`,
      params: [cursor.timestamp, cursor.timestamp, cursor.id, ...snapshotParams],
    };
  }

  return {
    clause: ` AND ((${timestampColumn} < ?) OR (${timestampColumn} = ? AND ${idColumn} < ?))${snapshotClause}`,
    params: [cursor.timestamp, cursor.timestamp, cursor.id, ...snapshotParams],
  };
}

/**
 * Build response metadata for database-backed cursor pagination.
 * @param {Object} options - Metadata options.
 * @param {Object[]} options.items - Page items in final response order.
 * @param {number} options.limit - Requested page size.
 * @param {string} options.direction - Request direction.
 * @param {boolean} options.hasMore - Whether another page exists in the requested direction.
 * @param {boolean} options.hasCursor - Whether the request included a cursor.
 * @param {string} options.timestampField - Timestamp field name.
 * @param {string} options.idField - Identifier field name.
 * @returns {{ limit: number, direction: string, next_cursor: string|null, prev_cursor: string|null }}
 */
function buildCursorMeta({
  items,
  limit,
  direction,
  hasMore,
  hasCursor,
  timestampField,
  idField = 'id',
}) {
  const firstItem = items[0] || null;
  const lastItem = items[items.length - 1] || null;

  let nextCursor = null;
  let prevCursor = null;

  if (items.length > 0) {
    if (direction === 'next') {
      nextCursor = hasMore ? createCursorFromItem(lastItem, timestampField, idField) : null;
      prevCursor = hasCursor ? createCursorFromItem(firstItem, timestampField, idField) : null;
    } else {
      nextCursor = hasCursor ? createCursorFromItem(lastItem, timestampField, idField) : null;
      prevCursor = hasMore ? createCursorFromItem(firstItem, timestampField, idField) : null;
    }
  }

  return {
    limit,
    direction,
    next_cursor: nextCursor,
    prev_cursor: prevCursor,
  };
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  PAGINATION_DIRECTIONS,
  encodeCursor,
  decodeCursor,
  parseSnapshotAt,
  parseCursorPaginationQuery,
  createCursorFromItem,
  compareItemsDescending,
  paginateCollection,
  buildCursorWhereClause,
  buildCursorMeta,
};
