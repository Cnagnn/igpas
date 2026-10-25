# Advisor roadmap — unbuilt, evidence-based

Backlog for features that are **not** implemented yet but are feasible under the
project's rules. Every item below is read-only, in-place, restorable, and uses
only numbers already visible on the page. Nothing here submits, bids, buys, or
touches the Race/Setup/Strategy tabs.

Source of record for what the client exposes: [SURFACE.md](SURFACE.md).

## Rules every feature must satisfy

- No network, no GM storage, no polling; render on `MutationObserver`.
- No new page elements; write on original nodes (text, `title`, colour, order).
- Store the original value and restore on re-render and page change.
- If a number cannot be read, write nothing (no invented values).
- Race pages are never read or written.

## Ranked backlog

| # | Feature | Page | Data already in the DOM | Output | Risk | Effort |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | Transfer closes-in + deadline order | `transfers` | `data-enddate` on every row, `#cdTransfersRefresh` | time-left in `title`, "closing" flag | low | S |
| F2 | Training focus value | `staff` | `#staff-card-train`, `data-preview-gain`, `data-current`, `data-maxed-focuses` | `#n` order + gain-per-focus in `title` | low | M |
| F3 | Facility / building payback | HQ (needs capture) | building cost + income delta | payback estimate in `title` | low | M |
| F4 | Auction board (read-only) | Auctions (needs capture) | row/bid markup, `data-enddate`-style fields | countdown + "no bid" marker | medium | L |
| F5 | Copy table as CSV | any table page | `table` + `data-*` | clipboard via menu | low | S |
| F6 | Sticky header + compact density | any table page | CSS only | `GM_addStyle`/style node | low | S |
| F7 | Colour-blind safe palette | Advisor-owned colours | existing colour writes | palette swap | low | S |
| F8 | Indonesian copy pack (opt-in) | advisor text only | advisor strings | translated text | low | L |
| F9 | Cars DP prefill (opt-in, no submit) | `cars` | `#designInline`, `#researchInline` inputs | filled inputs, user saves | medium | M |

## Details and acceptance criteria

### F1 — Transfer deadline awareness

**Why:** ranking by overall/fee answers "who is best", not "can I still get
them". `data-enddate` is present on every transfer row and currently unused.

**AC**
- A row with a readable `data-enddate` gets `· ends in Hh Mm` appended to its
  existing `title` (no new element, no text rewrite of the row body).
- Rows ending within 60 minutes get a `closing` marker in the same `title`.
- A row whose end date is in the past shows `ended` and is never hidden.
- Unreadable/missing date → no suffix (never a guess).
- Refresh recomputes on `#cdTransfersRefresh` changes; leaving the page restores
  the original `title` exactly.

**Verification:** new fixture with three rows (future / <60 min / past) and one
row without `data-enddate`; assertions in `test/advisor.test.js`; the restore
test reuses the page-change pattern.

### F2 — Training focus value

**Why:** the training card exposes `data-preview-gain`, `data-current`, and
`data-maxed-focuses`; the user still has to guess which focus is worth the
cost.

**AC**
- Focus rows are ordered by gain per unit of cost (or by gain when cost is not
  on the page) with the existing `#n` convention.
- `title` carries `now → after (+gain)` and, when the focus is maxed, a
  `maxed` note instead of a gain.
- Rows without a readable gain keep their original text and order.
- Nothing is selected, clicked, or submitted.

**Verification:** extend `test/fixtures/staff.html` with a training card; unit
tests for the ratio maths in `test/core.test.js`; restore test on page change.

### F3 — Facility / building payback

**Why:** HQ buildings have a cost and an income effect on the same page; the
payback time is simple division but the game never shows it.

**AC**
- Only fires when both cost and income delta are readable for that building.
- `title` gets `payback ≈ Nh` (or `> 30d` when it exceeds a stated cap) and the
  exact inputs used.
- No building is coloured; no recommendation to buy.
- Missing one of the two numbers → no annotation.

**Verification:** requires a sanitized HQ fixture first (census + DOM capture);
then a fixture-driven test plus a pure `payback` function in `test/core.test.js`.

### F4 — Auction board (read-only)

**Why:** live auctions update through the game's socket layer and the row markup
already carries the bid state; a read-only board helps without automating.

**AC**
- Read-only overlay of the same data inside existing rows (`title`/order only).
- Shows time left and whether the user already holds a bid.
- Never places, raises, or cancels a bid; never opens a socket of its own.
- Falls back to "unknown" when a field is missing.

**Verification:** needs a captured auction page plus a stable fixture; if the
markup is unstable, this item stays parked.

### F5 — Copy table as CSV

**Why:** users copy market/standings data into spreadsheets; the clipboard is
already an approved channel.

**AC**
- Menu command: `I.G.P.A.S: copy this table as CSV` copies the focused/hovered
  table (or the first data table) with a header row.
- No numeric reformatting: raw text cells are copied as-is.
- No network, no storage; nothing is added to the page.

**Verification:** pure `toCsv(rows, header)` in `test/core.test.js`; advisor
test invoking the menu with a stubbed clipboard.

### F6 — Sticky header + compact density

**AC**
- One style scope (`PREFIX + '-style'` already exists) with
  `thead th { position: sticky; top: 0 }` and a compact row height.
- Toggled per session by a menu entry; no storage.
- No layout change outside the tables; race pages untouched.

**Verification:** advisor test asserting the style node exists after the menu
runs and that no `#race` node is affected.

### F7 — Colour-blind safe palette

**AC**
- Advisor-owned colours switch to a palette that never relies on hue alone
  (adds a glyph or border pattern alongside colour).
- Game colours (bars, ratings) are untouched.
- Reversible: restore path returns the original `style` exactly.

**Verification:** existing colour tests parametrised over both palettes.

### F8 — Indonesian copy pack (opt-in)

**AC**
- A menu toggle translates only advisor-written strings, never game text.
- Switching back restores every original string.
- Missing keys fall back to English (no blank labels).

**Verification:** a table-driven test over the string map; restore test.

### F9 — Cars DP prefill (opt-in, no submit)

**Why:** the advisor already knows the DP priority; filling the inputs saves
manual typing.

**AC**
- Off by default; only runs from an explicit menu command.
- Fills existing `input[type=number]` in `#designInline` (or ticks research
  checkboxes) and never dispatches `submit`, `click`, or `change` on the form.
- User-visible notice that nothing was saved; `Esc`-free undo via a second menu
  command that restores the captured values.
- Never exceeds `max` or goes below `min`/`data-base`.

**Verification:** fixture test asserting values changed, form not submitted
(no `submit` event recorded), and undo restores the exact prior values.

## Not planned

- Auto-submit, auto-click, auto-bid, auto-race, or any loop that plays the game.
- Calling `cmsCall`/`index.php?action=send` directly, or reusing CSRF tokens.
- Timer/restock/training bypasses.
- Hidden data or other managers' unpublished values.
- IAP/offer surfaces (`data-offer-*`, `data-iap-*`) and payment flows.
- Writing on `#race`, `#setup`, `#strategy`.

## Prerequisites (captures needed)

1. HQ / facilities page (census + DOM capture) → unblocks F3.
2. Auction / bid dialog (census + DOM capture) → unblocks F4.
3. Training card with a readable cost (extend `staff.html`) → unblocks F2.

Suggested order: **F1 → F5 → F2 → F3 → F4**, with F6/F7 as low-effort
fillers, and F9 last because it is the only item that touches form state.
