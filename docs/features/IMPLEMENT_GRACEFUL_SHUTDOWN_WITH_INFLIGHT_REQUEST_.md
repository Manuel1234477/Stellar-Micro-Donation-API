# Graceful Shutdown with In-Flight Request Draining

## Overview
This documentation details the implementation handling lifecycle events (`SIGTERM` and `SIGINT`) directed at the Stellar-Micro-Donation-API to ensure clean HTTP closure mechanics. Application crashes or Kubernetes-driven pod cycling will no longer abruptly interrupt active transactions.

## Architecture & Mechanics

### Connections Rejection State
A global active middleware sits at the origin of `src/routes/app.js` inspecting the variable `isShuttingDown`. If set to `true` (triggered natively via standard signal emissions), the server begins returning `503 Service Unavailable` with `Connection: close` headers for all inbound attempts. 

> *Note: Bypasses exist ensuring `/health` checks continue responding accurately enabling orchestration environments (e.g. Kubernetes readiness probes) to safely sever load-balancers.*

### In-Flight Traffic Counters
Prior to yielding control through Express APIs, the request counter incrementally monitors processing arrays.
Listening accurately to Node TCP/HTTP `finish` and `close` socket events, the registry securely decrements the counter once payloads transfer fully out of the container or drop via broken client streams.

### Configurable Drain Thresholds
By default, the backend pauses during `server.close()` validating `inFlightRequests == 0`.
A strictly enforced fallback variable dictates that after a set period, the runtime forcibly yields, emitting an error array indicating a stale cycle timeout.

**Environment Control Configuration:**  
`SHUTDOWN_TIMEOUT`: defines cycle limits in milliseconds. (Default `30000` / 30 seconds).

## Validation Methods
A functional mock engine operates inside `tests/implement-graceful-shutdown-with-inflight-request-.test.js` validating:
- Bypassed `/health` traffic scopes efficiently.
- `inFlightRequests` counting accurately per request cycles.
- Correct process exit codes logic mapping.
