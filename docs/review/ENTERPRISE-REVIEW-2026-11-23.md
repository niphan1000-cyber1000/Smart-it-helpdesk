# Enterprise Code Review & Remediation Report (2026-11-23)

## Overview
This document tracks the security, data integrity, CI/CD, and architectural findings identified across the Enterprise Code Review cycles of `Smart-it-helpdesk`, separating **Source Remediation Implemented** from **Verified Validation Status** (local checks vs. GitHub Actions CI & live Firestore Emulator execution).

## Findings & Remediation Status

| ID | Finding | Severity | Source Remediation | Validation Status |
| -- | ------- | -------- | ------------------ | ----------------- |
| F-01 | AI API endpoints lacked authentication & rate limiting | High | Implemented (`server.ts`, `src/services/aiService.ts`) | Verified locally (`tsc`, rate-limiter unit test); live Firebase Auth token path requires deployed runtime |
| F-02 | Client-side Ticket ID generation risked collisions | High | Implemented (`runTransaction` on `/counters/tickets` + `firestore.rules`) | Strengthened with bidirectional coupling under **F-11** |
| F-03 | Admin users in `/admins/{uid}` could not list org-wide tickets | High | Implemented (unified RBAC permissions across `types/ticket.ts`, `App.tsx`, `server.ts`, `firestore.rules`) | RBAC unit tests & rules lint passed locally |
| F-04 | Webhook notify trusted client-supplied ticket fields | Medium | Implemented (`/api/webhook/notify` accepts `{ ticketId }` only and reads Firestore via caller token) | Document parser tested locally |
| F-05 | Webhook SSRF protection needed DNS resolution & redirect blocking | Medium | Implemented (`validateWebhookUrlAndResolve`, `3xx` rejected) | Strengthened under **F-10** |
| F-06 | Rules test suite was declarative & AI steps only checked index 0 | Medium | Implemented (`isValidStepElement` indices `0..4`, executable `node:test` suites) | Local invariant tests passed; Emulator execution covered under **F-12** |
| F-07 | In-memory runtime webhook config not suitable for multi-instance | Medium | Mitigated / Documented (`process.env.WEBHOOK_URL` primary for multi-instance) | Documented in `.env.example` & `WebhookSettingsPanel.tsx` |
| F-08 | GitHub Actions CI failed on `cache: 'npm'` / `npm ci` due to `bun.lock` | Blocker | Implemented (`.github/workflows/ci.yml` uses `oven-sh/setup-bun@v2` + `bun install --frozen-lockfile`) | `bun install --frozen-lockfile` passed locally; **Pending GitHub Actions Run after push** |
| F-09 | Audit Logs could be forged by non-admins or drift from failed secondary writes | High | Implemented (`firestore.rules` restricts admin actions to `isAdmin()`, binds `ticket.created`/`ticket.updated`/`ticket.deleted`/`ai.self_resolved` with `existsAfter`/`getAfter`, `ticketService.ts` uses atomic `writeBatch`, `server.ts` writes `webhook.config_updated`) | Rules linted & deployed; Emulator tests added; **Pending CI Emulator run** |
| F-10 | DNS Rebinding TOCTOU gap & hexadecimal IPv4-mapped IPv6 bypass | Medium | Implemented (`postJsonWithPinnedIp` pins resolved IP on `node:https` connection with TLS SNI; `parseIPv6Hextets` normalizes hex IPv4-mapped, compatible, NAT64, and 6to4 addresses) | Unit tests for hex IPv6 & `createPinnedLookup` passed locally |
| F-11 | Firestore Counter could be incremented independently of Ticket creation & Ticket ID wasn't bound to counter value | High | Implemented (`TicketCounter` adds `lastTicketId` matching `formatSeq(lastNumber)`; `firestore.rules` enforces bidirectional `existsAfter` / `getAfter` + `updatedAt == request.time` between `/counters/tickets` and `/tickets/{ticketId}`) | Rules linted & deployed; Emulator assertions added; **Pending CI Emulator run** |
| F-12 | Emulator tests did not execute all 12 Dirty Dozen cases individually | Medium | Implemented (`firestore.rules.test.ts` executes all 12 Dirty Dozen cases `01`–`12` plus F-11 & F-09 checks when `FIRESTORE_EMULATOR_HOST` is set) | Static invariant tests passed locally; **Pending CI Emulator run** |
| F-13 | Rate limiting is in-memory (`Map`) per server process | Medium | **Open (Phase 3)** — Suitable for single-instance preview; requires shared Redis / Memorystore backend before horizontal multi-instance Cloud Run scaling | Open architectural constraint |

## Remaining Enterprise Roadmap (Phases 3–5)
- **Phase 3 (Operations & Observability):** Distributed Redis/Memorystore rate limiting across Cloud Run instances (**F-13**), structured JSON logging sink, Cloud Run health/readiness metrics, centralized Secret Manager binding.
- **Phase 4 (Enterprise ITSM Features):** Hardware Asset Lifecycle Registry, Technician Assignment & Workload Balancing, SLA Policy & Escalation Timers, Dynamic Department Management.
- **Phase 5 (Production Operations):** Scheduled Firestore Export/Backup automation, Runbook & On-call documentation.
