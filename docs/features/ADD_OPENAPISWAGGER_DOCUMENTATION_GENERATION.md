# OpenAPI/Swagger Documentation Generation (#329)

## Overview
Serves an interactive Swagger UI at `/api/docs` and a raw OpenAPI 3.0 spec at `/api/openapi.json`, generated from JSDoc `@openapi` annotations in route files.

## Endpoints
- `GET /api/docs` — Swagger UI (interactive)
- `GET /api/openapi.json` — Raw OpenAPI 3.0 spec

## Configuration
`src/config/openapi.js` — lists all annotated route files. Add new route files to the `apis` array to include them in the spec.

## Security
All endpoints require `ApiKeyAuth` (header `x-api-key`) by default via the global `security` block.

## Tests
`tests/add-openapiswagger-documentation-generation.test.js` — 35 tests covering spec structure, all endpoint groups, response codes, and module exports.
