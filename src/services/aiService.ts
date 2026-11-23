import { User } from 'firebase/auth';
import {
  AiDiagnosticResult,
  AiTroubleshootResult,
  ProblemCategory,
  RepairTicket,
} from '../types/ticket';

export interface AiApiResponse<T> {
  source: 'gemini' | 'fallback';
  model: string;
  notice?: string;
  data: T;
}

async function getBearerHeaders(user: User): Promise<Record<string, string>> {
  const token = await user.getIdToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function requestUserTroubleshoot(
  user: User,
  category: ProblemCategory,
  description: string
): Promise<AiApiResponse<AiTroubleshootResult>> {
  const headers = await getBearerHeaders(user);
  const response = await fetch('/api/ai/troubleshoot', {
    method: 'POST',
    headers,
    body: JSON.stringify({ category, description }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof payload?.error === 'string'
        ? payload.error
        : 'ไม่สามารถเชื่อมต่อ AI ผู้ช่วยซ่อมเบื้องต้นได้ในขณะนี้'
    );
  }
  return payload as AiApiResponse<AiTroubleshootResult>;
}

export async function requestTechDiagnostic(
  user: User,
  ticket: RepairTicket
): Promise<AiApiResponse<AiDiagnosticResult>> {
  const headers = await getBearerHeaders(user);
  const response = await fetch('/api/ai/diagnostic', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ticketId: ticket.id,
      category: ticket.category,
      description: ticket.description,
      urgency: ticket.urgency,
      assetTag: ticket.assetTag,
      department: ticket.department,
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof payload?.error === 'string'
        ? payload.error
        : 'ไม่สามารถเรียกวิเคราะห์เชิงลึกสำหรับช่างได้ในขณะนี้'
    );
  }
  return payload as AiApiResponse<AiDiagnosticResult>;
}
