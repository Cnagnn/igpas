# I.G.P.A.S — UI/UX review & guidelines

Status: **proposal** for v0.14.x. This document reviews the current in-page UI and
defines the copy/hierarchy/colour rules future advisor features must follow.

Scope: the in-page Advisor (Cars, Manufacturers, Supply, Drivers & Staff, Transfers,
Sponsor) and the userscript menu/notification copy. The game owns the page; the
advisor owns only text, `title`, temporary colour, and (future) one scoped style node.

Evidence: the real userscript was run against `test/fixtures/*.html` in jsdom. Copy
lengths, visible strings and colours below are measured from that run. The fixtures
contain no game CSS, so contrast is calculated from the declared hex values; layout
width and hover/focus behaviour still need a real-page check.

---

## 1. What the advisor actually owns

| Channel | Owner | Consequence |
| --- | --- | --- |
| Font family, size, weight, line-height | iGP | Do not fight it. "Typography" here means the micro-typography of injected strings. |
| Table/card spacing, row height | iGP | Density is controlled by how much text/colour we add, not by CSS (until F6). |
| Visible label text | Shared | We add a prefix/suffix; the game text must stay intact. |
| `title` tooltip | Advisor | Plain text only; no newlines, no styling, OS-rendered. |
| Button background/text | Advisor (temporary) | Must remain readable in every state and must restore exactly. |
| Menu labels/notifications | Advisor | Part of the product voice, currently inconsistent. |

**Design consequence:** the advisor cannot create a type ramp or a spacing grid on
the page today. Consistency must come from a **copy grammar**, a **small semantic
colour palette**, and **one marker per surface** — not from fonts or layout hacks.

---

## 2. Principles

1. **One job per channel.**
   - Prefix `#n` = order/priority.
   - Suffix = state or value (`26 DP`, `best`, `fit 14h 49m`).
   - Colour = recommended action.
   - `title` = evidence and caveats.
2. **The primary decision must be visible without hover.** A tooltip is a second
   layer, never the only place where "switch / fix / sign this" exists.
3. **One visible marker per item.** Rank, star, "recommended", and colour must not
   all say the same thing. A non-colour cue (star/word) is allowed only as a
   deliberate duplicate of the colour for accessibility, never as a second claim.
4. **Rank only when the list is actually ranked on screen.** `#1` buried at row 8
   is worse than no rank.
5. **Same word, same meaning; same meaning, same word.**
6. **Fail honestly and say why.** "not read" is a feature, not an error to hide.
7. **Game first.** Preserve the game's words, numbers, icons, and layout unless the
   advisor's own signal needs the space.

---

## 3. Current inventory (as-is)

Measured strings from the fixtures (one representative each):

| Surface | Visible output | Title length | Order changed? | Primary marker |
| --- | --- | ---: | --- | --- |
| Cars Overview | `#1 Fuel economy · 26 DP` | 113–118 | **Yes** (`#1..#n`) | rank + DP |
| Cars Research/Upgrade | `#1 Acceleration` | — | **Yes** | rank |
| Cars Repair | `Fix 6`, `Replace 1` (text untouched) | 118–145 | No | colour only |
| Manufacturers | `#20 Akina SpeedStars` … `#1 CAVEIRA` | 58–108 | **No** | rank, plus conditional `★` |
| Supply | `350k` … `400k` | 99–121 (header 242) | No | colour only |
| Drivers & Staff | `SyarifHartono \| Full Recover 14h 49m` | 125 | No | text suffix |
| Transfers | `#1 B Maurício ★ recommended` | 69–92 | **No** | rank + star + word |
| Sponsor | `Sign ★` / `Sign` | 246–296 | No | colour + star |

Findings that follow directly from the table:

- **Rank without order.** Manufacturers shows `#20, #4, #10, #1…` in server order;
  Transfers shows `#1, #2, #4, #3`. The `#n` promise ("top to bottom") is false on
  two of the three ranked surfaces.
- **Redundant markers.** Transfers uses `#1` + `★` + `recommended` for one row;
  Sponsor uses green + `★` + "best value #1" in the title. The eye has three
  competing signals for the same fact.
- **Colour is the only visible signal** on Repair, Supply, and the Sponsor
  alternative. The tooltip explains it, but only on hover (and not on touch).
- **Tooltip density is high and repeated.** Sponsor averages 251 characters per
  offer; the Supply header is 242. The same model caveats are repeated on every
  row/button.
- **Symbol soup.** `#`, `★`, `·`, `—`, `→`, `Σ`, `±`, `≤`, `≥`, `≈`, `|`, `;`
  all appear in user-visible copy. Several of them are mathematical shorthand, not
  product language.
- **Doc drift.** The README says every write is labelled
  `"estimate — not the game formula"`; the actual copy is
  `"estimate, not the game formula."` and the Staff tooltip adds
  `"— the decision is still yours."`. The menu label differs across README,
  CONTRIBUTING, PRIVACY, SURFACE, and the code.

### Measured contrast (declared colours, white/dark text)

| Where | Background | Text | Ratio | WCAG AA normal text |
| --- | --- | --- | ---: | --- |
| Repair "now" / Supply "now" | `#c0392b` | `#ffffff` | 5.44 | pass |
| Repair "soon" / Supply "soon" | `#d68910` | `#1b2631` | 5.44 | pass |
| Repair/Supply "hold" | `#5d6d7e` | `#ffffff` | 5.31 | pass |
| Sponsor best | `#1e8449` | `#ffffff` | 4.72 | pass (little headroom) |
| **Sponsor alternative** | **`#b9770e`** | **`#ffffff`** | **3.68** | **fail** |

The Sponsor amber is the only outright accessibility failure, but the two different
ambers (`#d68910` vs `#b9770e`) and four different "status" colours make the palette
feel accidental rather than semantic.

---

## 4. Findings, prioritised

### P0 — misleading hierarchy

**F1. `#n` is shown on lists that are not sorted.**
Evidence: Manufacturers fixture order `#20, #4, #10, #1…`; Transfers `#1, #2, #4,
#3`. Cars sorts; the other two do not.
Why it matters: the user scans top-down. A rank prefix on an unsorted list turns the
main feature (priority) into noise and makes `#1` hard to find.
Recommendation: **rank only when we sort.** Sort Manufacturers (static data, same
move-not-clone + restore pattern as Cars). For Transfers, keep the game's live order
and use a single `best` marker, with `rank #n of m` in the title. If Transfers must
be sorted, do it explicitly and preserve/restore the server order.

**F2. One semantic colour is doing opposite jobs.**
Red means "replace now" (urgent maintenance) on Repair and "switch supplier"
(a recommended market action) on Supply. Amber means "prepare" on Repair, "candidate"
on Supply, and "trade-off alternative" on Sponsor — with two different hex values.
Grey means both "postpone" and "not an option", so a non-option looks disabled.
Why it matters: colour is the primary (sometimes only) visible signal. The user must
hover to decode it, which defeats the purpose of colour.
Recommendation: one language — **green = recommended, amber = consider/trade-off,
red = urgent/act now, no colour = no advice** (see §5.3). Concretely: Supply switch
becomes green (it is the recommended action), Supply non-options keep the game style
instead of grey, Repair "hold" keeps the game style, and only Repair "now" keeps red.

**F3. The primary signal is colour-only on three surfaces, and details are hover-only.**
Why it matters: colour-blind users cannot distinguish red/green/amber; touch users
cannot hover. The information exists in `title`, but the interaction cost is high.
Recommendation: add a redundant, non-colour cue where the architecture allows it —
`Sign ★` already does this for Sponsor. For tables, use rank or a short word
(`best`, `top`) rather than another star. For Repair/Supply, add an `aria-label` now
(attribute-only, restorable) and let roadmap F7 add the visible glyph/pattern. Do not
pretend colour alone is enough.

**F4. Tooltips are too dense and repeat model boilerplate.**
Evidence: Sponsor 246–296 chars × 16 offers; Supply header 242 chars; every Supply
card repeats "switch recommended", every Sponsor card repeats "tokens are not
converted to cash" and "token preferred; cash bonus is a trade-off".
Why it matters: a native tooltip cannot be scanned; identical caveats on every row
train the user to ignore the tooltip.
Recommendation: a hard budget (see §5.5): identity, verdict, at most 3 facts, one
disclaimer. Put rules/model explanations once (best/alternative offer or header),
not on every item.

**F5. The estimate disclaimer is not one string.**
Evidence: docs/comments use `estimate — not the game formula`; visible copy uses
`estimate, not the game formula.`; Staff uses a longer variant. The sponsor appends
it as a mid-sentence clause.
Why it matters: this is the trust marker; variation reads as sloppiness and makes
tests/docs drift.
Recommendation: one constant, appended exactly once, at the end, with a leading
` — `: `— estimate, not the game formula.` Update docs to quote the exact string.

### P1 — clarity and polish

**F6. The star is overloaded and collides with the game's own stars.**
Manufacturers: `★` means best value only when the item is **not** rank 1 (`i !== 0`),
and chassis gets no star at all. Transfers: `★ recommended` means rank 1. Sponsor:
`Sign ★` means best offer. The game already draws gold star SVGs for ratings
(Manufacturers rating column, Staff, Transfers, HQ). A text `★` in the name column
can be read as another rating.
Recommendation: **do not add `★` to game tables that already use stars.** Use rank
when sorted; use ` · best`/`· top` when unsorted. Keep `Sign ★` in the Sponsor
dialog, where there is no competing star and the button is advisor-owned. If the
star stays, define it as "advisor top pick", exactly one per table/dialog, and never
suppress it conditionally.

**F7. Separators and casing are inconsistent.**
`·` vs `—` vs `:` vs `;` vs `|`; `LOW STOCK` vs sentence case; `Full Recover` vs
`fix now`; `value/1M` vs `rating/1M` vs `/race`. The Staff visible label adds a pipe
(`Name | Full Recover…`) that appears nowhere else.
Recommendation: the copy grammar in §5.1: `·` between facts, exactly one `—` before
the verdict, sentence case for advisor copy, no pipes/semicolons/colons.

**F8. Number and unit formatting is ad hoc.**
`500 K` vs the game's `500k`; `1 M`; `rating/1M 82.22`; `recovery 6.615/hr` (missing
`%`); `ends in 632756h 19m`; `30 race(s)`; `2 token/race` (plural bug).
Recommendation: shared formatters (§5.1). Match the game's compact money style
(`350k`, `1.2m`), cap durations (days/hours, `>30d`), round ratios to 1 decimal,
normalise `race(s)` → `races`, and fix `token`/`tokens`.

**F9. `±` and `Σ` say the wrong thing.**
`Proposal ±26 DP of 200 DP` reads as "26 plus or minus something" (a tolerance), but
it is a point allocation. `Σ bonus` is mathematical shorthand; `→` and `≤` in a
tooltip are read aloud as symbols by screen readers.
Recommendation: `Proposal ≈26 of 200 DP`, `total bonus`, `to`, and spell out
thresholds as `≤50%` only where space is tight. The disclaimer already carries the
uncertainty; `±` adds a false precision.

**F10. Sponsor grammar and repetition.**
`2 token/race` should be `2 tokens/race`. Every offer repeats the token/cash model.
`Sponsor best value #1 of 16` vs `Sponsor #2 of 16` are two different title shapes.
Recommendation: one identity shape (`Sponsor #n of m`), one verdict clause, and the
model caveat only on the best + alternative buttons.

**F11. Menu and notification voice is developer-facing and inconsistent.**
Menu labels: `I.G.P.A.S: copy this page's DOM capture (fixture mapping)` and
`I.G.P.A.S: copy surface census (read-only map)`; notifications use
`I.G.P.A.S v0.14.0 — capture`. Docs quote two other variants.
Recommendation: `I.G.P.A.S — Copy DOM capture (redacted)` /
`I.G.P.A.S — Copy surface census (structure only)`, same brand separator in
notifications, no "this page's", no "fixture mapping" in the label (keep it in the
docs/notification if needed).

**F12. Staff visible suffix competes with the name.**
`Name | Full Recover 14h 49m` adds 25+ characters to a two-line name and uses a pipe.
Recommendation: `Hartono · fit 14h 49m` (short), with the full health/recovery
numbers in the title. Do not repeat "Full Recover" in both layers.

### P2 — later polish

- Hover/focus affordance: inline `!important` background/text overrides can suppress
  the game's hover state. Verify on the real page; never remove the outline.
- Native `title` has no line breaks and OS-dependent wrapping; long copy degrades
  differently per platform. The ordering of clauses is the only layout control.
- Pluralisation/i18n: strings are concatenated inline today; roadmap F8 (Indonesian
  copy pack) will need a string catalogue with placeholders, not more concatenation.
- The `★` glyph may render as text or emoji depending on platform/font; test on
  Windows/Android before relying on it.

---

## 5. Proposed system

### 5.1 Copy grammar

**Visible label template**

```
[#n ]<game text>[ · <value>][ <state>]
```

- `#n ` only when the advisor also sorts that list.
- Keep game text byte-for-byte: names, capitalisation, punctuation.
- Maximum **12 characters added** to any visible label (rank prefix + one suffix).
  The Staff ETA is the only exception; keep it under 20.
- Prefix = order; suffix = state/value. Never both `#1` and `★` on the same item.

**Tooltip template**

```
<Identity>[ — <verdict>][ · <fact 1>][ · <fact 2>][ · <fact 3>][ — estimate, not the game formula.]
```

- Identity: `Priority #1`, `Parts 30%`, `Driver #4`, `Sponsor #2 of 16`, `Supply #1 of 6`.
- Verdict: sentence case, imperative: `fix now`, `prepare to replace`, `defer`,
  `switch recommended`, `keep`, `best token value`, `highest cash bonus`.
- Facts: max 3; fixed order per surface (value → benchmark → cost → caveat).
- Disclaimer: exact constant, exactly once, always last.
- Budget: **140 characters target, 180 hard** (200 soft only for a multi-fact
  dialog). Current Sponsor copy is ~250; cut it. Max 3 facts (4 for a sponsor
  offer).
- No HTML, no newlines, no markdown, no emoji.

**Separators**

| Use | Token | Example |
| --- | --- | --- |
| Prefix rank | `#n ` | `#1 Fuel economy` |
| Between facts | ` · ` | `+4 · 500k/race · 8.0 per 1M` |
| Before the verdict | ` — ` (one per tooltip) | `Parts 30% — fix now` |
| Missing value | `—` or `not read` | `term not read` |
| Range | `–` | `50–60%` |
| Percent | no space | `30%` |
| Money | game style, lowercase, no space | `350k`, `1.2m`, `1.25b` |
| Ratio | 1 decimal + unit | `rating per 1M 160.0` |
| Duration | `d/h/m` with spaces | `2d 3h`, `14h 49m`, `30m` |
| Tokens | pluralised | `1 token/race`, `3 tokens/race` |
| Race count | pluralised | `5 races`, `1 race` |

Banned in user-visible copy: `|`, `;`, `:`, `Σ`, `±`, `→`, `≈`, `!` (except in
game text), `LOW STOCK`-style all caps. `≤`/`≥` are allowed only in compact threshold
rules. The em dash has exactly two allowed roles: the verdict lead and the disclaimer
lead at the end. No other em dash, and never two in the same clause.

**Casing**

- Advisor copy: sentence case (`fix now`, `switch recommended`, `total bonus`).
- Game copy: preserve exactly (`Fix`, `Replace`, `Sign`, `Engine supply`).
- Never title-case an advisor phrase to look like a game label.

**The disclaimer**

```js
const ESTIMATE = " — estimate, not the game formula.";
```

Every tooltip ends with it once. Remove the Staff variant
`"— the decision is still yours."`. Update README/ARCHITECTURE to quote this exact
string (currently they use an em dash variant).

**Empty states**

- Pattern: `<thing> not read`, placed where the value would be, never at the start.
- Examples: `term not read`, `card rating not read`, `condition not read`,
  `button cost not read`.
- If an estimate depends on the missing number, say what was withheld:
  `Estimate unavailable — 1 attribute not read. Order only; 25% of readable gap.`
  (replaces the WIP `DP proposal suppressed … biased …` wording, which is
  statistical jargon).
- Never render `0` for a missing value.

### 5.2 Hierarchy model

| Layer | Content | Where | Rule |
| --- | --- | --- | --- |
| L1 | What to do | visible on the element | One marker per item; no hover needed |
| L2 | Why | `title` | Verdict + max 3 facts |
| L3 | How sure | end of `title` | Exact disclaimer once |

**Per-surface marker (target)**

| Surface | L1 marker | Sort? | Notes |
| --- | --- | --- | --- |
| Cars Overview | `#n` + DP | Yes | Existing; no colour |
| Cars Research/Upgrade | `#n` | Yes | Existing |
| Cars Repair | colour + `aria-label` | No (car order) | Red now, amber prepare, normal hold |
| Manufacturers | `#n` | **Yes (new)** | Remove conditional `★` |
| Supply | green on the switch pick | No | Non-options untouched; rank in title |
| Drivers & Staff | ` · fit <eta>` | No | Health/recovery in title; ETA restated once |
| Transfers | ` · best` on the top row | No (live) | Numeric rank only in title |
| Sponsor | green/amber + `Sign ★` / `Sign (bonus)` | No | Only best + alternative coloured |
| Menu | verb-first labels | — | Brand + em dash + action |

Why ` · best` instead of `★`: the game already uses star icons for ratings in the
same tables. A word is unambiguous, accessible, and does not add a competing icon.
If the user prefers a star, it must be documented as "advisor star ≠ game rating
star" and tested for confusion.

Why sort Manufacturers but not Transfers: Manufacturers is a static page whose
ranking is the whole point; Cars already proves the move-and-restore pattern.
Transfers is a live market where end time matters (F1) and rows refresh; preserving
game order avoids fighting the socket and keeps "ending soon" scannable.

### 5.3 Colour tokens

Use only these three advisor-owned fills, with these exact text colours:

| Token | Background | Text | Contrast | Meaning | Applied to |
| --- | --- | --- | ---: | --- | --- |
| `recommended` | `#196f3d` | `#ffffff` | 6.21 | do this / best | Sponsor best; Supply switch |
| `consider` | `#9c6500` | `#ffffff` | 4.91 | alternative / prepare | Sponsor alt; Repair soon; Supply candidate (only when active is unknown) |
| `urgent` | `#c0392b` | `#ffffff` | 5.44 | act now to avoid loss | Repair now only |
| *(none)* | game default | game default | — | no advice / not an option / hold | everything else |

Rules:

- **Never colour a non-option.** Grey "hold" made buttons look disabled on Supply
  and Repair. Leave the game style alone; the tooltip explains "not an option".
- **Red is reserved for urgency/risk.** Do not use it for "switch supplier"; that is
  a recommendation, so use green.
- **One fill per element.** No gradients; keep `background-image: none` only where
  the game uses an image and the flat fill is required for contrast.
- **Keep focus visible.** Do not override `outline`; verify keyboard focus on the
  coloured button. Inline `!important` may suppress the game's hover background;
  test and, if needed, add a darker border rather than removing the hover entirely.
- **Do not rely on hue alone.** Pair with the visible marker or `aria-label`; the
  star/word is the redundant channel. F7 will extend this to patterns/glyphs.

Migration from current colours: `#c0392b` stays; `#d68910` and `#b9770e` merge into
`#9c6500`; `#1e8449` → `#196f3d`; `#5d6d7e` (hold) is removed.

### 5.4 Iconography

| Symbol | Decision |
| --- | --- |
| `#` | Keep. Means rank/order. Only on sorted lists. |
| `·` | Keep. The only fact separator. |
| `—` | Keep. Exactly one, before the verdict. |
| `★` | Keep **only** on `Sign ★` in the Sponsor dialog. Do not add it to game tables that already use star icons. |
| `→` | Remove; write `to`. |
| `Σ` | Remove; write `total`. |
| `±` | Remove; the disclaimer already signals an estimate. Use `≈` only if a single number needs it, never both. |
| `≈` | Avoid; prefer `about` or no marker. |
| `\|` | Remove. |
| `≤` / `≥` | Keep only in the one-line threshold rule. |
| Emoji | Never. |

If F7 needs a glyph for colour-blind safety, use a **word** (`now`, `soon`, `keep`)
or a simple border pattern, not an exotic symbol. Add `aria-label` to coloured
buttons now: e.g. `aria-label="Fix, 6 parts, fix now"`; restore it like `title`.

### 5.5 Spacing and density

- **Visible suffix budget:** 12 characters (Staff ETA ≤20). The longest current
  addition is the Staff pipe + "Full Recover 14h 49m" (~26); halve it.
- **Tooltip budget:** 140 chars target, 180 hard, max 3–4 facts. The native
  tooltip wraps by OS width; assume 60–70 characters per line, so the first clause
  must carry the verdict.
- **No repeated rules per item.** The Supply 5% rule belongs in the header/tooltip;
  the Sponsor token/cash model belongs on the best/alternative buttons or docs.
- **Fixed clause order** so the eye can jump: identity → verdict → value → benchmark
  → cost → caveat → disclaimer.
- **Test the worst case:** longest league/team name + rank + suffix at 1024 px and
  125% zoom. The added text must not push the rating/cost columns or force a wrap
  that hides the game number.
- **One line per visible addition.** Never add a second line to a table cell.
- **Table density:** do not add rows, badges, or columns. Until F6, spacing is the
  game's; after F6, density comes from padding/line-height, not smaller type.

### 5.6 Typography for the future style node (F6)

F6 is the first advisor-owned CSS. Define it as a **token layer**, not a redesign:

```css
/* scoped to the advisor's style node; never global */
--igpas-font: inherit;          /* never replace the game font */
--igpas-size-meta: 0.75rem;     /* 12px, only advisor-owned meta */
--igpas-size-body: 0.8125rem;   /* 13px minimum for dense rows */
--igpas-size-emphasis: 0.875rem;
--igpas-line: 1.35;
--igpas-weight: 400;
--igpas-weight-strong: 600;
--igpas-space-1: 0.125rem;      /* 2px */
--igpas-space-2: 0.25rem;       /* 4px */
--igpas-space-3: 0.375rem;      /* 6px */
--igpas-space-4: 0.5rem;        /* 8px */
--igpas-space-5: 0.75rem;       /* 12px */
```

Rules: `font: inherit` for game labels; `font-variant-numeric: tabular-nums` only on
advisor-owned numeric UI; no letter-spacing changes; use `rem` so browser zoom works;
never go below 12px; sticky header/compact mode changes padding only, not font size;
respect the game's colour inheritance; no transitions unless reduced-motion is
honoured. F6 must stay opt-in and must not touch `#race`, `#setup`, `#strategy`.

---

## 6. Target spec per surface (before → after)

### Cars Overview

```
Now:   #1 Fuel economy · 26 DP
       Priority #1 — Fuel economy: 43 → league max 300 (gap 257). Proposal ±26 DP of 200 DP — estimate, not the game formula.

After: #1 Fuel economy · 26 DP
       Priority #1 · Fuel economy — gap 257 to league max (43 to 300). Proposal ≈26 of 200 DP — estimate, not the game formula.
```

Keep the visible string. Remove `±`, `→`, and the duplicated "DP" where it reads
heavily. When an attribute is unreadable:

```
After: Priority #1 · Fuel economy — estimate unavailable (1 attribute not read) · order only · 25% of readable gap — estimate, not the game formula.
```

### Cars Repair

Visible text unchanged. Colour: red now, amber prepare, **no fill** for hold.

```
After: Parts 30% — fix now · cost 6 parts · stock 51 · thresholds ≤50% / ≤60% — estimate, not the game formula.
       Engine 62% — defer replace · cost 1 engine · stock 40 · restock in 15 races · thresholds ≤50% / ≤60% — estimate, not the game formula.
```

`cost`/`restock in` disambiguate the numbers; `low stock` is sentence case.

### Manufacturers

Sort rows by rank; remove `★`.

```
After: #1 CAVEIRA
       #1 · CAVEIRA — rating 100% · 500k/race · rating per 1M 200.0 — estimate, not the game formula.
```

Chassis: same shape without cost. If sorting is rejected, drop `#n` and put
` · best` on the top row; never show `#n` in server order.

### Supply

```
After visible: 400k            (green fill only on the switch pick)
      title:   Alternative #1 of 6 — switch recommended · total bonus +4 · 500k/race · 8.0 value per 1M · active #4 — estimate, not the game formula.
      header:  Active #4 of 6 — switch advised · best #1 with +88% value per 1M (15.0 vs 8.0) · switch only at ≥5% gain — estimate, not the game formula.
```

Non-options keep the game style. The 5% rule appears once in the header, not on every
card. If the active supplier cannot be read, use amber on the best alternative and
say `active not read — compare manually`.

### Drivers & Staff

```
Now:   SyarifHartono | Full Recover 14h 49m
After: Hartono · fit 14h 49m

Now:   Driver: Health 2% · recovery 6.615/hr · Full Recover ±14h 49m · estimate, not the game formula — the decision is still yours.
After: Health 2% · recovery 6.6%/hr · fit in 14h 49m — estimate, not the game formula.

Staff card: Wage 50k/race · 30 races · card rating not read.
```

The visible ETA is the feature; the title restates it once as the standalone summary,
without `±` and without the "Full Recover" phrase. Normalise `race(s)` to `races`.

### Transfers

Keep game order. Top row gets ` · best`; every row's title carries the numeric rank.

```
Now:   #1 B Maurício ★ recommended
After: B Maurício · best

Title: Rank #1 of 12 · overall 39.5 · fee 988k · ended — estimate, not the game formula.
Title: Rank #4 of 12 · overall 16.0 · fee 400k · ended — estimate, not the game formula.
```

Deadline formatting: `closing, 30m`, `ends in 2d 3h`, `ended`. Cap at `>30d` instead
of printing hundreds of hours.

### Sponsor

Best green + `Sign ★`; alternative amber + `Sign (bonus)`; all other buttons untouched.

```
After best:  Sponsor #1 of 16 — best token value · 3 tokens/race · bonus 612k/race if objective met · term not read — estimate, not the game formula.
After alt:   Sponsor #14 of 16 — highest cash bonus · 1 token/race · bonus 1.8m/race · better when objective met >84% — estimate, not the game formula.
```

The token/cash "not converted" model appears on the best and alternative tooltips
only, not on all 16. Fix `token`/`tokens` and use one identity shape.

### Menu / notifications

```
I.G.P.A.S — Copy DOM capture (redacted)
I.G.P.A.S — Copy surface census (structure only)

Notification title: I.G.P.A.S — DOM capture
Text: PII-redacted page DOM copied to the clipboard.
```

Update the four docs that currently quote different labels.

---

## 7. Future features (roadmap contracts)

| Feature | Contract before implementation |
| --- | --- |
| F2 Training focus | Use the same `#n` rule: sort rows, no star; `gain per focus` in title; missing gain → no annotation. |
| F3 HQ payback | Title only, no colour; use the shared duration formatter and cap (`>30d`); never recommend a purchase. |
| F4 Auction board | If rows are live-ordered, no `#n`; one `best`/state marker; time left in the shared duration format. |
| F5 CSV | Menu label follows the brand pattern; no visible page change. |
| F6 Style node | Token layer in §5.6; opt-in; no game font/size replacement; no `#race`. |
| F7 Colour-blind palette | Keep the semantic roles; add a word/glyph/pattern; never rely on hue alone; same restore path. |
| F8 Indonesian pack | Move every string to a catalogue with placeholders (`{n}`, `{value}`), plurals, and the single disclaimer; no inline concatenation. |
| F9 DP prefill | Short, explicit notice; sentence case; undo copy; no new element. |

F8 is the strongest argument for building a tiny copy/format module now: string
concatenation scattered across eight mounts will not survive translation or plural
rules.

---

## 8. Migration plan

| Phase | Work | Effort | Risk |
| --- | --- | --- | --- |
| 0 | Approve the four decisions in §9. Freeze the copy grammar. | S | — |
| 1 | Colour tokens + amber contrast + remove grey holds + exact disclaimer + plural/money fixes + menu labels. Update README/tests. | S | Low |
| 2 | Rank discipline: sort Manufacturers; Transfers `· best` + rank in title; remove conditional/chassis star; one marker per surface. | M | Medium (DOM moves/restore) |
| 3 | Tooltip budgets/templates per surface; remove repeated rules; Staff suffix; Supply header; deadline formatting. | M | Low |
| 4 | Accessibility: `aria-label`, F7 palette/non-colour cue, hover/focus check on the real page. | M | Low |
| 5 | F6 token layer + opt-in density mode; visual QA at 1024/1280 px and 125% zoom. | S/M | Medium |

**Tests to touch:** `test/advisor.test.js` asserts exact copy at lines ~98, 184,
512, 776, 857, 952, 1082, 1147, 1275. Add contract tests for: exact disclaimer once,
tooltip length budget, banned symbols, one star max, `#n` only on sorted lists,
palette contrast (pure function), and `aria-label` restore.

**Docs to sync:** README feature table (Manufacturers star, Supply red, disclaimer),
ARCHITECTURE (colour semantics), CONTRIBUTING/PRIVACY/SURFACE (menu labels), this
document.

---

## 9. Decisions requested

1. **Sort Manufacturers and keep Transfers unsorted (recommended)?** If not, drop
   `#n` from both and use a word marker; the current "rank but no order" state
   should not survive.
2. **Adopt the semantic palette (green recommended, amber consider, red urgent,
   no grey holds)?** This changes Supply switch from red to green and removes grey
   from non-options.
3. **Reserve `★` for the Sponsor button and use ` · best`/`#n` elsewhere?** The game
   already uses star icons for ratings.
4. **Match the game's money style (`350k`, `1.2m`) and cap tooltips at ~140 chars?**
   This is the biggest perceived change in the tooltips, but it is what makes them
   scannable.

---

## 10. PR checklist (future UI changes)

- [ ] Primary decision visible without hover; one marker per item.
- [ ] `#n` only on a list the advisor actually sorts.
- [ ] Visible addition ≤12 chars (Staff ETA ≤20).
- [ ] Tooltip ≤140 chars target (180 hard), ≤3–4 facts, verdict first, exact disclaimer last.
- [ ] Palette token only; contrast ≥4.5:1 for normal text; no grey non-options.
- [ ] No `|`, `;`, `Σ`, `±`, `→`, `≈`, emoji, or ALL CAPS in advisor copy.
- [ ] Money/duration/ratio/plural via shared formatters; missing value says `not read`.
- [ ] Game text, numbers, order, and icons preserved; restore path tested.
- [ ] `aria-label`/`title` restored; focus visible; hover state checked.
- [ ] Worst-case width at 1024 px and 125% zoom.
- [ ] Exact strings updated in tests and docs.
