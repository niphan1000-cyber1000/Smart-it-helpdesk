import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export type RateLimiterBackend = 'redis-tcp' | 'redis-rest' | 'memory';

export interface AsyncRateLimiter {
  readonly backend: RateLimiterBackend;
  check(key: string, nowMs?: number): Promise<RateLimitResult>;
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

const REDIS_SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local maxReq = tonumber(ARGV[3])
local member = ARGV[4]
local cutoff = now - windowMs
redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)
local count = redis.call('ZCARD', key)
if count >= maxReq then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local oldestTs = now
  if oldest[2] then oldestTs = tonumber(oldest[2]) end
  local retrySec = math.max(1, math.ceil((oldestTs + windowMs - now) / 1000))
  return {0, 0, retrySec}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, windowMs)
return {1, math.max(0, maxReq - (count + 1)), 0}
`.trim();

function encodeRespCommand(args: string[]): Buffer {
  const chunks: Buffer[] = [Buffer.from(`*${args.length}\r\n`, 'utf-8')];
  for (const arg of args) {
    const buf = Buffer.from(arg, 'utf-8');
    chunks.push(Buffer.from(`$${buf.length}\r\n`, 'utf-8'), buf, Buffer.from('\r\n', 'utf-8'));
  }
  return Buffer.concat(chunks);
}

type RespValue = string | number | null | RespValue[] | Error;

function parseRespValue(
  buf: Buffer,
  offset: number
): { value: RespValue; nextOffset: number } | null {
  if (offset >= buf.length) return null;
  const lineEnd = buf.indexOf('\r\n', offset);
  if (lineEnd === -1) return null;

  const prefix = String.fromCharCode(buf[offset]);
  const line = buf.subarray(offset + 1, lineEnd).toString('utf-8');

  if (prefix === '+') {
    return { value: line, nextOffset: lineEnd + 2 };
  }
  if (prefix === '-') {
    return { value: new Error(line), nextOffset: lineEnd + 2 };
  }
  if (prefix === ':') {
    return { value: Number.parseInt(line, 10), nextOffset: lineEnd + 2 };
  }
  if (prefix === '$') {
    const len = Number.parseInt(line, 10);
    if (len === -1) return { value: null, nextOffset: lineEnd + 2 };
    const start = lineEnd + 2;
    const end = start + len;
    if (buf.length < end + 2) return null;
    return { value: buf.subarray(start, end).toString('utf-8'), nextOffset: end + 2 };
  }
  if (prefix === '*') {
    const count = Number.parseInt(line, 10);
    if (count === -1) return { value: null, nextOffset: lineEnd + 2 };
    let cursor = lineEnd + 2;
    const items: RespValue[] = [];
    for (let i = 0; i < count; i += 1) {
      const parsed = parseRespValue(buf, cursor);
      if (!parsed) return null;
      items.push(parsed.value);
      cursor = parsed.nextOffset;
    }
    return { value: items, nextOffset: cursor };
  }

  throw new Error(`Unsupported RESP prefix: ${prefix}`);
}

function parseRedisTupleResult(raw: unknown): RateLimitResult {
  if (!Array.isArray(raw) || raw.length < 3) {
    throw new Error('Invalid Redis rate limiter tuple reply');
  }
  const allowedFlag = Number(raw[0]);
  const remaining = Math.max(0, Number(raw[1]) || 0);
  const retryAfterSeconds = Math.max(0, Number(raw[2]) || 0);
  return {
    allowed: allowedFlag === 1,
    remaining,
    retryAfterSeconds: allowedFlag === 1 ? 0 : Math.max(1, retryAfterSeconds),
  };
}

export class RedisTcpRateLimiter implements AsyncRateLimiter {
  readonly backend: RateLimiterBackend = 'redis-tcp';
  private readonly redisUrl: URL;
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly keyPrefix: string;
  private readonly fallback: SlidingWindowRateLimiter;
  private readonly timeoutMs: number;

  constructor(options: {
    redisUrl: string;
    maxRequests: number;
    windowMs: number;
    keyPrefix?: string;
    timeoutMs?: number;
  }) {
    this.redisUrl = new URL(options.redisUrl);
    this.maxRequests = options.maxRequests;
    this.windowMs = options.windowMs;
    this.keyPrefix = options.keyPrefix ?? 'rl:';
    this.timeoutMs = options.timeoutMs ?? 1500;
    this.fallback = new SlidingWindowRateLimiter(options.maxRequests, options.windowMs);
  }

  private async execLuaSlidingWindow(key: string, nowMs: number): Promise<RateLimitResult> {
    const isTls = this.redisUrl.protocol === 'rediss:';
    const host = this.redisUrl.hostname;
    const port = this.redisUrl.port ? Number(this.redisUrl.port) : 6379;
    const password = this.redisUrl.password ? decodeURIComponent(this.redisUrl.password) : '';
    const username = this.redisUrl.username ? decodeURIComponent(this.redisUrl.username) : '';
    const dbPath = this.redisUrl.pathname.replace(/^\//, '');
    const dbIndex = dbPath ? Number.parseInt(dbPath, 10) : 0;

    const commands: Buffer[] = [];
    if (password) {
      commands.push(
        username
          ? encodeRespCommand(['AUTH', username, password])
          : encodeRespCommand(['AUTH', password])
      );
    }
    if (Number.isInteger(dbIndex) && dbIndex > 0) {
      commands.push(encodeRespCommand(['SELECT', String(dbIndex)]));
    }

    const member = `${nowMs}-${crypto.randomUUID()}`;
    commands.push(
      encodeRespCommand([
        'EVAL',
        REDIS_SLIDING_WINDOW_LUA,
        '1',
        `${this.keyPrefix}${key}`,
        String(nowMs),
        String(this.windowMs),
        String(this.maxRequests),
        member,
      ])
    );

    const expectedReplies = commands.length;
    const payload = Buffer.concat(commands);

    const lastReply = await new Promise<RespValue>((resolve, reject) => {
      let settled = false;
      let rxBuffer = Buffer.alloc(0);

      const socket = isTls
        ? tls.connect({ host, port, servername: host })
        : net.createConnection({ host, port });

      const cleanup = () => {
        socket.removeAllListeners();
        if (!socket.destroyed) socket.destroy();
      };

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };

      socket.setTimeout(this.timeoutMs);
      socket.on('timeout', () => fail(new Error('Redis rate limiter connection timed out')));
      socket.on('error', (err) => fail(err));

      socket.on('connect', () => {
        socket.write(payload);
      });

      socket.on('data', (chunk: Buffer) => {
        if (settled) return;
        rxBuffer = Buffer.concat([rxBuffer, chunk]);
        try {
          let offset = 0;
          const replies: RespValue[] = [];
          while (replies.length < expectedReplies) {
            const parsed = parseRespValue(rxBuffer, offset);
            if (!parsed) break;
            if (parsed.value instanceof Error) {
              return fail(parsed.value);
            }
            replies.push(parsed.value);
            offset = parsed.nextOffset;
          }
          if (replies.length === expectedReplies) {
            settled = true;
            socket.end();
            resolve(replies[replies.length - 1]);
          }
        } catch (err) {
          fail(err instanceof Error ? err : new Error(String(err)));
        }
      });

      socket.on('close', () => {
        if (!settled) {
          fail(new Error('Redis connection closed before completing rate limit check'));
        }
      });
    });

    return parseRedisTupleResult(lastReply);
  }

  async check(key: string, nowMs = Date.now()): Promise<RateLimitResult> {
    try {
      return await this.execLuaSlidingWindow(key, nowMs);
    } catch {
      return this.fallback.check(key, nowMs);
    }
  }
}

export class RedisRestRateLimiter implements AsyncRateLimiter {
  readonly backend: RateLimiterBackend = 'redis-rest';
  private readonly restUrl: string;
  private readonly restToken: string;
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly keyPrefix: string;
  private readonly fallback: SlidingWindowRateLimiter;

  constructor(options: {
    restUrl: string;
    restToken: string;
    maxRequests: number;
    windowMs: number;
    keyPrefix?: string;
  }) {
    this.restUrl = options.restUrl.replace(/\/+$/, '');
    this.restToken = options.restToken;
    this.maxRequests = options.maxRequests;
    this.windowMs = options.windowMs;
    this.keyPrefix = options.keyPrefix ?? 'rl:';
    this.fallback = new SlidingWindowRateLimiter(options.maxRequests, options.windowMs);
  }

  async check(key: string, nowMs = Date.now()): Promise<RateLimitResult> {
    try {
      const member = `${nowMs}-${crypto.randomUUID()}`;
      const res = await fetch(this.restUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.restToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          'EVAL',
          REDIS_SLIDING_WINDOW_LUA,
          '1',
          `${this.keyPrefix}${key}`,
          String(nowMs),
          String(this.windowMs),
          String(this.maxRequests),
          member,
        ]),
        signal: AbortSignal.timeout(1500),
      });

      if (!res.ok) {
        throw new Error(`Redis REST HTTP ${res.status}`);
      }

      const json = (await res.json()) as { result?: unknown; error?: string };
      if (json.error) {
        throw new Error(json.error);
      }
      return parseRedisTupleResult(json.result);
    } catch {
      return this.fallback.check(key, nowMs);
    }
  }
}

export class MemoryAsyncRateLimiter implements AsyncRateLimiter {
  readonly backend: RateLimiterBackend = 'memory';
  private readonly limiter: SlidingWindowRateLimiter;

  constructor(maxRequests: number, windowMs: number) {
    this.limiter = new SlidingWindowRateLimiter(maxRequests, windowMs);
  }

  async check(key: string, nowMs = Date.now()): Promise<RateLimitResult> {
    return this.limiter.check(key, nowMs);
  }
}

export function createRateLimiter(options: {
  maxRequests: number;
  windowMs: number;
  keyPrefix?: string;
  redisUrl?: string;
  redisRestUrl?: string;
  redisRestToken?: string;
}): AsyncRateLimiter {
  const redisUrl = options.redisUrl?.trim();
  if (redisUrl && (redisUrl.startsWith('redis://') || redisUrl.startsWith('rediss://'))) {
    return new RedisTcpRateLimiter({
      redisUrl,
      maxRequests: options.maxRequests,
      windowMs: options.windowMs,
      keyPrefix: options.keyPrefix,
    });
  }

  const restUrl = options.redisRestUrl?.trim();
  const restToken = options.redisRestToken?.trim();
  if (restUrl && restToken && restUrl.startsWith('https://')) {
    return new RedisRestRateLimiter({
      restUrl,
      restToken,
      maxRequests: options.maxRequests,
      windowMs: options.windowMs,
      keyPrefix: options.keyPrefix,
    });
  }

  return new MemoryAsyncRateLimiter(options.maxRequests, options.windowMs);
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
