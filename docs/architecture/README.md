# DailyStar Architecture

This directory contains architecture documentation for the DailyStar project.

## Documents

| File | Description |
|---|---|
| [`dailystar_architecture.md`](../../dailystar_architecture.md) | Main architecture and implementation specification (source of truth) |

## Architecture Decision Records (ADRs)

ADRs will be added here as significant implementation decisions are made.
Format: `ADR-NNN-title.md`

## Phased Roadmap

Implementation follows the phased roadmap defined in **Section 13** of the architecture specification:

| Phase | Status | Description |
|---|---|---|
| **Phase 0** | ✅ Complete | Project scaffolding — monorepo, both apps boot, Docker Compose, CI |
| Phase 1 | Pending | Identity & RBAC |
| Phase 2 | Pending | Articles core |
| Phase 3 | Pending | Editorial workflow & audit logging |
| Phase 4 | Pending | Media management |
| Phase 5 | Pending | Public site (read path) + Postgres FTS |
| Phase 6 | Pending | CMS frontend |
| Phase 7 | Pending | Scheduled publishing |
| Phase 8 | Pending | Notifications |
| Phase 9 | Pending | AI newsroom pipeline |
| Phase 10 | Pending | AI newsroom CMS UI + embeddings-based dedup |
| Phase 11 | Pending | Comments |
| Phase 12 | Pending | Analytics & admin dashboard |
