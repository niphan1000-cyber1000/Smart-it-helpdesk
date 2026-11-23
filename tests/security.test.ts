import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {
  createPinnedLookup,
  createRateLimiter,
  isPrivateOrBlockedIp,
  parseFirestoreTicketDocument,
  postJsonWithPinnedIp,
  RedisRestRateLimiter,
  RedisTcpRateLimiter,
  resolveRateLimitFailurePolicy,
  SlidingWindowRateLimiter,
  validateWebhookUrlStructure,
} from '../server/security.ts';
import { getPermissionsForRole, hasPermission } from '../src/types/ticket.ts';
import { createInitialMockTickets } from '../src/data/mockTickets.ts';
import { resolveSeedCounterPlan } from '../src/utils/ticketCounter.ts';
import {
  buildFallbackDiagnostic,
  buildFallbackTroubleshoot,
  getSafeAiErrorMessage,
} from '../server/services/ai.ts';
import { getWebhookStatusInfo } from '../server/services/webhook.ts';
import { createAiRouter } from '../server/routes/aiRoutes.ts';
import { createWebhookRouter } from '../server/routes/webhookRoutes.ts';

describe('SlidingWindowRateLimiter', () => {
  it('allows requests up to maxRequests and blocks excess until window expires', () => {
    const limiter = new SlidingWindowRateLimiter(3, 60_000);
    const t0 = 1_000_000;

    assert.equal(limiter.check('user-1', t0).allowed, true);
    assert.equal(limiter.check('user-1', t0 + 1000).remaining, 1);
    assert.equal(limiter.check('user-1', t0 + 2000).allowed, true);

    const blocked = limiter.check('user-1', t0 + 3000);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
    assert.ok(blocked.retryAfterSeconds >= 57 && blocked.retryAfterSeconds <= 60);

    // Different key remains unaffected
    assert.equal(limiter.check('user-2', t0 + 3000).allowed, true);

    // After window passes, requests succeed again
    const afterWindow = limiter.check('user-1', t0 + 60_001);
    assert.equal(afterWindow.allowed, true);
  });
});

describe('SSRF IP, IPv6 Hex Normalization, & DNS Pinning Protection', () => {
  it('blocks loopback, RFC1918, CGNAT, link-local, metadata, IPv6 local, and hex IPv4-mapped/compatible/NAT64/6to4 addresses', () => {
    const blockedIps = [
      '127.0.0.1',
      '10.0.0.5',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.1.100',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:169.254.169.254',
      // Hexadecimal IPv4-mapped IPv6 forms
      '::ffff:7f00:1',
      '::ffff:7f00:0001',
      '0:0:0:0:0:ffff:7f00:1',
      '0000:0000:0000:0000:0000:ffff:a9fe:a9fe',
      '::ffff:0a00:0001',
      '::ffff:c0a8:0101',
      // Deprecated IPv4-compatible IPv6
      '::7f00:1',
      '::10.0.0.1',
      // NAT64 & 6to4 embedding private IPv4
      '64:ff9b::7f00:1',
      '64:ff9b:1::1',
      '2002:7f00:0001::',
      '2002:a9fe:a9fe::',
    ];

    for (const ip of blockedIps) {
      assert.equal(isPrivateOrBlockedIp(ip), true, `Expected ${ip} to be blocked`);
    }

    const publicIps = [
      '8.8.8.8',
      '1.1.1.1',
      '162.159.135.232',
      '2606:4700:4700::1111',
      '::ffff:0808:0808',
    ];
    for (const ip of publicIps) {
      assert.equal(isPrivateOrBlockedIp(ip), false, `Expected ${ip} to be allowed`);
    }
  });

  it('rejects non-HTTPS, credentials, non-443 ports, internal hostnames, and private IP literals', () => {
    const invalidUrls = [
      '',
      'not-a-url',
      'http://discord.com/api/webhooks/123/abc',
      'https://user:pass@discord.com/api/webhooks/123/abc',
      'https://discord.com:8443/api/webhooks/123/abc',
      'https://localhost/webhook',
      'https://service.internal/hook',
      'https://printer.local/hook',
      'https://127.0.0.1/hook',
      'https://169.254.169.254/latest/meta-data/',
      'https://[::ffff:7f00:1]/hook',
    ];

    for (const url of invalidUrls) {
      const res = validateWebhookUrlStructure(url);
      assert.equal(res.valid, false, `Expected ${url} to be rejected`);
    }
  });

  it('enforces optional WEBHOOK_ALLOWED_HOSTS allowlist and accepts valid HTTPS URLs', () => {
    const discordUrl = 'https://discord.com/api/webhooks/123456789/abcdef';
    assert.equal(validateWebhookUrlStructure(discordUrl).valid, true);
    assert.equal(
      validateWebhookUrlStructure(discordUrl, ['discord.com', 'api.telegram.org']).valid,
      true
    );
    assert.equal(
      validateWebhookUrlStructure('https://evil.example.com/hook', ['discord.com']).valid,
      false
    );
  });

  it('pins validated IP on custom lookup (single and all modes) and blocks private pinned IPs', async () => {
    const lookup = createPinnedLookup('162.159.135.232');

    await new Promise<void>((resolve, reject) => {
      lookup('discord.com', { family: 0 }, (err, address, family) => {
        if (err) return reject(err);
        assert.equal(address, '162.159.135.232');
        assert.equal(family, 4);
        resolve();
      });
    });

    await new Promise<void>((resolve, reject) => {
      lookup('discord.com', { all: true }, (err, addresses) => {
        if (err) return reject(err);
        assert.deepEqual(addresses, [{ address: '162.159.135.232', family: 4 }]);
        resolve();
      });
    });

    await assert.rejects(
      () =>
        postJsonWithPinnedIp(
          new URL('https://discord.com/api/webhooks/1/2'),
          '::ffff:7f00:1',
          { text: 'test' }
        ),
      /ถูกบล็อก/
    );
  });
});

describe('Firestore Ticket Document Parser', () => {
  it('parses authoritative ticket fields and rejects incomplete documents', () => {
    const parsed = parseFirestoreTicketDocument({
      fields: {
        id: { stringValue: 'IT-2026-001' },
        requesterName: { stringValue: 'สมชาย ใจดี' },
        department: { stringValue: 'บัญชี' },
        contactInfo: { stringValue: 'ต่อ 104' },
        category: { stringValue: 'อินเทอร์เน็ต/Wi-Fi มีปัญหา' },
        urgency: { stringValue: 'ด่วน' },
        assetTag: { stringValue: 'PC-ACC-012' },
        description: { stringValue: 'เชื่อมต่อ Wi-Fi ไม่ได้' },
        createdByUid: { stringValue: 'uid-employee-1' },
      },
    });

    assert.ok(parsed);
    assert.equal(parsed.id, 'IT-2026-001');
    assert.equal(parsed.createdByUid, 'uid-employee-1');
    assert.equal(parsed.requesterName, 'สมชาย ใจดี');

    assert.equal(parseFirestoreTicketDocument(null), null);
    assert.equal(
      parseFirestoreTicketDocument({
        fields: { id: { stringValue: 'IT-2026-002' } },
      }),
      null
    );
  });
});

describe('Standardized RBAC Permissions', () => {
  it('grants administrative permissions only to admin role and scopes employee role', () => {
    const employeePerms = getPermissionsForRole('employee');
    assert.equal(hasPermission(employeePerms, 'ticket:read_own'), true);
    assert.equal(hasPermission(employeePerms, 'ticket:create'), true);
    assert.equal(hasPermission(employeePerms, 'ai:troubleshoot'), true);
    assert.equal(hasPermission(employeePerms, 'ticket:read_all'), false);
    assert.equal(hasPermission(employeePerms, 'ticket:update'), false);
    assert.equal(hasPermission(employeePerms, 'ticket:delete'), false);
    assert.equal(hasPermission(employeePerms, 'ai:diagnostic'), false);
    assert.equal(hasPermission(employeePerms, 'webhook:manage'), false);
    assert.equal(hasPermission(employeePerms, 'audit:read'), false);

    const adminPerms = getPermissionsForRole('admin');
    assert.equal(hasPermission(adminPerms, 'ticket:read_all'), true);
    assert.equal(hasPermission(adminPerms, 'ticket:update'), true);
    assert.equal(hasPermission(adminPerms, 'ticket:delete'), true);
    assert.equal(hasPermission(adminPerms, 'ai:diagnostic'), true);
    assert.equal(hasPermission(adminPerms, 'webhook:manage'), true);
    assert.equal(hasPermission(adminPerms, 'audit:read'), true);
  });
});

describe('Demo Seed Counter Plan (F-14)', () => {
  it('picks highest sequence ticket IT-2026-005 regardless of descending mockTickets order and avoids overwriting ahead counters', () => {
    const mocks = createInitialMockTickets();
    assert.equal(mocks[mocks.length - 1].id, 'IT-2026-001');

    const initialPlan = resolveSeedCounterPlan(mocks, null);
    assert.deepEqual(initialPlan, {
      shouldWriteCounter: true,
      lastNumber: 5,
      lastTicketId: 'IT-2026-005',
    });

    const partialPlan = resolveSeedCounterPlan(mocks, 3);
    assert.deepEqual(partialPlan, {
      shouldWriteCounter: true,
      lastNumber: 5,
      lastTicketId: 'IT-2026-005',
    });

    const aheadPlan = resolveSeedCounterPlan(mocks, 8);
    assert.deepEqual(aheadPlan, {
      shouldWriteCounter: false,
    });
  });
});

describe('Distributed Shared Rate Limiter (F-13)', () => {
  it('selects redis-tcp, redis-rest, or memory backend via createRateLimiter', () => {
    assert.equal(
      createRateLimiter({
        maxRequests: 5,
        windowMs: 60_000,
        redisUrl: 'redis://:secret@127.0.0.1:6379/0',
      }).backend,
      'redis-tcp'
    );
    assert.equal(
      createRateLimiter({
        maxRequests: 5,
        windowMs: 60_000,
        redisRestUrl: 'https://example-redis.upstash.io',
        redisRestToken: 'token-123',
      }).backend,
      'redis-rest'
    );
    assert.equal(
      createRateLimiter({
        maxRequests: 5,
        windowMs: 60_000,
      }).backend,
      'memory'
    );
  });

  it('executes AUTH + EVAL sliding-window commands over RESP2 TCP and falls back cleanly on connection failure', async () => {
    let evalCallCount = 0;
    let sawAuth = false;

    const server = net.createServer((socket) => {
      let buffer = '';
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf-8');
        if (buffer.includes('AUTH') && buffer.includes('EVAL')) {
          if (buffer.includes('secretpass')) {
            sawAuth = true;
          }
          evalCallCount += 1;
          const reply =
            evalCallCount <= 2
              ? `+OK\r\n*3\r\n:1\r\n:${2 - evalCallCount}\r\n:0\r\n`
              : `+OK\r\n*3\r\n:0\r\n:0\r\n:42\r\n`;
          socket.write(reply);
          buffer = '';
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as net.AddressInfo;

    try {
      const limiter = new RedisTcpRateLimiter({
        redisUrl: `redis://:secretpass@127.0.0.1:${addr.port}`,
        maxRequests: 2,
        windowMs: 60_000,
        keyPrefix: 'test:',
      });

      const r1 = await limiter.check('user-a', 1_000_000);
      assert.equal(r1.allowed, true);
      assert.equal(r1.remaining, 1);

      const r2 = await limiter.check('user-a', 1_000_500);
      assert.equal(r2.allowed, true);
      assert.equal(r2.remaining, 0);

      const r3 = await limiter.check('user-a', 1_001_000);
      assert.equal(r3.allowed, false);
      assert.equal(r3.retryAfterSeconds, 42);
      assert.equal(sawAuth, true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    const loggedFailures: Array<Record<string, unknown>> = [];

    // Graceful fallback-memory policy logs structured error + tracks failureCount
    const fallbackLimiter = new RedisTcpRateLimiter({
      redisUrl: `redis://127.0.0.1:${addr.port}`,
      maxRequests: 1,
      windowMs: 60_000,
      timeoutMs: 300,
      failurePolicy: 'fallback-memory',
      onFailureLog: (entry) => loggedFailures.push(entry),
    });
    const fb1 = await fallbackLimiter.check('user-fb', 2_000_000);
    const fb2 = await fallbackLimiter.check('user-fb', 2_000_100);
    assert.equal(fb1.allowed, true);
    assert.equal(fb1.degraded, true);
    assert.equal(fb1.unavailable, false);
    assert.equal(fb2.allowed, false);
    assert.equal(fallbackLimiter.getStats().failureCount, 2);
    assert.equal(loggedFailures.length, 2);
    assert.equal(loggedFailures[0].event, 'rate_limiter.redis_failure');
    assert.equal(loggedFailures[0].failurePolicy, 'fallback-memory');

    // Explicit fail-closed policy blocks requests with unavailable: true on Redis outage
    const closedLogs: Array<Record<string, unknown>> = [];
    const failClosedLimiter = new RedisTcpRateLimiter({
      redisUrl: `redis://127.0.0.1:${addr.port}`,
      maxRequests: 5,
      windowMs: 60_000,
      timeoutMs: 300,
      failurePolicy: 'fail-closed',
      onFailureLog: (entry) => closedLogs.push(entry),
    });
    const fc1 = await failClosedLimiter.check('user-fc', 3_000_000);
    assert.equal(fc1.allowed, false);
    assert.equal(fc1.degraded, true);
    assert.equal(fc1.unavailable, true);
    assert.equal(fc1.retryAfterSeconds, 30);
    assert.equal(failClosedLimiter.getStats().failureCount, 1);
    assert.equal(closedLogs[0].failurePolicy, 'fail-closed');
  });

  it('resolves RATE_LIMIT_FAILURE_POLICY defaults cleanly for production vs preview', () => {
    assert.equal(
      resolveRateLimitFailurePolicy({ nodeEnv: 'production', hasRedisBackend: true }),
      'fail-closed'
    );
    assert.equal(
      resolveRateLimitFailurePolicy({ nodeEnv: 'development', hasRedisBackend: true }),
      'fallback-memory'
    );
    assert.equal(
      resolveRateLimitFailurePolicy({
        configuredPolicy: 'fallback-memory',
        nodeEnv: 'production',
        hasRedisBackend: true,
      }),
      'fallback-memory'
    );
    assert.equal(
      resolveRateLimitFailurePolicy({
        configuredPolicy: 'fail-closed',
        nodeEnv: 'development',
        hasRedisBackend: true,
      }),
      'fail-closed'
    );
  });

  it('supports Upstash-compatible Redis REST EVAL responses and fail-closed on REST error', async () => {
    const originalFetch = globalThis.fetch;
    let callNum = 0;
    globalThis.fetch = (async () => {
      callNum += 1;
      if (callNum === 3) {
        return new Response('Upstream error', { status: 502 });
      }
      const result = callNum === 1 ? [1, 4, 0] : [0, 0, 15];
      return new Response(JSON.stringify({ result }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const restLogs: Array<Record<string, unknown>> = [];
      const limiter = new RedisRestRateLimiter({
        restUrl: 'https://redis-rest.example.com',
        restToken: 'secret-token',
        maxRequests: 5,
        windowMs: 60_000,
        failurePolicy: 'fail-closed',
        onFailureLog: (entry) => restLogs.push(entry),
      });

      const first = await limiter.check('rest-user', 1000);
      assert.equal(first.allowed, true);
      assert.equal(first.remaining, 4);

      const second = await limiter.check('rest-user', 2000);
      assert.equal(second.allowed, false);
      assert.equal(second.retryAfterSeconds, 15);

      const third = await limiter.check('rest-user', 3000);
      assert.equal(third.allowed, false);
      assert.equal(third.unavailable, true);
      assert.equal(limiter.getStats().failureCount, 1);
      assert.equal(restLogs.length, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// Live Redis 7 Integration Suite (runs automatically in CI via REDIS_URL service container)
const liveRedisUrl = process.env.REDIS_URL?.trim();
if (liveRedisUrl) {
  describe('Live Redis 7 Multi-Instance Rate Limiter Integration (F-13)', () => {
    it('enforces shared atomic Lua sliding window across two independent server instances', async () => {
      const runPrefix = `ci:rl:${Date.now()}:${Math.random().toString(36).slice(2, 8)}:`;
      const instanceA = new RedisTcpRateLimiter({
        redisUrl: liveRedisUrl,
        maxRequests: 3,
        windowMs: 60_000,
        keyPrefix: runPrefix,
        failurePolicy: 'fail-closed',
      });
      const instanceB = new RedisTcpRateLimiter({
        redisUrl: liveRedisUrl,
        maxRequests: 3,
        windowMs: 60_000,
        keyPrefix: runPrefix,
        failurePolicy: 'fail-closed',
      });

      const now = Date.now();
      const r1 = await instanceA.check('shared-emp', now);
      const r2 = await instanceB.check('shared-emp', now + 10);
      const r3 = await instanceA.check('shared-emp', now + 20);
      const r4 = await instanceB.check('shared-emp', now + 30);

      assert.equal(r1.allowed, true);
      assert.equal(r1.remaining, 2);
      assert.equal(r2.allowed, true);
      assert.equal(r2.remaining, 1);
      assert.equal(r3.allowed, true);
      assert.equal(r3.remaining, 0);
      assert.equal(r4.allowed, false);
      assert.equal(r4.unavailable, undefined);
      assert.ok(r4.retryAfterSeconds >= 1);
      assert.equal(instanceA.getStats().failureCount, 0);
      assert.equal(instanceB.getStats().failureCount, 0);
    });
  });
}

describe('Modular Backend Services & Routers', () => {
  it('provides Thai fallback troubleshoot and diagnostic responses plus safe AI error mapping', () => {
    const troubleshoot = buildFallbackTroubleshoot('Wi-Fi', 'ต่อเน็ตไม่ได้');
    assert.ok(troubleshoot.summary.length > 0);
    assert.ok(troubleshoot.steps.length >= 3);

    const diagnostic = buildFallbackDiagnostic('ปริ้นเตอร์', 'พิมพ์ไม่ออก');
    assert.ok(diagnostic.rootCause.length > 0);
    assert.ok(diagnostic.toolsAndParts.length >= 3);
    assert.ok(diagnostic.technicalSteps.length >= 3);

    const badKey = getSafeAiErrorMessage({ status: 403, message: 'PERMISSION_DENIED' });
    assert.equal(badKey.status, 403);
    assert.match(badKey.message, /GEMINI_API_KEY/);

    const quota = getSafeAiErrorMessage({ status: 429, message: 'RESOURCE_EXHAUSTED' });
    assert.equal(quota.status, 429);
  });

  it('constructs AI and Webhook Express routers and reports safe masked webhook status', () => {
    const aiRouter = createAiRouter();
    const webhookRouter = createWebhookRouter();
    assert.equal(typeof aiRouter, 'function');
    assert.equal(typeof webhookRouter, 'function');

    const status = getWebhookStatusInfo();
    assert.ok(['env', 'runtime', 'none'].includes(status.source));
    assert.equal(typeof status.configured, 'boolean');
  });
});
