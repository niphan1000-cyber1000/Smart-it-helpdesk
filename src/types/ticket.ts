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
