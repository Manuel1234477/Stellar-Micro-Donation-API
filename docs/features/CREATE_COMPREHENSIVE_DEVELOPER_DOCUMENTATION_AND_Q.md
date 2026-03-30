# Comprehensive Developer Documentation and Quickstart Guide

## Summary

This feature adds structured developer documentation to make the project accessible to new contributors and API consumers.

## Files Added

| File | Purpose |
|------|---------|
| `docs/quickstart.md` | 5-minute local setup guide |
| `docs/architecture.md` | System design and component overview |
| `docs/api-reference.md` | All endpoints with request/response examples |
| `docs/authentication.md` | API key setup, roles, rotation, SEP-0010 notes |
| `docs/stellar-concepts.md` | Stellar blockchain concepts for new contributors |
| `docs/deployment.md` | Docker, bare metal, and cloud deployment |
| `CONTRIBUTING.md` | Code style, testing requirements, PR process |

## Quickstart Goal

A new developer can clone the repo, run `npm install && npm run init-db && npm start`, and make their first API call in under 10 minutes using `MOCK_STELLAR=true` — no Stellar account or network access required.

## Architecture Documentation

`docs/architecture.md` covers:
- High-level system diagram (text-based)
- Component table for routes, middleware, and services
- Request lifecycle from auth to response
- Security model summary
- Scalability notes

## Authentication Documentation

`docs/authentication.md` covers:
- API key header usage
- Role-based permissions table
- Database-backed key creation and rotation
- Legacy env-based keys (deprecated)
- SEP-0010 compatibility notes

## Stellar Concepts

`docs/stellar-concepts.md` explains Stellar-specific concepts (XLM, accounts, Horizon, transactions, memos, testnet vs mainnet) for developers unfamiliar with blockchain, without requiring deep crypto knowledge.

## Deployment Guide

`docs/deployment.md` covers:
- Bare metal / VPS with PM2
- Docker with persistent volume
- Cloud platforms (AWS EB, ECS, Cloud Run)
- Production checklist
- Graceful shutdown behavior

## Contributing Guidelines

`CONTRIBUTING.md` covers:
- Development workflow commands
- Code style and JSDoc requirements
- Testing requirements (95% coverage, MockStellarService)
- PR process and checklist
- Branch naming and commit message conventions
- Security guidelines
