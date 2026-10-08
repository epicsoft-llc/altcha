// Issuing and verifying challenges with altcha-lib in deterministic mode: the server
// knows the counter and signs the derived key, so a verification is two HMACs
// instead of a key derivation - verifying stays cheap however high the cost is set.

import crypto from 'node:crypto';
import { createChallenge, verifySolution } from 'altcha-lib';
import { deriveKey as pbkdf2 } from 'altcha-lib/algorithms/pbkdf2';
import { deriveKey as sha } from 'altcha-lib/algorithms/sha';

const MAX_PAYLOAD_LENGTH = 8192;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Two secrets from one, so the operator manages a single value.
function subkey(secret, purpose) {
  return crypto.createHmac('sha256', secret).update('altcha-service/' + purpose).digest('hex');
}

export function createAltcha(settings, hmacSecret) {
  const deriveKey = settings.algorithm.startsWith('PBKDF2/') ? pbkdf2 : sha;
  const signatureSecret = subkey(hmacSecret, 'challenge-signature');
  const keySignatureSecret = subkey(hmacSecret, 'key-signature');

  // The site name travels inside the signed parameters, so a solution can only be
  // spent on the site it was issued for.
  async function issue(siteName) {
    return createChallenge({
      algorithm: settings.algorithm,
      cost: settings.cost,
      counter: crypto.randomInt(settings.counterMin, settings.counterMax + 1),
      deriveKey,
      expiresAt: Math.floor(Date.now() / 1000) + settings.expiresSeconds,
      data: { site: siteName },
      hmacSignatureSecret: signatureSecret,
      hmacKeySignatureSecret: keySignatureSecret,
    });
  }

  // Returns { ok: true, site, nonce, expiresAt } or { ok: false, reason }. Marking the
  // challenge as used is the caller's job, and only after this returned ok.
  async function check(encoded) {
    if (typeof encoded !== 'string' || encoded === '') {
      return { ok: false, reason: 'altcha_missing' };
    }
    if (encoded.length > MAX_PAYLOAD_LENGTH) {
      return { ok: false, reason: 'altcha_malformed' };
    }
    let payload;
    try {
      payload = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    }
    catch (e) {
      return { ok: false, reason: 'altcha_malformed' };
    }
    const challenge = isObject(payload) ? payload.challenge : null;
    const solution = isObject(payload) ? payload.solution : null;
    if (!isObject(challenge) || !isObject(challenge.parameters) || typeof challenge.signature !== 'string' || !isObject(solution)) {
      return { ok: false, reason: 'altcha_malformed' };
    }
    const parameters = challenge.parameters;
    if (parameters.algorithm !== settings.algorithm) {
      return { ok: false, reason: 'altcha_algorithm' };
    }
    if (typeof parameters.nonce !== 'string' || !Number.isInteger(parameters.expiresAt)
        || !isObject(parameters.data) || typeof parameters.data.site !== 'string') {
      return { ok: false, reason: 'altcha_malformed' };
    }

    let result;
    try {
      result = await verifySolution({
        challenge: { parameters, signature: challenge.signature },
        solution,
        deriveKey,
        hmacSignatureSecret: signatureSecret,
        hmacKeySignatureSecret: keySignatureSecret,
      });
    }
    catch (e) {
      return { ok: false, reason: 'altcha_malformed' };
    }
    if (result.expired) {
      return { ok: false, reason: 'altcha_expired' };
    }
    if (result.invalidSignature) {
      return { ok: false, reason: 'altcha_signature' };
    }
    if (!result.verified) {
      return { ok: false, reason: 'altcha_solution' };
    }
    // Solve time is what the browser claims - for the metrics only, never for a decision.
    const claimed = solution.time;
    const solveSeconds = Number.isFinite(claimed) && claimed >= 0 && claimed < 3600000 ? claimed / 1000 : null;
    const issuedAt = parameters.expiresAt - settings.expiresSeconds;
    return {
      ok: true,
      site: parameters.data.site,
      nonce: parameters.nonce,
      expiresAt: parameters.expiresAt,
      solveSeconds,
      ageSeconds: Math.max(0, Date.now() / 1000 - issuedAt),
    };
  }

  return { issue, check };
}
