# I.G.P.A.S — Architecture (userscript-only)

A **read-only** study advisor for iGP Manager in a single userscript file, no
build step, no web GUI, no network, and no storage.

Current version 0.14.0.

## 1. Scope

- ✅ In-page recommendations on iGP **study** pages (Cars, Manufacturers,
  Supply, Drivers & Staff, Transfers) and the **Sponsor** dialog (Sign). The
  **pre-race Setup/Strategy** tabs no longer get an advisor (removed in v0.10.0).
- ✅ DOM capture menu with PII redaction for fixture mapping.
- ✅ Surface census menu: structural map of the active page (ids, form/field
  shapes, `data-*` names, row/table/dialog counts, regions) so advisor work can
  be planned per page. No text, values, credentials, or identity — see
  [SURFACE.md](SURFACE.md).
- ✅ Supply **switch-aware**: efficiency = Σ bonus per 1M cost. Ranking combines the active supplier + alternatives (ties go to the active one); the alternative button is coloured red when the recommendation is to switch (≥5% more efficient), amber for active/candidate, grey for not an option. Cost text & titles are unchanged; verdict + details in `title` — preventing supplier switch loops.
- ✅ Cars **Overview**: attribute rows sorted `#1..#n` from top to bottom and the original label written as `#n Attribute · X DP`; val/max/gap + DP estimate in `title`; no colour; game numbers & bars untouched.
- ✅ Cars **Research / Upgrade**: both tab forms (`#designInline`, `#researchInline`) receive the same `#1..#n` order as the Overview, and each tab label gets the same `#n ` prefix (game text kept, no DP suffix). Rows are moved, never cloned, so every game input keeps its name/value/id and the hidden form fields stay last; original order and text are restored on navigate-away.
- ✅ Cars **Repair**: `Fix`/`Replace` button coloured from the displayed condition + recommendation — red ≤50% (replace), amber 50–60% (get ready), grey >60% (postpone). Card titles are unchanged; cost/stock/restock/thresholds in `title`; no button clicks.
- ❌ No Command Center / web GUI / GitHub Pages.
- ❌ No cross-tab mailbox, GM storage, profile, or snapshot.
- ✅ Sponsor **Primary & Secondary**: green `Sign` + `Sign ★` for the safe choice — Secondary highest income/race (guaranteed), Primary highest token/race. The amber button marks the trade-off alternative: highest cash bonus/race (Secondary + break-even objective chance; Primary cash bonus vs token). Explicit model: bonuses are paid **per race** when the objective is met (not once per contract); tokens & cash are different units and are never summed/converted. Contract total (`income × term`, potential `(income+bonus) × term`) only if the term is readable from the Primary sponsor card — no invented numbers.
- ❌ No scraping/automation during live races; `#race`, `#setup`, and `#strategy` are never touched (neither read nor written).
- ❌ No clicks/submits/fetch/XHR.

## 2. Components

| Component | Role |
| --- | --- |
| `Utils` | Pure helpers: number/money parsing, `numOrNull`, `statIndex`, `roleCode`, formatting |
| `IGPCore` | Pure & tested heuristic engine: `designPriority`, `repairAdvice`, `rankSuppliers`, `compareSuppliers`, `rankManufacturerItems`, `rankSponsors`, `numberVerdict`. Every exported function has a production call site — dead code is removed rather than kept tested. |
| `IgpCarsAdapter` | Read-only parser for the Cars page → `{ attrs, best, designPoints, suppliers, … }`; Overview tab sorted/labelled by `Advisor.mountDesign`, Repair tab by `Advisor.mountRepair` (condition, button cost, stock) — both in-place |
| `IgpSupplyAdapter` | Read-only parser for the Supply dialog → `{ type, current, alternatives }` |
| `IgpManufacturersAdapter` | Read-only parser for the engine + chassis table |
| `IgpStaffAdapter` | Read-only parser for Drivers & Staff (driver, staff, pit crew) |
| `IgpTransfersAdapter` | Read-only parser for the Transfers market (driver + staff) |
| `IgpSponsorAdapter` | Read-only parser for the Sponsor dialog (Primary/Secondary) → `{ termRaces, incomeKind, offers }` |
| `Advisor` | Writes recommendations to original element text/`title` + automatic restore |
| `PageCapture` | Userscript menus: copy a PII-redacted DOM capture, and copy the structural surface census (ids/forms/`data-*` only — never text or values) |
| `boot()` | `igpmanager.com` host gate, installs Advisor + capture menu |

Adapters are **pure parsers over `document`** (no storage, no sending). The
Advisor calls them directly when rendering.

## 3. Data flow

```
iGP page DOM (read-only)
        │
        ├─ Igp*Adapter.captures(document)  → structured data
        │
        ├─ IGPCore.* (pure heuristics)     → ranking / estimate / verdict
        │
        └─ Advisor: write text + title on the ORIGINAL node
                      │
                      └─ automatic restore (data-igpas-orig / data-igpas-written)

Capture menu → PageCapture.buildCapture(document) → redaction → clipboard
```

There is no network, storage, or cross-tab sync step.

## 4. DOM discipline

1. **`#pageId` gate** — each adapter activates only on the matching page
   (`cars`, `manufacturers`, `staff`, `transfers`; Supply via the
   `.supplyDialog` dialog; Sponsor via the `#sponsorSignTable` dialog, usually
   on the Finances page).
2. **Live `#race`, `#setup`, and `#strategy` are never touched** — there is
   no pre-race/live-race advisor.
3. **In-place** — no new elements; only text nodes, `title` attributes, and
   temporary styles on game-owned elements (Supply/Repair button colours).
4. **Restore-first** — before every read, advisor writes are reverted so
   adapters always read pure game data. Every write stores `data-igpas-orig` +
   `data-igpas-written` (or the `data-igpas-orig-style` +
   `data-igpas-written-style` pair); restore does not overwrite text/styles
   already replaced by the game.
5. **Fail honestly** — unreadable data → no invented writes/numbers, not `0`.
6. **Instant render** — MutationObserver reacts when the game commits the DOM;
   no polling of the game page.

## 5. Boot & guards

- `@match` only `https://igpmanager.com/*` and
  `https://*.igpmanager.com/*`.
- `boot()` checks `location.hostname` before installing anything.
- `@grant` only `GM_registerMenuCommand`, `GM_setClipboard`,
  `GM_notification`.
- `scripts/check-guards.mjs` rejects `@match` outside the allowlist, `@require`/
  `@connect`/`@updateURL`, as well as `fetch`/XHR/`sendBeacon`/socket/`import()`/
  `eval`/`unsafeWindow`/`document.write`.

## 6. Testing

- `test/core.test.js` — 33 pure tests for `IGPCore`/`Utils`.
- `test/capture.test.js` — 14 `PageCapture` redaction tests (jsdom).
- `test/advisor.test.js` — 39 advisor tests against real DOM fixtures (jsdom):
  in-place, restore, idempotent, `#race` zero-UI, capture menu.
- `test/guards.test.js` — 6 guard tests: @include/@grant allowlist, no network, no dead core.
- `test/fixtures/*.html` — sanitised DOM captures (PII/scripts stripped).

Total **92 tests**; run by `npm test` and `npm run verify` (CI Node 22/24).

## 7. Brief history

- Initial architecture inspired by [A.C.A.S](https://psyyke.github.io/A.C.A.S/)
  (reverse-engineering study, single userscript file, adapter per page-type,
  stale-data guards, read-only). A.C.A.S code was not copied.
- v0.2–v0.8.x used the web Command Center (dual-tab + GM storage mailbox +
  snapshot). **v0.9.0 removed that entire path** — web GUI, GitHub Pages,
  mailbox, adapter registry, and GM storage — and kept the in-page Advisor +
  capture. The old implementation remains available in git history
  (tag `v0.8.6`).
- v0.10.0 removed the pre-race **Setup** and **Strategy** advisors along with
  their adapters/helpers; the advisor focus returned to study pages.
- v0.11.0 added the **Sponsor Primary & Secondary** advisor: offer ranking in
  the Sign dialog (income/token per race, bonus per race, guaranteed
  income, break-even) without changing game numbers.
- v0.12.0 translated the repository to English (userscript UI, comments, docs,
  tests, scripts) and polished the userscript comments. No behaviour change
  beyond the visible copy; `Tyre` spelling now matches the game.
- v0.12.1 added the **Cars Research / Upgrade** advisor: both tab forms follow
  the same `#1..#n` priority as the Overview and each label gets the `#n `
  prefix, with the row nodes moved (every input keeps its name/value/id) and the
  original order/text restored on navigate-away. The Engine Supply dialog header
  tint was removed so the card renders exactly as the game draws it.
- v0.13.0 added the read-only **surface census** menu (regions, form
  shapes/callbacks, `data-*` vocabulary, table/dialog counts — never text,
  values, credentials, or identity), plus [SURFACE.md](SURFACE.md) documenting
  the client surface and [ROADMAP.md](ROADMAP.md) listing the unbuilt backlog
  with acceptance criteria.
- v0.14.0 adds the transfer auction deadline (roadmap F1): the row tooltip shows
  "ends in 2h 15m", "closing, 30m" or "ended", read from the `data-enddate` the
  game already prints. `IGPCore.deadlineInfo()` takes the clock as a parameter, so
  CORE stays pure and the tests stay deterministic.
- v0.13.1 is a correctness and privacy release, no new advisor features:
  the DOM-capture redaction closed four identity leaks (free-text/select
  fields, `aria-label`/`alt`/`title`, lazy-load `data-src`, `PHPSESSID`-style
  params and nested JSON ids) without destroying game vocabulary; ~370 lines
  of unreachable `IGPCore` code left by v0.10.0 were removed (72 → 30 core
  tests, all reachable); the guards now reject `@include`/`@exclude`, network
  grants and unreachable core methods, and are themselves tested.
- Manual input/standalone calculator is no longer provided as a UI.

## 8. Ethics & limitations

The userscript rewrites **text on the game's original elements** (no new
elements). The ToS interpretation risk rests entirely with the user; data and
redaction details are in [PRIVACY.md](PRIVACY.md). The live Race tab is never
written and there is no click/submit automation.
