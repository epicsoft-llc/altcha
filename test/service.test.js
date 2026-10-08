import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createSite, fetchChallenge, solve, startService, startSmtpSink } from './helpers.js';

const ORIGIN = 'https://forms.example.com';
const FOREIGN = 'https://elsewhere.example.org';

function postForm(service, path, fields, headers = {}) {
  return fetch(`${service.base}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: ORIGIN, ...headers },
    body: new URLSearchParams(fields).toString(),
  });
}

function postJson(service, path, body, headers = {}) {
  return fetch(`${service.base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function freshPayload(service, origin = ORIGIN) {
  return solve((await fetchChallenge(service, origin)).body);
}

describe('public port', () => {
  let sink;
  let service;

  before(async () => {
    sink = await startSmtpSink();
    service = await startService({
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(sink.port),
      SMTP_SECURITY: 'none',
      SMTP_FROM: 'form@example.com',
      // every case here comes from the same address
      RATE_SUBMIT_PER_IP: '100',
    });
    const created = await createSite(service, {
      name: 'forms',
      origins: [ORIGIN],
      recipient: 'office@example.com',
      subjectPrefix: '[forms] ',
      successUrl: `${ORIGIN}/thanks`,
    });
    assert.equal(created.status, 201);
    assert.equal((await createSite(service, { name: 'verify-only', origins: ['https://app.example.com'] })).status, 201);
  });

  after(async () => {
    await service.close();
    await sink.close();
  });

  test('serves the widget with CORS for module scripts', async () => {
    const response = await fetch(`${service.base}/widget.js`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.match(await response.text(), /customElements\.define/);
  });

  test('a challenge only for a known origin', async () => {
    const known = await fetchChallenge(service, ORIGIN);
    assert.equal(known.status, 200);
    assert.equal(known.headers.get('access-control-allow-origin'), ORIGIN);
    assert.equal(known.body.parameters.data.site, 'forms');
    assert.equal((await fetchChallenge(service, FOREIGN)).status, 403);
    assert.equal((await fetch(`${service.base}/challenge`)).status, 403);
  });

  test('submit delivers the form and redirects a plain form post', async () => {
    const before = sink.messages.length;
    const response = await postForm(service, '/submit', {
      name: 'Visitor', email: 'visitor@example.org', subject: 'Hello', message: 'A question', altcha: await freshPayload(service),
    }, { Accept: 'text/html' });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), `${ORIGIN}/thanks`);
    assert.equal(sink.messages.length, before + 1);
    const mail = sink.messages.at(-1);
    assert.match(mail.to[0], /office@example\.com/);
    assert.ok(mail.data.includes('Reply-To: visitor@example.org'));
  });

  test('a solution is spent once', async () => {
    const payload = await freshPayload(service);
    assert.equal((await postForm(service, '/submit', { message: 'first', altcha: payload })).status, 200);
    const second = await postForm(service, '/submit', { message: 'second', altcha: payload });
    assert.equal(second.status, 403);
    assert.equal((await second.json()).error, 'altcha_replay');
  });

  test('a tampered challenge is refused', async () => {
    const challenge = (await fetchChallenge(service, ORIGIN)).body;
    const payload = JSON.parse(Buffer.from(await solve(challenge), 'base64').toString());
    payload.challenge.parameters.expiresAt += 3600;
    const response = await postForm(service, '/submit', { altcha: Buffer.from(JSON.stringify(payload)).toString('base64') });
    assert.equal((await response.json()).error, 'altcha_signature');
  });

  test('the honeypot is answered like a success but not mailed', async () => {
    const before = sink.messages.length;
    const response = await postForm(service, '/submit', { message: 'spam', website: 'http://spam.example', altcha: await freshPayload(service) });
    assert.equal(response.status, 200);
    assert.equal(sink.messages.length, before);
  });

  test('a solution for one site is not accepted by another', async () => {
    const payload = await freshPayload(service, 'https://app.example.com');
    const response = await postForm(service, '/submit', { altcha: payload });
    assert.equal((await response.json()).error, 'altcha_site');
  });

  test('a site without recipient cannot submit', async () => {
    const response = await postForm(service, '/submit', { altcha: 'x' }, { Origin: 'https://app.example.com' });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, 'submit_disabled');
  });

  test('verify from a backend, bound to the site it names', async () => {
    const ok = await postJson(service, '/verify', { altcha: await freshPayload(service, 'https://app.example.com'), site: 'verify-only' });
    assert.deepEqual(await ok.json(), { ok: true, verified: true, site: 'verify-only' });

    const wrong = await postJson(service, '/verify', { altcha: await freshPayload(service), site: 'verify-only' });
    assert.equal((await wrong.json()).error, 'altcha_site');

    const foreign = await postJson(service, '/verify', { altcha: await freshPayload(service) }, { Origin: FOREIGN });
    assert.equal(foreign.status, 403);
  });

  test('a body over the limit is answered with 413, not a reset connection', async () => {
    const response = await postForm(service, '/submit', { message: 'x'.repeat(40000) });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error, 'body_too_large');
  });

  test('multipart bodies are refused', async () => {
    const form = new FormData();
    form.append('altcha', 'x');
    const response = await fetch(`${service.base}/submit`, { method: 'POST', headers: { Origin: ORIGIN }, body: form });
    assert.equal((await response.json()).error, 'unsupported_media_type');
  });
});

describe('admin port', () => {
  let service;

  before(async () => {
    service = await startService({ ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'correct horse' });
  });

  after(async () => {
    await service.close();
  });

  const auth = { Authorization: 'Basic ' + Buffer.from('admin:correct horse').toString('base64') };

  test('Basic auth is required, except for the health check', async () => {
    assert.equal((await fetch(`${service.admin}/api/sites`)).status, 401);
    const wrong = { Authorization: 'Basic ' + Buffer.from('admin:wrong').toString('base64') };
    assert.equal((await fetch(`${service.admin}/api/sites`, { headers: wrong })).status, 401);
    assert.equal((await fetch(`${service.admin}/api/sites`, { headers: auth })).status, 200);
    assert.equal((await fetch(`${service.admin}/healthz`)).status, 200);
  });

  test('changes need the admin header', async () => {
    const response = await fetch(`${service.admin}/api/sites`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x', origins: ['https://x.example.com'] }),
    });
    assert.equal(response.status, 403);
  });

  test('create, update and delete a site', async () => {
    const created = await createSite(service, { name: 'shop', origins: ['https://shop.example.com'] }, auth);
    assert.equal(created.status, 201);
    const id = created.body.id;

    const duplicate = await createSite(service, { name: 'other', origins: ['https://shop.example.com/'] }, auth);
    assert.equal(duplicate.status, 400);
    assert.match(duplicate.body.fields.origins, /already belongs/);

    const updated = await fetch(`${service.admin}/api/sites/${id}`, {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'application/json', 'X-Altcha-Admin': '1' },
      body: JSON.stringify({ name: 'shop', origins: ['https://shop.example.com', 'https://www.shop.example.com'], enabled: false }),
    });
    assert.equal(updated.status, 200);
    assert.deepEqual((await updated.json()).origins, ['https://shop.example.com', 'https://www.shop.example.com']);

    // a disabled site gets no challenges, and the refusal is counted for it
    const refused = await fetchChallenge(service, 'https://shop.example.com');
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error, 'site_disabled');

    const removed = await fetch(`${service.admin}/api/sites/${id}`, { method: 'DELETE', headers: { ...auth, 'X-Altcha-Admin': '1' } });
    assert.equal(removed.status, 200);
    assert.equal((await fetch(`${service.admin}/api/sites/${id}`, { headers: auth })).status, 404);
  });

  test('the UI and its modules are served', async () => {
    const page = await fetch(`${service.admin}/`, { headers: auth });
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
    for (const asset of ['/app.js', '/chart.js', '/app.css']) {
      assert.equal((await fetch(`${service.admin}${asset}`, { headers: auth })).status, 200, asset);
    }
  });

  test('a site takes any number of origins', async () => {
    const origins = Array.from({ length: 250 }, (_, i) => `https://shop${i}.example.com`);
    const created = await createSite(service, { name: 'many', origins }, auth);
    assert.equal(created.status, 201);
    assert.equal(created.body.origins.length, 250);
  });

  test('statistics: history, activity per site and metrics', async () => {
    const created = await createSite(service, { name: 'counted', origins: ['https://counted.example.com'] }, auth);
    assert.equal((await fetchChallenge(service, 'https://counted.example.com')).status, 200);
    await fetchChallenge(service, 'https://nobody.example.org');

    const history = await (await fetch(`${service.admin}/api/stats?range=24h&site=${created.body.id}`, { headers: auth })).json();
    assert.equal(history.points.length, 24);
    assert.equal(history.totals.challenges, 1);
    assert.equal(history.points.at(-1).challenges, 1);

    const unknown = await (await fetch(`${service.admin}/api/stats?range=7d&site=0`, { headers: auth })).json();
    assert.equal(unknown.points.length, 56);
    assert.ok(unknown.reasons.origin_unknown >= 1);

    const sites = await (await fetch(`${service.admin}/api/sites`, { headers: auth })).json();
    const counted = sites.find((s) => s.name === 'counted');
    assert.equal(counted.activity.challenges, 1);
    assert.ok(counted.lastActivity > 0);

    assert.equal((await fetch(`${service.admin}/api/stats?range=1y`, { headers: auth })).status, 400);

    const metrics = await (await fetch(`${service.admin}/metrics`, { headers: auth })).text();
    for (const name of ['altcha_build_info', 'altcha_challenges_total{site="counted"} 1', 'altcha_rejected_total{site="-",reason="origin_unknown"} 1',
      'altcha_http_requests_total', 'altcha_challenge_issue_seconds_bucket', 'altcha_database_size_bytes', 'nodejs_eventloop_lag_seconds']) {
      assert.ok(metrics.includes(name), name);
    }
  });
});
