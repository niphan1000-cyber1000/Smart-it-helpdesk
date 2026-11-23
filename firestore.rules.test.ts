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
    // 01 & 06: get and list scoped to owner or admin
    assert.match(
      rulesSource,
      /allow get:\s*if isSignedIn\(\)\s*&&\s*isValidId\(ticketId\)\s*&&\s*\(existing\(\)\.createdByUid == request\.auth\.uid \|\| isAdmin\(\)\);/
    );
    assert.match(
      rulesSource,
      /allow list:\s*if isSignedIn\(\)\s*&&\s*\(resource\.data\.createdByUid == request\.auth\.uid \|\| isAdmin\(\)\);/
    );
    // 03, 04, 09 + atomic counter binding
    assert.match(rulesSource, /incoming\(\)\.createdByUid == request\.auth\.uid/);
    assert.match(rulesSource, /incoming\(\)\.createdByEmail == request\.auth\.token\.email/);
    assert.match(rulesSource, /incoming\(\)\.createdAt == request\.time/);
    assert.match(rulesSource, /incoming\(\)\.updatedAt == request\.time/);
    assert.match(rulesSource, /\(incoming\(\)\.status == 'รอดำเนินการ' \|\| isAdmin\(\)\)/);
    assert.match(
      rulesSource,
      /existsAfter\(\/databases\/\$\(database\)\/documents\/counters\/tickets\)/
    );
    // 05, 11, 12: update and delete restricted to isAdmin(), immutable ownership fields preserved
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
    assert.match(rulesSource, /data\.description is string && data\.description\.size\(\) >= 1 && data\.description\.size\(\) <= 2000/);
    assert.match(rulesSource, /isValidStepElement\(ai\.steps, 0\)/);
    assert.match(rulesSource, /isValidStepElement\(ai\.steps, 1\)/);
    assert.match(rulesSource, /isValidStepElement\(ai\.steps, 2\)/);
    assert.match(rulesSource, /isValidStepElement\(ai\.steps, 3\)/);
    assert.match(rulesSource, /isValidStepElement\(ai\.steps, 4\)/);
  });

  it('10: prevents self-escalation into /admins and enforces append-only /auditLogs', () => {
    assert.match(
      rulesSource,
      /match \/admins\/\{uid\}[\s\S]*?allow create:\s*if isSignedIn\(\)[\s\S]*?isAdmin\(\)/
    );
    assert.match(
      rulesSource,
      /match \/auditLogs\/\{logId\}[\s\S]*?allow list:\s*if isAdmin\(\);[\s\S]*?allow update, delete:\s*if false;/
    );
  });

  it('enforces monotonic atomic increments on /counters/tickets and blocks deletes', () => {
    assert.match(
      rulesSource,
      /match \/counters\/\{counterId\}[\s\S]*?allow list:\s*if false;[\s\S]*?incoming\(\)\.lastNumber == existing\(\)\.lastNumber \+ 1[\s\S]*?allow delete:\s*if false;/
    );
  });
});

// Optional live Firestore Emulator check when FIRESTORE_EMULATOR_HOST is configured in CI or local dev
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST?.trim();
if (emulatorHost) {
  describe('Firestore Emulator Live Rule Checks', () => {
    it('denies unauthenticated ticket reads against running emulator', async () => {
      const res = await fetch(
        `http://${emulatorHost}/v1/projects/demo-it-helpdesk/databases/(default)/documents/tickets/IT-2026-001`
      );
      assert.equal(res.status, 403);
    });
  });
}
