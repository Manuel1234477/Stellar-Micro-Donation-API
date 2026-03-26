# Structured Logging with Log Levels and Output Formats

## Overview
This feature implements robust, structured logging for the Stellar Micro-Donation API, providing observable and aggregatable JSON output. It allows filtering through configured log levels, handles high-volume traffic intelligently via logging sample rates, and ensures persistent file-streams with native size-based interval log rotation.

## Implementation Details
1. **Log Formats (`LOG_FORMAT`)**: Added `json` and `text` formatting. `json` is ideal for backend ingestion flows (ELK, Datadog), producing serialized payload matching `{ "timestamp", "level", "service", "message", "scope", "reqId" ... }`.
2. **Log Levels (`LOG_LEVEL`)**: Configurable thresholds (`DEBUG`, `INFO`, `WARN`, `ERROR`), preventing noisy outputs inside production.
3. **Log Sampling (`LOG_SAMPLE_RATE`)**: Native pseudo-randomized probability sampler. If `LOG_SAMPLE_RATE=0.1` and `LOG_LEVEL=DEBUG` is set, only ~10% of `DEBUG` traces will be actively recorded by the logger.
4. **Log File Rotation (`LOG_MAX_SIZE`)**: Implemented simple rolling log persistence by tracking `currentLogDate` and byte-length chunks inside `src/utils/log.js`. Log streams correctly append to `app-{date}.{rotation}.log` without locking.

## Environment Variables
- `LOG_FORMAT`: `json` or `text` (Defaults to `text`)
- `LOG_LEVEL`: `debug`, `info`, `warn`, `error` (Defaults to `info`)
- `LOG_SAMPLE_RATE`: Floating point probability `<0.0 - 1.0>`
- `LOG_TO_FILE`: `true|false`
- `LOG_DIR`: Directory override for log persistence
- `LOG_MAX_SIZE`: Bytes limit before causing file log rotation

## Security Testing
- `sanitizeForLogging` runs across injected payloads natively to defend against CRLF Log Injection.
- Tested without relying on live Stellar connections. 
- Fully validated test cases for structural completeness ensuring observability pipelines receive valid parseable strings.
