# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
the versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

| Part | Raised when |
|---|---|
| **MAJOR** | an existing setup stops working — a removed or renamed variable, a changed endpoint or answer |
| **MINOR** | something is added without requiring a change to an existing setup. Before `1.0.0` any release may break; the entry says so |
| **PATCH** | a fix or a dependency update without a change in behaviour |

**A release is a git tag `X.Y.Z`** that matches `version` in `package.json`. CI builds `X.Y.Z`, `X.Y`, `X`
from it, moves `latest` and creates the GitHub release from the entry below.

## [0.0.1] - 2026-10-08

First release.

### Added
- `GET /challenge`: ALTCHA challenges in the v3 format (PBKDF2 or SHA), deterministic mode, signed with HMAC, bound
  to the site of the requesting origin
- `POST /verify` for browsers and for backends, `POST /submit` to mail a verified form to the site's recipient
- Each solution is spent once; spent challenges are kept in the database until they expire
- `GET /widget.js` and `GET /widget.i18n.js` serve the ALTCHA widget 3.3.0, in English or with all its languages
- Sign-in on the admin port, in any combination: user name from a signing-in reverse proxy (only from
  `ADMIN_TRUSTED_PROXIES`, optionally limited to `ADMIN_ALLOWED_USERS`), Basic auth, API token for scripts. After
  10 failed attempts an address is locked out for 15 minutes
- Rate limits count IPv6 clients per /64; verifications from a backend have their own limit (`RATE_VERIFY_PER_IP`)
- Database files are created with mode `0600`; the container runs with a read-only root file system
- Admin web UI on a separate port:
  - statistics for 24 hours to 90 days, for all sites or one: totals against the period before, activity chart with
    table view, refused requests by reason
  - sites with any number of origins: search, filter, sort, switch on and off in the list, edit, delete, test mail,
    embed code with a choice of widget language and the matching Content Security Policy
  - light and dark theme, phone layout, refreshes itself every 30 seconds
- Statistics kept as hourly totals per site (`STATS_RETENTION_DAYS`, default 90)
- Prometheus metrics: requests and latency per endpoint, solve time and challenge age, mail delivery, database size,
  process and event loop
- Rate limits per client address and per site, honeypot field, optional redirect pages for plain HTML forms
- SMTP with STARTTLS, implicit TLS or plain, `AUTH PLAIN` and `AUTH LOGIN`
- SQLite database in `/data`, container health check
