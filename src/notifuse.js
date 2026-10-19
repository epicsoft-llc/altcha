// The webhook of Notifuse on the admin port. Notifuse signs every delivery the Standard
// Webhooks way; the signature takes the place of the sign-in, which Notifuse cannot do.
// A list event becomes one mail to NOTIFUSE_NOTIFY_TO, any other event is acknowledged.

import crypto from 'node:crypto';
import { BodyError, readBody, sendJson } from './http.js';
import { buildNotice, withoutAddresses } from './mail.js';

export const WEBHOOK_PATH = '/notifuse/webhook';

const MAX_BODY = 1048576;
// a timestamp further off is refused - and with it a recorded delivery sent again later
const TOLERANCE_SECONDS = 300;
// longer than Notifuse retries (about ten hours), so a retry after a lost answer is not mailed twice
const KEEP_IDS_MS = 24 * 3600 * 1000;
const MAX_IDS = 10000;

// True when one of the v1 signatures in the header is the HMAC of id, timestamp and body
// under one of the keys. The header carries several while a secret is being replaced.
export function validSignature(keys, id, timestamp, body, header) {
  const given = header.split(' ').filter((part) => part.startsWith('v1,')).map((part) => Buffer.from(part.slice(3), 'base64'));
  return keys.some((key) => {
    const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();
    return given.some((signature) => signature.length === expected.length && crypto.timingSafeEqual(signature, expected));
  });
}

function parseEvent(raw) {
  try {
    const event = JSON.parse(raw);
    return event !== null && typeof event === 'object' && typeof event.type === 'string' ? event : null;
  }
  catch (e) {
    return null;
  }
}

export function createNotifuseWebhook({ config, mailer, stats, log }) {
  const { keys, to } = config.notifuse;
  // delivery ids being mailed right now, and those done - oldest first
  const sending = new Set();
  const done = new Map();

  function remember(id) {
    const now = Date.now();
    done.set(id, now + KEEP_IDS_MS);
    for (const [known, until] of done) {
      if (until > now && done.size <= MAX_IDS) {
        break;
      }
      done.delete(known);
    }
  }

  function refuse(res, status, reason) {
    stats.notifuseWebhook('refused');
    log.info(`notifuse webhook refused reason=${reason}`);
    sendJson(res, status, { ok: false, error: reason });
  }

  return async function handle(req, res) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
      return;
    }
    const id = String(req.headers['webhook-id'] ?? '');
    const timestamp = String(req.headers['webhook-timestamp'] ?? '');
    const signature = String(req.headers['webhook-signature'] ?? '');
    if (!/^[\x21-\x7e]{1,128}$/.test(id) || !/^\d{1,12}$/.test(timestamp) || signature === '') {
      refuse(res, 401, 'webhook_headers');
      return;
    }
    let raw;
    try {
      raw = await readBody(req, MAX_BODY);
    }
    catch (e) {
      if (!(e instanceof BodyError)) {
        throw e;
      }
      refuse(res, e.status, e.reason);
      return;
    }
    if (!validSignature(keys, id, timestamp, raw, signature)) {
      refuse(res, 401, 'webhook_signature');
      return;
    }
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) {
      refuse(res, 401, 'webhook_timestamp');
      return;
    }

    if (done.has(id)) {
      stats.notifuseWebhook('duplicate');
      sendJson(res, 200, { ok: true, mailed: false, reason: 'duplicate' });
      return;
    }
    if (sending.has(id)) {
      // the first attempt is still at the mail server - Notifuse tries again later
      stats.notifuseWebhook('duplicate');
      sendJson(res, 409, { ok: false, error: 'in_progress' });
      return;
    }
    const event = parseEvent(raw);
    if (event === null) {
      refuse(res, 400, 'body_malformed');
      return;
    }
    if (!event.type.startsWith('list.') || event.data === null || typeof event.data !== 'object') {
      remember(id);
      stats.notifuseWebhook('ignored');
      sendJson(res, 200, { ok: true, mailed: false, reason: 'ignored' });
      return;
    }

    const type = /^list\.[a-z_]{1,32}$/.test(event.type) ? event.type : 'list.other';
    sending.add(id);
    try {
      await mailer.send({ from: config.smtp.from, to, message: buildNotice({ smtp: config.smtp, to, event }) });
    }
    catch (e) {
      stats.notifuseWebhook('failed');
      log.error(`notifuse event ${type} not mailed: ${withoutAddresses(e.message)}`);
      sendJson(res, 502, { ok: false, error: 'delivery_failed' });
      return;
    }
    finally {
      sending.delete(id);
    }
    remember(id);
    stats.notifuseWebhook('mailed');
    log.info(`notifuse event ${type} mailed`);
    sendJson(res, 200, { ok: true, mailed: true });
  };
}
