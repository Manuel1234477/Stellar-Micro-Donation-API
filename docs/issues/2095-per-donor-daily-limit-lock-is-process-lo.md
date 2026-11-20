# Issue #2095: Per-donor daily-limit lock is process-local, so limits can be bypassed across replicas

<https://github.com/Manuel1234477/Stellar-Micro-Donation-API/issues/2095>

## Status

Nothing was implemented. The attempt stopped at the time limit, so this is a starting point rather than a solution.

## Where the work goes

These paths are named by the issue and exist in this repository:

- `src/routes/donations/helpers.js`

## Next

- Read the issue in full: the acceptance criteria are the specification.
- Split it into pieces that each stand alone as one pull request.
- If a piece needs work outside this repository (dashboards, alerting, a vendor), say so and leave it out.
