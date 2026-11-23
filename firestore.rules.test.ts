import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export const DIRTY_DOZEN_CASES = [
  { name: '01_unauthenticated_ticket_read', expected: 'PERMISSION_DENIED' },
  { name: '02_unverified_email_ticket_create', expected: 'PERMISSION_DENIED' },
  { name: '03_spoofed_createdByUid_on_create', expected: 'PERMISSION_DENIED' },
  { name: '04_non_admin_creates_completed_status', expected: 'PERMISSION_DENIED' },
  { name: '05_non_admin_updates_ticket_status', expected: 'PERMISSION_DENIED' },
  { name: '06_non_admin_blanket_list_tickets', expected: 'PERMISSION_DENIED' },
  { name: '07_shadow_field_injection_on_ticket', expected: 'PERMISSION_DENIED' },
  { name: '08_oversized_description_or_id_poisoning', expected: 'PERMISSION_DENIED' },
  { name: '09_client_spoofed_createdAt_timestamp', expected: 'PERMISSION_DENIED' },
  { name: '10_self_escalation_into_admins_collection', expected: 'PERMISSION_DENIED' },
  { name: '11_mutating_immutable_createdByUid_or_createdAt', expected: 'PERMISSION_DENIED' },
  { name: '12_non_admin_deletes_ticket', expected: 'PERMISSION_DENIED' },
] as const;

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const rulesSource = fs.readFileSync(rulesPath, 'utf-8');

describe('Firestore Rules Dirty Dozen & Security Invariants', () => {
  it('enforces global default-deny catch-all rule', () => {
    assert.match(rulesSource, /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/);
  });

  it('requires verified email on isSignedIn()', () => {
    assert.match(
      rulesSource,
      /function isSignedIn\(\)\s*\{\s*return request\.auth != null && request\.auth\.token\.email_verified == true;\s*\}/
    );
  });

  it('F-11: enforces bidirectional atomic coupling between /counters/tickets and /tickets/{ticketId}', () => {
    assert.match(rulesSource, /function formatSeq\(n\)/);
    assert.match(
      rulesSource,
      /data\.lastTicketId\.matches\('\^IT-\[0-9\]\{4\}-' \+ formatSeq\(data\.lastNumber\) \+ '\$'\)/
    );
    assert.match(
      rulesSource,
      /getAfter\(\/databases\/\$\(database\)\/documents\/counters\/tickets\)\.data\.updatedAt == request\.time/
    );
    assert.match(
      rulesSource,
      /getAfter\(\/databases\/\$\(database\)\/documents\/counters\/tickets\)\.data\.lastTicketId == ticketId/
    );
    assert.match(
      rulesSource,
      /match \/counters\/\{counterId\}[\s\S]*?!exists\(\/databases\/\$\(database\)\/documents\/tickets\/\$\(incoming\(\)\.lastTicketId\)\)[\s\S]*?existsAfter\(\/databases\/\$\(database\)\/documents\/tickets\/\$\(incoming\(\)\.lastTicketId\)\)/
    );
  });

  it('protects /tickets read/list/create/update/delete against spoofing, blanket list, and privilege escalation', () => {
    assert.match(
      rulesSource,
      /allow get:\s*if isSignedIn\(\)\s*&&\s*isValidId\(ticketId\)\s*&&\s*\(existing\(\)\.createdByUid == request\.auth\.uid \|\| isAdmin\(\)\);/
    );
    assert.match(
      rulesSource,
      /allow list:\s*if isSignedIn\(\)\s*&&\s*\(resource\.data\.createdByUid == request\.auth\.uid \|\| isAdmin\(\)\);/
    );
    assert.match(rulesSource, /incoming\(\)\.createdByUid == request\.auth\.uid/);
    assert.match(rulesSource, /incoming\(\)\.createdByEmail == request\.auth\.token\.email/);
    assert.match(rulesSource, /incoming\(\)\.createdAt == request\.time/);
    assert.match(rulesSource, /incoming\(\)\.updatedAt == request\.time/);
    assert.match(rulesSource, /\(incoming\(\)\.status == 'รอดำเนินการ' \|\| isAdmin\(\)\)/);
    assert.match(
      rulesSource,
      /allow update:\s*if isSignedIn\(\)[\s\S]*?isAdmin\(\)[\s\S]*?incoming\(\)\.createdByUid == existing\(\)\.createdByUid[\s\S]*?incoming\(\)\.createdAt == existing\(\)\.createdAt/
    );
    assert.match(
      rulesSource,
      /allow delete:\s*if isSignedIn\(\)\s*&&\s*isValidId\(ticketId\)\s*&&\s*isAdmin\(\);/
    );
  });

  it('07 & 08: enforces strict hasOnly allowlist, length limits, and all 5 AI step elements', () => {
    assert.match(rulesSource, /data\.keys\(\)\.hasOnly\(\[/);
    assert.match(
      rulesSource,
      /data\.description is string && data\.description\.size\(\) >= 1 && data\.description\.size\(\) <= 2000/
    );
    assert.match(rulesSource, /isValidStepElement\(ai\.steps, 0\)/);
    assert.match(rulesSource, /isValidStepElement\(ai\.steps, 1\)/);
    assert.match(rulesSource, /isValidStepElement\(ai\.steps, 2\)/);
    assert.match(rulesSource, /isValidStepElement\(ai\.steps, 3\)/);
    assert.match(rulesSource, /isValidStepElement\(ai\.steps, 4\)/);
  });

  it('10 & F-09: prevents self-escalation into /admins, avoids hardcoded personal emails, and enforces custom-claim or /admins/{uid} RBAC + /auditLogs atomicity', () => {
    assert.doesNotMatch(rulesSource, /@gmail\.com/);
    assert.match(
      rulesSource,
      /function hasAdminClaim\(\)\s*\{\s*return isSignedIn\(\) && request\.auth\.token\.get\('admin', false\) == true;\s*\}/
    );
    assert.match(
      rulesSource,
      /match \/admins\/\{uid\}[\s\S]*?allow create:\s*if isSignedIn\(\)[\s\S]*?isAdmin\(\)/
    );
    assert.match(
      rulesSource,
      /match \/auditLogs\/\{logId\}[\s\S]*?allow list:\s*if isAdmin\(\);[\s\S]*?incoming\(\)\.action in \['admin\.demo_seeded', 'webhook\.config_updated'\]\s*&&\s*isAdmin\(\)[\s\S]*?incoming\(\)\.action == 'ticket\.deleted'\s*&&\s*isAdmin\(\)[\s\S]*?incoming\(\)\.action == 'ticket\.created'[\s\S]*?existsAfter\(\/databases\/\$\(database\)\/documents\/tickets\/\$\(incoming\(\)\.targetId\)\)[\s\S]*?allow update, delete:\s*if false;/
    );
  });
});

// Live Firestore Emulator execution suite (activated when FIRESTORE_EMULATOR_HOST is set)
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST?.trim();
if (emulatorHost) {
  const projectId = 'demo-it-helpdesk';
  const docRoot = `projects/${projectId}/databases/(default)/documents`;
  const baseUrl = `http://${emulatorHost}/v1/${docRoot}`;

  function makeEmulatorJwt(claims: {
    sub: string;
    email: string;
    email_verified: boolean;
    admin?: boolean;
  }): string {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        iss: `https://securetoken.google.com/${projectId}`,
        aud: projectId,
        auth_time: Math.floor(Date.now() / 1000),
        user_id: claims.sub,
        sub: claims.sub,
        email: claims.email,
        email_verified: claims.email_verified,
        ...(claims.admin ? { admin: true } : {}),
      })
    ).toString('base64url');
    return `${header}.${payload}.`;
  }

  const employeeToken = makeEmulatorJwt({
    sub: 'emp-uid-1',
    email: 'employee1@company.co.th',
    email_verified: true,
  });
  const unverifiedToken = makeEmulatorJwt({
    sub: 'unverified-uid',
    email: 'unverified@company.co.th',
    email_verified: false,
  });
  const unverifiedAdminClaimToken = makeEmulatorJwt({
    sub: 'unverified-admin-uid',
    email: 'unverified-admin@company.co.th',
    email_verified: false,
    admin: true,
  });
  const adminToken = makeEmulatorJwt({
    sub: 'admin-uid-1',
    email: 'it-admin@company.co.th',
    email_verified: true,
    admin: true,
  });

  async function commitWrites(token: string | null, writes: unknown[]): Promise<Response> {
    return fetch(`${baseUrl}:commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ writes }),
    });
  }

  function buildTicketFields(overrides: Record<string, unknown> = {}) {
    return {
      id: { stringValue: 'IT-2026-001' },
      requesterName: { stringValue: 'สมชาย ใจดี' },
      department: { stringValue: 'บัญชี' },
      contactInfo: { stringValue: 'ต่อ 104' },
      category: { stringValue: 'อินเทอร์เน็ต/Wi-Fi มีปัญหา' },
      urgency: { stringValue: 'ด่วน' },
      description: { stringValue: 'เชื่อมต่อ Wi-Fi ไม่ได้' },
      assetTag: { stringValue: 'PC-ACC-001' },
      status: { stringValue: 'รอดำเนินการ' },
      resolutionNote: { stringValue: '' },
      createdByUid: { stringValue: 'emp-uid-1' },
      createdByEmail: { stringValue: 'employee1@company.co.th' },
      completedAt: { nullValue: null },
      ...overrides,
    };
  }

  function buildAtomicTicketCommit(
    ticketId: string,
    seqNum: number,
    uid: string,
    email: string,
    auditId: string,
    ticketFieldsOverride: Record<string, unknown> = {},
    isFirstCounter = false,
    useClientTimestamp = false
  ) {
    const ticketWrite: Record<string, unknown> = {
      update: {
        name: `${docRoot}/tickets/${ticketId}`,
        fields: {
          ...buildTicketFields({
            id: { stringValue: ticketId },
            createdByUid: { stringValue: uid },
            createdByEmail: { stringValue: email },
            ...ticketFieldsOverride,
          }),
          ...(useClientTimestamp
            ? {
                createdAt: { timestampValue: '2020-01-01T00:00:00.000Z' },
                updatedAt: { timestampValue: '2020-01-01T00:00:00.000Z' },
              }
            : {}),
        },
      },
      currentDocument: { exists: false },
    };

    if (!useClientTimestamp) {
      ticketWrite.updateTransforms = [
        { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
        { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
      ];
    }

    return [
      {
        update: {
          name: `${docRoot}/counters/tickets`,
          fields: {
            lastNumber: { integerValue: String(seqNum) },
            lastTicketId: { stringValue: ticketId },
          },
        },
        ...(isFirstCounter ? { currentDocument: { exists: false } } : {}),
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      },
      ticketWrite,
      {
        update: {
          name: `${docRoot}/auditLogs/${auditId}`,
          fields: {
            action: { stringValue: 'ticket.created' },
            targetId: { stringValue: ticketId },
            actorUid: { stringValue: uid },
            actorEmail: { stringValue: email },
            summary: { stringValue: `สร้างใบแจ้งซ่อม ${ticketId}` },
          },
        },
        currentDocument: { exists: false },
        updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
      },
    ];
  }

  describe('Firestore Emulator Live Dirty Dozen (All 12 Cases) + F-11 & F-09', () => {
    it('01_unauthenticated_ticket_read: denies unauthenticated ticket read and write', async () => {
      const readRes = await fetch(`${baseUrl}/tickets/IT-2026-001`);
      assert.equal(readRes.status, 403);

      const writeRes = await commitWrites(
        null,
        buildAtomicTicketCommit(
          'IT-2026-001',
          1,
          'emp-uid-1',
          'employee1@company.co.th',
          'aud-01',
          {},
          true
        )
      );
      assert.equal(writeRes.status, 403);
    });

    it('02_unverified_email_ticket_create: denies unverified email ticket creation', async () => {
      const res = await commitWrites(
        unverifiedToken,
        buildAtomicTicketCommit(
          'IT-2026-001',
          1,
          'unverified-uid',
          'unverified@company.co.th',
          'aud-02',
          {},
          true
        )
      );
      assert.equal(res.status, 403);
    });

    it('03_spoofed_createdByUid_on_create: denies spoofing createdByUid', async () => {
      const res = await commitWrites(
        employeeToken,
        buildAtomicTicketCommit(
          'IT-2026-001',
          1,
          'emp-uid-1',
          'employee1@company.co.th',
          'aud-03',
          { createdByUid: { stringValue: 'victim-uid' } },
          true
        )
      );
      assert.equal(res.status, 403);
    });

    it('04_non_admin_creates_completed_status: denies employee creating completed ticket', async () => {
      const res = await commitWrites(
        employeeToken,
        buildAtomicTicketCommit(
          'IT-2026-001',
          1,
          'emp-uid-1',
          'employee1@company.co.th',
          'aud-04',
          { status: { stringValue: 'เสร็จสิ้น' } },
          true
        )
      );
      assert.equal(res.status, 403);
    });

    it('06_non_admin_blanket_list_tickets: denies unfiltered blanket list by employee', async () => {
      const res = await fetch(`${baseUrl}/tickets`, {
        headers: { Authorization: `Bearer ${employeeToken}` },
      });
      assert.equal(res.status, 403);
    });

    it('07_shadow_field_injection_on_ticket: denies ghost/shadow fields on ticket', async () => {
      const res = await commitWrites(
        employeeToken,
        buildAtomicTicketCommit(
          'IT-2026-001',
          1,
          'emp-uid-1',
          'employee1@company.co.th',
          'aud-07',
          { isAdminApproved: { booleanValue: true } },
          true
        )
      );
      assert.equal(res.status, 403);
    });

    it('08_oversized_description_or_id_poisoning: denies oversized description and invalid ticket ID', async () => {
      const oversized = await commitWrites(
        employeeToken,
        buildAtomicTicketCommit(
          'IT-2026-001',
          1,
          'emp-uid-1',
          'employee1@company.co.th',
          'aud-08a',
          { description: { stringValue: 'x'.repeat(2001) } },
          true
        )
      );
      assert.equal(oversized.status, 403);

      const poisonedId = await commitWrites(
        employeeToken,
        buildAtomicTicketCommit(
          'IT-bad$id',
          1,
          'emp-uid-1',
          'employee1@company.co.th',
          'aud-08b',
          {},
          true
        )
      );
      assert.equal(poisonedId.status, 403);
    });

    it('09_client_spoofed_createdAt_timestamp: denies client-supplied createdAt timestamp', async () => {
      const res = await commitWrites(
        employeeToken,
        buildAtomicTicketCommit(
          'IT-2026-001',
          1,
          'emp-uid-1',
          'employee1@company.co.th',
          'aud-09',
          {},
          true,
          true
        )
      );
      assert.equal(res.status, 403);
    });

    it('10_self_escalation_into_admins_collection: denies non-admin writing to /admins', async () => {
      const res = await commitWrites(employeeToken, [
        {
          update: {
            name: `${docRoot}/admins/emp-uid-1`,
            fields: {
              email: { stringValue: 'employee1@company.co.th' },
              addedByUid: { stringValue: 'emp-uid-1' },
            },
          },
          currentDocument: { exists: false },
          updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
        },
      ]);
      assert.equal(res.status, 403);
    });

    it('F-11: blocks orphan counter increment and counter/ticket ID mismatch', async () => {
      const orphanCounter = await commitWrites(employeeToken, [
        {
          update: {
            name: `${docRoot}/counters/tickets`,
            fields: {
              lastNumber: { integerValue: '1' },
              lastTicketId: { stringValue: 'IT-2026-001' },
            },
          },
          currentDocument: { exists: false },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        },
      ]);
      assert.equal(orphanCounter.status, 403);

      const mismatchedCounter = await commitWrites(employeeToken, [
        {
          update: {
            name: `${docRoot}/counters/tickets`,
            fields: {
              lastNumber: { integerValue: '1' },
              lastTicketId: { stringValue: 'IT-2026-009' },
            },
          },
          currentDocument: { exists: false },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        },
      ]);
      assert.equal(mismatchedCounter.status, 403);
    });

    it('F-09: denies non-admin forging admin audit actions or orphan ticket.created logs', async () => {
      const forgedWebhookAudit = await commitWrites(employeeToken, [
        {
          update: {
            name: `${docRoot}/auditLogs/aud-forged-1`,
            fields: {
              action: { stringValue: 'webhook.config_updated' },
              targetId: { stringValue: 'webhook' },
              actorUid: { stringValue: 'emp-uid-1' },
              actorEmail: { stringValue: 'employee1@company.co.th' },
              summary: { stringValue: 'Forged webhook event' },
            },
          },
          currentDocument: { exists: false },
          updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
        },
      ]);
      assert.equal(forgedWebhookAudit.status, 403);

      const forgedCreatedAudit = await commitWrites(employeeToken, [
        {
          update: {
            name: `${docRoot}/auditLogs/aud-forged-2`,
            fields: {
              action: { stringValue: 'ticket.created' },
              targetId: { stringValue: 'IT-2026-999' },
              actorUid: { stringValue: 'emp-uid-1' },
              actorEmail: { stringValue: 'employee1@company.co.th' },
              summary: { stringValue: 'Fake ticket log without ticket' },
            },
          },
          currentDocument: { exists: false },
          updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
        },
      ]);
      assert.equal(forgedCreatedAudit.status, 403);
    });

    it('valid atomic ticket + counter + audit creation succeeds, then enforces 05, 11, 12 and admin lifecycle', async () => {
      // Valid atomic creation #1
      const create1 = await commitWrites(
        employeeToken,
        buildAtomicTicketCommit(
          'IT-2026-001',
          1,
          'emp-uid-1',
          'employee1@company.co.th',
          'aud-create-001',
          {},
          true
        )
      );
      assert.equal(create1.status, 200);

      // F-11: employee cannot create ticket IT-2026-999 with counter IT-2026-002
      const mismatchTicket = await commitWrites(employeeToken, [
        {
          update: {
            name: `${docRoot}/counters/tickets`,
            fields: {
              lastNumber: { integerValue: '2' },
              lastTicketId: { stringValue: 'IT-2026-002' },
            },
          },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        },
        {
          update: {
            name: `${docRoot}/tickets/IT-2026-999`,
            fields: buildTicketFields({ id: { stringValue: 'IT-2026-999' } }),
          },
          currentDocument: { exists: false },
          updateTransforms: [
            { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
            { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
          ],
        },
      ]);
      assert.equal(mismatchTicket.status, 403);

      // 05_non_admin_updates_ticket_status: employee cannot update own ticket status
      const empUpdate = await fetch(
        `${baseUrl}/tickets/IT-2026-001?updateMask.fieldPaths=status`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${employeeToken}`,
          },
          body: JSON.stringify({
            fields: { status: { stringValue: 'กำลังซ่อม' } },
          }),
        }
      );
      assert.equal(empUpdate.status, 403);

      // 11_mutating_immutable_createdByUid_or_createdAt: even admin cannot mutate createdByUid
      const adminMutateImmutable = await commitWrites(adminToken, [
        {
          update: {
            name: `${docRoot}/tickets/IT-2026-001`,
            fields: buildTicketFields({ createdByUid: { stringValue: 'other-uid' } }),
          },
          updateMask: { fieldPaths: ['createdByUid', 'updatedAt'] },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        },
      ]);
      assert.equal(adminMutateImmutable.status, 403);

      // 12_non_admin_deletes_ticket: employee cannot delete ticket
      const empDelete = await fetch(`${baseUrl}/tickets/IT-2026-001`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${employeeToken}` },
      });
      assert.equal(empDelete.status, 403);

      // Unverified email with admin:true claim must still be denied admin list access
      const unverifiedAdminList = await fetch(`${baseUrl}/tickets`, {
        headers: { Authorization: `Bearer ${unverifiedAdminClaimToken}` },
      });
      assert.equal(unverifiedAdminList.status, 403);

      // Valid admin update + atomic ticket.updated audit succeeds
      const adminUpdate = await commitWrites(adminToken, [
        {
          update: {
            name: `${docRoot}/tickets/IT-2026-001`,
            fields: buildTicketFields({
              status: { stringValue: 'กำลังซ่อม' },
              resolutionNote: { stringValue: 'กำลังตรวจสอบ' },
            }),
          },
          updateMask: { fieldPaths: ['status', 'resolutionNote', 'completedAt', 'updatedAt'] },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        },
        {
          update: {
            name: `${docRoot}/auditLogs/aud-upd-001`,
            fields: {
              action: { stringValue: 'ticket.updated' },
              targetId: { stringValue: 'IT-2026-001' },
              actorUid: { stringValue: 'admin-uid-1' },
              actorEmail: { stringValue: 'it-admin@company.co.th' },
              summary: { stringValue: 'อัปเดตสถานะ IT-2026-001' },
            },
          },
          currentDocument: { exists: false },
          updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
        },
      ]);
      assert.equal(adminUpdate.status, 200);

      // Valid admin delete + atomic ticket.deleted audit succeeds
      const adminDelete = await commitWrites(adminToken, [
        { delete: `${docRoot}/tickets/IT-2026-001` },
        {
          update: {
            name: `${docRoot}/auditLogs/aud-del-001`,
            fields: {
              action: { stringValue: 'ticket.deleted' },
              targetId: { stringValue: 'IT-2026-001' },
              actorUid: { stringValue: 'admin-uid-1' },
              actorEmail: { stringValue: 'it-admin@company.co.th' },
              summary: { stringValue: 'ลบใบแจ้งซ่อม IT-2026-001' },
            },
          },
          currentDocument: { exists: false },
          updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
        },
      ]);
      assert.equal(adminDelete.status, 200);

      // Immutable audit log cannot be deleted even by admin
      const adminDeleteAudit = await fetch(`${baseUrl}/auditLogs/aud-create-001`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(adminDeleteAudit.status, 403);

      // F-14: Admin demo seed with mismatched lastTicketId IT-2026-001 for lastNumber=5 must fail
      const badSeed = await commitWrites(adminToken, [
        {
          update: {
            name: `${docRoot}/counters/tickets`,
            fields: {
              lastNumber: { integerValue: '5' },
              lastTicketId: { stringValue: 'IT-2026-001' },
            },
          },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        },
        {
          update: {
            name: `${docRoot}/tickets/IT-2026-005`,
            fields: buildTicketFields({
              id: { stringValue: 'IT-2026-005' },
              createdByUid: { stringValue: 'admin-uid-1' },
              createdByEmail: { stringValue: 'it-admin@company.co.th' },
            }),
          },
          currentDocument: { exists: false },
          updateTransforms: [
            { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
            { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
          ],
        },
      ]);
      assert.equal(badSeed.status, 403);

      // F-14: Valid admin demo seed with lastNumber=5 and lastTicketId=IT-2026-005 succeeds
      const goodSeed = await commitWrites(adminToken, [
        {
          update: {
            name: `${docRoot}/counters/tickets`,
            fields: {
              lastNumber: { integerValue: '5' },
              lastTicketId: { stringValue: 'IT-2026-005' },
            },
          },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        },
        {
          update: {
            name: `${docRoot}/tickets/IT-2026-005`,
            fields: buildTicketFields({
              id: { stringValue: 'IT-2026-005' },
              createdByUid: { stringValue: 'admin-uid-1' },
              createdByEmail: { stringValue: 'it-admin@company.co.th' },
            }),
          },
          currentDocument: { exists: false },
          updateTransforms: [
            { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
            { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
          ],
        },
        {
          update: {
            name: `${docRoot}/auditLogs/aud-seed-001`,
            fields: {
              action: { stringValue: 'admin.demo_seeded' },
              targetId: { stringValue: 'tickets' },
              actorUid: { stringValue: 'admin-uid-1' },
              actorEmail: { stringValue: 'it-admin@company.co.th' },
              summary: { stringValue: 'เพิ่มข้อมูลตัวอย่างลงฐานข้อมูล Firestore' },
            },
          },
          currentDocument: { exists: false },
          updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
        },
      ]);
      assert.equal(goodSeed.status, 200);
    });
  });
}
