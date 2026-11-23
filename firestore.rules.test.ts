// Security specification test cases for Firestore rules (Dirty Dozen verification)
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
