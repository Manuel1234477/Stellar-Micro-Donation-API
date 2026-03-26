const { ValidationError, ERROR_CODES } = require('./errors');
const { validateInteger, validateEnum } = require('./validationHelpers');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const PAGINATION_DIRECTIONS = ['next', 'prev'];

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
 * Parse and strictly validate cursor pagination query parameters.
 * @param {Object} query - Express request query object.
 * @returns {{ cursor: { timestamp: string, id: string }|null, limit: number, direction: string }}
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
 * @param {Object[]} items - Records to paginate.
 * @param {Object} options - Pagination options.
 * @param {{ timestamp: string, id: string }|null} options.cursor - Decoded cursor.
 * @param {number} options.limit - Requested page size.
 * @param {string} options.direction - Pagination direction.
 * @param {string} options.timestampField - Timestamp field name.
 * @param {string} options.idField - Identifier field name.
 * @returns {{ data: Object[], totalCount: number, meta: { limit: number, direction: string, next_cursor: string|null, prev_cursor: string|null } }}
 */
function paginateCollection(items, {
  cursor = null,
  limit = DEFAULT_LIMIT,
  direction = 'next',
  timestampField,
  idField = 'id',
}) {
  const sortedItems = [...items].sort((left, right) => compareItemsDescending(left, right, timestampField, idField));
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
 * @param {Object} options - Clause options.
 * @param {{ timestamp: string, id: string }|null} options.cursor - Decoded cursor.
 * @param {string} options.direction - Pagination direction.
 * @param {string} options.timestampColumn - Timestamp column name.
 * @param {string} options.idColumn - Identifier column name.
 * @returns {{ clause: string, params: Array<string> }} SQL clause fragment and parameters.
 */
function buildCursorWhereClause({
  cursor,
  direction = 'next',
  timestampColumn,
  idColumn = 'id',
}) {
  if (!cursor) {
    return { clause: '', params: [] };
  }

  if (direction === 'prev') {
    return {
      clause: ` AND ((${timestampColumn} > ?) OR (${timestampColumn} = ? AND ${idColumn} > ?))`,
      params: [cursor.timestamp, cursor.timestamp, cursor.id],
    };
  }

  return {
    clause: ` AND ((${timestampColumn} < ?) OR (${timestampColumn} = ? AND ${idColumn} < ?))`,
    params: [cursor.timestamp, cursor.timestamp, cursor.id],
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
  parseCursorPaginationQuery,
  createCursorFromItem,
  compareItemsDescending,
  paginateCollection,
  buildCursorWhereClause,
  buildCursorMeta,
};
