# Implementation Plan: Smart Donation Routing

## Overview

Implement the `DonationRouter` service and supporting repositories, four routing strategies, admin pool management endpoints, audit trail storage, and integration with the existing `POST /donations` route.

## Tasks

- [x] 1. Create database migration for routing tables
  - Add `recipient_pools`, `recipient_pool_members`, `round_robin_state`, and `routing_decisions` tables with indexes to `src/scripts/migrations/`
  - Follow the existing migration file naming convention (e.g., `005_add_smart_donation_routing.js`)
  - _Requirements: 5.3, 6.1, 7.2_

- [x] 2. Add routing error codes to `src/utils/errors.js`
  - Add codes `ROUTING_STRATEGY_REQUIRED`, `INVALID_ROUTING_STRATEGY`, `POOL_NAME_REQUIRED`, `POOL_NOT_FOUND`, `POOL_EMPTY`, `POOL_ALREADY_EXISTS`, `RECIPIENT_NOT_IN_POOL`, `DONOR_COORDINATES_REQUIRED`, `NO_ELIGIBLE_RECIPIENTS`, `NO_ACTIVE_CAMPAIGNS` in the 5000–5099 range
  - _Requirements: 1.2, 1.3, 3.4, 4.4, 6.6, 6.7, 6.8, 6.9_

- [x] 3. Implement `RecipientPoolRepository` in `src/services/RecipientPoolRepository.js`
  - Implement `create`, `getByName`, `addMembers`, `removeMembers`, `delete`, and `listMembers` methods against the SQLite tables
  - Throw `POOL_ALREADY_EXISTS` on duplicate name, `POOL_NOT_FOUND` when pool is absent, `RECIPIENT_NOT_IN_POOL` when removing a non-member
  - Reset round-robin state (via `RoundRobinStateRepository`) when members are added or removed
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 5.4_

- [x] 4. Implement `RoundRobinStateRepository` in `src/services/RoundRobinStateRepository.js`
  - Implement `getIndex`, `incrementAndWrap`, and `reset` methods
  - `getIndex` returns `0` when no row exists; `incrementAndWrap` performs an atomic update and wraps at `poolSize`
  - _Requirements: 5.1, 5.2, 5.3_

- [x] 5. Implement `RoutingDecisionRepository` in `src/services/RoutingDecisionRepository.js`
  - Implement `create`, `findByDonationId`, `findByPoolName`, and `findByStrategy` methods
  - Records are insert-only; no update path
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 6. Implement `DonationTotalsRepository` in `src/services/DonationTotalsRepository.js`
  - Implement `getTotalsForPool(recipientIds, lookbackWindowMs)` querying the existing `transactions` table
  - Return a `Map<recipientId, totalAmount>` with `0` for recipients with no transactions in the window
  - _Requirements: 2.1_

- [x] 7. Implement routing strategies in `src/services/routing/`
  - [x] 7.1 Implement `HighestNeedStrategy.js`
    - `select(pool, { donationTotals })` returns `{ selectedId, excludedIds: [] }`
    - Tiebreak by lexicographically smallest `id`
    - _Requirements: 2.1, 2.2, 2.3_
  - [x] 7.2 Implement `GeographicStrategy.js`
    - `select(pool, { donorLat, donorLon })` using the Haversine formula; exclude recipients without coordinates
    - Tiebreak by lexicographically smallest `id`; throw `DONOR_COORDINATES_REQUIRED` if coordinates absent; throw `NO_ELIGIBLE_RECIPIENTS` if all excluded
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - [x] 7.3 Implement `CampaignUrgencyStrategy.js`
    - `select(pool, { now })` selects the recipient with the nearest future deadline; exclude recipients without a deadline
    - Tiebreak by lexicographically smallest `id`; throw `NO_ACTIVE_CAMPAIGNS` if all deadlines have passed or all excluded
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - [x] 7.4 Implement `RoundRobinStrategy.js`
    - `select(pool, { currentIndex })` returns the recipient at `currentIndex`; no exclusions
    - _Requirements: 5.1, 5.2_

- [x] 8. Implement `DonationRouter` in `src/services/DonationRouter.js`
  - Constructor accepts `{ recipientPoolRepo, routingDecisionRepo, roundRobinStateRepo, donationTotalsRepo }`
  - `route({ poolName, routingStrategy, donorCoordinates, donationId, now })` validates strategy name, loads pool, delegates to the correct strategy, persists the `Routing_Decision`, and returns `{ recipientId, recipientName, routingDecisionId }`
  - Throw `INVALID_ROUTING_STRATEGY` for unrecognized names, `POOL_EMPTY` for empty pools
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 6.9, 7.1, 7.2, 8.1, 8.2_

- [x] 9. Register repositories and `DonationRouter` in `src/config/serviceContainer.js`
  - Instantiate `RecipientPoolRepository`, `RoundRobinStateRepository`, `RoutingDecisionRepository`, `DonationTotalsRepository`, and `DonationRouter`
  - Wire dependencies following the existing container pattern
  - _Requirements: 1.1_

- [x] 10. Integrate `DonationRouter` into `src/routes/donation.js`
  - Accept optional `routingStrategy`, `poolName`, `donorLatitude`, and `donorLongitude` fields on `POST /donations`
  - When `recipient` is absent and `routingStrategy` is present, call `DonationRouter.route(...)` and inject the resolved recipient before delegating to `DonationService`
  - Append `routing: { recipientId, recipientName, routingDecisionId }` to the success response
  - Throw `ROUTING_STRATEGY_REQUIRED` when neither `recipient` nor `routingStrategy` is provided
  - _Requirements: 1.1, 1.2, 8.1, 8.2_

- [x] 11. Implement admin routing endpoints in `src/routes/admin/routing.js`
  - `POST /admin/routing/pools` — create pool
  - `GET /admin/routing/pools/:name` — get pool members
  - `POST /admin/routing/pools/:name/members` — add members
  - `DELETE /admin/routing/pools/:name/members` — remove members
  - `DELETE /admin/routing/pools/:name` — delete pool
  - `GET /admin/routing/decisions` — query decisions with `donationId`, `poolName`, `strategy` query filters
  - Apply `requireApiKey` + `requireAdmin()` middleware matching the existing admin route pattern
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 7.3_

- [x] 12. Register admin routing router in `src/routes/app.js`
  - Mount `src/routes/admin/routing.js` under `/admin/routing` alongside the existing admin routes
  - _Requirements: 6.1, 7.3_
