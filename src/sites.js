// Validation of a site as it comes from the admin API. Everything that later ends up
// in a mail header, a redirect or a CORS header passes through here first - the
// public handler trusts what the database holds.

import { MAIL_ADDRESS } from './config.js';

const NAME = /^[a-z0-9][a-z0-9.-]{0,62}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

export class ValidationError extends Error {
  constructor(fields) {
    super('validation');
    this.fields = fields;
  }
}

export function normalizeOrigin(value) {
  let url;
  try {
    url = new URL(String(value).trim());
  }
  catch (e) {
    return null;
  }
  const plain = url.pathname === '/' && url.search === '' && url.hash === '' && url.username === '' && url.password === '';
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !plain) {
    return null;
  }
  return url.origin;
}

function optionalText(errors, field, value, max) {
  const text = value === undefined || value === null ? '' : String(value).trim();
  if (text.length > max) {
    errors[field] = `at most ${max} characters`;
  }
  else if (CONTROL.test(text)) {
    errors[field] = 'must not contain line breaks or control characters';
  }
  return text;
}

// A redirect target has to point back to the site itself, otherwise /submit is an
// open redirect anyone can put behind a link.
function redirectUrl(errors, field, value, origins) {
  const text = value === undefined || value === null ? '' : String(value).trim();
  if (text === '') {
    return null;
  }
  let url;
  try {
    url = new URL(text);
  }
  catch (e) {
    errors[field] = 'not a valid URL';
    return null;
  }
  if (!origins.includes(url.origin)) {
    errors[field] = 'has to be on one of the origins of this site';
    return null;
  }
  return url.href;
}

export function validateSite(input) {
  const errors = {};
  const source = input !== null && typeof input === 'object' ? input : {};

  const name = String(source.name ?? '').trim().toLowerCase();
  if (!NAME.test(name)) {
    errors.name = 'lowercase letters, digits, dot and dash, starting with a letter or digit, at most 63 characters';
  }

  const origins = [];
  const rawOrigins = Array.isArray(source.origins) ? source.origins : [];
  for (const raw of rawOrigins) {
    const origin = normalizeOrigin(raw);
    if (origin === null) {
      errors.origins = `'${String(raw).slice(0, 80)}' is not an origin - scheme and host only, like https://example.com`;
      break;
    }
    if (!origins.includes(origin)) {
      origins.push(origin);
    }
  }
  if (!errors.origins && origins.length === 0) {
    errors.origins = 'at least one origin';
  }

  const recipientText = String(source.recipient ?? '').trim();
  if (recipientText !== '' && !MAIL_ADDRESS.test(recipientText)) {
    errors.recipient = 'not a plain mail address';
  }

  const submitPerHour = Number(source.submitPerHour ?? 200);
  if (!Number.isInteger(submitPerHour) || submitPerHour < 1 || submitPerHour > 100000) {
    errors.submitPerHour = 'a whole number between 1 and 100000';
  }

  const site = {
    name,
    origins,
    recipient: recipientText === '' ? null : recipientText,
    subjectPrefix: optionalText(errors, 'subjectPrefix', source.subjectPrefix, 100),
    successUrl: redirectUrl(errors, 'successUrl', source.successUrl, origins),
    errorUrl: redirectUrl(errors, 'errorUrl', source.errorUrl, origins),
    submitPerHour,
    enabled: source.enabled === undefined ? true : source.enabled === true,
    note: optionalText(errors, 'note', source.note, 500),
  };

  if (Object.keys(errors).length > 0) {
    throw new ValidationError(errors);
  }
  return site;
}
