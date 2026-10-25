# I.G.P.A.S — iGP Manager study advisor userscript (read-only)

[![CI](https://github.com/Cnagnn/igpas/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Cnagnn/igpas/actions/workflows/ci.yml)
[![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg)](LICENSE)

**Read-only decision advisor for [iGP Manager](https://igpmanager.com) — right on the page you
already have open.** I.G.P.A.S reads the numbers already displayed on study pages (design
priority, part condition, supplier, sponsor offers, transfer targets) and writes its
recommendations onto the game's original elements: text, `title` attributes, and temporary button
colours. One userscript file, no build step, and **not a single new element** on the page — no
panels, badges, or extra buttons.

**"Read-only" means no actions on the game.** No clicks or submits on your behalf, no network
requests, and no game values changed. The **Race, Setup, and Strategy pages are never read or
written**. Every advisor write is kept as original text and restored automatically on every
re-render and on page changes; unreadable numbers are left blank — never replaced with guesses.

> ⚠️ **Study tool — not a racing tool.** No automation. The risk of interpreting iGP Manager's
> ToS rests entirely with the user — details in
> [docs/PRIVACY.md](docs/PRIVACY.md).

`Status: <b>v0.12.1</b> · GPL-3.0-or-later · no network · no persistent storage`

[How it works](#how-it-works) · [Features](#features) · [Installation](#installation-tampermonkey) ·
[Limitations](#limitations) · [FAQ](#faq)

## How it works

Every recommendation follows the same cycle: an adapter **reads** the study page DOM (game numbers
are not changed), pure heuristics **compute** the available options with openly documented
thresholds, the result is **written** onto the original node as text/`title` or button colour, then
**restored** exactly on re-render and page change. Rendering reacts through `MutationObserver`
without polling, always after the original text is restored — reads never use data the advisor
itself has written.

## Features

| Page                    | Advisor output                                                         | Form             |
| ----------------------- | ---------------------------------------------------------------------- | ---------------- |
| Cars — Overview         | Attribute order `#1..#n` + DP; val/max/gap in `title`                  | text + `title`   |
| Cars — Research/Upgrade | Same `#1..#n` order + `#n` label prefix (rows moved, inputs intact)    | text + order     |
| Cars — Repair           | `Fix`/`Replace` button colours: replace / get ready / postpone         | colour + `title` |
| Manufacturers           | Engine & chassis ranking (`★` best); rating/cost in `title`            | text + `title`   |
| Supply                  | Supplier buttons coloured by the switch recommendation                 | colour + `title` |
| Drivers & Staff         | `Full Recover` countdown on the driver name; staff contract in `title` | text + `title`   |
| Transfers               | Market row ranking (driver/staff); links & flags stay live             | text + `title`   |
| Sponsor                 | `Sign` button coloured by the value model (see below)                  | text + colour    |

### Sponsor: Primary vs Secondary

- **Secondary (cash)** — green + `Sign ★` = highest **guaranteed** income/race; amber button =
  highest cash bonus/race, together with the break-even objective chance.
- **Primary (token)** — green + `Sign ★` = highest token/race; amber button = highest cash bonus
  as a trade-off. Tokens and cash are different units and are **never summed**.
- Bonuses are paid **per race** only when the objective is met; the contract total is shown only
  if the contract term can be read — no invented numbers.

### Cars: design & repair

Design point priority uses the gap to the league max; the 50/60% repair thresholds decide
replace, get ready, or postpone — cost, stock, and restock stay in `title`.

### Supply: switch-aware

Ranking combines the active supplier and candidates (Σ bonus per cost); the red alternative button
appears only when ≥5% more efficient — preventing supplier switch loops.

### Race, Setup, Strategy: never touched

The advisor is active only on study pages and the Sponsor dialog. The Race, Setup, and Strategy
pre-race tabs are neither read nor written — at all.

Every write is labelled **"estimate — not the game formula"**: transparent heuristics over the
displayed numbers, not a performance certainty.

## Installation (Tampermonkey)

1. Install [Tampermonkey](https://www.tampermonkey.net/) (other runners, e.g. Violentmonkey, are
   untested).
2. Open [src/igpas.user.js](https://raw.githubusercontent.com/Cnagnn/igpas/main/src/igpas.user.js)
   and accept the userscript install prompt.
3. Open `igpmanager.com` — study pages and the Sponsor dialog immediately show recommendations;
   other pages stay silent.
4. Updates: reinstall from the link above or from the
   [Releases page](https://github.com/Cnagnn/igpas/releases) (every release is tagged
   `v*.*.*`), then a reload of the iGP tab is usually enough.

<details>
<summary>Manual installation alternative</summary>

Tampermonkey dashboard → **Create new script** → paste the contents of `src/igpas.user.js`, save,
then reload the iGP tab. No build step or additional server.
</details>

## Limitations

- **No network** — no `fetch`, XHR, `sendBeacon`, WebSocket, dynamic `import()`, `@require`, or
  `@connect`; enforced mechanically by `scripts/check-guards.mjs`.
- **No persistent storage** — no GM storage, profile, snapshot, or mailbox. The clipboard is filled
  only when you choose the capture menu; internal `data-igpas-*` markers live only in the DOM while
  the page is open.
- **No game actions** — no clicks/submits on game elements; the advisor never changes values,
  state, or race order.
- **ToS risk borne by the user** — the tool writes to the DOM, so the ToS interpretation remains
  yours ([docs/PRIVACY.md](docs/PRIVACY.md)). If in doubt, do not install the userscript during a
  live race.

## Quality & maintenance

`npm run verify` runs syntax, lint, format, version sync, guards, and **110 tests** (72 core + 8
capture + 30 advisor) on Node 22 and 24. Guards reject network, `eval`, remote code, and `@match`
outside `igpmanager.com`. Every tagged release triggers a workflow that validates tag =
`package.json`, runs the full gate, and uploads the userscript asset.

There is no promise of a release schedule. If page data cannot be read, the advisor is designed to
fail honestly — hiding itself rather than writing invented numbers.

The **"I.G.P.A.S: copy capture of this page's DOM"** menu copies the active page DOM to the
clipboard with PII automatically redacted — no automatic sending
([docs/PRIVACY.md](docs/PRIVACY.md)).

## Development

```bash
npm install
npm run verify   # syntax + lint + format + versions + guards + test
```

Pre-commit uses a native Git hook (`scripts/githooks`, installed automatically by `npm install` via
the `prepare` script). Contribution guidelines, repo structure, and the fixture workflow are in
[CONTRIBUTING.md](CONTRIBUTING.md); requires **Node ≥ 22.22.2** (`.nvmrc` uses 24).

## FAQ

### Is this a bot or a cheat?

No. There are no clicks, submits, or automation; Race/Setup/Strategy are not touched.

### Can my account get banned?

There is no guarantee. The userscript writes to the game DOM, so interpreting iGP Manager's ToS is
entirely the user's risk — do not install it during a live race if in doubt.

### Is my data sent anywhere?

No. There are no network requests and no persistent storage; both are enforced by guards run in
CI, not just a promise in the docs.

### Why don't recommendations appear?

Make sure a study page or the Sponsor dialog is open and the userscript is active. If data cannot
be read, I.G.P.A.S deliberately writes nothing — rather than showing a `0`.

### Is there a setup or race strategy calculator?

No. The pre-race Setup and Strategy advisors were removed in v0.10.0; the focus remains on study
pages and the Sponsor dialog.

## License

GPL-3.0-or-later (SPDX) — see [LICENSE](LICENSE).
Related documents: [PRIVACY](docs/PRIVACY.md) · [ARCHITECTURE](docs/ARCHITECTURE.md) ·
[SECURITY](SECURITY.md) · [CONTRIBUTING](CONTRIBUTING.md) ·
[Issues](https://github.com/Cnagnn/igpas/issues) ·
[Releases](https://github.com/Cnagnn/igpas/releases).
