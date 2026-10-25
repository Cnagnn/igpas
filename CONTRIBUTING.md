# Contributing — I.G.P.A.S

> A **read-only study tool**, not a racing tool. Do not submit changes that
> add automation, clicks/submits, networking, or that write to the live
> `#race` tab. This repo contains only a userscript — no web GUI/deploy.

## Quick start

```bash
npm install
npm run verify   # syntax + lint + format:check + versions:check + guards:check + test
```

Requires Node ≥ 22.22.2 (see `.nvmrc`).

## Quality gate (must be green before a PR)

| Gate         | Command                  | Notes                                                                |
| ------------ | ------------------------ | -------------------------------------------------------------------- |
| Syntax       | `npm run syntax`         | `node --check src/igpas.user.js`                                     |
| Lint         | `npm run lint`           | `eslint .` (fix: `npm run lint:fix`)                                 |
| Format       | `npm run format:check`   | `prettier --check .` (fix: `npm run format`)                         |
| Version sync | `npm run versions:check` | source: `package.json` → `@version` + `const VERSION` + README badge |
| Guards       | `npm run guards:check`   | `@match` only igpmanager.com + 0 network/eval/remote code            |
| Tests        | `npm test`               | 110 tests (72 core + 8 capture + 30 advisor)                         |

CI (`.github/workflows/ci.yml`) runs `npm run verify` on Node 22 **and** 24. Guards reject
`fetch`/XHR/`sendBeacon`/WebSocket/EventSource/dynamic import/`eval`/`unsafeWindow`,
`@require`/`@connect`, and `@match` outside the allowlist.

## Repository structure

```
src/igpas.user.js          main userscript — NO build step
test/                      Node + jsdom (no framework)
  fixtures/*.html          sanitised DOM captures (PII/scripts stripped)
  core.test.js             IGPCore/Utils unit tests
  capture.test.js          PageCapture redaction
  advisor.test.js          in-place advisor vs real fixture DOM
docs/
  ARCHITECTURE.md          components, data flow, DOM discipline
  PRIVACY.md               data, redaction, ToS risk
scripts/check-versions.mjs version sync
scripts/check-guards.mjs   allowlist + anti network/remote code
```

**Why no build?** Userscripts install via copy-paste / raw GitHub — a build step adds drift &
supply-chain risk. One file = easiest audit.

## Adding support for a new page

1. Capture the DOM via the userscript menu `I.G.P.A.S: copy capture of this page's DOM`
   (automatic PII redaction) — save it as `test/fixtures/<page>.html`.
2. Add a read-only parser `Igp<X>Adapter.captures(document)` with a `#pageId`/dialog gate; do not
   store or send data.
3. Add in-place writes in `Advisor` (text + `title` on the original node), complete with
   `restore*()` that stores `data-igpas-orig` / `data-igpas-written` and does not overwrite text
   already replaced by the game.
4. Add tests in `test/advisor.test.js` (jsdom) — including restore checks, idempotence, and
   zero-UI on other pages / `#race`.
5. Never: `click`/`submit`/`fetch`/`GM_xmlhttpRequest`/`unsafeWindow`, `GM_setValue` (storage has
   been removed), or write to `#race`.

## Conventions

- Commit: `type(scope): desc` — `feat`, `fix`, `docs`, `chore`, `test`, `ci`.
- Version: bump `package.json` → sync `@version` + `const VERSION` + README badge (checked by
  `scripts/check-versions.mjs`).
- Format: `prettier` (LF, 100 cols), lint: `eslint` flat config, editor: `.editorconfig`.
- License: `GPL-3.0-or-later` — do not commit iGP assets/logos.

## PR checklist

See `.github/pull_request_template.md`. PRs must pass `npm run verify`; there is no longer a Pages
deploy.
