import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPinnedLookup,
  isPrivateOrBlockedIp,
  parseFirestoreTicketDocument,
  postJsonWithPinnedIp,
  SlidingWindowRateLimiter,
  validateWebhookUrlStructure,
} from '../server/security.ts';
import { getPermissionsForRole, hasPermission } from '../src/types/ticket.ts';

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
