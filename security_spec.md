# Security Specification: IT Helpdesk & Repair Ticketing System

## 1. Data Invariants
1. **Identity Binding**: Every ticket created in `/tickets/{ticketId}` must set `createdByUid == request.auth.uid` and `createdByEmail == request.auth.token.email` with `email_verified == true`.
2. **Initial State Integrity**: Regular users can only create tickets with `status == 'รอดำเนินการ'`; only verified IT Admins can create pre-seeded demo tickets in non-pending states or transition ticket statuses.
3. **Immutable Audit Fields**: `id`, `createdByUid`, `createdByEmail`, and `createdAt` are immutable once created.
4. **Temporal Integrity**: `createdAt` and `updatedAt` must equal `request.time`.
5. **PII Isolation**: Ticket documents contain employee names and contact info (`contactInfo`, `createdByEmail`); non-admin users can only `get` or `list` documents where `createdByUid == request.auth.uid`.
6. **Privilege Escalation Prevention**: Only verified IT Admins can write to `/admins/{uid}` or update ticket `status` and `resolutionNote`.

## 2. The Dirty Dozen Adversarial Payloads
1. Unauthenticated read/write on `/tickets/IT-2026-001` -> `PERMISSION_DENIED`
2. Unverified email user creating a ticket -> `PERMISSION_DENIED`
3. User creating a ticket with `createdByUid` spoofed to another user's UID -> `PERMISSION_DENIED`
4. Regular user creating a ticket with `status: 'เสร็จสิ้น'` -> `PERMISSION_DENIED`
5. Regular user updating another user's ticket status -> `PERMISSION_DENIED`
6. Regular user attempting `list` query without owner filter -> `PERMISSION_DENIED`
7. Shadow field injection (`isAdmin: true` or `extraField: 'x'`) on ticket create -> `PERMISSION_DENIED`
8. Resource poisoning with oversized `description` (> 2000 chars) or oversized `ticketId` (> 128 chars) -> `PERMISSION_DENIED`
9. Client-spoofed `createdAt` timestamp not equal to `request.time` -> `PERMISSION_DENIED`
10. Regular user writing themselves into `/admins/{uid}` -> `PERMISSION_DENIED`
11. Modifying immutable `createdByUid` or `createdAt` on update -> `PERMISSION_DENIED`
12. Regular user deleting a ticket -> `PERMISSION_DENIED`
