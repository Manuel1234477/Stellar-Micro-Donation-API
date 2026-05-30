# Donation Notes and Tags (#363)

## Overview
Donations support private `notes` and public `tags` for categorization and reporting.

## Fields
- `notes` (string) — private, visible only to the API key owner and admins
- `tags` (array of strings) — public, used for filtering and analytics

## Tag Taxonomy
Predefined tags are in `src/constants/tags.js`. Standard users may only use predefined tags. Premium/admin users may use custom tags.

## Filtering
`GET /donations?tag=education` — returns only donations with that tag.

## Analytics
`GET /stats/tags?startDate=...&endDate=...` — returns total donated and donation count per tag.

## Tag Management
`GET /tags` — returns predefined tags and whether custom tags are allowed for the caller's role.

## Tests
`tests/add-support-for-donation-notes-and-tags.test.js` — 17 tests covering persistence, filtering, analytics, privacy, and taxonomy.
