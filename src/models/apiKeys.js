/**
 * API Keys Model - Data Access Layer
 * 
 * RESPONSIBILITY: Database operations for API key management and validation
 * OWNER: Security Team
 * DEPENDENCIES: Database, crypto, logger, constants
 * 
 * Handles CRUD operations for API keys including creation, validation, rotation,
 * deprecation, and revocation. Supports zero-downtime key rotation workflow.
 */

const db = require('../utils/database');
const crypto = require('crypto');

const db = require('../utils/database');
const log = require('../utils/log');
const { API_KEY_STATUS } = require('../constants');
