# API Response Compression

Gzip and Brotli compression for JSON responses above a configurable size threshold.

## How it works

The middleware (`src/middleware/compression.js`) intercepts `res.json()` calls and compresses the serialized body when:

1. The client sends an `Accept-Encoding` header with `br` or `gzip`
2. The response body exceeds the configured threshold (default: 1 KB)
3. The `Content-Type` is not already compressed (images, PDFs, zip files, etc.)

Brotli is preferred over Gzip when both are accepted.

## Configuration

Set via environment variables:

| Variable | Default | Description |
|---|---|---|
| `COMPRESSION_THRESHOLD` | `1024` | Min response size in bytes to compress |
| `COMPRESSION_LEVEL` | `6` | Compression level (1–9 gzip / 0–11 brotli) |

## Security

- No user input is executed — only serialized JSON is compressed
- Compression is skipped on error to prevent information leakage via side-channel (BREACH-style attacks are mitigated by only compressing JSON, not HTML with secrets)
- Already-compressed content types are never double-compressed
