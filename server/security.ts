import dns from 'node:dns/promises';
import net from 'node:net';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export class SlidingWindowRateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly buckets: Map<string, number[]> = new Map();

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  check(key: string, nowMs = Date.now()): RateLimitResult {
    const cutoff = nowMs - this.windowMs;
    const prev = this.buckets.get(key) || [];
    const active = prev.filter((ts) => ts > cutoff);

    if (active.length >= this.maxRequests) {
      const oldest = active[0] ?? nowMs;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((oldest + this.windowMs - nowMs) / 1000)
      );
      this.buckets.set(key, active);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds,
      };
    }

    active.push(nowMs);
    this.buckets.set(key, active);
    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequests - active.length),
      retryAfterSeconds: 0,
    };
  }
}

export function isPrivateOrBlockedIp(rawIp: string): boolean {
  const ip = rawIp.trim().toLowerCase();
  if (!ip) return true;

  // Handle IPv4-mapped IPv6 addresses like ::ffff:127.0.0.1
  if (ip.startsWith('::ffff:')) {
    const v4Part = ip.slice(7);
    if (net.isIPv4(v4Part)) {
      return isPrivateOrBlockedIp(v4Part);
    }
  }

  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map((n) => parseInt(n, 10));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }

  if (net.isIPv6(ip)) {
    if (
      ip === '::' ||
      ip === '::1' ||
      ip.startsWith('fc') ||
      ip.startsWith('fd') ||
      ip.startsWith('fe80') ||
      ip.startsWith('ff')
    ) {
      return true;
    }
    return false;
  }

  return true;
}

export interface WebhookUrlCheckResult {
  valid: boolean;
  url?: URL;
  resolvedIps?: string[];
  error?: string;
}

export function validateWebhookUrlStructure(
  rawUrl: string,
  allowedHosts: string[] = []
): WebhookUrlCheckResult {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, error: 'กรุณาระบุ Webhook URL' };
  }
  if (trimmed.length > 1000) {
    return { valid: false, error: 'Webhook URL ยาวเกินกำหนด' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: 'รูปแบบ URL ไม่ถูกต้อง' };
  }

  if (parsed.protocol !== 'https:') {
    return {
      valid: false,
      error: 'รองรับเฉพาะ Webhook URL แบบ HTTPS เพื่อความปลอดภัย',
    };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      error: 'ไม่อนุญาตให้ฝัง Username/Password ใน Webhook URL',
    };
  }

  if (parsed.port && parsed.port !== '443') {
    return {
      valid: false,
      error: 'รองรับเฉพาะพอร์ตมาตรฐาน HTTPS (443)',
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost')
  ) {
    return {
      valid: false,
      error: 'ไม่อนุญาตให้ส่ง Webhook ไปยังเครือข่ายภายในหรือ Localhost',
    };
  }

  if (net.isIP(host) !== 0 && isPrivateOrBlockedIp(host)) {
    return {
      valid: false,
      error: 'ไม่อนุญาตให้ส่ง Webhook ไปยัง IP ภายในองค์กรหรือ Metadata',
    };
  }

  if (allowedHosts.length > 0) {
    const normalizedAllowed = allowedHosts.map((h) => h.trim().toLowerCase()).filter(Boolean);
    const matches = normalizedAllowed.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`)
    );
    if (!matches) {
      return {
        valid: false,
        error: `โฮสต์ ${host} ไม่อยู่ในรายการ Webhook Hosts ที่อนุญาต`,
      };
    }
  }

  return { valid: true, url: parsed };
}

export async function validateWebhookUrlAndResolve(
  rawUrl: string,
  allowedHosts: string[] = []
): Promise<WebhookUrlCheckResult> {
  const structural = validateWebhookUrlStructure(rawUrl, allowedHosts);
  if (!structural.valid || !structural.url) {
    return structural;
  }

  const host = structural.url.hostname.toLowerCase();
  if (net.isIP(host) !== 0) {
    return {
      valid: true,
      url: structural.url,
      resolvedIps: [host],
    };
  }

  try {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    if (!records || records.length === 0) {
      return { valid: false, error: 'ไม่สามารถแปลงชื่อโดเมนของ Webhook URL ได้' };
    }
    const ips = records.map((r) => r.address);
    for (const ip of ips) {
      if (isPrivateOrBlockedIp(ip)) {
        return {
          valid: false,
          error: 'ปลายทาง DNS ของ Webhook ชี้ไปยัง IP ภายในที่ถูกบล็อก',
        };
      }
    }
    return {
      valid: true,
      url: structural.url,
      resolvedIps: ips,
    };
  } catch {
    return {
      valid: false,
      error: 'ไม่สามารถตรวจสอบ DNS ของ Webhook URL ได้',
    };
  }
}

export interface ParsedFirestoreTicket {
  id: string;
  requesterName: string;
  department: string;
  contactInfo: string;
  category: string;
  urgency: string;
  assetTag: string;
  description: string;
  createdByUid: string;
}

function readStringField(
  fields: Record<string, { stringValue?: string }>,
  key: string
): string {
  const entry = fields[key];
  return entry && typeof entry.stringValue === 'string' ? entry.stringValue : '';
}

export function parseFirestoreTicketDocument(
  docJson: unknown
): ParsedFirestoreTicket | null {
  if (!docJson || typeof docJson !== 'object') return null;
  const record = docJson as {
    fields?: Record<string, { stringValue?: string }>;
  };
  if (!record.fields || typeof record.fields !== 'object') return null;

  const id = readStringField(record.fields, 'id');
  const requesterName = readStringField(record.fields, 'requesterName');
  const description = readStringField(record.fields, 'description');
  const createdByUid = readStringField(record.fields, 'createdByUid');

  if (!id || !requesterName || !description || !createdByUid) {
    return null;
  }

  return {
    id,
    requesterName,
    department: readStringField(record.fields, 'department'),
    contactInfo: readStringField(record.fields, 'contactInfo'),
    category: readStringField(record.fields, 'category'),
    urgency: readStringField(record.fields, 'urgency'),
    assetTag: readStringField(record.fields, 'assetTag'),
    description,
    createdByUid,
  };
}
