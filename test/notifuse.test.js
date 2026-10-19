import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { startService, startSmtpSink } from './helpers.js';

// fixtures, not secrets: they exist for the length of one test run - one key per workspace
const KEY = Buffer.alloc(32, 7);
const SECOND_KEY = Buffer.alloc(32, 6);
const SECRET = `whsec_${KEY.toString('base64')} whsec_${SECOND_KEY.toString('base64')}`;

const confirmed = {
  type: 'list.confirmed',
  data: { email: 'reader@example.org', list_id: 'weekly', list_name: 'Weekly', status: 'active', previous_status: 'pending' },
};

// signed the way Notifuse signs a delivery; `sign` builds the header from the signature
function deliver(service, event, { id = crypto.randomUUID(), timestamp = Math.floor(Date.now() / 1000), key = KEY, sign = (mac) => `v1,${mac}` } = {}) {
  const body = JSON.stringify({ id, workspace_id: 'ws1', timestamp: new Date().toISOString(), ...event });
  const mac = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return fetch(`${service.admin}/notifuse/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'webhook-id': id, 'webhook-timestamp': String(timestamp), 'webhook-signature': sign(mac) },
    body,
  });
}

function bodyOf(mail) {
  const blank = mail.data.indexOf('');
  return Buffer.from(mail.data.slice(blank + 1).join(''), 'base64').toString('utf8');
}

function smtpEnv(sink) {
  return { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(sink.port), SMTP_SECURITY: 'none', SMTP_FROM: 'form@example.com', NOTIFUSE_WEBHOOK_SECRET: SECRET };
}

describe('notifuse webhook', () => {
  const logged = [];
  const auth = { Authorization: 'Basic ' + Buffer.from('admin:correct horse').toString('base64') };
  let sink;
  let service;

  before(async () => {
    sink = await startSmtpSink();
    service = await startService({
      ...smtpEnv(sink),
      NOTIFUSE_NOTIFY_TO: 'news@example.com',
      // the webhook has to get through without it
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'correct horse',
    }, { info: (message) => logged.push(message), error: (message) => logged.push(message) });
  });

  after(async () => {
    await service.close();
    await sink.close();
  });

  test('a signed list event becomes one mail, without the sign-in of the admin port', async () => {
    const before = sink.messages.length;
    const response = await deliver(service, confirmed);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, mailed: true });
    assert.equal(sink.messages.length, before + 1);
    const mail = sink.messages.at(-1);
    assert.match(mail.to[0], /news@example\.com/);
    const text = bodyOf(mail);
    for (const line of ['Address: reader@example.org', 'List: Weekly (weekly)', 'Status: active (was pending)', 'Event: list.confirmed', 'Workspace: ws1']) {
      assert.ok(text.includes(line), line);
    }
    assert.equal((await fetch(`${service.admin}/api/sites`)).status, 401);
  });

  test('a wrong or missing signature is refused and mails nothing', async () => {
    const before = sink.messages.length;
    const wrong = await deliver(service, confirmed, { key: Buffer.alloc(32, 8) });
    assert.equal(wrong.status, 401);
    assert.equal((await wrong.json()).error, 'webhook_signature');
    assert.equal((await deliver(service, confirmed, { sign: (mac) => `v2,${mac}` })).status, 401);
    assert.equal((await deliver(service, confirmed, { sign: () => 'v1,' })).status, 401);
    const unsigned = await fetch(`${service.admin}/notifuse/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(confirmed) });
    assert.equal(unsigned.status, 401);
    assert.equal((await unsigned.json()).error, 'webhook_headers');
    assert.equal(sink.messages.length, before);
  });

  test('while a secret is replaced, one valid signature among several is enough', async () => {
    const other = Buffer.alloc(32, 9).toString('base64');
    const response = await deliver(service, confirmed, { sign: (mac) => `v1,${other} v1,${mac}` });
    assert.equal(response.status, 200);
  });

  test('a second workspace signs with its own secret', async () => {
    assert.equal((await deliver(service, confirmed, { key: SECOND_KEY })).status, 200);
  });

  test('a timestamp off by more than five minutes is refused, even with a valid signature', async () => {
    for (const offset of [-301, 301]) {
      const response = await deliver(service, confirmed, { timestamp: Math.floor(Date.now() / 1000) + offset });
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error, 'webhook_timestamp');
    }
  });

  test('a delivery sent again is acknowledged, but not mailed twice', async () => {
    const id = crypto.randomUUID();
    const before = sink.messages.length;
    assert.equal((await deliver(service, confirmed, { id })).status, 200);
    const again = await deliver(service, confirmed, { id });
    assert.equal(again.status, 200);
    assert.deepEqual(await again.json(), { ok: true, mailed: false, reason: 'duplicate' });
    assert.equal(sink.messages.length, before + 1);
  });

  test('any other event is acknowledged without a mail', async () => {
    const before = sink.messages.length;
    for (const event of [{ type: 'contact.created', data: { email: 'reader@example.org' } }, { type: 'test', data: {} }, { type: 'list.confirmed', data: null }]) {
      const response = await deliver(service, event);
      assert.equal(response.status, 200, event.type);
      assert.deepEqual(await response.json(), { ok: true, mailed: false, reason: 'ignored' });
    }
    assert.equal(sink.messages.length, before);
  });

  test('only POST is answered', async () => {
    assert.equal((await fetch(`${service.admin}/notifuse/webhook`)).status, 405);
  });

  test('the log names the event, never the address, and the outcomes are counted', async () => {
    assert.ok(logged.includes('notifuse event list.confirmed mailed'));
    assert.ok(logged.includes('notifuse webhook refused reason=webhook_signature'));
    assert.ok(!logged.some((line) => line.includes('reader@example.org')));
    const metrics = await (await fetch(`${service.admin}/metrics`, { headers: auth })).text();
    for (const outcome of ['mailed', 'refused', 'duplicate', 'ignored']) {
      assert.ok(metrics.includes(`altcha_notifuse_webhooks_total{outcome="${outcome}"}`), outcome);
    }
  });
});

describe('notifuse webhook, mail server refuses', () => {
  const logged = [];
  let sink;
  let service;

  before(async () => {
    sink = await startSmtpSink();
    // the sink refuses every recipient blocked@, with the address in its answer
    service = await startService({ ...smtpEnv(sink), NOTIFUSE_NOTIFY_TO: 'blocked@example.com' }, { info: () => {}, error: (message) => logged.push(message) });
  });

  after(async () => {
    await service.close();
    await sink.close();
  });

  test('a refusal is answered with 502, and the retry of Notifuse is mailed again', async () => {
    const id = crypto.randomUUID();
    const first = await deliver(service, confirmed, { id });
    assert.equal(first.status, 502);
    assert.equal((await first.json()).error, 'delivery_failed');
    assert.equal((await deliver(service, confirmed, { id })).status, 502);
    const line = logged.at(-1);
    assert.ok(line.startsWith('notifuse event list.confirmed not mailed') && line.includes('<address>'), line);
    assert.ok(!line.includes('blocked@example.com'), line);
  });
});

test('without NOTIFUSE_WEBHOOK_SECRET the path does not exist', async () => {
  const service = await startService();
  try {
    assert.equal((await fetch(`${service.admin}/notifuse/webhook`, { method: 'POST' })).status, 404);
  }
  finally {
    await service.close();
  }
});
