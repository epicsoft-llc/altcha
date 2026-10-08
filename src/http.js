// Small HTTP helpers shared by the public and the admin server.

import net from 'node:net';

export class BodyError extends Error {
  constructor(status, reason) {
    super(reason);
    this.status = status;
    this.reason = reason;
  }
}

const MAX_FIELDS = 100;
const MAX_FIELD_NAME = 100;

const COMMON_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

// A body that was not read to the end is not drained: the answer closes the connection.
function closeIfUnread(req, headers) {
  return req.complete ? headers : { Connection: 'close', ...headers };
}

export function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, closeIfUnread(res.req, { 'Content-Type': 'application/json; charset=utf-8', ...COMMON_HEADERS, ...headers }));
  res.end(JSON.stringify(body));
}

export function sendText(res, status, body, headers = {}) {
  res.writeHead(status, closeIfUnread(res.req, { 'Content-Type': 'text/plain; charset=utf-8', ...COMMON_HEADERS, ...headers }));
  res.end(body);
}

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > limit) {
      req.pause();
      reject(new BodyError(413, 'body_too_large'));
      return;
    }
    let size = 0;
    const parts = [];
    const onData = (chunk) => {
      size += chunk.length;
      if (size > limit) {
        req.off('data', onData);
        req.pause();
        reject(new BodyError(413, 'body_too_large'));
        return;
      }
      parts.push(chunk);
    };
    req.on('data', onData);
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', () => reject(new BodyError(400, 'body_malformed')));
    // a client that hangs up mid-body; after 'end' this rejection is a no-op
    req.on('close', () => reject(new BodyError(400, 'body_incomplete')));
  });
}

export function mediaType(req) {
  return String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
}

// Form fields as a flat map of strings. Nested JSON is refused rather than flattened:
// what a form sends is flat, and anything else would end up as [object Object].
export function parseFields(raw, type) {
  const fields = Object.create(null);
  let entries;
  if (type === 'application/json') {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    }
    catch (e) {
      throw new BodyError(400, 'body_malformed');
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BodyError(400, 'body_malformed');
    }
    entries = Object.entries(parsed);
    for (const [, value] of entries) {
      if (value !== null && typeof value === 'object') {
        throw new BodyError(400, 'body_malformed');
      }
    }
  }
  else if (type === 'application/x-www-form-urlencoded') {
    entries = [...new URLSearchParams(raw)];
  }
  else {
    throw new BodyError(415, 'unsupported_media_type');
  }
  if (entries.length > MAX_FIELDS) {
    throw new BodyError(400, 'too_many_fields');
  }
  for (const [name, value] of entries) {
    if (name.length === 0 || name.length > MAX_FIELD_NAME) {
      throw new BodyError(400, 'body_malformed');
    }
    fields[name] = value === null || value === undefined ? '' : String(value);
  }
  return fields;
}

// '::ffff:192.0.2.1' is an IPv4 client on a dual-stack socket
export function normalizeAddress(address) {
  const text = String(address ?? '').trim();
  return text.startsWith('::ffff:') && net.isIPv4(text.slice(7)) ? text.slice(7) : text;
}

// With n trusted proxies in front, each appends the address it saw: the client is
// the n-th entry from the right. Anything further left was sent by the client itself.
export function clientIp(req, trustProxy) {
  const direct = normalizeAddress(req.socket.remoteAddress ?? '-');
  if (trustProxy === 0) {
    return direct;
  }
  const chain = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
  return chain.length >= trustProxy ? normalizeAddress(chain[chain.length - trustProxy]) : direct;
}

// The key a rate limit counts under. An IPv6 user usually holds a whole /64 and can
// pick a new address from it for every request - so IPv6 counts per /64.
export function rateKey(address) {
  const ip = normalizeAddress(address).split('%')[0];
  if (!net.isIPv6(ip)) {
    return ip;
  }
  const [head, tail] = ip.split('::');
  const front = head === '' ? [] : head.split(':');
  const back = tail === undefined || tail === '' ? [] : tail.split(':');
  const groups = tail === undefined ? front : [...front, ...new Array(Math.max(0, 8 - front.length - back.length)).fill('0'), ...back];
  return groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':') + '::/64';
}

export function requestOrigin(req) {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
    return origin;
  }
  const referer = req.headers.referer;
  if (typeof referer === 'string' && referer !== '') {
    try {
      return new URL(referer).origin;
    }
    catch (e) {
      return '';
    }
  }
  return '';
}
