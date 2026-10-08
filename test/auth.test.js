import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { FAILURE_LIMIT } from '../src/auth.js';
import { rateKey } from '../src/http.js';
import { createSite, fetchChallenge, solve, startService } from './helpers.js';

// fixtures for the length of one test run, not secrets
const TOKEN = 'test-token-0123456789-0123456789-abcdef';
const basic = (user, password) => ({ Authorization: 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64') });

test('rate limit keys: IPv4 as it is, IPv6 by its /64', () => {
  assert.equal(rateKey('192.0.2.7'), '192.0.2.7');
  assert.equal(rateKey('::ffff:192.0.2.7'), '192.0.2.7');
  assert.equal(rateKey('2001:db8:1:2::1'), '2001:db8:1:2::/64');
  assert.equal(rateKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), '2001:db8:1:2::/64');
  assert.equal(rateKey('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(rateKey('::1'), '0:0:0:0::/64');
  assert.equal(rateKey('fe80::1%eth0'), 'fe80:0:0:0::/64');
});

describe('Basic auth and API token', () => {
  let service;

  before(async () => {
    service = await startService({ ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'correct horse', ADMIN_API_TOKEN: TOKEN });
  });

  after(async () => {
    await service.close();
  });

  test('the API token works for reading and for changes, without the admin header', async () => {
    const auth = { Authorization: `Bearer ${TOKEN}` };
    assert.equal((await fetch(`${service.admin}/api/sites`, { headers: auth })).status, 200);
    const created = await fetch(`${service.admin}/api/sites`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'scripted', origins: ['https://scripted.example.com'] }),
    });
    assert.equal(created.status, 201);
    const status = await (await fetch(`${service.admin}/api/status`, { headers: auth })).json();
    assert.equal(status.auth.method, 'token');
    assert.equal((await fetch(`${service.admin}/api/sites`, { headers: { Authorization: 'Bearer wrong-token' } })).status, 401);
  });

  test('after too many failures the address is locked out, even with the right password', async () => {
    for (let i = 0; i < FAILURE_LIMIT; i++) {
      await fetch(`${service.admin}/api/sites`, { headers: basic('admin', 'guess ' + i) });
    }
    const locked = await fetch(`${service.admin}/api/sites`, { headers: basic('admin', 'correct horse') });
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers.get('retry-after')) > 0);
    assert.equal((await fetch(`${service.admin}/healthz`)).status, 200);
    const metrics = await fetch(`${service.admin}/metrics`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(metrics.status, 429, 'the lockout covers the token too - it is per address');
  });
});

describe('sign-in through a proxy', () => {
  let service;
  let untrusted;

  before(async () => {
    service = await startService({ ADMIN_PROXY_USER_HEADER: 'X-Forwarded-User', ADMIN_TRUSTED_PROXIES: '127.0.0.1, ::1', ADMIN_ALLOWED_USERS: 'anna' });
    untrusted = await startService({ ADMIN_PROXY_USER_HEADER: 'X-Forwarded-User', ADMIN_TRUSTED_PROXIES: '10.0.0.0/8' });
  });

  after(async () => {
    await service.close();
    await untrusted.close();
  });

  test('the user from the header is signed in', async () => {
    const status = await (await fetch(`${service.admin}/api/status`, { headers: { 'X-Forwarded-User': 'anna' } })).json();
    assert.equal(status.auth.user, 'anna');
    assert.equal(status.auth.method, 'proxy');
  });

  test('a user outside ADMIN_ALLOWED_USERS is refused', async () => {
    assert.equal((await fetch(`${service.admin}/api/status`, { headers: { 'X-Forwarded-User': 'mallory' } })).status, 403);
  });

  test('without the header there is no way in', async () => {
    const response = await fetch(`${service.admin}/api/status`);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('www-authenticate'), null);
  });

  test('the header from an address that is not a trusted proxy is ignored', async () => {
    assert.equal((await fetch(`${untrusted.admin}/api/status`, { headers: { 'X-Forwarded-User': 'anna' } })).status, 401);
  });
});

describe('backend verification limit', () => {
  let service;

  before(async () => {
    service = await startService({ RATE_VERIFY_PER_IP: '2' });
    await createSite(service, { name: 'limited', origins: ['https://limited.example.com'] });
  });

  after(async () => {
    await service.close();
  });

  test('verify without an Origin has its own limit per address', async () => {
    const statuses = [];
    for (let i = 0; i < 3; i++) {
      const payload = await solve((await fetchChallenge(service, 'https://limited.example.com')).body);
      const response = await fetch(`${service.base}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ altcha: payload, site: 'limited' }),
      });
      statuses.push(response.status);
    }
    assert.deepEqual(statuses, [200, 200, 429]);
  });
});
