import dns from 'node:dns/promises';
import https from 'node:https';
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

function isBlockedIPv4Octets(a: number, b: number): boolean {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast / reserved
  return false;
}

export function parseIPv6Hextets(rawIp: string): number[] | null {
  let ip = rawIp.trim().toLowerCase();
  const zoneIdx = ip.indexOf('%');
  if (zoneIdx !== -1) {
    ip = ip.slice(0, zoneIdx);
  }
  if (!net.isIPv6(ip)) return null;

  // Convert trailing dotted-quad IPv4 (if any) into two 16-bit hextets
  const lastColon = ip.lastIndexOf(':');
  if (lastColon !== -1) {
    const tail = ip.slice(lastColon + 1);
    if (net.isIPv4(tail)) {
      const octets = tail.split('.').map((n) => parseInt(n, 10));
      const hi = ((octets[0] << 8) | octets[1]).toString(16);
      const lo = ((octets[2] << 8) | octets[3]).toString(16);
      ip = `${ip.slice(0, lastColon + 1)}${hi}:${lo}`;
    }
  }

  const parts = ip.split('::');
  if (parts.length > 2) return null;

  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const missing = 8 - (left.length + right.length);
  if (parts.length === 1 && missing !== 0) return null;
  if (parts.length === 2 && missing < 0) return null;

  const fullStrings = [
    ...left,
    ...Array.from({ length: Math.max(0, missing) }, () => '0'),
    ...right,
  ];
  if (fullStrings.length !== 8) return null;

  const hextets: number[] = [];
  for (const hex of fullStrings) {
    if (!/^[0-9a-f]{1,4}$/.test(hex)) return null;
    hextets.push(parseInt(hex, 16));
  }
  return hextets;
}

function isBlockedHextetIPv4(hi: number, lo: number): boolean {
  const a = (hi >> 8) & 0xff;
  const b = hi & 0xff;
  const c = (lo >> 8) & 0xff;
  const d = lo & 0xff;
  if (
    Number.isNaN(a) ||
    Number.isNaN(b) ||
    Number.isNaN(c) ||
    Number.isNaN(d)
  ) {
    return true;
  }
  return isBlockedIPv4Octets(a, b);
}

export function isPrivateOrBlockedIp(rawIp: string): boolean {
  const ip = rawIp.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!ip) return true;

  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map((n) => parseInt(n, 10));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    return isBlockedIPv4Octets(parts[0], parts[1]);
  }

  const g = parseIPv6Hextets(ip);
  if (!g) return true;

  // Unspecified ::
  if (g.every((v) => v === 0)) return true;

  // Loopback ::1
  if (g.slice(0, 7).every((v) => v === 0) && g[7] === 1) return true;

  // IPv4-mapped IPv6 ::ffff:0:0/96 (decimal or hex form, e.g. ::ffff:7f00:1)
  if (g.slice(0, 5).every((v) => v === 0) && g[5] === 0xffff) {
    return isBlockedHextetIPv4(g[6], g[7]);
  }

  // Deprecated IPv4-compatible IPv6 ::/96 (e.g. ::127.0.0.1 or ::7f00:1)
  if (g.slice(0, 6).every((v) => v === 0)) {
    return isBlockedHextetIPv4(g[6], g[7]);
  }

  // NAT64 well-known prefix 64:ff9b::/96 & local-use 64:ff9b:1::/48
  if (g[0] === 0x0064 && g[1] === 0xff9b) {
    if (g[2] === 0x0001) return true;
    if (g.slice(2, 6).every((v) => v === 0)) {
      return isBlockedHextetIPv4(g[6], g[7]);
    }
  }

  // 6to4 2002::/16 embedding IPv4 in groups 1 and 2
  if (g[0] === 0x2002 && isBlockedHextetIPv4(g[1], g[2])) {
    return true;
  }

  // Teredo 2001::/32 & Documentation 2001:db8::/32
  if (g[0] === 0x2001 && (g[1] === 0x0000 || g[1] === 0x0db8)) {
    return true;
  }

  // ULA fc00::/7
  if ((g[0] & 0xfe00) === 0xfc00) return true;

  // Link-local fe80::/10
  if ((g[0] & 0xffc0) === 0xfe80) return true;

  // Multicast ff00::/8
  if ((g[0] & 0xff00) === 0xff00) return true;

  return false;
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

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
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
    const normalizedAllowed = allowedHosts
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
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

  const host = structural.url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
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

export function createPinnedLookup(pinnedIp: string): net.LookupFunction {
  const family: 4 | 6 = net.isIPv6(pinnedIp) ? 6 : 4;
  return (_hostname, options, callback) => {
    if (options && typeof options === 'object' && options.all) {
      (
        callback as unknown as (
          err: null,
          addresses: Array<{ address: string; family: number }>
        ) => void
      )(null, [{ address: pinnedIp, family }]);
      return;
    }
    callback(null, pinnedIp, family);
  };
}

export async function postJsonWithPinnedIp(
  targetUrl: URL,
  pinnedIp: string,
  payload: Record<string, unknown>,
  timeoutMs = 8000
): Promise<{ status: number }> {
  if (isPrivateOrBlockedIp(pinnedIp)) {
    throw new Error('ปลายทาง IP ของ Webhook ถูกบล็อกเพื่อความปลอดภัย');
  }

  const bodyString = JSON.stringify(payload);
  const hostHeader = targetUrl.host;
  const servername = targetUrl.hostname.replace(/^\[|\]$/g, '');
  const port = targetUrl.port ? Number(targetUrl.port) : 443;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: servername,
        port,
        path: `${targetUrl.pathname}${targetUrl.search}`,
        method: 'POST',
        servername,
        lookup: createPinnedLookup(pinnedIp),
        headers: {
          Host: hostHeader,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyString),
          'User-Agent': 'it-helpdesk-webhook/1.0',
        },
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode ?? 0 });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('การเชื่อมต่อ Webhook เกินเวลาที่กำหนด'));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(bodyString);
    req.end();
  });
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
