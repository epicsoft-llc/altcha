// Who is asking on the admin port. Three ways in, in any combination: a reverse proxy
// that signs users in and passes the name in a header, Basic auth, and an API token
// for scripts. Wrong passwords and tokens are counted per client; after too many the
// client is turned away without its credentials even being checked, so a correct
// guess during the lockout cannot be told from a wrong one.

import crypto from 'node:crypto';
import net from 'node:net';
import { normalizeAddress, rateKey } from './http.js';
import { RateLimiter } from './ratelimit.js';

export const FAILURE_LIMIT = 10;
export const FAILURE_WINDOW_SECONDS = 900;

function digest(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

// compares digests of equal length, so the time taken says nothing about the value
function equal(a, b) {
  return crypto.timingSafeEqual(digest(a), digest(b));
}

function basicMatches(header, basic) {
  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header);
  if (match === null) {
    return false;
  }
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const split = decoded.indexOf(':');
  if (split < 0) {
    return false;
  }
  // both parts compared in full, so the time taken does not say which one was wrong
  const userOk = equal(decoded.slice(0, split), basic.username);
  const passwordOk = equal(decoded.slice(split + 1), basic.password);
  return userOk && passwordOk;
}

export function createAuth(admin) {
  const failures = new RateLimiter(FAILURE_WINDOW_SECONDS * 1000);

  function trusted(address) {
    if (admin.trustedProxies === null || net.isIP(address) === 0) {
      return false;
    }
    return admin.trustedProxies.check(address, net.isIPv4(address) ? 'ipv4' : 'ipv6');
  }

  // Behind a trusted proxy the client is the last X-Forwarded-For entry - otherwise all
  // failures would count against the proxy, and one attacker could lock everybody out.
  function client(req) {
    const socket = normalizeAddress(req.socket.remoteAddress ?? '');
    if (trusted(socket)) {
      const chain = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
      if (chain.length > 0) {
        return { socket, address: normalizeAddress(chain[chain.length - 1]) };
      }
    }
    return { socket, address: socket };
  }

  // Returns { ok: true, user, method } or { ok: false, status, reason }.
  function authenticate(req) {
    if (!admin.enabled) {
      return { ok: true, user: null, method: 'none' };
    }
    const { socket, address } = client(req);
    const key = rateKey(address);
    if (failures.full(key, FAILURE_LIMIT)) {
      return { ok: false, status: 429, reason: 'too_many_failures' };
    }
    const header = String(req.headers.authorization ?? '');

    if (admin.token !== null && /^Bearer\s+/i.test(header)) {
      if (equal(header.replace(/^Bearer\s+/i, '').trim(), admin.token)) {
        return { ok: true, user: 'api-token', method: 'token' };
      }
      failures.allow(key, FAILURE_LIMIT);
      return { ok: false, status: 401, reason: 'invalid_token' };
    }

    if (admin.proxy !== null && trusted(socket)) {
      const name = String(req.headers[admin.proxy.header] ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
      if (name !== '') {
        if (admin.proxy.users !== null && !admin.proxy.users.has(name)) {
          return { ok: false, status: 403, reason: 'user_not_allowed', user: name };
        }
        return { ok: true, user: name, method: 'proxy' };
      }
    }

    if (admin.basic !== null && /^Basic\s+/i.test(header)) {
      if (basicMatches(header, admin.basic)) {
        return { ok: true, user: admin.basic.username, method: 'basic' };
      }
      failures.allow(key, FAILURE_LIMIT);
      return { ok: false, status: 401, reason: 'invalid_credentials' };
    }

    return { ok: false, status: 401, reason: 'authentication_required' };
  }

  return { authenticate };
}
