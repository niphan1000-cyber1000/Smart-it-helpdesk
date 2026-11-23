# Enterprise Code Review & Remediation Report (2026-11-23)

## Overview
This document tracks the 7 security, data integrity, and architectural findings identified during the Enterprise Code Review of `Smart-it-helpdesk`, along with the implemented Phase 1 & Phase 2 remediations and remaining Phase 3–5 Enterprise ITSM roadmap.

## Findings & Remediation Status

| ID | Finding | Severity | Status | Evidence & Implementation |
| -- | ------- | -------- | ------ | ------------------------- |
| F-01 | AI API endpoints lacked authentication & rate limiting | High | Resolved | `server.ts` enforces Firebase ID Token verification on `/api/ai/troubleshoot`, IT Admin role verification on `/api/ai/diagnostic`, sliding-window per-UID/per-IP rate limiting, and `maxOutputTokens` budget caps. `src/services/aiService.ts` sends `Authorization: Bearer` tokens. |
| F-02 | Client-side Ticket ID generation risked collisions | High | Resolved | `src/services/ticketService.ts` uses atomic Firestore `runTransaction` against `/counters/tickets`, enforced by `firestore.rules` (`existsAfter(/counters/tickets)` and strict `+1` increment). |
| F-03 | Admin users in `/admins/{uid}` could not list org-wide tickets | High | Resolved | Unified RBAC role & permission model (`ticket:read_all`, `ticket:read_own`, `ticket:update`, `ticket:delete`, `ai:diagnostic`, `webhook:manage`, `audit:read`) across `src/types/ticket.ts`, `src/App.tsx`, `server.ts`, and `firestore.rules`. |
| F-04 | Webhook notify trusted client-supplied ticket fields | Medium | Resolved | `/api/webhook/notify` accepts only `{ ticketId }`, verifies caller ownership/admin rights by reading the ticket directly from Firestore REST API using the caller's Firebase ID Token, and rate-limits notifications. |
| F-05 | Webhook SSRF protection needed DNS resolution & redirect blocking | Medium | Resolved | `server.ts` resolves DNS records (`dns.lookup(..., { all: true })`), blocks loopback/private/CGNAT/link-local IPv4 & IPv6 addresses, enforces `https:` port 443, and uses `redirect: 'manual'`. |
| F-06 | Rules test suite was declarative & AI steps only checked index 0 | Medium | Resolved | `firestore.rules` validates all 5 allowed elements of `aiTroubleshooting.steps`. `tests/` includes automated security/validation tests runnable via `npm test` plus CI workflow `.github/workflows/ci.yml`. |
| F-07 | In-memory runtime webhook config not suitable for multi-instance | Medium | Mitigated / Documented | `process.env.WEBHOOK_URL` (Secrets/Env) is the primary multi-instance production config; runtime config in `WebhookSettingsPanel` is explicitly marked as single-instance testing and logs audit events. |

## Remaining Enterprise Roadmap (Phases 3–5)
- **Phase 3 (Operations & Observability):** Structured JSON logging sink, Cloud Run health/readiness metrics, centralized Secret Manager binding.
- **Phase 4 (Enterprise ITSM Features):** Hardware Asset Lifecycle Registry, Technician Assignment & Workload Balancing, SLA Policy & Escalation Timers, Dynamic Department Management.
- **Phase 5 (Production Operations):** Scheduled Firestore Export/Backup automation, Emulator-backed CI security regression gates, Runbook & On-call documentation.
