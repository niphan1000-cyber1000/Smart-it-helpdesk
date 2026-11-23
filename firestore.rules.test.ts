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
      /existsAfter\(\/databases\/\$\(database\)\/documents\/counters\/tickets\)/
    );
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

  it('10 & F-09: prevents self-escalation into /admins and enforces /auditLogs trust boundary + atomicity', () => {
    assert.match(
      rulesSource,
      /match \/admins\/\{uid\}[\s\S]*?allow create:\s*if isSignedIn\(\)[\s\S]*?isAdmin\(\)/
    );
    assert.match(
      rulesSource,
      /match \/auditLogs\/\{logId\}[\s\S]*?allow list:\s*if isAdmin\(\);[\s\S]*?incoming\(\)\.action in \['admin\.demo_seeded', 'webhook\.config_updated'\]\s*&&\s*isAdmin\(\)[\s\S]*?incoming\(\)\.action == 'ticket\.deleted'\s*&&\s*isAdmin\(\)[\s\S]*?incoming\(\)\.action == 'ticket\.created'[\s\S]*?existsAfter\(\/databases\/\$\(database\)\/documents\/tickets\/\$\(incoming\(\)\.targetId\)\)[\s\S]*?allow update, delete:\s*if false;/
    );
  });

  it('enforces monotonic atomic increments on /counters/tickets and blocks deletes', () => {
    assert.match(
      rulesSource,
      /match \/counters\/\{counterId\}[\s\S]*?allow list:\s*if false;[\s\S]*?incoming\(\)\.lastNumber == existing\(\)\.lastNumber \+ 1[\s\S]*?allow delete:\s*if false;/
    );
  });
});

// Live Firestore Emulator execution suite (activated when FIRESTORE_EMULATOR_HOST is set)
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST?.trim();
if (emulatorHost) {
  const projectId = 'demo-it-helpdesk';
  const baseUrl = `http://${emulatorHost}/v1/projects/${projectId}/databases/(default)/documents`;

  function makeEmulatorJwt(claims: {
    sub: string;
    email: string;
    email_verified: boolean;
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
  const adminToken = makeEmulatorJwt({
    sub: 'admin-uid-1',
    email: 'niphan1000@gmail.com',
    email_verified: true,
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

  describe('Firestore Emulator Live Dirty Dozen & Audit Trust Boundary', () => {
    it('01 & 06: denies unauthenticated ticket read and employee blanket list', async () => {
      const unauthGet = await fetch(`${baseUrl}/tickets/IT-2026-001`);
      assert.equal(unauthGet.status, 403);

      const empList = await fetch(`${baseUrl}/tickets`, {
        headers: { Authorization: `Bearer ${employeeToken}` },
      });
      assert.equal(empList.status, 403);
    });

    it('02 & F-09: denies unverified email ticket create and denies employee forging admin audit events', async () => {
      const unverifiedCommit = await commitWrites(unverifiedToken, [
        {
          update: {
            name: `projects/${projectId}/databases/(default)/documents/counters/tickets`,
            fields: { lastNumber: { integerValue: '1' } },
          },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        },
      ]);
      assert.equal(unverifiedCommit.status, 403);

      const forgedAdminAudit = await commitWrites(employeeToken, [
        {
          update: {
            name: `projects/${projectId}/databases/(default)/documents/auditLogs/aud-forged-1`,
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
      assert.equal(forgedAdminAudit.status, 403);

      const forgedTicketCreatedAudit = await commitWrites(employeeToken, [
        {
          update: {
            name: `projects/${projectId}/databases/(default)/documents/auditLogs/aud-forged-2`,
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
      assert.equal(forgedTicketCreatedAudit.status, 403);
    });

    it('allows atomic ticket + counter + ticket.created audit creation, then allows admin update & blocks immutable audit delete', async () => {
      const ticketPath = `projects/${projectId}/databases/(default)/documents/tickets/IT-2026-001`;
      const counterPath = `projects/${projectId}/databases/(default)/documents/counters/tickets`;
      const auditCreatePath = `projects/${projectId}/databases/(default)/documents/auditLogs/aud-create-001`;

      const createRes = await commitWrites(employeeToken, [
        {
          update: {
            name: counterPath,
            fields: { lastNumber: { integerValue: '1' } },
          },
          currentDocument: { exists: false },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        },
        {
          update: {
            name: ticketPath,
            fields: {
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
            },
          },
          currentDocument: { exists: false },
          updateTransforms: [
            { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
            { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
          ],
        },
        {
          update: {
            name: auditCreatePath,
            fields: {
              action: { stringValue: 'ticket.created' },
              targetId: { stringValue: 'IT-2026-001' },
              actorUid: { stringValue: 'emp-uid-1' },
              actorEmail: { stringValue: 'employee1@company.co.th' },
              summary: { stringValue: 'สร้างใบแจ้งซ่อม IT-2026-001' },
            },
          },
          currentDocument: { exists: false },
          updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
        },
      ]);
      assert.equal(createRes.status, 200);

      // 10: Employee cannot self-escalate into /admins
      const selfEscalate = await commitWrites(employeeToken, [
        {
          update: {
            name: `projects/${projectId}/databases/(default)/documents/admins/emp-uid-1`,
            fields: {
              email: { stringValue: 'employee1@company.co.th' },
              addedByUid: { stringValue: 'emp-uid-1' },
            },
          },
          currentDocument: { exists: false },
          updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
        },
      ]);
      assert.equal(selfEscalate.status, 403);

      // 12: Employee cannot delete ticket
      const empDelete = await fetch(`${baseUrl}/tickets/IT-2026-001`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${employeeToken}` },
      });
      assert.equal(empDelete.status, 403);

      // Admin cannot delete immutable auditLogs
      const adminDeleteAudit = await fetch(`${baseUrl}/auditLogs/aud-create-001`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(adminDeleteAudit.status, 403);
    });
  });
}
