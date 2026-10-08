import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ConfigError, loadConfig } from '../src/config.js';
import { TEST_SECRET, tempDir } from './helpers.js';

const base = { HMAC_SECRET: TEST_SECRET };

test('defaults', () => {
  const config = loadConfig(base);
  assert.equal(config.port, 8080);
  assert.equal(config.adminPort, 8081);
  assert.equal(config.altcha.algorithm, 'PBKDF2/SHA-256');
  assert.equal(config.admin.enabled, false);
  assert.equal(config.smtp, null);
});

test('HMAC_SECRET is required and has a minimum length', () => {
  assert.throws(() => loadConfig({}), ConfigError);
  assert.throws(() => loadConfig({ HMAC_SECRET: 'short' }), ConfigError);
});

test('secrets come from a file, a trailing newline is dropped', () => {
  const dir = tempDir();
  const file = path.join(dir, 'secret');
  fs.writeFileSync(file, TEST_SECRET + '\n');
  assert.equal(loadConfig({ HMAC_SECRET_FILE: file }).hmacSecret, TEST_SECRET);
  assert.throws(() => loadConfig({ HMAC_SECRET: TEST_SECRET, HMAC_SECRET_FILE: file }), /both set/);
  assert.throws(() => loadConfig({ HMAC_SECRET_FILE: path.join(dir, 'missing') }), /cannot be read/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('admin credentials only together', () => {
  assert.throws(() => loadConfig({ ...base, ADMIN_USERNAME: 'admin' }), /together/);
  assert.throws(() => loadConfig({ ...base, ADMIN_PASSWORD: 'pw' }), /together/);
  assert.throws(() => loadConfig({ ...base, ADMIN_USERNAME: 'a:b', ADMIN_PASSWORD: 'pw' }), /colon/);
  assert.deepEqual(loadConfig({ ...base, ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'pw' }).admin.basic, { username: 'admin', password: 'pw' });
});

test('API token and proxy sign-in are checked', () => {
  assert.throws(() => loadConfig({ ...base, ADMIN_API_TOKEN: 'short' }), /32 characters/);
  assert.equal(loadConfig({ ...base, ADMIN_API_TOKEN: 'x'.repeat(32) }).admin.enabled, true);
  assert.throws(() => loadConfig({ ...base, ADMIN_PROXY_USER_HEADER: 'X-Forwarded-User' }), /ADMIN_TRUSTED_PROXIES/);
  assert.throws(() => loadConfig({ ...base, ADMIN_PROXY_USER_HEADER: 'X User', ADMIN_TRUSTED_PROXIES: '10.0.0.1' }), /header name/);
  assert.throws(() => loadConfig({ ...base, ADMIN_PROXY_USER_HEADER: 'X-User', ADMIN_TRUSTED_PROXIES: '10.0.0.0/33' }), /CIDR/);
  assert.throws(() => loadConfig({ ...base, ADMIN_PROXY_USER_HEADER: 'X-User', ADMIN_TRUSTED_PROXIES: 'proxy.local' }), /CIDR/);
  assert.throws(() => loadConfig({ ...base, ADMIN_ALLOWED_USERS: 'anna' }), /ADMIN_PROXY_USER_HEADER/);
  const proxy = loadConfig({ ...base, ADMIN_PROXY_USER_HEADER: 'X-Forwarded-User', ADMIN_TRUSTED_PROXIES: '172.16.0.0/12, fd00::/8', ADMIN_ALLOWED_USERS: 'anna,ben' }).admin;
  assert.equal(proxy.proxy.header, 'x-forwarded-user');
  assert.deepEqual([...proxy.proxy.users], ['anna', 'ben']);
  assert.equal(proxy.trustedProxies.check('172.20.1.2', 'ipv4'), true);
  assert.equal(proxy.trustedProxies.check('10.0.0.1', 'ipv4'), false);
});

test('SMTP settings are checked', () => {
  const smtp = { ...base, SMTP_HOST: 'mail.example.com', SMTP_FROM: 'form@example.com' };
  assert.equal(loadConfig(smtp).smtp.port, 587);
  assert.equal(loadConfig({ ...smtp, SMTP_SECURITY: 'tls' }).smtp.port, 465);
  assert.equal(loadConfig(smtp).smtp.tlsServername, 'mail.example.com');
  assert.throws(() => loadConfig({ ...smtp, SMTP_FROM: 'Form <form@example.com>' }), /SMTP_FROM/);
  assert.throws(() => loadConfig({ ...smtp, SMTP_SECURITY: 'none', SMTP_USERNAME: 'u', SMTP_PASSWORD: 'p' }), /clear text/);
  assert.throws(() => loadConfig({ ...smtp, SMTP_USERNAME: 'u' }), /together/);
  assert.throws(() => loadConfig({ ...smtp, SMTP_SECURITY: 'ssl' }), /one of/);
});

test('numbers and lists are validated', () => {
  assert.throws(() => loadConfig({ ...base, PORT: 'eighty' }), /whole number/);
  assert.throws(() => loadConfig({ ...base, ALTCHA_ALGORITHM: 'MD5' }), /one of/);
  assert.throws(() => loadConfig({ ...base, ALTCHA_COUNTER_MIN: '10', ALTCHA_COUNTER_MAX: '5' }), /COUNTER_MAX/);
  assert.throws(() => loadConfig({ ...base, PUBLIC_URL: 'ftp://example.com' }), /PUBLIC_URL/);
  assert.equal(loadConfig({ ...base, PUBLIC_URL: 'https://altcha.example.com/' }).publicUrl, 'https://altcha.example.com');
});
