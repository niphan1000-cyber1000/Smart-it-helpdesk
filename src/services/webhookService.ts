import { User } from 'firebase/auth';

export type WebhookType = 'auto' | 'discord' | 'telegram' | 'custom';

export interface WebhookStatusResponse {
  configured: boolean;
  source: 'env' | 'runtime' | 'none';
  maskedUrl: string;
  type: WebhookType;
}

export interface WebhookNotifyResponse {
  sent: boolean;
  skipped?: boolean;
  reason?: string;
}

async function getBearerHeader(user: User): Promise<Record<string, string>> {
  const token = await user.getIdToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function fetchWebhookStatus(
  user: User
): Promise<WebhookStatusResponse> {
  const headers = await getBearerHeader(user);
  const res = await fetch('/api/webhook/status', { headers });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || 'ไม่สามารถตรวจสอบสถานะ Webhook ได้');
  }
  return data as WebhookStatusResponse;
}

export async function saveWebhookConfig(
  user: User,
  url: string,
  type: WebhookType
): Promise<WebhookStatusResponse> {
  const headers = await getBearerHeader(user);
  const res = await fetch('/api/webhook/config', {
    method: 'POST',
    headers,
    body: JSON.stringify({ url, type }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || 'ไม่สามารถบันทึก Webhook URL ได้');
  }
  return data as WebhookStatusResponse;
}

export async function clearWebhookConfig(
  user: User
): Promise<WebhookStatusResponse> {
  const headers = await getBearerHeader(user);
  const res = await fetch('/api/webhook/config', {
    method: 'POST',
    headers,
    body: JSON.stringify({ url: '', type: 'auto' }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || 'ไม่สามารถล้างการตั้งค่า Webhook ได้');
  }
  return data as WebhookStatusResponse;
}

export async function sendWebhookTest(
  user: User
): Promise<{ ok: boolean; message: string }> {
  const headers = await getBearerHeader(user);
  const res = await fetch('/api/webhook/test', {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || 'การทดสอบส่ง Webhook ล้มเหลว');
  }
  return data as { ok: boolean; message: string };
}

export async function notifyTicketWebhook(
  user: User,
  ticketId: string
): Promise<WebhookNotifyResponse> {
  const headers = await getBearerHeader(user);
  const res = await fetch('/api/webhook/notify', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ticketId }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || 'ไม่สามารถส่งแจ้งเตือน Webhook ได้');
  }
  return data as WebhookNotifyResponse;
}
