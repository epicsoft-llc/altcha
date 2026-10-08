import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMessage, encodeHeader } from '../src/mail.js';
import { ValidationError, normalizeOrigin, validateSite } from '../src/sites.js';

const smtp = { from: 'form@example.com', fromName: '' };
const site = { name: 'example', recipient: 'office@example.com', subjectPrefix: '[web]' };

function headers(message) {
  return message.split('\r\n\r\n')[0];
}

function subject(message) {
  const encoded = /^Subject: (.*(?:\r\n .*)*)/m.exec(headers(message))[1];
  return encoded.split('\r\n ').map((w) => Buffer.from(w.slice(10, -2), 'base64').toString('utf8')).join('');
}

test('prefix and subject are joined by one space', () => {
  assert.equal(subject(buildMessage({ smtp, site, origin: 'o', fields: { subject: 'Hello' } })), '[web] Hello');
  assert.equal(subject(buildMessage({ smtp, site: { ...site, subjectPrefix: '' }, origin: 'o', fields: {} })), 'Form submission');
});

function body(message) {
  return Buffer.from(message.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
}

test('a line break in the subject cannot add a header', () => {
  const message = buildMessage({ smtp, site, origin: 'https://example.com', fields: { subject: 'Hi\r\nBcc: victim@example.org' } });
  assert.doesNotMatch(headers(message), /^Bcc:/m);
});

test('reply-to only for a plain address', () => {
  const good = buildMessage({ smtp, site, origin: 'o', fields: { email: 'visitor@example.org' } });
  assert.match(headers(good), /^Reply-To: visitor@example\.org$/m);
  const bad = buildMessage({ smtp, site, origin: 'o', fields: { email: 'visitor@example.org\r\nBcc: x@example.org' } });
  assert.doesNotMatch(headers(bad), /Reply-To|Bcc/);
});

test('the body carries every field and the site', () => {
  const message = buildMessage({ smtp, site, origin: 'https://example.com', fields: { name: 'Jürgen', message: 'line one\nline two' } });
  const text = body(message);
  assert.match(text, /name: Jürgen/);
  assert.match(text, /line one\r\nline two/);
  assert.match(text, /Site: example/);
});

test('long subjects become several encoded words within the limit', () => {
  const encoded = encodeHeader('ä'.repeat(100));
  for (const word of encoded.split('\r\n ')) {
    assert.ok(word.length <= 75, `${word.length} characters`);
  }
});

test('origins are scheme and host only', () => {
  assert.equal(normalizeOrigin('https://Example.com/'), 'https://example.com');
  assert.equal(normalizeOrigin('https://example.com:8443'), 'https://example.com:8443');
  assert.equal(normalizeOrigin('https://example.com/contact'), null);
  assert.equal(normalizeOrigin('javascript:alert(1)'), null);
  assert.equal(normalizeOrigin('https://user:pw@example.com'), null);
});

test('redirect targets have to stay on the site', () => {
  const input = { name: 'example', origins: ['https://example.com'], successUrl: 'https://evil.example.org/' };
  assert.throws(() => validateSite(input), (e) => e instanceof ValidationError && 'successUrl' in e.fields);
  assert.equal(validateSite({ ...input, successUrl: 'https://example.com/thanks' }).successUrl, 'https://example.com/thanks');
});

test('site names and recipients are checked', () => {
  assert.throws(() => validateSite({ name: '../x', origins: ['https://example.com'] }), ValidationError);
  assert.throws(() => validateSite({ name: 'x', origins: ['https://example.com'], recipient: 'a@b.c\r\nBcc: d@e.f' }), ValidationError);
  assert.equal(validateSite({ name: 'Example.COM', origins: ['https://example.com'] }).name, 'example.com');
});
