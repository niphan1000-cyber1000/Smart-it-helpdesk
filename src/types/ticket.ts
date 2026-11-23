export const DEPARTMENTS = [
  'บัญชี',
  'การตลาด',
  'บุคคล',
  'ขาย',
  'ไอที',
  'อื่นๆ',
] as const;

export type Department = (typeof DEPARTMENTS)[number];

export const PROBLEM_CATEGORIES = [
  'คอมพิวเตอร์เปิดไม่ติด/จอดำ',
  'ลง Windows/โปรแกรมใหม่',
  'อินเทอร์เน็ต/Wi-Fi มีปัญหา',
  'ปริ้นเตอร์/สแกนเนอร์',
  'อุปกรณ์ต่อพ่วง เมาส์/คีย์บอร์ด',
  'อื่นๆ',
] as const;

export type ProblemCategory = (typeof PROBLEM_CATEGORIES)[number];

export const URGENCY_LEVELS = [
  'ปกติ',
  'ด่วน',
  'ด่วนมาก - ทำงานต่อไม่ได้',
] as const;

export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];

export const TICKET_STATUSES = [
  'รอดำเนินการ',
  'กำลังซ่อม',
  'รออะไหล่',
  'เสร็จสิ้น',
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

export type AppViewMode = 'user' | 'admin';

export type UserRole = 'admin' | 'employee';

export type Permission =
  | 'ticket:read_all'
  | 'ticket:read_own'
  | 'ticket:create'
  | 'ticket:update'
  | 'ticket:delete'
  | 'ai:troubleshoot'
  | 'ai:diagnostic'
  | 'webhook:manage'
  | 'audit:read';

const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  admin: [
    'ticket:read_all',
    'ticket:read_own',
    'ticket:create',
    'ticket:update',
    'ticket:delete',
    'ai:troubleshoot',
    'ai:diagnostic',
    'webhook:manage',
    'audit:read',
  ],
  employee: ['ticket:read_own', 'ticket:create', 'ai:troubleshoot'],
};

export function getPermissionsForRole(role: UserRole): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function hasPermission(
  permissions: readonly Permission[],
  permission: Permission
): boolean {
  return permissions.includes(permission);
}

export type AuditAction =
  | 'ticket.created'
  | 'ticket.updated'
  | 'ticket.deleted'
  | 'ai.self_resolved'
  | 'admin.demo_seeded'
  | 'webhook.config_updated';

export interface AuditLogEntry {
  id: string;
  action: AuditAction;
  targetId: string;
  actorUid: string;
  actorEmail: string;
  summary: string;
  createdAt: string;
}

export interface AiTroubleshootResult {
  summary: string;
  steps: string[];
  warningNote: string;
}

export interface AiDiagnosticResult {
  rootCause: string;
  toolsAndParts: string[];
  technicalSteps: string[];
}

export interface AiAttemptHistory {
  summary: string;
  steps: string[];
  warningNote: string;
  source: 'gemini' | 'fallback';
  triedAt: string;
}

export interface AiStats {
  selfResolvedCount: number;
  lastResolvedAt: string | null;
}

export interface RepairTicket {
  id: string;
  requesterName: string;
  department: Department;
  contactInfo: string;
  category: ProblemCategory;
  urgency: UrgencyLevel;
  description: string;
  assetTag: string;
  status: TicketStatus;
  resolutionNote: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  aiTroubleshooting?: AiAttemptHistory | null;
}

export interface NewTicketInput {
  requesterName: string;
  department: Department;
  contactInfo: string;
  category: ProblemCategory;
  urgency: UrgencyLevel;
  description: string;
  assetTag: string;
  aiTroubleshooting?: AiAttemptHistory | null;
}
