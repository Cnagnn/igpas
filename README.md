# I.G.P.A.S

**iGP Analytics & Study System — a read-only study advisor for [iGP Manager](https://igpmanager.com).**

[![CI](https://github.com/Cnagnn/igpas/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Cnagnn/igpas/actions/workflows/ci.yml)
[![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg)](LICENSE)

I.G.P.A.S reads the numbers already displayed on iGP Manager study pages and writes concise
recommendations onto the game's original elements: text, native tooltips (`title`), and temporary
colour. One userscript file. No build step. No new elements on the game page — no panels, badges, or
extra buttons.

Every annotation is reversible: the original text and style are restored on re-render and page
change. Updates are handled through a `MutationObserver`, without polling, and the advisor never
reads data it wrote itself.

**Status:** <b>v0.14.0</b> · GPL-3.0-or-later · no network · no persistent storage

[What it does](#what-it-does) · [Install](#install) · [Safety](#safety-model) · [FAQ](#faq) ·
[Development](#development)

> [!WARNING]
> **Study tool, not a racing tool.** I.G.P.A.S does not automate races or bypass game rules.
> Interpreting iGP Manager's Terms of Service is your responsibility. If in doubt, do not use it
> during a live race.

## What it does

Each recommendation follows the same cycle: **read** the displayed values, **compute** a documented
heuristic, **annotate** the original element, then **restore** the original text and style when the
page updates.

| Page                    | What you see                                                                   |
| ----------------------- | ------------------------------------------------------------------------------ |
| Cars — Overview         | Attribute order `#1..#n`, design priority (DP), and value/max/gap in `title`   |
| Cars — Research/Upgrade | Ranked rows with `#n` prefixes; existing inputs and game order stay intact     |
| Cars — Repair           | Red = act now, amber = prepare, no fill = defer; cost/stock in `title`         |
| Manufacturers           | Engine and chassis rows sorted by rank; rating/cost in `title`                 |
| Supply                  | Only the recommended switch is green; bonus/value per 1M in `title`            |
| Drivers & Staff         | `fit` ETA on the driver name; recovery rate and wage in `title`                |
| Transfers               | Live order preserved; top row gets ` · best`; rank/overall/deadline in `title` |
| Sponsor                 | `Sign ★` for the best offer; `Sign (bonus)` for the cash-bonus trade-off       |

### Reading the recommendations

- **Colour is a priority signal, not a guarantee.** Red means act now, amber means prepare, and no
  fill means defer or no advice.
- **Estimates are estimates.** The advisor appends the exact disclaimer
  ` — estimate, not the game formula.` to its estimates. The heuristics are documented, but they are
  not the game's internal formula.
- **Unreadable data stays blank.** The advisor never replaces a missing value with `0` or a guess.
- **Only Sponsor uses `★`.** Tables that already contain game star icons never get a second marker.

<details>
<summary>Advisor rules in detail</summary>

- **Cars.** Design priority uses the gap to the league maximum. Repair uses the 50/60% thresholds;
  cost, stock, and restock stay in `title`.
- **Manufacturers.** Rows are sorted by advisor rank; the original server order is restored when you
  leave the page.
- **Supply.** Ranking combines the active supplier and candidates by total bonus per cost. A switch
  is recommended only at a ≥5% value-per-1M gain, which prevents supplier switch loops.
- **Transfers.** The live game order is kept. Only the top row receives ` · best`.
- **Sponsor.** Secondary (cash) offers compare guaranteed income per race; primary (token) offers
  compare tokens per race. The amber `Sign (bonus)` marks the best cash-bonus trade-off, with the
  break-even objective chance in `title`. Tokens and cash are never summed. Bonuses are paid per race
  only when the objective is met; contract totals appear only when the term is readable.
- **Never touched.** The advisor is active only on study pages and the Sponsor dialog. Race, Setup,
  and Strategy are neither read nor written.

Full UI contract: [docs/UI-GUIDELINES.md](docs/UI-GUIDELINES.md).

</details>

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/). Other userscript managers, such as
   Violentmonkey, are untested.
2. Open [src/igpas.user.js](https://raw.githubusercontent.com/Cnagnn/igpas/main/src/igpas.user.js)
   and accept the userscript install prompt.
3. Open iGP Manager. Study pages and the Sponsor dialog show recommendations; other pages remain
   unchanged.

**Updates:** reinstall from the same link or from the
[Releases page](https://github.com/Cnagnn/igpas/releases). A reload of the iGP Manager tab is usually
enough.

<details>
<summary>Manual installation</summary>

In Tampermonkey, choose **Create new script**, paste the contents of `src/igpas.user.js`, save, and
reload the iGP Manager tab. No build step or additional server is required.

</details>

## Safety model

I.G.P.A.S is **read-only with respect to the game**: it annotates existing elements but never changes
game state.

- **No network or remote code.** No `fetch`, XHR, `sendBeacon`, WebSocket, dynamic `import()`,
  `@require`, or `@connect`; CI guards also reject `eval`, remote code, and `@match` outside
  `igpmanager.com`.
- **No persistence.** No GM storage, profile, snapshot, or mailbox. Internal `data-igpas-*` markers
  exist only in the open page.
- **No game actions.** No clicks, submits, value changes, or race-state changes. The advisor only
  writes text, `title`, and temporary colour on existing elements.
- **No new page elements.** No panels, badges, or extra buttons are added to the game.
- **Clipboard only on request.** The `I.G.P.A.S — Copy DOM capture (redacted)` and
  `I.G.P.A.S — Copy surface census (structure only)` menu items copy data only when you select them.
  Nothing is sent automatically.

See [docs/PRIVACY.md](docs/PRIVACY.md) for the privacy model and
[docs/SURFACE.md](docs/SURFACE.md) for the surface census.

## Limitations

- Other userscript managers are untested.
- The tool depends on the game's current page structure; a game update can temporarily break a
  recommendation.
- Interpretation of iGP Manager's Terms of Service and account risk remain with you.
- There is no guaranteed release schedule or coverage of every game page.

## Development

```bash
npm install
npm run verify
```

`npm run verify` runs syntax, lint, formatting, version sync, guards, and the full test suite. CI
runs the same gate on Node.js 22 and 24; the local `.nvmrc` uses 24. The minimum supported Node.js
version is 22.22.2.

Tagged releases run the same gate and publish the userscript as a release asset. Pre-commit uses the
native Git hook in `scripts/githooks`, installed automatically by `npm install`. See
[CONTRIBUTING.md](CONTRIBUTING.md) for repository structure and the fixture workflow. Security
reports: [SECURITY.md](SECURITY.md).

## FAQ

### Is this a bot or a cheat?

No. There are no clicks, submits, or automation. Race, Setup, and Strategy are not touched.

### Can my account get banned?

There is no guarantee. The userscript writes to the game's page structure, so interpreting iGP
Manager's Terms of Service is your responsibility. If in doubt, do not use it during a live race.

### Is my data sent anywhere?

No. There are no network requests and no persistent storage; both are enforced by CI guards.

### Why don't recommendations appear?

Check that a study page or the Sponsor dialog is open and the userscript is active. If the data
cannot be read, I.G.P.A.S deliberately writes nothing rather than showing a `0`.

## License

I.G.P.A.S is free software licensed under the **GNU General Public License, version 3 or later**
(`GPL-3.0-or-later`).

You may use, study, modify, and redistribute it under the terms of the GPL. If you distribute
modified versions, you must make the modified source code available under the same license.

The complete license text is available in [LICENSE](LICENSE). The software is provided without
warranty, to the extent permitted by law.

Copyright (C) 2026 I.G.P.A.S contributors.
