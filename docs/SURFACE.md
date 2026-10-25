# Modifiable surface — iGP Manager (study notes)

What a **userscript** can read and change on iGP Manager, how the client is
built, and where the safe hooks are. This document exists to plan advisor work
and to keep the read-only boundary explicit. It is **not** a guide to
automating the game.

Evidence: public app assets (`/app/merged.js`, `/app/vendors.js`) fetched on
2026-10-25, plus real page DOM captured from a normal session (see
`test/fixtures/` and the built-in surface census).

## 1. Client shape (evidence)

| Fact | Evidence |
| --- | --- |
| App shell is a static page that loads `vendors.js` + `merged.js` | `/app/` HTML |
| `merged.js` 686,360 chars — sha256 `5b49907f…bd42` | `sha256sum` |
| `vendors.js` 478,393 chars — socket.io (5 refs), THREE (1), Chart.js (2), Sortable (30) | counts in `vendors.js` |
| Networking goes through jQuery: `$.ajax` ×24, **no** `fetch` / `XMLHttpRequest` in `merged.js` | grep counts |
| Live data (auctions/bids) uses a socket layer (`socketAuth`, `bidConnected`, `checkBidSocket`) | `merged.js` globals |
| Routing is SPA-ish: `history.pushState` ×1, `#pageId` marks the active page | `merged.js`, page DOM |
| Storage used by the game: `localStorage` ×11 (`igpMusicTab`, `igpDeviceInfo`, …), `sessionStorage` ×4, `indexedDB` ×2 | grep counts |
| Timers: `setTimeout` ×99, `setInterval` ×9, `requestAnimationFrame` ×8 | grep counts |

The important consequence: **pages are server-rendered HTML**. Page markup
(forms, dialogs, tables) arrives from the server and is then enhanced by
`merged.js`, so the DOM is the stable contract for a userscript — not the
bundle internals.

## 2. The write pipeline

```
form.igpForm  ──submit──►  cmsCall( rootUrl + 'index.php?action=send&type=…&addon=igp&ajax=1&jsReply=<name>' )
                                   │
                                   ▼
                          response HTML / JSON
                                   │
                                   ▼
                            igpParse(content)  ──►  translate + rebind handlers
                                   │
                                   ▼
                        #page-content / dialog HTML replaced
```

Counts in `merged.js`: `igpForm` ×17, `jsReply` ×67, `addon=igp` ×21,
`saveAlone` ×7, `csrfToken` ×9.

What this means for an advisor:

- Every meaningful state change is an **AJAX response replacing DOM**. A
  `MutationObserver` on the affected containers is the correct trigger — no
  polling, no network hook needed.
- `data-callback="…"` on a form names the page-level function that runs after
  the reply (for example `carsDesignSaved`). Those functions live in the
  page's own inline script, not in `merged.js`.
- Dialogs are stacked inside `#dialogs-container` (`#modal-wrap`,
  `#dialog-wrap`, `closeDialog` / `closeDialogs` / `refreshDialog`).
- The game's toast system is `igpAlertQueue` + `igpAlert{Overlay,Title,Message}`.

## 3. Tiers of modification

| Tier | What changes | Examples on iGP | Verdict |
| --- | --- | --- | --- |
| A | Presentation of existing nodes: text, `title`/`data-tip`, colour, order, CSS | `#n` design priority, repair colours, supplier colours, sponsor `Sign` | Safe, reversible |
| B | Derived knowledge: maths on numbers already displayed | DP estimate, cost/1M, break-even, recovery ETA | Safe, no side effects |
| C | Local UX: clipboard/CSV export, keyboard shortcuts, menu commands, counters | copy census, copy table | Safe, user-triggered |
| D | Pre-filling a form **without submitting** | filling DP numbers or research checkboxes | Grey: user must click Save |
| E | Submitting, bidding, buying, switching, racing | `action=send` calls, auto-click | **Out of scope** |
| F | Payload tampering, CSRF reuse, timer bypass, hidden data | crafted requests | **Out of scope** |

Only A–C are in the advisor's design. D needs an explicit, documented opt-in.

## 4. Page map

| Page (`#pageId`) | Main containers | Machine-readable hooks in real DOM | Advisor today |
| --- | --- | --- | --- |
| `cars` | `#carAttributes`, `#carAttributesDisplay`, `#designInline`, `#researchInline`, `#repair` | `data-dp`, `data-dmax`, `data-base`, `data-callback`, `.attribute-row` | Overview, Research/Upgrade, Repair |
| `manufacturers` | `#engine-table`, `#chassis-table` | `data-sort`, `data-searchable`, `data-col`, `data-nationality` | Engine/chassis ranking |
| `staff` | `#drivers`, `#driverStatsTable`, `#staff-card-train` | `data-health`, `data-recovery-rate`, `data-preview-gain`, `data-current`, `data-maxed-focuses` | Recovery ETA |
| `transfers` | `#driver-table`, `#staff-table`, `#cdTransfersRefresh` | `data-overall`, `data-enddate`, `data-sort`, `data-entitytype` | Market ranking |
| `home` / `finances` | Sponsors: `#sponsorSignTable`, `#alternatives` | `data-tip` | Sponsor value ranking |
| `race` | `#race`, `#setup`, `#strategy`, forms `d1setup`… | `data-tyre`, `data-stint`, `data-refuelling` | **Never touched** |
| Develop / HQ / Auctions | not captured yet | `hqUpdateBuilding`, `data-preview-gain`, socket | Not mapped |

## 5. Hook inventory

- **Page identity**: `#pageId` value, `#page-title-text`, `#page-content`.
- **Dynamic regions**: `WATCH_SEL` in the userscript lists every container the
  advisor re-renders on.
- **Row-level hooks**: `.attribute-row` (Cars/Repair), `tbody tr` with stable
  `id` (`3_13673757`) plus `data-*` payloads.
- **Dialogs**: `#dialogId`, `#dialogs-container` children, `.dialog` layers.
- **Timers already in the page**: `data-enddate` (transfers), countdown nodes
  with `data-cdseconds`/`data-callback`.
- **Advisor markers never to collide with**: `data-igpas-*`.

## 6. Red lines

Not implemented, not planned, and not documented as recipes:

- Submitting or clicking game forms (`igpFormSubmit`, `cmsCall`, `action=send`).
- Reading or reusing `csrfName`/`csrfToken` for any request.
- Bypassing timers, restock, training, or contract terms.
- Reading account identity (manager id, email, tokens) beyond what the page
  already shows the user.
- Touching `#race`, `#setup`, `#strategy` (live race data).
- Interacting with IAP/offer surfaces (`data-offer-*`, `data-iap-*`).

## 7. Surface census tool

Menu: **"I.G.P.A.S: copy surface census (read-only map)"**. It copies a
structural text map of the active page — no text, values, credentials, or
identity. Sample (Cars fixture):

```text
I.G.P.A.S surface census — v0.13.0
host: www.igpmanager.com  url: /app/p=cars
page: cars

regions present (4):
  #carAttributes children=8
  #carAttributesDisplay children=8
  #designInline children=10
  #researchInline children=10

forms (2):
  #designInline type=design cb=carsDesignSaved rows=8 fields: number:acceleration, …, hidden×2
  #researchInline type=research cb=carsResearchSaved rows=8 fields: checkbox:c[]×8, hidden×2

attribute rows: #carAttributesDisplay=8 #designInline=8 #researchInline=8

tables (0):
  (none)

dialogs: container absent dialogId=absent

data-* attributes (6): data-base×8, data-tip×8, data-callback×2, data-orig-html×2, data-dmax×1, data-dp×1

counts: buttons=2 links=3 inputs=22 tables=0 rows=24

not captured by design: text, values, CSRF, profile identity.
```

Use it on a page you want mapped, then pair it with the DOM capture when a
fixture is needed (census = shape, capture = markup with PII redacted).

## 8. Maintenance

The bundle version changes without notice. When a hook stops working:

1. Re-fetch `/app/merged.js` and `/app/vendors.js`, compare `sha256`.
2. Re-run the counts in section 1/2 (`$.ajax`, `igpForm`, `jsReply`,
   `addon=igp`, socket refs).
3. Run the census on the affected page and diff the form/`data-*` lists.
4. Update this document and the fixture together — never "fix" a selector
   without a fixture that proves it.
