# Enterprise Code Review & Remediation Report (2026-11-23)

## Overview
This document tracks the security, data integrity, CI/CD, and architectural findings identified during the two-round Enterprise Code Review of `Smart-it-helpdesk`, separating **Source Remediation Implemented** from **Verified Validation Status** (local checks vs. GitHub Actions CI & Firestore Emulator execution).

## Findings & Remediation Status

| ID | Finding | Severity | Source Remediation | Validation Status |
| -- | ------- | -------- | ------------------ | ----------------- |
| F-01 | AI API endpoints lacked authentication & rate limiting | High | Implemented (`server.ts`, `src/services/aiService.ts`) | Verified locally (`tsc`, `npm test` rate limiter); live Auth token requires deployed/emulator Firebase Auth |
| F-02 | Client-side Ticket ID generation risked collisions | High | Implemented (`runTransaction` on `/counters/tickets` + `firestore.rules`) | Rules linted & deployed; Emulator transaction test added in `firestore.rules.test.ts` (runs in CI) |
| F-03 | Admin users in `/admins/{uid}` could not list org-wide tickets | High | Implemented (unified RBAC permissions across `types/ticket.ts`, `App.tsx`, `server.ts`, `firestore.rules`) | RBAC unit tests & rules lint passed locally |
| F-04 | Webhook notify trusted client-supplied ticket fields | Medium | Implemented (`/api/webhook/notify` accepts `{ ticketId }` only and reads Firestore via caller token) | Document parser tested in `tests/security.test.ts`; live route tested with auth |
| F-05 | Webhook SSRF protection needed DNS resolution & redirect blocking | Medium | Implemented (`validateWebhookUrlAndResolve` + `redirect` rejected on `3xx`) | Expanded under **F-10** below |
| F-06 | Rules test suite was declarative & AI steps only checked index 0 | Medium | Implemented (`isValidStepElement` indices `0..4`, executable `node:test` suites) | Local unit/invariant tests passed (`12+` tests); live Emulator suite configured in CI |
| F-07 | In-memory runtime webhook config not suitable for multi-instance | Medium | Mitigated / Documented (`process.env.WEBHOOK_URL` primary for multi-instance) | Documented in `.env.example` & `WebhookSettingsPanel.tsx` |
| F-08 | GitHub Actions CI failed on `cache: 'npm'` / `npm ci` due to `bun.lock` | Blocker | Implemented (`.github/workflows/ci.yml` updated to `oven-sh/setup-bun@v2` + `bun install --frozen-lockfile`) | **Pending GitHub Actions run after push** |
| F-09 | Audit Logs could be forged by non-admins or drift from failed secondary writes | High | Implemented (`firestore.rules` restricts admin actions to `isAdmin()`, binds `ticket.created` / `ai.self_resolved` / `ticket.updated` / `ticket.deleted` with `existsAfter`/`getAfter`, `ticketService.ts` uses atomic `writeBatch`, and `server.ts` writes `webhook.config_updated` from trusted backend) | Rules linted & deployed; local invariant tests passed; Emulator assertions added |
| F-10 | DNS Rebinding TOCTOU gap & hexadecimal IPv4-mapped IPv6 bypass | Medium | Implemented (`postJsonWithPinnedIp` pins resolved IP on `node:https` connection with SNI; `parseIPv6Hextets` normalizes hex IPv4-mapped, compatible, NAT64, and 6to4 addresses) | Unit tests for hex IPv6 & `createPinnedLookup` passed locally |

## Key Engineering Controls Implemented
1. **Audit Log Trust Boundary & Atomicity (F-09)**:
   - `firestore.rules` enforces strict action-level authorization: `'ticket.updated'`, `'ticket.deleted'`, `'admin.demo_seeded'`, and `'webhook.config_updated'` require `isAdmin()`.
   - Employee actions `'ticket.created'` and `'ai.self_resolved'` require cross-document atomicity (`existsAfter` + `getAfter` matching `request.auth.uid`), blocking forged logs without real atomic resource creation.
   - `src/services/ticketService.ts` commits every ticket update, ticket deletion, and AI self-resolution alongside its `/auditLogs` entry in a single atomic `writeBatch`.
   - `server.ts` `/api/webhook/config` persists `'webhook.config_updated'` directly via Firestore REST `documents:commit` with `REQUEST_TIME`.
2. **Connection-Level DNS Pinning & IPv6 Normalization (F-10)**:
   - `server/security.ts` expands all IPv6 addresses into 8 hextets to block hexadecimal IPv4-mapped (`::ffff:7f00:1`), uncompressed (`0:0:0:0:0:ffff:a9fe:a9fe`), IPv4-compatible (`::7f00:1`), NAT64 (`64:ff9b::`), and 6to4 (`2002::`) private targets.
   - `dispatchWebhook` uses `postJsonWithPinnedIp` (`node:https` with custom `lookup` and TLS `servername`) so the outbound socket connects strictly to the pre-validated IP rather than re-resolving DNS.
3. **CI/CD & Emulator Gates (F-08)**:
   - `.github/workflows/ci.yml` aligns with `bun.lock` via `oven-sh/setup-bun@v2` (`bun install --frozen-lockfile`), executes `lint`, `lint:rules`, `test`, `build`, and invokes `firebase-tools` Firestore Emulator tests using `firebase.json`.

## Remaining Enterprise Roadmap (Phases 3–5)
- **Phase 3 (Operations & Observability):** Distributed Redis/Memorystore rate limiting across Cloud Run instances, structured JSON logging sink, Cloud Run health/readiness metrics, centralized Secret Manager binding.
- **Phase 4 (Enterprise ITSM Features):** Hardware Asset Lifecycle Registry, Technician Assignment & Workload Balancing, SLA Policy & Escalation Timers, Dynamic Department Management.
- **Phase 5 (Production Operations):** Scheduled Firestore Export/Backup automation, Runbook & On-call documentation.
