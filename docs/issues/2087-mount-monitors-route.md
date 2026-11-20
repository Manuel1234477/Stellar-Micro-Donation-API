# #2087 — Mount `src/routes/monitors.js` at `/api/v1/monitors`

## Status

- **Done:** `src/routes/monitors.js` is registered in `V1_ROUTES` in
  `src/bootstrap/routes.js`, so it is mounted at `/api/v1/monitors`
  (`POST /`, `GET /`, `GET /:id`, `DELETE /:id`).
- **Left:** auth/permission gating, OpenAPI entry, docs, and the route-table
  snapshot test update.

## Approach

Mount (not delete): `AccountMonitorService` is a working, tested service
(`tests/monitoring/account-monitoring-and-alerts.test.js`) and the router is
complete; only the mount was missing.

## Remaining steps, in order

1. **Permissions** — decide the guard for the mount. Options:
   - add `['/monitors', requireApiKey, rbac.requirePermission('monitors:manage'), require('../routes/monitors')]`
     and extend `V1_ROUTES` entries to support middleware arrays, or
   - mount explicitly after the loop:
     `apiV1.use('/monitors', requireApiKey, rbac.requirePermission('monitors:manage'), monitorsRoutes);`
   Add `monitors:manage` to `src/config/permissionMatrix.js` and `src/config/roles.json`.
2. **Route-table snapshot** — update `tests/bootstrap/route-table.test.js`
   expectations with the four new paths.
3. **OpenAPI** — add the `/monitors` paths + `AccountMonitor` schema to
   `src/config/openapi.js` (or the generator source), then run
   `npm run openapi:check` and commit the regenerated `docs/openapi.json`.
4. **Docs** — add a `## Monitors` section to `docs/api-reference.md` (and
   `docs/permissions.md` for the new permission) describing the four endpoints,
   request bodies and error codes.
5. **Verify** — `node scripts/check-src-orphans.js` (check:orphans) clean,
   `npm run lint`, `npm test`.

## Done when

- `GET /api/v1/monitors` returns 200 with an API key holding the permission and
  401/403 without it.
- `check:orphans` reports no orphan for `src/routes/monitors.js`.
- OpenAPI spec contains the four monitor paths and `openapi:check` passes.
