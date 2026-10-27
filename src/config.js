// Configuration comes from environment variables only. Every secret can also be read
// from a file (<NAME>_FILE, the Docker secrets pattern); setting both is an error, so a
// stale variable never silently wins over the mounted secret.

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export const ALGORITHMS = ['PBKDF2/SHA-256', 'PBKDF2/SHA-384', 'PBKDF2/SHA-512', 'SHA-256', 'SHA-384', 'SHA-512'];
const SMTP_SECURITY = ['starttls', 'tls', 'none'];
const LOGO_TYPES = { '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
const MAX_LOGO_BYTES = 65536;

export const MAIL_ADDRESS = /^[^\s@<>,;:"()[\]\\]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
// a language tag in lower case, like de, de-at, es-419 or zh-hant - for the site settings and the form
export const LANGUAGE_TAG = /^[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}$/;

export class ConfigError extends Error {}

function text(env, name, fallback = '') {
  const value = env[name];
  return value === undefined || value === '' ? fallback : value;
}

function secret(env, name) {
  const value = text(env, name);
  const file = text(env, name + '_FILE');
  if (value !== '' && file !== '') {
    throw new ConfigError(`${name} and ${name}_FILE are both set - use one of them`);
  }
  if (file === '') {
    return value;
  }
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  }
  catch (e) {
    throw new ConfigError(`${name}_FILE cannot be read: ${file}`);
  }
  content = content.replace(/\r?\n$/, '');
  if (content === '') {
    throw new ConfigError(`${name}_FILE is empty: ${file}`);
  }
  return content;
}

function integer(env, name, fallback, min, max) {
  const raw = text(env, name);
  if (raw === '') {
    return fallback;
  }
  if (!/^\d+$/.test(raw)) {
    throw new ConfigError(`${name} must be a whole number, got '${raw}'`);
  }
  const value = Number(raw);
  if (value < min || value > max) {
    throw new ConfigError(`${name} must be between ${min} and ${max}, got ${value}`);
  }
  return value;
}

function oneOf(env, name, fallback, allowed) {
  const value = text(env, name, fallback);
  if (!allowed.includes(value)) {
    throw new ConfigError(`${name} must be one of ${allowed.join(', ')}, got '${value}'`);
  }
  return value;
}

function singleLine(name, value) {
  if (/[\r\n]/.test(value)) {
    throw new ConfigError(`${name} must be a single line`);
  }
  return value;
}

function webUrl(env, name) {
  const raw = text(env, name);
  if (raw === '') {
    return '';
  }
  let url;
  try {
    url = new URL(raw);
  }
  catch (e) {
    throw new ConfigError(`${name} is not a valid URL: '${raw}'`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ConfigError(`${name} must start with https:// or http://`);
  }
  return url.href;
}

function publicUrl(env) {
  return webUrl(env, 'PUBLIC_URL').replace(/\/+$/, '');
}

// Who runs this instance, for the page on / of the public port - each part only shows when it is set.
function page(env) {
  const operator = singleLine('PAGE_OPERATOR', text(env, 'PAGE_OPERATOR'));
  const operatorUrl = webUrl(env, 'PAGE_OPERATOR_URL');
  const logoPath = text(env, 'PAGE_LOGO');
  if (operator === '' && (operatorUrl !== '' || logoPath !== '')) {
    throw new ConfigError('PAGE_OPERATOR_URL and PAGE_LOGO need PAGE_OPERATOR - the page shows them next to the name');
  }
  let logo = '';
  if (logoPath !== '') {
    const type = LOGO_TYPES[path.extname(logoPath).toLowerCase()];
    if (type === undefined) {
      throw new ConfigError(`PAGE_LOGO must be an .svg, .png or .webp file, got '${logoPath}'`);
    }
    let data;
    try {
      data = fs.readFileSync(logoPath);
    }
    catch (e) {
      throw new ConfigError(`PAGE_LOGO cannot be read: ${logoPath}`);
    }
    if (data.length === 0 || data.length > MAX_LOGO_BYTES) {
      throw new ConfigError(`PAGE_LOGO must not be empty or larger than ${MAX_LOGO_BYTES / 1024} kB: ${logoPath}`);
    }
    logo = `data:${type};base64,${data.toString('base64')}`;
  }
  return {
    operator,
    operatorUrl,
    logo,
    imprintUrl: webUrl(env, 'PAGE_IMPRINT_URL'),
    privacyUrl: webUrl(env, 'PAGE_PRIVACY_URL'),
  };
}

// IP addresses and CIDR ranges, separated by commas or spaces
function addressList(name, raw) {
  const list = new net.BlockList();
  const entries = raw.split(/[\s,]+/).filter((entry) => entry !== '');
  for (const entry of entries) {
    const [address, prefix, extra] = entry.split('/');
    const type = net.isIPv4(address) ? 'ipv4' : net.isIPv6(address) ? 'ipv6' : null;
    const bits = type === 'ipv4' ? 32 : 128;
    if (type === null || extra !== undefined || (prefix !== undefined && (!/^\d{1,3}$/.test(prefix) || Number(prefix) > bits))) {
      throw new ConfigError(`${name}: '${entry}' is not an IP address or CIDR range`);
    }
    if (prefix === undefined) {
      list.addAddress(address, type);
    }
    else {
      list.addSubnet(address, Number(prefix), type);
    }
  }
  return { list, entries };
}

function admin(env) {
  const username = singleLine('ADMIN_USERNAME', text(env, 'ADMIN_USERNAME'));
  const password = secret(env, 'ADMIN_PASSWORD');
  if ((username === '') !== (password === '')) {
    throw new ConfigError('ADMIN_USERNAME and ADMIN_PASSWORD have to be set together - one of them alone would leave the admin port open by mistake');
  }
  if (username.includes(':')) {
    throw new ConfigError('ADMIN_USERNAME must not contain a colon - Basic auth uses it as the separator');
  }

  const token = secret(env, 'ADMIN_API_TOKEN');
  if (token !== '' && token.length < 32) {
    throw new ConfigError('ADMIN_API_TOKEN must have at least 32 characters');
  }

  const trustedRaw = text(env, 'ADMIN_TRUSTED_PROXIES');
  const trusted = trustedRaw === '' ? null : addressList('ADMIN_TRUSTED_PROXIES', trustedRaw);
  const header = text(env, 'ADMIN_PROXY_USER_HEADER');
  const usersRaw = text(env, 'ADMIN_ALLOWED_USERS');
  let proxy = null;
  if (header !== '') {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(header)) {
      throw new ConfigError(`ADMIN_PROXY_USER_HEADER is not a header name: '${header}'`);
    }
    if (trusted === null) {
      throw new ConfigError('ADMIN_PROXY_USER_HEADER needs ADMIN_TRUSTED_PROXIES - without it anybody could send the header and be let in');
    }
    proxy = { header: header.toLowerCase(), users: usersRaw === '' ? null : new Set(usersRaw.split(/[\s,]+/).filter((u) => u !== '')) };
  }
  else if (usersRaw !== '') {
    throw new ConfigError('ADMIN_ALLOWED_USERS only works together with ADMIN_PROXY_USER_HEADER');
  }

  const basic = username === '' ? null : { username, password };
  return {
    basic,
    token: token === '' ? null : token,
    proxy,
    trustedProxies: trusted?.list ?? null,
    trustedProxiesText: trusted?.entries ?? [],
    enabled: basic !== null || token !== '' || proxy !== null,
  };
}

function smtp(env) {
  const host = text(env, 'SMTP_HOST');
  if (host === '') {
    return null;
  }
  const security = oneOf(env, 'SMTP_SECURITY', 'starttls', SMTP_SECURITY);
  const username = singleLine('SMTP_USERNAME', text(env, 'SMTP_USERNAME'));
  const password = secret(env, 'SMTP_PASSWORD');
  if ((username === '') !== (password === '')) {
    throw new ConfigError('SMTP_USERNAME and SMTP_PASSWORD have to be set together');
  }
  if (security === 'none' && username !== '') {
    throw new ConfigError('SMTP_SECURITY=none sends the password in clear text - use starttls or tls, or drop the credentials');
  }
  const from = text(env, 'SMTP_FROM');
  if (!MAIL_ADDRESS.test(from)) {
    throw new ConfigError(`SMTP_FROM must be a plain mail address, got '${from}'`);
  }
  return {
    host: singleLine('SMTP_HOST', host),
    port: integer(env, 'SMTP_PORT', security === 'tls' ? 465 : 587, 1, 65535),
    security,
    tlsServername: singleLine('SMTP_TLS_SERVERNAME', text(env, 'SMTP_TLS_SERVERNAME', host)),
    username,
    password,
    from,
    fromName: singleLine('SMTP_FROM_NAME', text(env, 'SMTP_FROM_NAME')),
    helo: singleLine('SMTP_HELO', text(env, 'SMTP_HELO', 'altcha')),
    timeoutMs: integer(env, 'SMTP_TIMEOUT', 20, 1, 300) * 1000,
  };
}

// The webhook of Notifuse: its signing secrets in the whsec_ form Notifuse shows once - one
// per workspace, separated by spaces or commas - and the address that gets the mails.
function notifuse(env, smtpSettings) {
  const signingSecret = secret(env, 'NOTIFUSE_WEBHOOK_SECRET');
  const to = text(env, 'NOTIFUSE_NOTIFY_TO');
  if ((signingSecret === '') !== (to === '')) {
    throw new ConfigError('NOTIFUSE_WEBHOOK_SECRET and NOTIFUSE_NOTIFY_TO have to be set together');
  }
  if (signingSecret === '') {
    return null;
  }
  if (smtpSettings === null) {
    throw new ConfigError('NOTIFUSE_NOTIFY_TO needs SMTP_HOST - the events go out by mail');
  }
  if (!MAIL_ADDRESS.test(to)) {
    throw new ConfigError(`NOTIFUSE_NOTIFY_TO must be a plain mail address, got '${to}'`);
  }
  const entries = signingSecret.split(/[\s,]+/).filter((entry) => entry !== '');
  const keys = entries.map((entry) => Buffer.from(entry.slice(6), 'base64'));
  const wellFormed = (entry, i) => /^whsec_[A-Za-z0-9+/]+={0,2}$/.test(entry) && (entry.length - 6) % 4 === 0 && keys[i].length >= 24;
  if (keys.length === 0 || !entries.every(wellFormed)) {
    throw new ConfigError('NOTIFUSE_WEBHOOK_SECRET must hold the whsec_... secrets Notifuse shows for its webhooks');
  }
  return { keys, to };
}

export function loadConfig(env = process.env) {
  const hmacSecret = secret(env, 'HMAC_SECRET');
  if (hmacSecret.length < 32) {
    throw new ConfigError('HMAC_SECRET is required and must have at least 32 characters');
  }

  const counterMin = integer(env, 'ALTCHA_COUNTER_MIN', 5000, 0, 4294967295);
  const counterMax = integer(env, 'ALTCHA_COUNTER_MAX', 10000, 0, 4294967295);
  if (counterMax < counterMin) {
    throw new ConfigError('ALTCHA_COUNTER_MAX must not be smaller than ALTCHA_COUNTER_MIN');
  }

  const smtpSettings = smtp(env);
  return Object.freeze({
    buildTag: text(env, 'IMAGE_TAG', 'local'),
    port: integer(env, 'PORT', 8080, 0, 65535),
    adminPort: integer(env, 'ADMIN_PORT', 8081, 0, 65535),
    dataDir: text(env, 'DATA_DIR', '/data'),
    publicUrl: publicUrl(env),
    trustProxy: integer(env, 'TRUST_PROXY', 0, 0, 10),
    maxBodyBytes: integer(env, 'MAX_BODY_BYTES', 32768, 1024, 1048576),
    honeypotField: singleLine('HONEYPOT_FIELD', text(env, 'HONEYPOT_FIELD', 'website')),
    statsRetentionDays: integer(env, 'STATS_RETENTION_DAYS', 90, 1, 3650),
    rate: {
      challengePerIp: integer(env, 'RATE_CHALLENGE_PER_IP', 60, 0, 1000000),
      submitPerIp: integer(env, 'RATE_SUBMIT_PER_IP', 10, 0, 1000000),
      verifyPerIp: integer(env, 'RATE_VERIFY_PER_IP', 3600, 0, 10000000),
    },
    hmacSecret,
    altcha: {
      algorithm: oneOf(env, 'ALTCHA_ALGORITHM', 'PBKDF2/SHA-256', ALGORITHMS),
      cost: integer(env, 'ALTCHA_COST', 5000, 1, 10000000),
      counterMin,
      counterMax,
      expiresSeconds: integer(env, 'ALTCHA_EXPIRES', 600, 10, 86400),
    },
    admin: admin(env),
    smtp: smtpSettings,
    notifuse: notifuse(env, smtpSettings),
    page: page(env),
  });
}
