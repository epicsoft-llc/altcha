// The page on GET / of the public port: what this service is, where its source lives and, from PAGE_*, who runs it.
// Built once at start; the CSP allows its inline style by hash and images only as data: URLs.

import crypto from 'node:crypto';

const SHIELD = '<path d="M12 3l7.5 3v5.5c0 4.6-3.1 8.4-7.5 9.9-4.4-1.5-7.5-5.3-7.5-9.9V6L12 3z"/><path d="M8.8 12.2l2.2 2.2 4.3-4.6"/>';

// Marks of GitLab, GitHub and Docker from simple-icons 13.21.0 (CC0-1.0).
const MARKS = {
  gitlab: 'm23.6004 9.5927-.0337-.0862L20.3.9814a.851.851 0 0 0-.3362-.405.8748.8748 0 0 0-.9997.0539.8748.8748 0 0 0-.29.4399l-2.2055 6.748H7.5375l-2.2057-6.748a.8573.8573 0 0 0-.29-.4412.8748.8748 0 0 0-.9997-.0537.8585.8585 0 0 0-.3362.4049L.4332 9.5015l-.0325.0862a6.0657 6.0657 0 0 0 2.0119 7.0105l.0113.0087.03.0213 4.976 3.7264 2.462 1.8633 1.4995 1.1321a1.0085 1.0085 0 0 0 1.2197 0l1.4995-1.1321 2.4619-1.8633 5.006-3.7489.0125-.01a6.0682 6.0682 0 0 0 2.0094-7.003z',
  github: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
  docker: 'M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.184-.186h-2.12a.186.186 0 00-.186.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.082.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288Z',
};

const LINKS = [
  { mark: 'gitlab', label: 'Source code', href: 'https://gitlab.com/epicsoft-networks/altcha' },
  { mark: 'github', label: 'Mirror on GitHub', href: 'https://github.com/epicsoft-llc/altcha' },
  { mark: 'docker', label: 'Image on Docker Hub', href: 'https://hub.docker.com/r/epicsoft/altcha' },
];

const STYLE = `
:root {
  color-scheme: light;
  --page: #f4f4f1;
  --surface: #fcfcfb;
  --ink: #0b0b0b;
  --ink-2: #52514e;
  --border: rgba(11, 11, 11, 0.1);
  --accent: #256abf;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  line-height: 1.55;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --page: #0d0d0d;
    --surface: #1a1a19;
    --ink: #ffffff;
    --ink-2: #c3c2b7;
    --border: rgba(255, 255, 255, 0.1);
    --accent: #3987e5;
  }
}
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; background: var(--page); color: var(--ink); }
main { width: 100%; max-width: 34rem; padding: 32px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; }
header { display: flex; align-items: center; gap: 12px; }
h1 { margin: 0; font-size: 1.5rem; line-height: 1.2; }
p { margin: 16px 0 0; color: var(--ink-2); }
p.lead { color: var(--ink); font-size: 1.125rem; }
a { color: var(--accent); }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
svg { flex: none; width: 24px; height: 24px; fill: currentColor; }
svg.shield { width: 32px; height: 32px; fill: none; stroke: var(--accent); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
ul { display: grid; gap: 8px; margin: 24px 0 0; padding: 0; list-style: none; }
li a { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 8px; color: var(--ink); text-decoration: none; }
li a:hover { border-color: var(--accent); }
li span { display: grid; }
li small { color: var(--ink-2); overflow-wrap: anywhere; }
footer { margin-top: 24px; color: var(--ink-2); font-size: 0.875rem; }
footer p { margin: 0 0 6px; color: inherit; }
footer .operator { display: flex; align-items: center; gap: 8px; }
footer img { height: 24px; width: auto; }
footer nav { display: flex; flex-wrap: wrap; gap: 4px 16px; }
`;

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

const escapeHtml = (value) => value.replace(/[&<>"']/g, (c) => ESCAPES[c]);

const sha256 = (data, encoding) => crypto.createHash('sha256').update(data).digest(encoding);

// Name, link, logo and legal pages of the operator (PAGE_*); without them the footer only names the license.
function footer({ operator, operatorUrl, logo, imprintUrl, privacyUrl }) {
  const lines = [];
  if (operator !== '') {
    const name = operatorUrl === '' ? escapeHtml(operator) : `<a href="${escapeHtml(operatorUrl)}">${escapeHtml(operator)}</a>`;
    lines.push(`<p class="operator">${logo === '' ? '' : `<img src="${logo}" alt="">`}<span>Operated by ${name}</span></p>`);
  }
  lines.push('<p>Open source under the MIT license.</p>');
  const legal = [[imprintUrl, 'Legal notice'], [privacyUrl, 'Privacy policy']].filter(([href]) => href !== '');
  if (legal.length > 0) {
    lines.push(`<nav aria-label="Legal">${legal.map(([href, label]) => `<a href="${escapeHtml(href)}">${label}</a>`).join('')}</nav>`);
  }
  return `<footer>${lines.join('\n')}</footer>`;
}

export function createInfoPage(settings) {
  const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#256abf" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${SHIELD}</svg>`;
  const links = LINKS.map(({ mark, label, href }) =>
    `<li><a href="${href}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${MARKS[mark]}"/></svg>`
    + `<span><strong>${label}</strong><small>${href.replace('https://', '')}</small></span></a></li>`);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="description" content="Self-hosted ALTCHA challenge, verification and form mail service with an admin web UI.">
<title>ALTCHA service</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(favicon)}">
<style>${STYLE}</style>
</head>
<body>
<main>
<header><svg class="shield" viewBox="0 0 24 24" aria-hidden="true">${SHIELD}</svg><h1>ALTCHA service</h1></header>
<p class="lead">Self-hosted ALTCHA challenge, verification and form mail service with an admin web UI.</p>
<p>This server issues and checks the proof-of-work challenges of the <a href="https://altcha.org">ALTCHA</a> widget for the websites that use it and delivers their forms and newsletter sign-ups. It has no other pages.</p>
<ul>
${links.join('\n')}
</ul>
${footer(settings)}
</main>
</body>
</html>
`;
  const body = Buffer.from(html);
  return { body, etag: `"page-${sha256(body, 'hex').slice(0, 16)}"`, styleHash: `'sha256-${sha256(STYLE, 'base64')}'` };
}
