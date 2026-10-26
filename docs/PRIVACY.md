# PRIVACY & RISK — I.G.P.A.S

Applies to v0.13.0. Concise and factual: what the userscript does not do,
what is redacted during capture, and what risks remain.

## 1. No network

The userscript **does not** call `fetch`, XHR, `sendBeacon`, WebSocket,
EventSource, dynamic `import()`, or `@require`/`@connect`. Enforced automatically
by `scripts/check-guards.mjs` in `npm run verify` and CI.

There is no I.G.P.A.S server. No telemetry. No accounts.

## 2. No data storage

Since v0.9.0 the userscript **does not use GM storage** (`GM_getValue`,
`GM_setValue`, `GM_deleteValue`, `GM_listValues` have been removed, including
their grants). There is no snapshot, profile, mailbox, or heartbeat.

- The advisor only writes **temporary text/`title`/button colour** on the
  page's original elements and **restores** them automatically; no persisted
  copy exists.
- The clipboard is filled only when you yourself choose the **"copy capture of
  this page's DOM"** menu. There is no automatic copying/sending.

## 3. Capture DOM (`copy capture`)

This feature copies the page DOM to the clipboard for fixture mapping. The
result is **designed to be pasted into public issues/PRs**, so redaction is
conservative:

Removed/redacted:
- `<meta>`, `<link>`, `<base>`, `<template>`, `<iframe>`, `<object>`, `<embed>`,
  executable `<script>`, HTML comments, and `srcdoc`/`on*` attributes;
- known PII values from the page (manager name, balance, tokens, rank) in
  **all** text and attributes — including `aria-label`, `alt`, `placeholder`,
  `title`, `src` and lazy-load `data-src`/`data-original`, `style`;
- form field contents that are not game numbers: text/search/select/textarea and
  every credential field, plus `<option>` values that carry a player id or name
  (game vocabulary such as tyre compounds and setup levels is kept);
- sensitive field contents (input/textarea), emails, and long token strings
  (32+ hex / 40+ alphanumeric) in text, attributes, URLs, and JSON;
- sensitive JSON keys (`csrf`, `token`, `session`, `auth`, `password`,
  `secret`, `apiKey`, `email`, `manager`, `username`), and `id`/`name`/`*Id`
  values nested under an identity context (`profile`, `user`, `manager`,
  `owner`, `account`, `member`, `player`, or the identity bootstrap script);
- identity URL parameters (`manager`, `uid`, `userid`, `account`, `profile`,
  `email`, `username`, token/csrf/session/auth/key, PHP/JS session ids such as
  `PHPSESSID`, `sess`, `sid`, `sessid`); all `id=` in the context
  of `p=manager`/`page=manager` (account/player profile);
- avatar/account paths `/img/user/<id>/…`, `/av/<id>…` and `/pic/<id>…`;
- tracker attributes `data-sharkid`, `visitor`, `tracker`, `analytics`,
  `fingerprint`, `device`;
- top-level `id` on identity bootstrap scripts (`userBootstrap` etc.).

**Intentionally residual risk** (check yourself before pasting in public):
- third-party manager names / team names displayed as game data
  (cannot be distinguished from other game data without breaking fixtures);
- game IDs genuinely needed by fixtures (e.g. supplier/brand `id`,
  `data-driver`, car id) — not account identities;
- long IDs that are not tokens (e.g. asset hashes) — may become `[REDACTED]`
  and make part of a fixture less informative.

For fixtures, use captures from **study** pages (not profile pages)
and remove unique IDs before pasting.

## 3b. Surface census (`copy surface census`)

A separate menu entry copies a **structural** map of the active page: page id,
region list, form ids/types/callbacks, field shapes (`number:acceleration`,
`checkbox:c[]×8`, `hidden×2`), `data-*` attribute names with counts, table and
dialog counts.

Never included: element text, input values, `csrfName`/`csrfToken` values,
profile identity, balance, tokens, rank, URLs with identity parameters, or any
`data-igpas-*` marker written by the advisor. Storage keys are listed by name
only, and names matching `token`/`session`/`auth` are skipped. The same PII
scrub as the DOM capture runs over the final text as a second line of defence.

## 4. No web GUI / mailbox

The Web Command Center, GitHub Pages, and cross-tab mailbox were removed in
v0.9.0. The userscript runs only on `igpmanager.com` and does not communicate
with other tabs. The old implementation remains in git history (tag `v0.8.6`)
but is no longer maintained or distributed.

## 5. ToS risk

I.G.P.A.S is a read-only study tool: it does not click, submit, or
automate races. The advisor rewrites text/`title`/button colours on original game
elements (ToS § V.J on scripts). The risk of interpreting iGP Manager's Terms of
Service rests entirely with the user. If in doubt, do not install the userscript
during a live race.

## 6. Reporting a privacy issue

Open an issue at <https://github.com/Cnagnn/igpas/issues> with the `security` label
and include reproduction steps **without** real personal data (use fake names/IDs).
