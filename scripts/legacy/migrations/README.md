# Legacy one-off migration scripts (unused)

These scripts are kept for history only. They are **not** run by the migration
runner and must not be added to new workflows.

The schema they created is now in the numbered migrations under
`src/migrations/`, which the runner applies in order:

- `064_legacy_script_schema.js` covers every table and column that existed only
  in these scripts (#2101). It is idempotent, so databases that already ran a
  script are left unchanged.
- Data-only steps (e.g. `013_fix_invalid_frequencies.js`,
  `migrateToEnvelopeEncryption.js`) are not repeated by the runner. Run them
  by hand only if you know you need them.

Do not add new scripts here. Add a numbered migration under `src/migrations/`.
