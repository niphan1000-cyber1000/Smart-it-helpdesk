import { ALLOWED_WEBHOOK_HOSTS } from '../config.ts';
import {
  postJsonWithPinnedIp,
  validateWebhookUrlAndResolve,
} from '../security.ts';

export type WebhookType = 'auto' | 'discord' | 'telegram' | 'custom';

export interface TicketWebhookPayload {
  id: string;
  requesterName: string;
  department: string;
  contactInfo: string;
  category: string;
  urgency: string;
  assetTag: string;
  description: string;
}

export interface WebhookStatusInfo {
  configured: boolean;
  source: 'env' | 'runtime' | 'none';
  maskedUrl: string;
  type: WebhookType;
}

let runtimeWebhookConfig: { url: string; type: WebhookType } | null = null;

function maskWebhookUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const tail = rawUrl.length > 8 ? rawUrl.slice(-6) : '••••';
    return `${u.origin}/••••${tail}`;
  } catch {
    return '••••';
  }
}

export function getEffectiveWebhook(): {
  url: string;
  type: WebhookType;
  source: 'env' | 'runtime' | 'none';
} {
  const envUrl = process.env.WEBHOOK_URL?.trim();
  const envType = (process.env.WEBHOOK_TYPE?.trim() as WebhookType) || 'auto';
  if (envUrl) {
    return { url: envUrl, type: envType, source: 'env' };
  }
  if (runtimeWebhookConfig) {
    return {
      url: runtimeWebhookConfig.url,
      type: runtimeWebhookConfig.type,
      source: 'runtime',
    };
  }
  return { url: '', type: 'auto', source: 'none' };
}

export function getWebhookStatusInfo(): WebhookStatusInfo {
  const effective = getEffectiveWebhook();
  return {
    configured: Boolean(effective.url),
    source: effective.source,
    maskedUrl: effective.url ? maskWebhookUrl(effective.url) : '',
    type: effective.type,
  };
}

export function clearRuntimeWebhookConfig(): WebhookStatusInfo {
  runtimeWebhookConfig = null;
  return getWebhookStatusInfo();
}

export async function setRuntimeWebhookConfig(
  rawUrl: string,
  type: WebhookType
): Promise<{ ok: true; status: WebhookStatusInfo } | { ok: false; error: string }> {
  const check = await validateWebhookUrlAndResolve(rawUrl, ALLOWED_WEBHOOK_HOSTS);
  if (!check.valid || !check.url) {
    return {
      ok: false,
      error: check.error || 'Webhook URL ไม่ผ่านการตรวจสอบความปลอดภัย',
    };
  }

  runtimeWebhookConfig = { url: check.url.toString(), type };
  return {
    ok: true,
    status: getWebhookStatusInfo(),
  };
}

function detectWebhookType(
  url: string,
  configuredType: WebhookType
): Exclude<WebhookType, 'auto'> {
  if (configuredType !== 'auto') return configuredType;
  const lower = url.toLowerCase();
  if (
    lower.includes('discord.com/api/webhooks/') ||
    lower.includes('discordapp.com/api/webhooks/')
  ) {
    return 'discord';
  }
  if (lower.includes('api.telegram.org/')) {
    return 'telegram';
  }
  return 'custom';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildWebhookBody(
  targetKind: Exclude<WebhookType, 'auto'>,
  ticket: TicketWebhookPayload,
  isTest = false
): Record<string, unknown> {
  const prefix = isTest ? '[ทดสอบระบบแจ้งเตือน] ' : '';

  if (targetKind === 'discord') {
    const color = ticket.urgency.includes('ด่วนมาก')
      ? 0xdc2626
      : ticket.urgency === 'ด่วน'
        ? 0xd97706
        : 0x1d4ed8;
    return {
      username: 'ศูนย์แจ้งซ่อมไอที (IT Helpdesk)',
      content: `${prefix}มีใบแจ้งซ่อมใหม่ **${ticket.id}** (${ticket.urgency})`,
      embeds: [
        {
          title: `${prefix}ใบแจ้งซ่อม ${ticket.id} — ${ticket.category}`,
          description: ticket.description,
          color,
          fields: [
            { name: 'ผู้แจ้ง', value: ticket.requesterName, inline: true },
            { name: 'แผนก', value: ticket.department || '-', inline: true },
            { name: 'ความเร่งด่วน', value: ticket.urgency || '-', inline: true },
            { name: 'ติดต่อ', value: ticket.contactInfo || '-', inline: true },
            { name: 'ครุภัณฑ์', value: ticket.assetTag || 'ไม่ระบุ', inline: true },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    };
  }

  if (targetKind === 'telegram') {
    const lines = [
      `<b>${escapeHtml(prefix)}แจ้งเตือนใบแจ้งซ่อมไอทีใหม่ (${escapeHtml(ticket.id)})</b>`,
      `<b>ผู้แจ้ง:</b> ${escapeHtml(ticket.requesterName)} (แผนก${escapeHtml(ticket.department || '-')})`,
      `<b>ติดต่อ:</b> ${escapeHtml(ticket.contactInfo || '-')}`,
      `<b>ประเภท:</b> ${escapeHtml(ticket.category || '-')}`,
      `<b>ความเร่งด่วน:</b> ${escapeHtml(ticket.urgency || '-')}`,
      `<b>ครุภัณฑ์:</b> ${escapeHtml(ticket.assetTag || 'ไม่ระบุ')}`,
      `<b>อาการ:</b> ${escapeHtml(ticket.description)}`,
    ];
    return {
      text: lines.join('\n'),
      parse_mode: 'HTML',
    };
  }

  const summaryText = `${prefix}ใบแจ้งซ่อมใหม่ ${ticket.id}\nผู้แจ้ง: ${ticket.requesterName} (${ticket.department})\nติดต่อ: ${ticket.contactInfo}\nประเภท: ${ticket.category}\nความเร่งด่วน: ${ticket.urgency}\nครุภัณฑ์: ${ticket.assetTag || '-'}\nอาการ: ${ticket.description}`;
  return {
    event: isTest ? 'ticket.test' : 'ticket.created',
    text: summaryText,
    message: summaryText,
    ticket: {
      ...ticket,
      createdAt: new Date().toISOString(),
    },
  };
}

export async function dispatchWebhook(
  url: string,
  configuredType: WebhookType,
  ticket: TicketWebhookPayload,
  isTest = false
): Promise<void> {
  const check = await validateWebhookUrlAndResolve(url, ALLOWED_WEBHOOK_HOSTS);
  if (!check.valid || !check.url || !check.resolvedIps || check.resolvedIps.length === 0) {
    throw new Error(check.error || 'Webhook URL ไม่ผ่านการตรวจสอบความปลอดภัย');
  }

  const targetKind = detectWebhookType(check.url.toString(), configuredType);
  const body = buildWebhookBody(targetKind, ticket, isTest);
  const pinnedIp = check.resolvedIps[0];

  const response = await postJsonWithPinnedIp(check.url, pinnedIp, body, 8000);

  if (response.status >= 300 && response.status < 400) {
    throw new Error('ปลายทาง Webhook พยายาม Redirect ซึ่งถูกปฏิเสธเพื่อความปลอดภัย');
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`ปลายทาง Webhook ตอบกลับสถานะ HTTP ${response.status}`);
  }
}
