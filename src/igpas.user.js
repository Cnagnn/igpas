// ==UserScript==
// @name         I.G.P.A.S — iGP Analytics & Study System
// @namespace    https://github.com/Cnagnn/igpas
// @version      0.13.1
// @description  Read-only in-page study advisor for iGP Manager: #1..#n sorted design-point priorities, colour-coded supply and parts/engine repair buttons, supplier/manufacturer rankings, staff/transfer notes, and sponsor-offer value rankings written only as text/title/style on original page elements. Includes menu commands to copy a PII-redacted DOM capture and a read-only surface census. Study tool only, no automation, no network.
// @license      GPL-3.0-or-later
// @homepageURL  https://github.com/Cnagnn/igpas
// @supportURL   https://github.com/Cnagnn/igpas/issues
// @match        https://igpmanager.com/*
// @match        https://*.igpmanager.com/*
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_notification
// @run-at       document-idle
// ==/UserScript==

// I.G.P.A.S — iGP Analytics & Study System
// A single-file, read-only study advisor for iGP Manager. It reads numbers the
// game already renders, applies explicit heuristics, and writes the result back
// onto the original DOM nodes as text, `title` attributes or temporary colour.
//
// Invariants — never break these:
//   1. Read-only. No clicks, no submits, no synthesized game actions.
//   2. No network. No fetch/XHR, no sockets, no remote code.
//   3. In-place. No new page elements; every write is reversible.
//   4. Honest. Missing data stays missing; nothing is invented.
//
// Layout:
//   1) CORE              pure functions, no DOM   →  test/core.test.js
//   2) ADAPTERS          read-only DOM readers    →  test/advisor.test.js
//   3) IN-PAGE ADVISOR   render and restore
//   4) PAGE CAPTURE      manual DOM snapshot for fixture mapping
//   5) BOOT              browser and Node wiring

(function IGPAS() {
    'use strict';

    const VERSION = '0.13.1';

    // =====================================================================
    // 1) CORE — pure functions, no DOM. Tested in Node (test/core.test.js).
    //    All maths is plain arithmetic over user input; no game formulas.
    // =====================================================================

    // Grammatical unit: "1 race" / "5 races".
    const raceUnit = n => (Math.abs(Number(n)) === 1 ? ' race' : ' races');

    const Utils = Object.freeze({
      numOrNull(v) {
        // Trim first: a DOM field holding only spaces ("   ") is not the number 0.
        const s = (v == null) ? '' : String(v).trim();
        return s !== '' && Number.isFinite(Number(s)) ? Number(s) : null;
      },
      clean(s) {
        return String(s || '').replace(/\s+/g, ' ').trim();
      },
      parseMoney(t) {
        const m = String(t || '').match(/(\d+(?:\.\d+)?)\s*([kmb]?)/i);
        if (!m) return null;
        const suf = m[2].toLowerCase();
        return Math.round(parseFloat(m[1]) * (suf === 'k' ? 1e3 : suf === 'm' ? 1e6 : suf === 'b' ? 1e9 : 1));
      },
      fmtMoney(n) {
        const v = Number(n);
        if (n == null || !Number.isFinite(v)) return '—';
        if (v >= 1e9) return (Math.round(v / 1e8) / 10) + ' B';
        if (v >= 1e6) return (Math.round(v / 1e5) / 10) + ' M';
        if (v >= 1e3) return (Math.round(v / 1e2) / 10) + ' K';
        return String(v);
      },
      // 12-stat index derived from the page's `data-driver` / `data-staff` CSV
      // (v0.8.0). It is the mean of the first 12 CSV numbers and is computed the
      // same way for roster and market, so the two sides are comparable.
      // This is not the game's overall rating: that comes from unpublished internal
      // numbers, while the CSV is rounded per stat. Values therefore differ slightly
      // from the "Overall/Fee" column, and the result is always labelled a heuristic.
      // Fewer than 12 numbers yields null — never an invented value.
      statIndex(csv) {
        const parts = String(csv == null ? '' : csv).split(',');
        const vals = [];
        for (let i = 0; i < 12 && i < parts.length; i++) {
          const v = Utils.numOrNull(parts[i]);
          if (v != null) vals.push(v);
        }
        if (vals.length < 12) return null;
        const mean = vals.reduce((s, v) => s + v, 0) / 12;
        return Math.round(mean * 100) / 100;
      },
      // Normalize a staff role label to its code (CD/TD/DR) so roster and market
      // entries can be compared. Markers for other roles (e.g. 'DRV' for a driver)
      // pass through unchanged; the uppercase form is kept so labels stay tidy.
      roleCode(s) {
        const raw = Utils.clean(s);
        if (!raw) return null;
        const t = raw.toLowerCase();
        if (/chief\s*designer|^cd$/.test(t)) return 'CD';
        if (/technical\s*director|^td$/.test(t)) return 'TD';
        if (/^doctor$|^dr$/.test(t)) return 'DR';
        if (t === 'drv') return 'DRV';
        return t.slice(0, 40);
      },
    });


    const IGPCore = Object.freeze({

        // Design-point allocation priority (v0.7.0).
        // Heuristic: compare each car attribute with the best value in the league
        // (#leagueDesignData) and propose a DP share proportional to the largest gap.
        // This is not the game formula; the user still has to test the result.
        designPriority(p) {
            const attrs = (p && p.attrs && typeof p.attrs === 'object') ? p.attrs : null;
            if (!attrs || !Object.keys(attrs).length) {
                return { ok: false, error: 'Car attributes not found on this page' };
            }
            const best = (p && p.best && typeof p.best === 'object') ? p.best : {};
            const numOrNull = Utils.numOrNull;
            const rows = [];
            let totalGap = 0;
            for (const key of Object.keys(attrs)) {
                const a = attrs[key];
                const val = a ? numOrNull(a.val) : null;
                if (val == null) continue;
                const maxEntry = best[key];
                const max = maxEntry ? numOrNull(maxEntry.max) : null;
                const effMax = (max != null) ? Math.max(max, val) : null;
                const gap = (effMax != null) ? Math.max(0, effMax - val) : null;
                if (gap != null) totalGap += gap;
                rows.push({ key: key, label: a.label || key, val: val, max: effMax, gap: gap });
            }
            if (!rows.length) return { ok: false, error: 'No attributes were read' };
            if (totalGap <= 0) {
                return { ok: false, error: 'No gap to league max (already ≥ max, or league benchmark unavailable)' };
            }
            const ranked = rows.filter(r => r.gap != null)
                .sort((a, b) => (b.gap - a.gap) || String(a.key).localeCompare(String(b.key)));
            for (const r of ranked) {
                r.sharePct = Math.round((r.gap / totalGap) * 1000) / 10;
            }
            return {
                ok: true,
                values: {
                    ranked: ranked,
                    totalGap: totalGap,
                    designPoints: numOrNull(p ? p.designPoints : null),
                    unbenchmarked: rows.filter(r => r.gap == null).length,
                },
            };
        },

        // Parts and engine replacement advice based on car condition (v0.9.4).
        // Reads the condition shown on the page, the Fix/Replace button cost and the
        // warehouse stock. Thresholds are explicit, not the game formula:
        // ≤50% replace now, 50–60% prepare, >60% defer.
        // `enough` stays null unless both cost and stock are readable; unknown is
        // never rounded into "enough" or "short".
        // Inputs: condition, engine, partCost, engineCost,
        //   partsStock, engineStock, restockRaces.
        repairAdvice(p) {
            const numOrNull = Utils.numOrNull;
            const src = p || {};
            const condition = numOrNull(src.condition);
            const engine = numOrNull(src.engine);
            if (condition == null && engine == null) {
                return { ok: false, error: 'Parts/engine condition not read' };
            }
            if (condition != null && (condition < 0 || condition > 100)) {
                return { ok: false, error: 'Parts condition must be 0–100' };
            }
            if (engine != null && (engine < 0 || engine > 100)) {
                return { ok: false, error: 'Engine condition must be 0–100' };
            }
            const partsStock = numOrNull(src.partsStock);
            const engineStock = numOrNull(src.engineStock);
            const partCost = numOrNull(src.partCost);
            const engineCost = numOrNull(src.engineCost);
            const restockRaces = numOrNull(src.restockRaces);
            const judge = (value, cost, stock) => {
                if (value == null) {
                    return { value: null, status: 'unknown', cost: cost, stock: stock, enough: null };
                }
                const status = (value <= 50) ? 'now' : (value <= 60) ? 'soon' : 'hold';
                const enough = (cost == null || stock == null) ? null : (stock >= cost);
                return { value: value, status: status, cost: cost, stock: stock, enough: enough };
            };
            return {
                ok: true,
                values: {
                    parts: judge(condition, partCost, partsStock),
                    engine: judge(engine, engineCost, engineStock),
                    partsStock: partsStock,
                    engineStock: engineStock,
                    restockRaces: restockRaces,
                    thresholds: { now: 50, soon: 60 },
                },
            };
        },

        // Rank suppliers from the Supply dialog (v0.7.0).
        // Transparent heuristic: Σ stat bonus against cost per race, with value per
        // 1M as the efficiency metric. Different stats are not equated by any game
        // formula, so this is a comparison, not a performance guarantee.
        // Inputs: items, each with supplierId, eId, costPerRace and
        //   bonuses.
        rankSuppliers(p) {
            const items = (p && Array.isArray(p.items)) ? p.items : null;
            if (!items || !items.length) return { ok: false, error: 'No suppliers found in the dialog' };
            const rows = items.map(it => {
                const costRaw = it ? it.costPerRace : null;
                const cost = (costRaw != null && Number.isFinite(Number(costRaw))) ? Number(costRaw) : null;
                const value = (it && Array.isArray(it.bonuses))
                    ? it.bonuses.reduce((s, b) => s + (b && b.value != null && Number.isFinite(Number(b.value)) ? Number(b.value) : 0), 0)
                    : (it && it.value != null && Number.isFinite(Number(it.value)) ? Number(it.value) : null);
                return {
                    id: it ? it.supplierId : null,
                    eId: it ? it.eId : null,
                    value: value,
                    cost: cost,
                    valuePerCost: (value != null && cost != null && cost > 0)
                        ? Math.round((value / cost) * 1e6 * 100) / 100
                        : null,
                };
            });
            const ranked = rows.slice().sort((a, b) =>
                (((b.valuePerCost == null) ? -Infinity : b.valuePerCost) - ((a.valuePerCost == null) ? -Infinity : a.valuePerCost)) ||
                (((b.value == null) ? -Infinity : b.value) - ((a.value == null) ? -Infinity : a.value)) ||
                String(a.id).localeCompare(String(b.id)));
            const withCost = rows.filter(r => r.cost != null).sort((x, y) => x.cost - y.cost);
            return {
                ok: true,
                values: {
                    ranked: ranked,
                    bestValueId: (ranked.find(r => r.valuePerCost != null) || ranked[0]).id,
                    cheapestId: withCost.length ? withCost[0].id : null,
                    withoutCost: rows.filter(r => r.cost == null).length,
                },
            };
        },

        // Rank manufacturer rows (engine or chassis) by rating (v0.7.0).
        // Engines carry a cost, so efficiency is rating per 1M; chassis are ranked on
        // rating alone.
        rankManufacturerItems(p) {
            const items = (p && Array.isArray(p.items)) ? p.items : null;
            if (!items || !items.length) return { ok: false, error: 'No manufacturer rows found' };
            const withCost = !!p.withCost;
            const rows = items.map(it => {
                const ratingRaw = it ? it.ratingPct : null;
                const costRaw = it ? it.costPerRace : null;
                const rating = (ratingRaw != null && Number.isFinite(Number(ratingRaw))) ? Number(ratingRaw) : null;
                const cost = (costRaw != null && Number.isFinite(Number(costRaw))) ? Number(costRaw) : null;
                return {
                    id: it ? it.id : null,
                    name: it ? it.name : null,
                    rating: rating,
                    cost: cost,
                    ratingPerCost: (withCost && rating != null && cost != null && cost > 0)
                        ? Math.round((rating / cost) * 1e6 * 100) / 100
                        : null,
                };
            });
            const ranked = rows.filter(r => r.rating != null).sort((a, b) =>
                (b.rating - a.rating) ||
                (((b.ratingPerCost == null) ? -Infinity : b.ratingPerCost) - ((a.ratingPerCost == null) ? -Infinity : a.ratingPerCost)) ||
                String(a.name).localeCompare(String(b.name)));
            if (!ranked.length) return { ok: false, error: 'Manufacturer rating not read' };
            const byEff = withCost ? rows.filter(r => r.ratingPerCost != null)
                .sort((x, y) => y.ratingPerCost - x.ratingPerCost) : [];
            return {
                ok: true,
                values: {
                    ranked: ranked,
                    bestRatingId: ranked[0].id,
                    bestValueId: byEff.length ? byEff[0].id : null,
                    noData: rows.filter(r => r.rating == null).length,
                },
            };
        },

        // Sponsor offer ranking (v0.11.0) — Sign dialog, Primary and Secondary.
        // Model: the bonus is paid per race, and only when that race's objective is
        // met; no bonus is treated as a one-off for the whole contract.
        // - Secondary (cash income): income is guaranteed every league race. Ranking
        //   is by highest income (the guarantee); the highest cash bonus becomes an
        //   amber alternative, together with an objective-probability break-even.
        // - Primary (token income): tokens and cash are different units and are never
        //   summed or converted. Ranking is by highest tokens per race, with the cash
        //   bonus as tie-break; the best cash bonus becomes the alternative.
        // - Contract total is shown only when the term is readable: income × term, and
        //   max potential (income + bonus) × term. An unreadable term yields null.
        //   The term comes from the Primary sponsor card on the page behind the dialog.
        // Inputs: offers, termRaces, incomeKind.
        // Returns { ok, values, error? } — values carry the ranked offers,
        //   the selected eIds and the break-even probability.
        rankSponsors(p) {
            const offers = (p && Array.isArray(p.offers)) ? p.offers : null;
            if (!offers || !offers.length) {
                return { ok: false, error: 'Sponsor offers not found in the dialog' };
            }
            const termRaw = p && p.termRaces;
            const term = (termRaw != null && Number.isFinite(Number(termRaw)) && Number(termRaw) > 0)
                ? Math.floor(Number(termRaw)) : null;
            const incomeKind = (p && p.incomeKind === 'token') ? 'token' : 'cash';
            const tokenMode = incomeKind === 'token';
            const bonusVal = r => (r.bonus == null ? -Infinity : r.bonus);
            const rows = [];
            for (const o of offers) {
                if (!o) continue;
                const bonus = Utils.numOrNull(o.bonus);
                const eId = o.eId != null ? String(o.eId) : null;
                if (tokenMode) {
                    const tokens = Utils.numOrNull(o.tokens);
                    // 0 or unreadable means the offer cannot be scored.
                    if (tokens == null || tokens <= 0) continue;
                    rows.push({
                        eId: eId,
                        tokens: tokens,
                        income: null,
                        bonus: bonus,
                        guaranteePerRace: null,
                        potentialPerRace: null,
                        guaranteeTotal: null,
                        potentialTotal: null, // tokens & cash are never mixed
                    });
                    continue;
                }
                const income = Utils.numOrNull(o.income);
                if (income == null || income <= 0) continue;
                const bonusCash = bonus == null ? 0 : bonus;
                rows.push({
                    eId: eId,
                    tokens: null,
                    income: income,
                    bonus: bonus,
                    guaranteePerRace: income,
                    potentialPerRace: income + bonusCash,
                    guaranteeTotal: term != null ? income * term : null,
                    potentialTotal: term != null ? (income + bonusCash) * term : null,
                });
            }
            if (!rows.length) {
                return {
                    ok: false,
                    error: tokenMode ? 'Sponsor token income not read' : 'Sponsor income not read',
                };
            }
            const byEId = (a, b) => String(a.eId).localeCompare(String(b.eId));
            if (tokenMode) {
                rows.sort((a, b) =>
                    (b.tokens - a.tokens) || (bonusVal(b) - bonusVal(a)) || byEId(a, b));
            } else {
                // Income is the guarantee; potentialPerRace assumes the bonus is achieved.
                rows.sort((a, b) =>
                    (b.income - a.income) ||
                    (b.potentialPerRace - a.potentialPerRace) ||
                    (bonusVal(b) - bonusVal(a)) ||
                    byEId(a, b));
            }
            const ranked = rows.map((r, i) => Object.assign({}, r, { rank: i + 1 }));
            const bestEId = ranked[0].eId;
            let bestBonus = null;
            let bestPotential = null;
            for (const r of ranked) {
                if (!bestBonus || bonusVal(r) > bonusVal(bestBonus)) bestBonus = r;
                if (!tokenMode && (!bestPotential || r.potentialPerRace > bestPotential.potentialPerRace)) {
                    bestPotential = r;
                }
            }
            const alternative = tokenMode
                ? (bestBonus && bestBonus.eId !== bestEId ? bestBonus.eId : null)
                : (bestPotential && bestPotential.eId !== bestEId ? bestPotential.eId : null);
            let breakEvenP = null;
            if (!tokenMode && alternative) {
                const best = ranked[0];
                const alt = ranked.find(r => r.eId === alternative);
                // The alternative (lower income, higher bonus) wins when the objective
                // probability > (income_best − income_alt) / (bonus_alt − bonus_best).
                const dIncome = best.income - alt.income;
                const dBonus = bonusVal(alt) - bonusVal(best);
                if (dIncome > 0 && dBonus > 0) {
                    breakEvenP = Math.round((dIncome / dBonus) * 100) / 100;
                }
            }
            return {
                ok: true,
                values: {
                    ranked: ranked,
                    incomeKind: incomeKind,
                    bestEId: bestEId,
                    bestGuaranteeEId: tokenMode ? null : bestEId,
                    bestBonusEId: bestBonus ? bestBonus.eId : null,
                    bestPotentialEId: !tokenMode && bestPotential ? bestPotential.eId : null,
                    alternativeEId: alternative,
                    breakEvenP: breakEvenP,
                    termRaces: term,
                    unreadable: offers.length - rows.length,
                },
            };
        },

        // ------------------------------------------------------------------
        // DECISION COMPARISON (v0.8.0) — "better / worse / equal" verdicts
        // against outside options (transfer market, alternative suppliers,
        // league max). Rules:
        //  - every verdict sits on an explicit axis (value or cost) with a stated
        //    "≈ equal" tolerance;
        //  - a side without numbers yields 'unknown'; values are never invented
        //    just to produce a verdict;
        //  - callers must label the result "estimate — not the game formula".
        // ------------------------------------------------------------------

        // Compare one number against a reference on a single axis.
        // now / ref — the two values; opts — { lowerIsBetter, tolerance (ratio) }.
        // Returns { verdict, delta, pct }; verdict is 'better', 'worse', 'equal'
        // or 'unknown'.
        numberVerdict(now, ref, opts) {
            const a = Utils.numOrNull(now);
            const b = Utils.numOrNull(ref);
            if (a == null || b == null) return { verdict: 'unknown', delta: null, pct: null };
            const lower = !!(opts && opts.lowerIsBetter);
            const tolRaw = opts ? Number(opts.tolerance) : NaN;
            const tol = (Number.isFinite(tolRaw) && tolRaw >= 0) ? tolRaw : 0.02;
            const delta = Math.round((a - b) * 100) / 100;
            const base = Math.abs(b);
            const pct = base > 0 ? Math.round(((a - b) / base) * 1000) / 10 : null;
            const equal = (base === 0) ? (delta === 0) : (Math.abs(a - b) / base <= tol);
            if (equal) return { verdict: 'equal', delta: delta, pct: pct };
            const better = lower ? (a < b) : (a > b);
            return { verdict: better ? 'better' : 'worse', delta: delta, pct: pct };
        },

        // Transfer deadline status (v0.13.1, roadmap F1).
        // `now` is injected, never read from a global clock: this keeps the function
        // pure and the tests deterministic. Callers pass Date.now() at render time.
        // - state: 'open' | 'closing' (<= 60 min) | 'ended' | 'unknown'
        // - Unreadable or missing date -> 'unknown', and callers write nothing.
        // - remainingMin is rounded down (never overstates the time left).
        deadlineInfo(p) {
            const src = p || {};
            const now = Utils.numOrNull(src.now);
            const closingRaw = Utils.numOrNull(src.closingMin);
            const closingMin = (closingRaw != null && closingRaw >= 0) ? closingRaw : 60;
            const endRaw = src.endDate;
            // Only a full ISO-8601 timestamp is accepted; anything else is "not read"
            // rather than a guess from a partial string.
            const m = String(endRaw == null ? '' : endRaw).trim().match(
                /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/
            );
            if (!m || now == null) return { state: 'unknown', remainingMin: null, endsAt: null };
            const ms = Date.parse(String(endRaw).trim());
            if (!Number.isFinite(ms)) return { state: 'unknown', remainingMin: null, endsAt: null };
            const remainingMs = ms - now;
            const remainingMin = Math.floor(remainingMs / 60000);
            const state = remainingMs <= 0 ? 'ended'
                : (remainingMin <= closingMin ? 'closing' : 'open');
            return { state: state, remainingMin: remainingMin, endsAt: ms };
        },


        compareSuppliers(p) {
            const cur = (p && p.current) ? p.current : null;
            const alts = (p && Array.isArray(p.alternatives)) ? p.alternatives : null;
            if (!cur) return { ok: false, error: 'Active supplier not read from the dialog' };
            if (!alts || !alts.length) return { ok: false, error: 'Alternative suppliers are not shown in this dialog' };
            const bonusSum = x => {
                if (!x || !Array.isArray(x.bonuses) || x.bonuses.length === 0) return null;
                return x.bonuses.reduce((s, b) => s + (b && Number.isFinite(Number(b.value)) ? Number(b.value) : 0), 0);
            };
            const curBonus = bonusSum(cur);
            const curCost = Utils.numOrNull(cur.costPerRace);
            let refBonus = null;
            let refCost = null;
            for (const a of alts) {
                const bv = bonusSum(a);
                if (bv != null && (refBonus == null || bv > refBonus.value)) {
                    refBonus = { value: bv, id: a.supplierId, eId: a.eId };
                }
                const cv = Utils.numOrNull(a.costPerRace);
                if (cv != null && (refCost == null || cv < refCost.value)) {
                    refCost = { value: cv, id: a.supplierId, eId: a.eId };
                }
            }
            const vBonus = IGPCore.numberVerdict(curBonus, refBonus ? refBonus.value : null, { tolerance: p && p.tolerance });
            const vCost = IGPCore.numberVerdict(curCost, refCost ? refCost.value : null, { lowerIsBetter: true, tolerance: p && p.tolerance });
            const basis = (vBonus.verdict !== 'unknown') ? 'bonus'
                : (vCost.verdict !== 'unknown') ? 'cost' : 'none';
            const verdict = (basis === 'bonus') ? vBonus.verdict
                : (basis === 'cost') ? vCost.verdict : 'unknown';
            return {
                ok: true,
                values: {
                    current: { bonus: curBonus, cost: curCost },
                    bestBonus: refBonus,
                    cheapest: refCost,
                    bonus: vBonus,
                    cost: vCost,
                    basis: basis,
                    verdict: verdict,
                },
            };
        },
    });

    // =====================================================================
    // 2) ADAPTERS — read-only DOM readers, one per page or dialog.
    //    Each mirrors a saved fixture under test/fixtures/.
    // =====================================================================


    const IgpCarsAdapter = {
        id: 'car-data',
        desc: 'car attributes + suppliers + DP + bonus (Cars page)',
        captures(doc) {
            const pid = doc.getElementById('pageId');
            if (!pid || pid.value !== 'cars') return null; // gate: Cars page only
            const txt = (root, sel) => {
                const el = root.querySelector(sel);
                return el ? el.textContent.trim() : null;
            };
            const attrs = {};
            for (const row of doc.querySelectorAll('#carAttributesDisplay .attribute-row')) {
                const key = (row.id || '').replace(/^wrap-/, '');
                if (!key) continue; // form edit rows have no wrap-* id
                // Restore advisor-written labels (data-igpas-orig); the snapshot is game data.
                const saved = row.getAttribute('data-igpas-orig');
                attrs[key] = {
                    label: (saved != null ? saved : txt(row, '.attribute-rating-header span:not(.ratingVal)')),
                    // Without .ratingVal (partial render or pre-season) it is null,
                    // not 0: 0 would become the "largest gap" and DP priority #1.
                    val: Utils.numOrNull(txt(row, '.ratingVal')),
                };
            }
            if (!Object.keys(attrs).length) return null;
            const dpEl = doc.querySelector('#carsDesignPoints');
            const host = doc.querySelector('#carAttributes');
            let best = {};
            try { best = JSON.parse(txt(doc, '#leagueDesignData') || '{}') || {}; } catch { best = {}; }
            const bonuses = [];
            for (const s of doc.querySelectorAll('#carAttributesBonuses .tooltip')) {
                const m = (s.getAttribute('data-tip') || '').match(/^([A-Za-z ]+):\s*([+-]?\d+)$/);
                if (m) bonuses.push({ key: m[1], bonus: parseInt(m[2], 10) });
            }
            const suppliers = [];
            for (const w of doc.querySelectorAll('.carsSuppliers .c-wrap')) {
                const img = w.querySelector('img[src*="/supply/"]');
                const m = img ? (img.getAttribute('src') || '').match(/\/supply\/(?:light\/)?(\d+)\.png/) : null;
                const kind = (w.textContent || '').match(/\b(Engines|Fuel|Tyres)\b/);
                if (m) suppliers.push({ kind: kind ? kind[1].toLowerCase() : null, id: m[1] });
            }
            return {
                carType: txt(host, '.c-head h2 span'),
                dmax: host ? Utils.numOrNull(host.getAttribute('data-dmax')) : null,
                designPoints: dpEl ? Utils.numOrNull(dpEl.getAttribute('data-dp')) : null,
                attrs, best, bonuses, suppliers,
            };
        },
    };

    // Supply dialog adapter (engine / fuel / tyre) — read-only.
    // Mapped from live DOM captures (test/fixtures/supply-*.html). The dialog is
    // opened by the user on the Cars page; this adapter never opens it, never
    // clicks and never submits, it only reads what is visible.
    // Gate: `.supplyDialog` exists (dialog open) and the h2 title selects the type.
    // Detection is DOM-based, not URL-based, so any URL variant works.
    const IgpSupplyAdapter = {
        id: 'supply-data',
        desc: 'engine/fuel/tyre suppliers (Supply dialog on the Cars page)',
        captures(doc) {
            const root = doc.querySelector('.supplyDialog');
            if (!root) return null; // gate: only while the Supply dialog is open
            const h2 = root.querySelector('.dialog-subhead-content h2');
            // The advisor saves the original title in data-igpas-orig, so the gate reads
            // the game text, never the annotated title.
            const h2txt = h2 ? (h2.getAttribute('data-igpas-orig') || h2.textContent) : '';
            const tm = h2txt.match(/^\s*(engine|fuel|tyre)s?\s+supply\s*$/i);
            if (!tm) return null;
            const type = tm[1].toLowerCase();

            const money = Utils.parseMoney;
            const sid = el => {
                const m = el ? (el.getAttribute('src') || '').match(/\/supply\/(?:light\/)?(\d+)\.png/) : null;
                return m ? parseInt(m[1], 10) : null;
            };
            const bonusesIn = scope => {
                const out = [];
                for (const s of scope.querySelectorAll('.tooltip[data-tip]')) {
                    const v = (s.textContent || '').match(/[+-]?\d+/);
                    if (v) out.push({ stat: s.getAttribute('data-tip'), value: parseInt(v[0], 10) });
                }
                // An empty array means bonuses are not rendered yet (supplier not scouted
                // or lazy), not "total bonus 0", which would win the "better" verdict.
                return out.length ? out : null;
            };

            const sub = root.querySelector('.dialog-subhead');
            const costMatch = sub ? (sub.textContent || '').match(/Cost:\s*([\d.]+\s*[kmb]?)/i) : null;

            const alternatives = [];
            for (const btn of root.querySelectorAll('a[data-tip*="supplyType="]')) {
                const tip = btn.getAttribute('data-tip') || '';
                const eId = (tip.match(/eId=(\d+)/) || [])[1];
                const supType = (tip.match(/supplyType=([a-z]+)/i) || [])[1];
                if (!eId || (supType && supType.toLowerCase() !== type)) continue;
                const card = btn.closest('.inline-block') || btn.parentElement;
                // Restore advisor-written cost text (data-igpas-orig); the snapshot is game data.
                const savedCost = btn.getAttribute('data-igpas-orig');
                alternatives.push({
                    eId: parseInt(eId, 10),
                    supplierId: sid(card ? card.querySelector('img[src*="/supply/"]') : null),
                    costPerRace: money(savedCost != null ? savedCost : btn.textContent),
                    bonuses: card ? bonusesIn(card) : [],
                });
            }

            return {
                type,
                current: {
                    supplierId: sid(sub ? sub.querySelector('img[src*="/supply/"]') : null),
                    costPerRace: costMatch ? money(costMatch[1]) : null,
                    bonuses: sub ? bonusesIn(sub) : null, // null = unreadable, not 0
                },
                alternatives,
            };
        },
    };

    // Manufacturers page adapter — read-only.
    // Mapped from live DOM captures of both tabs (test/fixtures/
    // manufacturers-engines.html and manufacturers-chassis.html). Both tables are
    // always in the DOM and the active tab only controls display, so one capture
    // reads both. Gate: #pageId === 'manufacturers' — DOM-based, not URL-based,
    // so the tab=engines and tab=chassis variants both pass.
    // Never clicks (including "Show hidden stats"), submits or opens a dialog.
    const IgpManufacturersAdapter = {
        id: 'manufacturer-data',
        desc: 'engine + chassis manufacturer list (Manufacturers page)',
        captures(doc) {
            const pid = doc.getElementById('pageId');
            if (!pid || pid.value !== 'manufacturers') return null; // gate: Manufacturers page only
            const engineTable = doc.getElementById('engine-table');
            const chassisTable = doc.getElementById('chassis-table');
            if (!engineTable && !chassisTable) return null;

            const money = Utils.parseMoney;
            const clean = s => String(s || '').replace(/\s+/g, ' ').trim(); // names carry stray spaces in the DOM
            // A manufacturer name can be split across nodes (text plus a <span> inside
            // the <a>). Raw textContent would glue "Aero" and "Dynamics" into
            // "AeroDynamics", so join with a space at element boundaries.
            const textOf = el => {
                if (!el) return '';
                const walk = node => {
                    if (!node) return '';
                    if (node.nodeType === 3) return node.textContent;
                    if (node.nodeType !== 1) return '';
                    if (String(node.tagName || '').toUpperCase() === 'BR') return ' ';
                    return Array.from(node.childNodes || []).map(walk).join(' ');
                };
                return clean(walk(el));
            };
            const num = t => {
                const n = parseInt(String(t || '').replace(/[^\d]/g, ''), 10);
                return Number.isFinite(n) ? n : null;
            };
            // Stats are visible when #ios-eye is present; #ios-eye-off (red) means hidden.
            const statsVisible = td => {
                const use = td ? td.querySelector('svg use') : null;
                if (!use) return null;
                const ref = use.getAttribute('xlink:href') || use.getAttribute('href') || '';
                if (/#ios-eye-off$/.test(ref)) return false;
                if (/#ios-eye$/.test(ref)) return true;
                return null;
            };
            const totalPages = pagerId => {
                const pgr = doc.getElementById(pagerId);
                const last = pgr ? pgr.querySelector('.pager-last') : null;
                return last ? num(last.getAttribute('rel')) : null;
            };

            // Table rows: engines have 5 columns (name, rating, cost, stats, customers);
            // chassis have 3.
            const parseRows = (table, withCost) => {
                const out = [];
                if (!table) return out;
                for (const tr of table.querySelectorAll('tbody tr')) {
                    const tds = tr.querySelectorAll('td');
                    if (tds.length < 2) continue;
                    const a = tds[0].querySelector('a[href]');
                    const idm = a ? (a.getAttribute('href') || '').match(/id=(\d+)/) : null;
                    const tip = tds[1] ? tds[1].querySelector('.tooltip[data-tip]') : null;
                    const rm = tip ? (tip.getAttribute('data-tip') || '').match(/^Rating:\s*(\d+)\s*%\s*$/i) : null;
                    // Restore advisor-written names (data-igpas-orig); the snapshot is game data.
                    const savedName = tr.getAttribute('data-igpas-orig');
                    const row = {
                        id: idm ? parseInt(idm[1], 10) : null,
                        name: (savedName != null ? savedName : textOf(tds[0])), // text only — an empty <a> + <img> flag yields no text
                        nationality: tr.getAttribute('data-nationality') || null,
                        ratingPct: rm ? parseInt(rm[1], 10) : null,
                    };
                    if (withCost) {
                        const costTd = (tds[2] && tds[2].classList.contains('currency')) ? tds[2] : null;
                        row.costPerRace = costTd ? money(costTd.textContent) : null;
                        row.statsVisible = statsVisible(tds[3]);
                    }
                    row.customers = num(tds[tds.length - 1].textContent);
                    out.push(row);
                }
                return out;
            };

            return {
                engines: parseRows(engineTable, true),
                chassis: parseRows(chassisTable, false),
                totalPages: { engines: totalPages('engine-pager'), chassis: totalPages('chassis-pager') },
            };
        },
    };

    // Drivers & Staff page adapter (v0.7.2) — read-only.
    // Mapped from test/fixtures/staff.html. Gate: #pageId === 'staff'.
    // Reads active drivers (name, ability/mental %, health bar with recovery
    // estimate, contract, wage), active staff cards (role, wage, contract), pit
    // crew status (locked when a tooltip is present) and the reserve count.
    // Active staff cards carry stars, not rating numbers, so the adapter never
    // invents them.
    const IgpStaffAdapter = {
        id: 'staff-data',
        desc: 'Drivers & Staff page: active drivers + staff + pit crew',
        captures(doc) {
            const pid = doc.getElementById('pageId');
            if (!pid || pid.value !== 'staff') return null;
            const drvBlock = doc.getElementById('drivers');
            const staffGrid = doc.getElementById('staff');
            if (!drvBlock && !staffGrid) return null;
            const money = Utils.parseMoney;
            const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
            const intOf = t => {
                const n = parseInt(String(t || '').replace(/[^\d-]/g, ''), 10);
                return Number.isFinite(n) ? n : null;
            };
            const salaryOf = card => {
                // Wage is the exact number right after the cash icon; card.textContent may
                // capture digits from the name/role first.
                const cash = card.querySelector('img[src*="cash"]');
                if (cash) {
                    let nd = cash.nextSibling;
                    while (nd && nd.nodeType !== 3) nd = nd.nextSibling;
                    const v = nd ? money(nd.textContent) : null;
                    if (v != null) return v;
                }
                return money(card.textContent);
            };
            const nameOf = el => {
                if (!el) return null;
                // Original name from the advisor (data-igpas-orig) — the snapshot is game data.
                const direct = el.getAttribute('data-igpas-orig');
                if (direct != null) return clean(direct);
                const c = el.cloneNode(true);
                for (const m of c.querySelectorAll('[data-igpas-orig]')) {
                    m.textContent = m.getAttribute('data-igpas-orig');
                }
                const brs = c.querySelectorAll('br');
                for (const b of brs) b.replaceWith(doc.createTextNode(' '));
                return clean(c.textContent);
            };

            const cols = [null, null]; // driver columns 1 & 2 in the stats table
            const cell = i => (cols[i] = cols[i] || {});
            const tbl = doc.getElementById('driverStatsTable');
            if (tbl) {
                for (const tr of tbl.querySelectorAll('tbody tr')) {
                    const th = tr.querySelector('th');
                    const label = clean(th ? th.textContent : '');
                    const tds = tr.querySelectorAll('td');
                    if (label === 'Ability' || label === 'Mental') {
                        for (let i = 0; i < tds.length && i < 2; i++) cell(i)[label.toLowerCase()] = intOf(tds[i].textContent);
                    } else if (label === 'Contract') {
                        for (let i = 0; i < tds.length && i < 2; i++) cell(i).contract = clean(tds[i].textContent);
                    } else if (label === 'Salary') {
                        for (let i = 0; i < tds.length && i < 2; i++) cell(i).salaryPerRace = money(tds[i].textContent);
                    }
                    // Health row: no label — identify it from the training preview.
                    const vals = tr.querySelectorAll('.trainingPreviewValue');
                    if (vals.length) {
                        vals.forEach((v, i) => {
                            if (i < 2) {
                                cell(i).health = intOf(v.getAttribute('data-val'));
                                const rec = tds[i] ? tds[i].querySelector('.staffHealthRecovery') : null;
                                const rate = tds[i] ? tds[i].querySelector('.trainingPreviewRate') : null;
                                // `data-recovery-rate` is the full game number (6.615);
                                // the "+6" text is only a fallback and must not go through intOf
                                // (intOf strips the dot → 6.6 becomes 66).
                                const rv = rec ? Utils.numOrNull(rec.getAttribute('data-recovery-rate')) : null;
                                if (rv != null) cell(i).recoveryPerHour = rv;
                                else if (rate) cell(i).recoveryPerHour = Utils.numOrNull(rate.textContent);
                            }
                        });
                    }
                    const hovers = tr.querySelectorAll('.hoverData[data-driver]');
                    hovers.forEach((sp, i) => {
                        if (i < 2) {
                            const csv = sp.getAttribute('data-driver');
                            cell(i).raw = csv;
                            // 12-stat index from the CSV, used to compare with the market
                            // (the same number shape on both sides).
                            cell(i).statIndex = Utils.statIndex(csv);
                        }
                    });
                }
            }

            const pics = ['d1Pic', 'd2Pic'].map(pId => doc.getElementById(pId));
            const drivers = pics.map((pic, i) => {
                const nm = pic ? pic.querySelector('.driverName') : null;
                const a = pic ? pic.querySelector('a[href*="id="]') : null;
                const idm = a ? (a.getAttribute('href') || '').match(/id=(\d+)/) : null;
                return Object.assign(
                    { id: idm ? parseInt(idm[1], 10) : null, name: nameOf(nm) },
                    cols[i] || {}
                );
            });

            const staffCards = [];
            if (staffGrid) {
                for (const card of staffGrid.querySelectorAll('.c-wrap')) {
                    const roleEl = card.querySelector('.c-head');
                    const link = card.querySelector('a[href*="id="]');
                    const idm = link ? (link.getAttribute('href') || '').match(/id=(\d+)/) : null;
                    staffCards.push({
                        id: idm ? parseInt(idm[1], 10) : null,
                        role: clean(roleEl ? roleEl.textContent : ''),
                        name: nameOf(card.querySelector('.driverName')),
                        salaryPerRace: salaryOf(card),
                        contract: clean((card.querySelector('span[id^="nStaffC"]') || {}).textContent),
                    });
                }
            }

            const pc = doc.querySelector('.pc-main-div');
            const pitLocked = pc ? (clean(pc.getAttribute('data-tip') || '') || null) : null;
            const reserveTable = doc.getElementById('reserveStaff');

            return {
                drivers: drivers,
                staffCards: staffCards,
                pitLocked: pitLocked,
                reserveCount: reserveTable ? reserveTable.querySelectorAll('tbody tr').length : null,
            };
        },
    };

    // Transfers market adapter (v0.7.2) — read-only.
    // Mapped from test/fixtures/transfers.html. Gate: #pageId === 'transfers'.
    // Both tables (drivers and staff) are always in the DOM; the active tab is
    // display only. Overall numbers come from attributes that actually exist on the
    // page (data-overall, data-sort, the CSV blobs, trait in data-append); nothing
    // is fabricated. The market can refresh on its own, which the panel notes.
    const IgpTransfersAdapter = {
        id: 'transfers-data',
        desc: 'Transfers market: drivers & staff (rating/fee/wage/trait)',
        captures(doc) {
            const pid = doc.getElementById('pageId');
            if (!pid || pid.value !== 'transfers') return null;
            const dT = doc.getElementById('driver-table');
            const sT = doc.getElementById('staff-table');
            if (!dT && !sT) return null;
            const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
            const sortNum = td => {
                const v = td ? Number(td.getAttribute('data-sort')) : NaN;
                return Number.isFinite(v) ? v : null;
            };
            const parseTable = (tid, isStaff) => {
                const t = doc.getElementById(tid);
                const out = [];
                if (!t) return out;
                for (const tr of t.querySelectorAll('tbody tr')) {
                    const tds = tr.querySelectorAll('td');
                    if (tds.length < 4) continue;
                    const idm = String(tr.id || '').match(/_(\d+)$/);
                    const hover = tr.querySelector('.hoverData');
                    const csv = hover ? (hover.getAttribute(isStaff ? 'data-staff' : 'data-driver') || '') : '';
                    const row = {
                        id: idm ? parseInt(idm[1], 10) : null,
                        name: tr.getAttribute('data-name') || clean(tds[0].textContent),
                        overall: (v => (v != null && Number.isFinite(Number(v)) ? Number(v) : null))(tr.getAttribute('data-overall')),
                        statIndex: Utils.statIndex(csv),
                        traitsHtml: hover ? (hover.getAttribute('data-append') || '') : '',
                        fee: sortNum(tds[3]),
                        wage: sortNum(tds[4]),
                        // Roadmap F1: the auction deadline the game already prints.
                        // Kept raw; IGPCore.deadlineInfo() decides what it means.
                        endDate: tr.getAttribute('data-enddate') || null,
                    };
                    if (isStaff) row.role = clean(tds[1].textContent);
                    else row.age = sortNum(tds[1]);
                    out.push(row);
                }
                return out;
            };
            const cd = doc.getElementById('cdTransfersRefresh');
            return {
                drivers: parseTable('driver-table', false),
                staff: parseTable('staff-table', true),
                refreshIn: cd ? clean(cd.textContent) : null,
            };
        },
    };

    // Sponsor dialog adapter (Primary / Secondary) — read-only.
    // Gate: #sponsorSignTable exists (the Sign dialog is open). Never opens the
    // dialog, clicks or submits.
    // The game does not display the contract term (that row is commented out), so
    // the term is read from the Primary sponsor card on the page behind the modal.
    // That is an explicit assumption, not the game formula.
    const IgpSponsorAdapter = {
        id: 'sponsor-data',
        desc: 'sponsor dialog: income per league race + objective bonus',
        captures(doc) {
            const table = doc.getElementById('sponsorSignTable');
            if (!table) return null; // gate: only while the sponsor dialog is open
            const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
            const rows = Array.from(table.querySelectorAll('tr'));
            const rowOf = label => rows.find(tr => {
                const th = tr.querySelector('th');
                return th && clean(th.textContent).toLowerCase().indexOf(label) === 0;
            });
            const incomeRow = rowOf('income');
            const bonusRow = rowOf('bonus');
            const signRow = rows.find(tr => tr.querySelector('a[data-tip*="eId="]'));
            if (!incomeRow || !bonusRow || !signRow) return null;
            const incomeCells = Array.from(incomeRow.querySelectorAll('td'));
            const bonusCells = Array.from(bonusRow.querySelectorAll('td'));
            // Income unit: token (Primary sponsor) vs cash (Secondary).
            // Tokens and cash must never be mixed; the kind is detected from the icon.
            const isTokenCell = c => !!(c && c.querySelector('img[src*="token"], .token-icon, .token-cost'));
            const incomeKind = incomeCells.some(isTokenCell) ? 'token' : 'cash';
            const amountOf = cell => {
                if (!cell) return null;
                const m = clean(cell.textContent).match(/(\d+(?:\.\d+)?)/);
                return m ? parseFloat(m[1]) : null;
            };
            const offers = [];
            Array.from(signRow.querySelectorAll('td')).forEach((td, i) => {
                const a = td.querySelector('a[data-tip*="eId="]');
                if (!a) return;
                const eId = (String(a.getAttribute('data-tip') || '').match(/eId=(\d+)/) || [])[1];
                if (!eId) return;
                const moneyOf = cell => (cell ? Utils.parseMoney(clean(cell.textContent)) : null);
                offers.push({
                    eId: parseInt(eId, 10),
                    tokens: incomeKind === 'token' ? amountOf(incomeCells[i]) : null,
                    income: incomeKind === 'cash' ? moneyOf(incomeCells[i]) : null,
                    bonus: moneyOf(bonusCells[i]),
                });
            });
            if (!offers.length) return null;
            // Contract term: Primary sponsor card in #page-content (behind the modal).
            let termRaces = null;
            for (const card of doc.querySelectorAll('#page-content .c-wrap')) {
                const head = card.querySelector('.font-heading');
                if (!head || !/primary\s+sponsor/i.test(clean(head.textContent))) continue;
                const m = clean(card.textContent).match(/(\d+)\s*race(?:\(s\)|s)?/i);
                if (m) termRaces = parseInt(m[1], 10);
                break;
            }
            return { termRaces: termRaces, incomeKind: incomeKind, offers: offers };
        },
    };

    // Adapter registry. Status is published as-is: ':ready' means a read-only
    // adapter is installed; ':waiting-map' means the page DOM is not mapped yet.
    // =====================================================================
    // 3) IN-PAGE ADVISOR (v0.7.0) — read-only recommendations.
    //  - In-place: no elements are added. Writes are text on existing game nodes,
    //    the title attribute of those nodes, and temporary style (button colour).
    //    No clicks, no submits, no fetch/XHR, no mailbox packets.
    //  - Active on #pageId 'cars' (including an open Supply dialog),
    //    'manufacturers', 'staff' and 'transfers', plus the sponsor dialog
    //    (#sponsorSignTable, usually the Finances page). Race pages (Setup,
    //    Strategy and the live Race) get no UI and no text.
    //  - Re-render follows user actions and relevant DOM changes — never broad
    //    polling.
    //  - Every number is a displayed DOM reading plus an explicit IGPCore
    //    heuristic, always labelled "estimate — not the game formula".
    // =====================================================================
    const Advisor = (() => {
        const PREFIX = 'igpas-adv';
        const fmtMoney = Utils.fmtMoney; // one money format for the whole advisor
        const pageId = () => {
            const el = document.getElementById('pageId');
            return el ? String(el.value || '').trim() : null;
        };

        function removeIfAny(ids) {
            for (const id of ids) {
                const el = document.getElementById(id);
                if (el) el.remove();
            }
        }

        // Cars page: design-point allocation priority against the league benchmark.
        // Fully in-place (no new elements): each row's original label becomes
        // "#n Label · X DP" and rows are sorted #1, #2, ... top to bottom. The
        // val/max/gap details and the estimate label go in the title attribute of the
        // same row; game numbers and bars are untouched. The Research and Upgrade tabs
        // (their own forms) get the same #1..#n order and the same "#n Label" prefix,
        // with the rows moved, not cloned. Original order and text are restored by
        // restoreDesign(), and captures always run after restore so the adapter never
        // reads the advisor's own output.
        function applyInlineStyle(el, props) {
            if (!el.hasAttribute('data-igpas-orig-style')) {
                el.setAttribute('data-igpas-orig-style', el.getAttribute('style') || '');
            }
            for (const prop of Object.keys(props)) {
                el.style.setProperty(prop, props[prop], 'important');
            }
            el.setAttribute('data-igpas-written-style', el.getAttribute('style') || '');
        }
        function restoreInlineStyle(el) {
            const saved = el.getAttribute('data-igpas-orig-style');
            if (saved == null) return;
            const written = el.getAttribute('data-igpas-written-style');
            const current = el.getAttribute('style') || '';
            if (written == null || current === written) {
                if (saved === '') el.removeAttribute('style');
                else el.setAttribute('style', saved);
            }
            el.removeAttribute('data-igpas-orig-style');
            el.removeAttribute('data-igpas-written-style');
        }
        // Cars page — Research and Upgrade tabs. Both tabs list the same eight attributes
        // in their own forms (#designInline, #researchInline), server-rendered in
        // alphabetical order. The rows are moved (never cloned) into the same #1..#n
        // priority order as the Overview, and each row label gets the same "#n " prefix:
        // every game input keeps its name/value/id, and the hidden form fields stay at the
        // end of the form. Original order and text are stored per row in
        // data-igpas-orig-order / data-igpas-form-orig and restored by restoreFormOrder().
        function tabForms() {
            return Array.from(document.querySelectorAll('#designInline, #researchInline'));
        }
        function formRowKey(row) {
            // Upgrade rows carry the attribute in the number input's name; Research rows
            // carry it in the checkbox value (their name is the shared "c[]" array).
            const num = row.querySelector('input[type="number"][name]');
            if (num) return num.getAttribute('name');
            const cb = row.querySelector('input[type="checkbox"][value]');
            if (cb) return cb.getAttribute('value');
            return null;
        }
        function formAnchor(form) {
            // First child that is not an attribute row (the hidden inputs), so rows always
            // stay above the hidden fields they were rendered above.
            return Array.from(form.children).find(el =>
                !(el.classList && el.classList.contains('attribute-row'))) || null;
        }
        function restoreFormOrder(form) {
            const rows = Array.from(form.children).filter(el =>
                el.classList && el.classList.contains('attribute-row'));
            for (const row of rows) {
                if (row.hasAttribute('data-igpas-form-orig') ||
                    row.hasAttribute('data-igpas-form-written')) {
                    restoreTabRow(row);
                }
            }
            const marked = rows.filter(row => row.hasAttribute('data-igpas-orig-order'));
            if (!marked.length) return;
            marked.sort((a, b) => Number(a.getAttribute('data-igpas-orig-order')) -
                Number(b.getAttribute('data-igpas-orig-order')));
            const anchor = formAnchor(form);
            for (const row of marked) {
                if (anchor && anchor.parentNode === form) form.insertBefore(row, anchor);
                else form.appendChild(row);
                row.removeAttribute('data-igpas-orig-order');
            }
        }
        function tabRowLabel(row) {
            return row.querySelector('.attribute-rating-header span:not(.ratingVal)');
        }
        function annotateTabRow(row, rank) {
            const label = tabRowLabel(row);
            if (!label) return;
            const written = row.getAttribute('data-igpas-form-written');
            let orig = row.getAttribute('data-igpas-form-orig');
            // The game may have replaced the label after our write: adopt its text as the
            // new original instead of prefixing the advisor's own output again.
            if (orig == null || (written != null && label.textContent !== written)) {
                orig = label.textContent;
            }
            const text = (rank != null) ? '#' + rank + ' ' + orig : orig;
            row.setAttribute('data-igpas-form-orig', orig);
            row.setAttribute('data-igpas-form-written', text);
            if (label.textContent !== text) label.textContent = text;
        }
        function restoreTabRow(row) {
            const orig = row.getAttribute('data-igpas-form-orig');
            if (orig != null) {
                const label = tabRowLabel(row);
                const written = row.getAttribute('data-igpas-form-written');
                // Never overwrite a label the game replaced after the advisor wrote it.
                if (label && (written == null || label.textContent === written)) {
                    label.textContent = orig;
                }
            }
            row.removeAttribute('data-igpas-form-orig');
            row.removeAttribute('data-igpas-form-written');
        }
        function sortFormRows(form, ranked) {
            const rows = Array.from(form.children).filter(el =>
                el.classList && el.classList.contains('attribute-row'));
            if (rows.length < 2) return;
            const current = rows.slice();
            rows.forEach((row, i) => {
                if (!row.hasAttribute('data-igpas-orig-order')) {
                    row.setAttribute('data-igpas-orig-order', String(i));
                }
            });
            const ordered = [];
            const rankOf = new Map();
            for (const r of ranked || []) {
                const key = r && r.key != null ? String(r.key) : null;
                if (!key) continue;
                const row = rows.find(el => ordered.indexOf(el) === -1 && formRowKey(el) === key);
                if (!row) continue;
                ordered.push(row);
                rankOf.set(row, ordered.length); // same #n as the Overview row
            }
            for (const row of rows) if (ordered.indexOf(row) === -1) ordered.push(row);
            for (const row of ordered) annotateTabRow(row, rankOf.get(row) || null);
            // Already in priority order: do not re-insert, so a focused field keeps its caret.
            if (current.every((row, i) => row === ordered[i])) return;
            const anchor = formAnchor(form);
            for (const row of ordered) {
                if (anchor && anchor.parentNode === form) form.insertBefore(row, anchor);
                else form.appendChild(row);
            }
        }
        function restoreDesign() {
            const display = document.getElementById('carAttributesDisplay');
            const rows = display ? display.querySelectorAll('.attribute-row') : [];
            for (const row of rows) {
                try {
                    const orig = row.getAttribute('data-igpas-orig');
                    if (orig != null) {
                        const label = row.querySelector('.attribute-rating-header span:not(.ratingVal)');
                        const written = row.getAttribute('data-igpas-written');
                        // Never overwrite a label the game replaced after the advisor wrote it.
                        if (label && (written == null || label.textContent === written)) {
                            label.textContent = orig;
                        }
                    }
                    const savedTitle = row.getAttribute('data-igpas-title');
                    if (savedTitle != null) {
                        const writtenTitle = row.getAttribute('data-igpas-written-title');
                        if (writtenTitle == null || row.getAttribute('title') === writtenTitle) {
                            if (savedTitle === '') row.removeAttribute('title');
                            else row.setAttribute('title', savedTitle);
                        }
                    }
                    if (row.hasAttribute('data-igpas-orig-style') || row.hasAttribute('data-igpas-written-style')) {
                        restoreInlineStyle(row);
                    }
                } catch {}
                row.removeAttribute('data-igpas-orig');
                row.removeAttribute('data-igpas-written');
                row.removeAttribute('data-igpas-title');
                row.removeAttribute('data-igpas-written-title');
            }
                    if (display) {
                const marked = Array.from(display.children).filter(el =>
                    el && el.classList && el.classList.contains('attribute-row') &&
                    el.hasAttribute('data-igpas-orig-order'));
                if (marked.length) {
                    marked.sort((a, b) => Number(a.getAttribute('data-igpas-orig-order')) -
                        Number(b.getAttribute('data-igpas-orig-order')));
                    for (const row of marked) {
                        display.appendChild(row);
                        row.removeAttribute('data-igpas-orig-order');
                    }
                }
            }
            // Research / Upgrade forms: rows return to their original server order.
            for (const form of tabForms()) restoreFormOrder(form);
            // Remove leftovers from the old badge/panel design without touching game nodes.
            for (const el of document.querySelectorAll('.igpas-adv-inline, .igpas-adv-inline-head')) el.remove();
            removeIfAny([PREFIX + '-design']);
        }
        function mountDesign() {
            const anchor = (pageId() === 'cars') ? document.getElementById('carAttributesDisplay') : null;
            if (!anchor) { restoreDesign(); return; }
            restoreDesign(); // restore original text/order first so captures read pure data
            const data = IgpCarsAdapter.captures(document);
            const res = IGPCore.designPriority({
                attrs: data && data.attrs,
                best: data && data.best,
                designPoints: data && data.designPoints,
            });
                    if (!res.ok) return;
            const dpTotal = res.values.designPoints;
            const ranked = res.values.ranked;
            const rows = Array.from(anchor.children).filter(el =>
                el && el.classList && el.classList.contains('attribute-row'));
            if (!rows.length) return;
            const byKey = new Map();
            rows.forEach((row, i) => {
                if (!row.hasAttribute('data-igpas-orig-order')) {
                    row.setAttribute('data-igpas-orig-order', String(i));
                }
                if (row.id && row.id.indexOf('wrap-') === 0) byKey.set(row.id.slice(5), row);
            });
            // Sort #1..#n by rank; unreadable rows stay at the end.
            const ordered = [];
            for (const r of ranked) {
                const row = r && r.key != null ? byKey.get(String(r.key)) : null;
                if (row && ordered.indexOf(row) === -1) ordered.push(row);
            }
            for (const row of rows) if (ordered.indexOf(row) === -1) ordered.push(row);
            for (const row of ordered) anchor.appendChild(row);
            // Research and Upgrade tabs follow the same #1..#n priority order.
            for (const form of tabForms()) sortFormRows(form, ranked);
            ranked.forEach((r, i) => {
                if (r.key == null || !/^[A-Za-z0-9_-]+$/.test(String(r.key))) return;
                let row = null;
                try { row = document.getElementById('wrap-' + r.key); } catch { row = null; }
                if (!row) return;
                const label = row.querySelector('.attribute-rating-header span:not(.ratingVal)');
                if (!label) return;
                const orig = label.textContent;
                const share = (r.sharePct != null ? r.sharePct : 0);
                const dpEst = (dpTotal != null) ? Math.round(dpTotal * share / 100) : null;
                row.setAttribute('data-igpas-orig', orig);
                row.setAttribute('data-igpas-title',
                    row.hasAttribute('title') ? row.getAttribute('title') : '');
                const newLabel = '#' + (i + 1) + ' ' + orig + (dpEst != null ? ' · ' + dpEst + ' DP' : '');
                label.textContent = newLabel;
                row.setAttribute('data-igpas-written', newLabel);
                const advisorTitle = 'Priority #' + (i + 1) + ' — ' + (r.label || orig) + ': ' + r.val +
                    ' → league max ' + (r.max == null ? '—' : r.max) +
                    ' (gap ' + (r.gap == null ? '—' : r.gap) + '). ' +
                    'Proposal ' + (dpEst != null ? '±' + dpEst + ' DP of ' + dpTotal + ' DP' : share + '% of the gap') +
                    ' — estimate, not the game formula.';
                row.setAttribute('title', advisorTitle);
                row.setAttribute('data-igpas-written-title', advisorTitle);
            });
        }

        // Cars Repair tab: fix parts / replace engine advice.
        // Fully in-place (no new elements): game buttons are coloured by condition —
        // red ≤50% (replace now), amber 50–60% (prepare), grey >60% (defer). Card
        // titles are not written; cost, stock and threshold details stay in the button
        // title and condition circle. Original style and title are restored by
        // restoreRepair(), and buttons are never clicked or submitted.
        const REPAIR_BUTTON_COLORS = {
            now: { bg: '#c0392b', fg: '#ffffff' },
            soon: { bg: '#d68910', fg: '#1b2631' },
            hold: { bg: '#5d6d7e', fg: '#ffffff' },
        };
        function restoreRepair() {
            const repair = document.getElementById('repair');
            if (!repair) return;
            for (const el of repair.querySelectorAll('[data-igpas-orig]')) {
                try { restoreMarkedText(el); } catch {}
                el.removeAttribute('data-igpas-orig');
                el.removeAttribute('data-igpas-origmode');
                el.removeAttribute('data-igpas-written');
            }
            for (const el of repair.querySelectorAll('[data-igpas-title], [data-igpas-written-title]')) {
                try { restoreTitle(el); } catch {}
            }
            for (const el of repair.querySelectorAll('[data-igpas-orig-style], [data-igpas-written-style]')) {
                try { restoreInlineStyle(el); } catch {}
            }
        }
        function repairVerdictText(part, kind) {
            const status = part ? part.status : 'unknown';
            if (status === 'unknown') return 'condition not read';
            if (kind === 'parts') {
                if (status === 'now') return 'fix now';
                if (status === 'soon') return 'prepare to fix';
                return 'still usable — defer fix';
            }
            if (status === 'now') return 'replace now';
            if (status === 'soon') return 'prepare to replace';
            return 'defer replace';
        }
        function repairTitle(part, kind, restockRaces) {
            if (!part || part.value == null) {
                return (kind === 'parts' ? 'Parts' : 'Engine') +
                    ' not read — no advice invented.';
            }
            const unit = kind === 'parts' ? 'parts' : 'engine';
            const bits = [repairVerdictText(part, kind)];
            if (part.cost != null) {
                bits.push(part.cost + ' ' + unit + (part.stock != null ? '; stock ' + part.stock : '; stock not read'));
            } else {
                bits.push('button cost not read');
            }
            if (part.enough === false) bits.push('LOW STOCK');
            if (kind === 'engine' && restockRaces != null) bits.push('restock ' + restockRaces + raceUnit(restockRaces));
            bits.push('study threshold ≤50% replace, ≤60% prepare');
            return (kind === 'parts' ? 'Parts ' : 'Engine ') + part.value + '% — ' + bits.join(' · ') +
                ' — estimate, not the game formula.';
        }
        function paintRepairButton(el, part, kind, restockRaces) {
            if (!el || !part || part.value == null || part.status === 'unknown') return;
            const color = REPAIR_BUTTON_COLORS[part.status];
            if (!color) return;
            applyInlineStyle(el, {
                'background-color': color.bg,
                'background-image': 'none',
                'border-color': color.bg,
                'color': color.fg,
            });
            saveTitle(el);
            const tip = repairTitle(part, kind, restockRaces);
            el.setAttribute('title', tip);
            el.setAttribute('data-igpas-written-title', tip);
        }
        function mountRepair() {
            if (pageId() !== 'cars') { restoreRepair(); return; }
            const repair = document.getElementById('repair');
            if (!repair) { restoreRepair(); return; }
            restoreRepair(); // restore original text/style first so captures read pure data
            const notice = repair.querySelector('.notice');
            const numOf = el => (el ? Utils.numOrNull(el.textContent) : null);
            const partsStock = numOf(repair.querySelector('.notice .totalParts'));
            const engineStock = numOf(repair.querySelector('.notice .totalEngines'));
            const restockM = notice ? Utils.clean(notice.textContent)
                .match(/Race\(s\) to next engine restock:\s*(\d+)/i) : null;
            const restockRaces = restockM ? Number(restockM[1]) : null;
            for (const card of repair.querySelectorAll('.c-wrap')) {
                const condEl = card.querySelector('.ratingCircle[id$="Condition"]');
                const engEl = card.querySelector('.ratingCircle[id$="Engine"]');
                if (!condEl && !engEl) continue;
                const fixBtn = card.querySelector('a[id$="PartSwap"]');
                const engBtn = card.querySelector('a[id$="EngSwap"]');
                const valueOf = el => (el ? Utils.numOrNull(el.getAttribute('data-value')) : null);
                const costOf = (el, label) => {
                    if (!el) return null;
                    const m = Utils.clean(el.textContent).match(new RegExp(label + '\\s*(\\d+)', 'i'));
                    return m ? Number(m[1]) : null;
                };
                const res = IGPCore.repairAdvice({
                    condition: valueOf(condEl),
                    engine: valueOf(engEl),
                    partCost: costOf(fixBtn, 'Fix'),
                    engineCost: costOf(engBtn, 'Replace'),
                    partsStock: partsStock,
                    engineStock: engineStock,
                    restockRaces: restockRaces,
                });
                if (!res.ok) continue;
                paintRepairButton(fixBtn, res.values.parts, 'parts', restockRaces);
                paintRepairButton(engBtn, res.values.engine, 'engine', restockRaces);
                const annotateCircle = (el, part, kind) => {
                    if (!el) return;
                    saveTitle(el);
                    const tip = repairTitle(part, kind, restockRaces);
                    el.setAttribute('title', tip);
                    el.setAttribute('data-igpas-written-title', tip);
                };
                annotateCircle(condEl, res.values.parts, 'parts');
                annotateCircle(engEl, res.values.engine, 'engine');
            }
        }

        // Supply dialog (engine / fuel / tyre): alternative buttons are coloured by
        // the recommendation — red means switch to this supplier, amber means active or
        // candidate (keep or check), grey means not an option. The dialog header and its
        // title keep the game's own look (no tint, no background or box-shadow override),
        // so the active supplier card renders exactly like the original. Σ bonus, value
        // per 1M and verdict details stay in the header title and card titles. Game cost
        // text is unchanged. Original style and title are restored by restoreSupply(), and
        // captures always run after restore so the adapter never reads the advisor's own
        // output.
        const SUPPLY_BUTTON_COLORS = {
            now: { bg: '#c0392b', fg: '#ffffff' },
            soon: { bg: '#d68910', fg: '#1b2631' },
            hold: { bg: '#5d6d7e', fg: '#ffffff' },
        };
        function restoreSupply() {
            // Strict dialog scope: Cars and Manufacturers data-igpas-* attributes
            // must stay untouched because renderAll mounts them in sequence.
            // No dialog means there is nothing to clean up.
            const dlg = document.querySelector('.supplyDialog');
            if (!dlg) return;
            for (const link of dlg.querySelectorAll('a[data-igpas-orig]')) {
                try {
                    // Restore legacy text unless the game already replaced it.
                    restoreMarkedText(link);
                } catch {}
                link.removeAttribute('data-igpas-orig');
                link.removeAttribute('data-igpas-origmode');
                link.removeAttribute('data-igpas-written');
            }
            const h2 = dlg.querySelector('.dialog-subhead-content h2[data-igpas-orig]');
            if (h2) {
                try { restoreMarkedText(h2); }
                catch {}
                h2.removeAttribute('data-igpas-orig');
                h2.removeAttribute('data-igpas-origmode');
                h2.removeAttribute('data-igpas-written');
            }
            for (const el of dlg.querySelectorAll('[data-igpas-title]')) {
                try {
                    const saved = el.getAttribute('data-igpas-title');
                    const written = el.getAttribute('data-igpas-written-title');
                    // Never overwrite a new game title if the game has
                    // updated the same node after the advisor wrote it.
                    if (written == null || el.getAttribute('title') === written) {
                        if (saved === '') el.removeAttribute('title');
                        else el.setAttribute('title', saved);
                    }
                } catch {}
                el.removeAttribute('data-igpas-title');
                el.removeAttribute('data-igpas-written-title');
            }
            for (const el of dlg.querySelectorAll('[data-igpas-orig-style]')) {
                try { restoreInlineStyle(el); } catch {}
            }
        }
        function mountSupply() {
                    removeIfAny([PREFIX + '-supply', PREFIX + '-supply-compare']);
            const dlg = document.querySelector('.supplyDialog');
            if (!dlg) { restoreSupply(); return; }
            restoreSupply(); // restore original text/style first so captures read pure data
            const s = IgpSupplyAdapter.captures(document);
            if (!s || !s.current || !Array.isArray(s.alternatives) || !s.alternatives.length) return;
            const rank = IGPCore.rankSuppliers({ items: s.alternatives });
                    if (!rank.ok) return;
            const n = rank.values.ranked.length;
            const cmp = IGPCore.compareSuppliers({ current: s.current, alternatives: s.alternatives });
            // Active-supplier efficiency (Σ bonus per 1M) uses the same metric as
            // rankSuppliers. Switch only when an alternative is clearly more efficient:
            // without that threshold the alternative always "wins" and the user switches
            // suppliers repeatedly, paying the sign-on cost again and again.
            const SWITCH_MARGIN = 1.05; // at least 5% more efficient
            const curBonus = cmp.ok ? cmp.values.current.bonus : null;
            const curCost = cmp.ok ? cmp.values.current.cost : null;
            const curValuePerCost = (curBonus != null && curCost != null && curCost > 0)
                ? Math.round((curBonus / curCost) * 1e6 * 100) / 100
                : null;
            const bestAlt = rank.values.ranked.find(r => r.valuePerCost != null) || null;
            const switchRec = !!(curValuePerCost != null && bestAlt &&
                (curValuePerCost <= 0
                    ? bestAlt.valuePerCost > 0
                    : bestAlt.valuePerCost > curValuePerCost * SWITCH_MARGIN));
            const gainPct = (switchRec && curValuePerCost > 0 && bestAlt.valuePerCost != null)
                ? Math.round((bestAlt.valuePerCost / curValuePerCost - 1) * 100)
                : null;
            // Rank the active supplier with the alternatives so the user can see at a
            // glance where they stand. Ties go to the active supplier: there is no reason
            // to switch when the value is equal.
            const pool = curValuePerCost != null
                ? [{ id: s.current.supplierId, eId: null, value: curBonus, cost: curCost,
                     valuePerCost: curValuePerCost, active: true }].concat(rank.values.ranked)
                : rank.values.ranked.slice();
            if (curValuePerCost != null) {
                const vp = r => (r.valuePerCost == null ? -Infinity : r.valuePerCost);
                const vv = r => (r.value == null ? -Infinity : r.value);
                pool.sort((a, b) => (vp(b) - vp(a)) || (vv(b) - vv(a)) ||
                    ((a.active ? 0 : 1) - (b.active ? 0 : 1)) ||
                    String(a.id).localeCompare(String(b.id)));
            }
            const ranks = new Map();
            let activeRank = null;
            pool.forEach((r, i) => {
                if (r.active) activeRank = i + 1;
                else if (r.eId != null) ranks.set(String(r.eId), i + 1);
            });
            const totalOps = n + (curValuePerCost != null ? 1 : 0);
            const bestAltRank = bestAlt ? pool.findIndex(r => r === bestAlt) + 1 : null;
            const showRanks = curValuePerCost != null;
            const cheapId = rank.values.cheapestId;
            // Card map keyed by eId. Parsing mirrors the adapter so eId=1 never matches
            // eId=10 as a substring.
            const cards = new Map();
            for (const btn of dlg.querySelectorAll('a[data-tip*="supplyType="]')) {
                const tip = btn.getAttribute('data-tip') || '';
                const eId = (tip.match(/eId=(\d+)/) || [])[1];
                if (!eId || cards.has(eId)) continue;
                cards.set(eId, { link: btn, card: btn.closest('.inline-block') || btn.parentElement });
            }
            rank.values.ranked.forEach((r, i) => {
                if (r.eId == null) return;
                const hit = cards.get(String(r.eId));
                if (!hit || !hit.link) return;
                const link = hit.link, card = hit.card;
                const rankNo = ranks.get(String(r.eId)) || (i + 1);
                const isBest = !!(bestAlt && r.id === bestAlt.id);
                const isCheap = cheapId != null && r.id === cheapId;
                let status = 'hold';
                if (isBest) {
                    if (switchRec) status = 'now';
                    else if (curValuePerCost == null) status = 'soon';
                }
                const bc = SUPPLY_BUTTON_COLORS[status];
                applyInlineStyle(link, {
                    'background-color': bc.bg,
                    'background-image': 'none',
                    'border-color': bc.bg,
                    'color': bc.fg,
                });
                if (card) {
                    // The title marker is always set ('' when the game had no title) so restore is
                    // precise and never wipes a game-owned title.
                    card.setAttribute('data-igpas-title',
                        card.hasAttribute('title') ? card.getAttribute('title') : '');
                    const advisorTitle = (showRanks ? '#' + rankNo + ' of ' + totalOps : 'Alternative') +
                        (isBest ? ' · switch recommended' : '') +
                        (isCheap ? ' · cheapest' : '') +
                        ' — Σ bonus ' + (r.value == null ? '—' : (r.value > 0 ? '+' : '') + r.value) +
                        ' · ' + fmtMoney(r.cost) + '/race · value/1M ' +
                        (r.valuePerCost == null ? '—' : r.valuePerCost) +
                        (curValuePerCost != null
                            ? ' · active #' + activeRank + ' (' + curValuePerCost + '/1M)' +
                              (switchRec ? '' : ' — keep')
                            : ' · active not read') +
                        ' — estimate, not the game formula.';
                    card.setAttribute('title', advisorTitle);
                    card.setAttribute('data-igpas-written-title', advisorTitle);
                }
            });
            // The dialog header stays game-owned: it is never tinted and its background is
            // never overridden, so the active supplier card keeps its original appearance.
            // The active verdict lives only in the header title below.
            if (cmp.ok) {
                const h2 = dlg.querySelector('.dialog-subhead-content h2');
                if (h2) {
                    h2.setAttribute('data-igpas-title',
                        h2.hasAttribute('title') ? h2.getAttribute('title') : '');
                    const advisorTitle = 'Active supplier #' +
                        (s.current.supplierId != null ? s.current.supplierId : '?') +
                        ': Σ bonus ' + (curBonus == null ? '—' : (curBonus > 0 ? '+' : '') + curBonus) +
                        ' · ' + fmtMoney(curCost) + '/race · value/1M ' +
                        (curValuePerCost == null ? '—' : curValuePerCost) +
                        (activeRank != null ? ' (#' + activeRank + ' of ' + totalOps + ')' : '') + '. ' +
                        'Best alternative: ' + (bestAlt
                            ? '#' + bestAltRank + ' · value/1M ' + bestAlt.valuePerCost +
                              ' · ' + fmtMoney(bestAlt.cost) + '/race' +
                              (gainPct == null ? '' : ' (+' + gainPct + '%)')
                            : '—') + '. ' +
                        'Rule: switch only when an alternative is ≥5% more efficient. ' +
                        'Verdict: ' + (switchRec
                            ? 'switch advised'
                            : (curValuePerCost != null ? 'keep' : 'active not read — compare manually')) +
                        ' — estimate, not the game formula.';
                    h2.setAttribute('title', advisorTitle);
                    h2.setAttribute('data-igpas-written-title', advisorTitle);
                }
            }
        }

        // Manufacturers page: the ranking is written into each row's name column.
        // Fully in-place (no new elements): each game row's original name becomes
        // "#n Name" (+ ★ best-value engine). Rating, cost and rating-per-1M details
        // plus the estimate label go in the same row's title attribute. Links, flags,
        // ratings and other columns are untouched. Original text is stored in
        // data-igpas-orig and restored by restoreManufacturers(); captures always run
        // after restore so the adapter never reads the advisor's own output.
        function restoreManufacturers() {
            for (const tid of ['engine-table', 'chassis-table']) {
                let table = null;
                try { table = document.getElementById(tid); } catch { table = null; }
                if (!table) continue;
                for (const tr of table.querySelectorAll('tr[data-igpas-orig]')) {
                    try {
                        const tds = tr.querySelectorAll('td');
                        if (tds.length) {
                            const nd = Array.from(tds[0].childNodes).find(n =>
                                n.nodeType === 3 && n.textContent.trim() !== '');
                            const written = tr.getAttribute('data-igpas-written');
                            if (nd && (written == null || nd.textContent === written)) {
                                nd.textContent = tr.getAttribute('data-igpas-orig');
                            }
                        }
                        const savedTitle = tr.getAttribute('data-igpas-title');
                        if (savedTitle != null) {
                            const written = tr.getAttribute('data-igpas-written-title');
                            if (written == null || tr.getAttribute('title') === written) {
                                if (savedTitle === '') tr.removeAttribute('title');
                                else tr.setAttribute('title', savedTitle);
                            }
                        } else {
                            tr.removeAttribute('title');
                        }
                    } catch {}
                    tr.removeAttribute('data-igpas-orig');
                    tr.removeAttribute('data-igpas-written');
                    tr.removeAttribute('data-igpas-title');
                    tr.removeAttribute('data-igpas-written-title');
                }
            }
        }
        function writeMfgRanks(table, ranked, bestValueId, withCost) {
            if (!table || !ranked) return;
            // Row map by manufacturer id (href d=brand&id=...) — guards against duplicates.
            const byId = new Map();
            for (const tr of table.querySelectorAll('tbody tr')) {
                const tds = tr.querySelectorAll('td');
                if (tds.length < 2) continue;
                const a = tds[0].querySelector('a[href]');
                const idm = a ? (a.getAttribute('href') || '').match(/id=(\d+)/) : null;
                if (idm && !byId.has(idm[1])) byId.set(idm[1], tr);
            }
            const written = new Set();
            ranked.forEach((r, i) => {
                if (r.id == null) return;
                const tr = byId.get(String(r.id));
                if (!tr || written.has(tr)) return;
                const tds = tr.querySelectorAll('td');
                if (!tds.length) return;
                let nameNode = null;
                try {
                    for (const nd of tds[0].childNodes) {
                        if (nd.nodeType === 3 && nd.textContent.trim() !== '') { nameNode = nd; break; }
                    }
                } catch { nameNode = null; }
                if (!nameNode) return;
                const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
                // Only the text that belongs to this text node, never the whole cell. When a
                // name is split across children (text node "Akina" + <span>SpeedStars</span>),
                // using the cell's textContent duplicates it, and restore then injects the
                // combined text into the node.
                const rawName = nameNode.textContent;
                const orig = clean(rawName);
                const fullName = clean(tds[0].textContent) || orig;
                if (!orig) return;
                const star = withCost && bestValueId != null && r.id === bestValueId &&
                    i !== 0 ? ' ★' : '';
                tr.setAttribute('data-igpas-orig', orig);
                tr.setAttribute('data-igpas-title',
                    tr.hasAttribute('title') ? tr.getAttribute('title') : '');
                nameNode.textContent = '#' + (i + 1) + ' ' + orig + star;
                tr.setAttribute('data-igpas-written', nameNode.textContent);
                const advisorTitle = '#' + (i + 1) + ' · ' + fullName +
                    (star ? ' · best value' : '') + ': rating ' + r.rating + '%' +
                    (withCost ? ' · ' + fmtMoney(r.cost) + '/race · rating/1M ' +
                        (r.ratingPerCost == null ? '—' : r.ratingPerCost) : '') +
                    ' — estimate, not the game formula.';
                tr.setAttribute('title', advisorTitle);
                tr.setAttribute('data-igpas-written-title', advisorTitle);
                written.add(tr);
            });
        }
        function mountManufacturers() {
                    removeIfAny([PREFIX + '-mfg-engine', PREFIX + '-mfg-chassis']);
            if (pageId() !== 'manufacturers') { restoreManufacturers(); return; }
            restoreManufacturers(); // restore original text first so captures read pure data
            const m = IgpManufacturersAdapter.captures(document);
            // Engines: rating and cost per race, so efficiency is rating per 1M. Each table
            // fails honestly: without numbers it gets no modification and no panel.
            const et = document.getElementById('engine-table');
            if (et) {
                const res = IGPCore.rankManufacturerItems({ items: m ? m.engines : [], withCost: true });
                if (res.ok) writeMfgRanks(et, res.values.ranked, res.values.bestValueId, true);
            }
            // Chassis: rating only, no cost.
            const ct = document.getElementById('chassis-table');
            if (ct) {
                const res = IGPCore.rankManufacturerItems({ items: m ? m.chassis : [], withCost: false });
                if (res.ok) writeMfgRanks(ct, res.values.ranked, null, false);
            }
        }

        // Full recovery ETA from health (%) and recovery rate (%/hour). Rounded
        // up so the advisor never promises a faster recovery than reality.
        // Returns a string such as "13h 55m" or "2d 3h", or null.
        function formatRecoverEta(health, ratePerHour) {
            if (health == null || ratePerHour == null || !(ratePerHour > 0)) return null;
            const remain = 100 - health;
            if (remain <= 0) return null;
            const mins = Math.ceil((remain / ratePerHour) * 60);
            const days = Math.floor(mins / 1440);
            const hours = Math.floor((mins % 1440) / 60);
            const minutes = mins % 60;
            if (days > 0) return days + 'd ' + hours + 'h';
            if (hours > 0) return hours + 'h ' + minutes + 'm';
            return minutes + 'm';
        }

        function mountTeam() {
            const id = PREFIX + '-team';
            const idCmp = PREFIX + '-team-compare';
            removeIfAny([id, idCmp]);
            if (pageId() !== 'staff') { restoreTeamInPlace(); return; }
            const s = IgpStaffAdapter.captures(document);
            if (!s) return;
            for (const [i, d] of (s.drivers || []).entries()) {
                const name = document.querySelector('#d' + (i + 1) + 'Pic .driverName');
                if (!name || !d.name) continue;
                // Clean label: "<Name> | Full Recover 13h 55m", without the "low health"
                // jargon. Raw numbers and recovery rate stay in the title.
                const eta = (d.health != null && d.health < 100)
                    ? formatRecoverEta(d.health, d.recoveryPerHour)
                    : null;
                const advice = [];
                if (eta) advice.push('Full Recover ' + eta);
                else if (d.health != null && d.health < 100) advice.push('Health ' + d.health + '%');
                // Preserve the game structure (.driverName > br + span): advice attaches to the
                // existing name span, and hovering the container shows the details.
                const span = name.querySelector('span:last-child');
                saveTitle(name);
                const tipParts = [];
                if (d.health != null) tipParts.push('Health ' + d.health + '%');
                if (d.recoveryPerHour != null) tipParts.push('recovery ' + d.recoveryPerHour + '/hr');
                if (eta) tipParts.push('Full Recover ±' + eta);
                const tip = tipParts.length
                    ? 'Driver: ' + tipParts.join(' · ') + ' · estimate, not the game formula — the decision is still yours.'
                    : '';
                if (tip) { name.setAttribute('title', tip); name.setAttribute('data-igpas-written-title', tip); }
                if (span) {
                    const orig = span.getAttribute('data-igpas-orig') || span.textContent;
                    writeSelfText(span, orig + (advice.length ? ' | ' + advice.join(' · ') : ''));
                }
            }
            for (const card of document.querySelectorAll('#staff .c-wrap')) {
                const role = Utils.roleCode(card.querySelector('.c-head')?.textContent);
                const c = (s.staffCards || []).find(x => Utils.roleCode(x.role) === role);
                if (!c) continue;
                const head = card.querySelector('.c-head');
                if (head) {
                    writeSelfText(head, (head.getAttribute('data-igpas-orig') || head.textContent));
                    saveTitle(head);
                    const tip = (c.salaryPerRace != null ? 'Wage ' + fmtMoney(c.salaryPerRace) + '/race' : '') +
                        (c.contract ? ' · contract ' + c.contract : '') + ' — card rating not read.';
                    head.setAttribute('title', tip);
                    head.setAttribute('data-igpas-written-title', tip);
                }
            }
        }

        // Restore only text this script wrote. If the game has already replaced the
        // node's content (AJAX or re-render), the newer data must not be overwritten
        // with stale text.
        function restoreMarkedText(el) {
            const orig = el.getAttribute('data-igpas-orig');
            if (orig == null) return;
            const written = el.getAttribute('data-igpas-written');
            const isNode = el.getAttribute('data-igpas-origmode') === 'node';
            const target = isNode
                ? Array.from(el.childNodes).find(n => n.nodeType === 3 && n.textContent.trim() !== '')
                : el;
            if (!target) return;
            if (written != null && target.textContent !== written) return;
            target.textContent = orig;
        }
        // Write to elements whose entire textContent is safe to replace (name span,
        // card header), so no child elements are destroyed.
        function writeSelfText(el, text) {
            if (!el) return;
            if (!el.hasAttribute('data-igpas-orig')) el.setAttribute('data-igpas-orig', el.textContent);
            el.setAttribute('data-igpas-origmode', 'self');
            el.textContent = text;
            el.setAttribute('data-igpas-written', text);
        }
        // Write into the first non-empty text node inside the container (the game cell
        // holds <a> and <img>), keeping links, flags and icons alive.
        function writeFirstTextNode(container, text) {
            if (!container) return;
            const nd = Array.from(container.childNodes).find(n => n.nodeType === 3 && n.textContent.trim() !== '');
            if (!nd) return;
            if (!container.hasAttribute('data-igpas-orig')) container.setAttribute('data-igpas-orig', nd.textContent);
            container.setAttribute('data-igpas-origmode', 'node');
            nd.textContent = text;
            container.setAttribute('data-igpas-written', text);
        }
        function saveTitle(el) {
            if (!el.hasAttribute('data-igpas-title')) el.setAttribute('data-igpas-title', el.getAttribute('title') || '');
        }
        function restoreTitle(el) {
            const saved = el.getAttribute('data-igpas-title');
            const written = el.getAttribute('data-igpas-written-title');
            if (saved != null && (written == null || el.getAttribute('title') === written)) {
                if (saved) el.setAttribute('title', saved); else el.removeAttribute('title');
            }
            el.removeAttribute('data-igpas-title');
            el.removeAttribute('data-igpas-written-title');
        }
        function restoreTeamInPlace() {
            const SKIP = '#carAttributesDisplay, .supplyDialog, #engine-table, #chassis-table,' +
                ' #repair, #sponsorSignTable';
            for (const el of document.querySelectorAll('[data-igpas-orig]')) {
                if (el.closest(SKIP)) continue;
                try {
                    restoreMarkedText(el);
                    restoreTitle(el);
                } catch {}
                el.removeAttribute('data-igpas-orig');
                el.removeAttribute('data-igpas-origmode');
                el.removeAttribute('data-igpas-written');
            }
            // Second pass for annotations that only carry a title (e.g. the portrait
            // #dNPic .driverName) and therefore have no data-igpas-orig. Without it the
            // tooltip would be left behind after navigation.
            for (const el of document.querySelectorAll('[data-igpas-title], [data-igpas-written-title]')) {
                if (el.closest(SKIP)) continue;
                try { restoreTitle(el); } catch {}
            }
        }

        // Roadmap F1: append the auction deadline to the row tooltip. Returns '' when
        // the date cannot be read, so an unreadable row simply gets no suffix — the
        // advisor never guesses. Wording stays short: the tooltip already carries rank,
        // overall and fee.
        function deadlineSuffix(item, nowMs) {
            const d = IGPCore.deadlineInfo({ endDate: item && item.endDate, now: nowMs });
            if (d.state === 'unknown') return '';
            if (d.state === 'ended') return ' · ended';
            const total = d.remainingMin;
            const h = Math.floor(total / 60);
            const m = total % 60;
            const left = (h > 0 ? h + 'h ' : '') + m + 'm';
            return (d.state === 'closing' ? ' · closing, ' : ' · ends in ') + left;
        }

        function mountTransfers() {
            const idD = PREFIX + '-tx-driver';
            const idS = PREFIX + '-tx-staff';
            const idC = PREFIX + '-tx-compare';
            removeIfAny([idD, idS, idC]);
            if (pageId() !== 'transfers') return;
            const m = IgpTransfersAdapter.captures(document);
            if (!m) return;
            // One clock reading per render keeps every row consistent with the others.
            const nowMs = Date.now();
            const annotate = (table, items, label) => {
                if (!table || !items.length) return;
                const ranked = items.slice().sort((a, b) =>
                    (Number(b.overall || -1) - Number(a.overall || -1)) ||
                    (Number(a.fee || Infinity) - Number(b.fee || Infinity)));
                const ranks = new Map(ranked.map((x, i) => [String(x.id), i + 1]));
                for (const tr of table.querySelectorAll('tbody tr')) {
                    const idm = String(tr.id || '').match(/_(\d+)$/);
                    const item = idm ? items.find(x => String(x.id) === idm[1]) : null;
                    const td = tr.querySelector('td');
                    if (!item || !td) continue;
                    const nd = Array.from(td.childNodes).find(n => n.nodeType === 3 && n.textContent.trim() !== '');
                    const original = td.getAttribute('data-igpas-orig') || (nd ? nd.textContent : td.textContent);
                    const rank = ranks.get(String(item.id));
                    writeFirstTextNode(td, '#' + rank + ' ' + original.trim() + (rank === 1 ? ' ★ recommended' : ''));
                    saveTitle(td);
                    const tip = label + ' #' + rank + ': overall ' + (item.overall == null ? '—' : item.overall) +
                        ' · fee ' + fmtMoney(item.fee) +
                        deadlineSuffix(item, nowMs) + ' — estimate, not the game formula.';
                    td.setAttribute('title', tip);
                    td.setAttribute('data-igpas-written-title', tip);
                }
            };
            annotate(document.getElementById('driver-table'), m.drivers, 'Driver');
            annotate(document.getElementById('staff-table'), m.staff, 'Staff');
            return;
        }

        // Sponsor dialog (Primary / Secondary): "best value" ranking on the existing
        // Sign buttons. Fully in-place (no new elements): the best total is green with
        // "Sign ★", and an offer with the highest income (best guarantee) turns amber.
        // Game numbers are unchanged; income, term, bonus and guarantee details live in
        // each button's title. Original text, style and title are restored by
        // restoreSponsor(), and captures always run after restore.
        const SPONSOR_BUTTON_COLORS = {
            best: { bg: '#1e8449', fg: '#ffffff' },
            alternative: { bg: '#b9770e', fg: '#ffffff' },
        };
        function restoreSponsor() {
            const table = document.getElementById('sponsorSignTable');
            if (!table) return;
            for (const el of table.querySelectorAll('[data-igpas-orig]')) {
                try { restoreMarkedText(el); } catch {}
                el.removeAttribute('data-igpas-orig');
                el.removeAttribute('data-igpas-origmode');
                el.removeAttribute('data-igpas-written');
            }
            for (const el of table.querySelectorAll('[data-igpas-title], [data-igpas-written-title]')) {
                try { restoreTitle(el); } catch {}
            }
            for (const el of table.querySelectorAll('[data-igpas-orig-style]')) {
                try { restoreInlineStyle(el); } catch {}
            }
        }
        function sponsorTitle(r, values) {
            const bits = [];
            if (values.incomeKind === 'token') {
                // Tokens are a different unit from cash; never sum them.
                bits.push('income ' + r.tokens + ' token/race (tokens are not converted to cash)');
                if (r.bonus != null) {
                    bits.push('cash bonus ' + fmtMoney(r.bonus) + '/race if the objective is met');
                }
                if (values.termRaces != null) {
                    bits.push('≈ ' + (r.tokens * values.termRaces) + ' tokens over ' +
                        values.termRaces + raceUnit(values.termRaces));
                    if (r.bonus != null) {
                        bits.push('max cash bonus ' + fmtMoney(r.bonus * values.termRaces) +
                            ' if the objective is met every race');
                    }
                } else {
                    bits.push('contract term not read — total not calculated');
                }
                bits.push('token preferred; cash bonus is a trade-off');
            } else {
                bits.push('income ' + fmtMoney(r.income) + '/race (guaranteed every race)');
                if (r.bonus != null) {
                    bits.push('cash bonus ' + fmtMoney(r.bonus) + '/race if the objective is met');
                }
                if (values.termRaces != null) {
                    bits.push('guaranteed ' + fmtMoney(r.guaranteeTotal) + ' (' + values.termRaces + raceUnit(values.termRaces) + ')');
                    bits.push('max potential ' + fmtMoney(r.potentialTotal) + ' if the objective is met every race');
                } else {
                    bits.push('contract term not read — total not calculated');
                }
                if (String(r.eId) === String(values.alternativeEId)) {
                    bits.push('highest cash bonus — trade-off against income' +
                        (values.breakEvenP != null
                            ? '; better when the objective is met in >' + Math.round(values.breakEvenP * 100) + '% of races'
                            : ''));
                }
            }
            if (values.incomeKind === 'token' && String(r.eId) === String(values.alternativeEId)) {
                bits.push('highest cash bonus — trade-off against tokens');
            }
            bits.push('estimate, not the game formula');
            return 'Sponsor ' + (r.rank === 1 ? 'best value #1' : '#' + r.rank) +
                ' of ' + values.ranked.length + ': ' + bits.join(' · ') + '.';
        }
        function mountSponsor() {
            const table = document.getElementById('sponsorSignTable');
            if (!table) { restoreSponsor(); return; }
            restoreSponsor(); // restore original text/style first so captures read pure data
            const s = IgpSponsorAdapter.captures(document);
            if (!s) return;
            const res = IGPCore.rankSponsors({
                offers: s.offers,
                termRaces: s.termRaces,
                incomeKind: s.incomeKind,
            });
            if (!res.ok) return;
            const values = res.values;
            const byId = new Map(values.ranked.map(r => [String(r.eId), r]));
            const signRow = Array.from(table.querySelectorAll('tr')).find(tr =>
                tr.querySelector('a[data-tip*="eId="]'));
            if (!signRow) return;
            for (const td of signRow.querySelectorAll('td')) {
                const a = td.querySelector('a[data-tip*="eId="]');
                if (!a) continue;
                const eId = (String(a.getAttribute('data-tip') || '').match(/eId=(\d+)/) || [])[1];
                const r = eId ? byId.get(eId) : null;
                if (!r) continue;
                const isBest = r.rank === 1;
                const isAlternative = String(r.eId) === String(values.alternativeEId);
                if (isBest) {
                    writeSelfText(a, 'Sign ★');
                    applyInlineStyle(a, {
                        'background-color': SPONSOR_BUTTON_COLORS.best.bg,
                        'background-image': 'none',
                        'border-color': SPONSOR_BUTTON_COLORS.best.bg,
                        'color': SPONSOR_BUTTON_COLORS.best.fg,
                    });
                } else if (isAlternative) {
                    applyInlineStyle(a, {
                        'background-color': SPONSOR_BUTTON_COLORS.alternative.bg,
                        'background-image': 'none',
                        'border-color': SPONSOR_BUTTON_COLORS.alternative.bg,
                        'color': SPONSOR_BUTTON_COLORS.alternative.fg,
                    });
                }
                saveTitle(a);
                const tip = sponsorTitle(r, values);
                a.setAttribute('title', tip);
                a.setAttribute('data-igpas-written-title', tip);
            }
        }

        // Instant render (v0.8.0): game content arrives asynchronously (AJAX) after the
        // initial DOM, so waiting for a click plus a 250 ms debounce makes advice late.
        // MutationObserver reacts in the same microtask in which the game commits DOM,
        // before the next paint, with no debounce.
        // Anti-loop: the observer is disconnected during renderAll so our own writes and
        // panel are not recorded, then reconnected. Mutations that still slip through are
        // filtered by relevance, ignoring our UI and advisor-written attributes.
        let renderObserver = null;
        let renderObserving = false;
        const WATCH_SEL = '#carAttributesDisplay, #carAttributes, #carsDesignPoints,' +
            ' #leagueDesignData, #carAttributesBonuses, .carsSuppliers, #repair, .supplyDialog,' +
            ' #engine-table, #chassis-table, #drivers, #staff, #driverStatsTable,' +
            ' #driver-table, #staff-table, #cdTransfersRefresh, #sponsorSignTable, #pageId';
        function observeOff() {
            if (renderObserver && renderObserving) {
                try { renderObserver.disconnect(); } catch {}
                renderObserving = false;
            }
        }
        function observeOn() {
            if (renderObserver || typeof MutationObserver === 'undefined') {
                if (!renderObserver || renderObserving) return;
            } else {
                try { renderObserver = new MutationObserver(onMutations); }
                catch { renderObserver = null; }
                if (!renderObserver) return; // fallback: debounce on click/user action still runs
            }
            if (renderObserving || typeof document === 'undefined' || !document.body) return;
            // The observer is optional; the debounce fallback still runs.
            try {
                renderObserver.observe(document.body,
                    { childList: true, subtree: true, characterData: true, attributes: true });
                renderObserving = true;
            } catch {}
        }
        // Game countdown timers tick every second and do not
        // affect recommendations, so they must not trigger a full DOM walk.
        const COUNTDOWN_SEL = '.countdown, [data-countdown], .raceCountdown, .timer';
        function mutationRelevant(m) {
            if (!m) return false;
            const own = el => !!(el && el.closest && el.closest('.igpas-adv-panel, #' + PREFIX + '-toggle'));
            const t = m.target;
            if (t && t.nodeType === 1 && t.closest && t.closest(COUNTDOWN_SEL)) return false;
            if (m.type === 'attributes' && t && t.nodeType === 1) {
                if (own(t)) return false;
                const an = m.attributeName;
                if (an === 'data-igpas-orig' || an === 'data-igpas-title') return false;
                // Advisor-written titles on marked game elements (Cars rows,
                // Manufacturers rows, Supply cards and headers) are not a game signal.
                if (an === 'title' && t.closest && t.closest('[data-igpas-orig], [data-igpas-title]')) return false;
                if (t === document.body) return false; // our own igpas-adv-hide class
            }
            if (m.type === 'characterData') {
                const p = t && t.parentElement;
                if (!p || own(p)) return false;
                if (p.closest && p.closest(COUNTDOWN_SEL)) return false;
                try { return !!(p.closest && p.closest(WATCH_SEL)); }
                catch { return false; }
            }
            if (t && t.nodeType === 1 && !own(t)) {
                try { if (t.closest && t.closest(WATCH_SEL)) return true; }
                catch {}
            }
            if (m.type === 'childList') {
                const lists = [m.addedNodes, m.removedNodes];
                for (const list of lists) {
                    for (const n of (list || [])) {
                        if (!n || n.nodeType !== 1 || own(n)) continue;
                        try {
                            if (n.matches && n.matches(WATCH_SEL)) return true;
                            if (n.querySelector && n.querySelector(WATCH_SEL)) return true;
                        } catch {}
                    }
                }
            }
            return false;
        }
        function onMutations(muts) {
            for (const m of (muts || [])) {
                let hit = false;
                try { hit = mutationRelevant(m); } catch { hit = false; }
                if (hit) { renderAll(); return; } // synchronous, no debounce
            }
        }

        function renderAll() {
            if (typeof document === 'undefined' || !document.body) return;
            const pid = pageId();
            // The sponsor dialog can open from the Finances page, outside the study
            // page list, so gate on the dialog DOM rather than on pageId.
            const sponsorOpen = !!document.getElementById('sponsorSignTable');
            if (!sponsorOpen && ['cars', 'manufacturers', 'staff', 'transfers'].indexOf(pid) === -1) {
                // Everywhere else: no UI trace at all — the study-only discipline.
                removeIfAny([PREFIX + '-toggle', PREFIX + '-style', PREFIX + '-design',
                    PREFIX + '-supply', PREFIX + '-supply-compare', PREFIX + '-mfg-engine',
                    PREFIX + '-mfg-chassis', PREFIX + '-team', PREFIX + '-team-compare',
                    PREFIX + '-tx-driver', PREFIX + '-tx-staff', PREFIX + '-tx-compare']);
                restoreDesign(); // restore original label text (no new elements)
                restoreRepair(); // restore card titles + condition titles
                restoreSupply(); // restore card cost text + dialog title
                restoreManufacturers(); // restore original row name text
                restoreTeamInPlace(); // restore staff/transfers names + titles
                restoreSponsor(); // restore Sign buttons + title/style
                return;
            }
            observeOff(); // our own writes must not trigger the observer
            removeIfAny([PREFIX + '-style']);
            try {
                restoreDesign();
                restoreRepair();
                restoreSupply();
                restoreManufacturers();
                restoreTeamInPlace();
                restoreSponsor();
                mountDesign();
                mountRepair();
                mountSupply();
                mountManufacturers();
                mountTeam();
                mountTransfers();
                mountSponsor();
            } catch (e) {
                if (typeof console !== 'undefined') console.warn('IGPAS advisor', e); // never break the game page
            }
            removeIfAny([PREFIX + '-toggle']);
            observeOn();
        }

        function start() {
            if (typeof document === 'undefined' || !document.body) return;
            if (start.started) return; // idempotent — safe against double DOMContentLoaded
            start.started = true;
            renderAll();
            observeOn(); // keep the observer attached after the initial render
            // Re-render has two paths: (1) the instant observer when the game DOM changes
            // (0 ms, no debounce); (2) a 250 ms debounce fallback for navigation that does
            // not touch the watched DOM (popstate, hashchange, inter-page clicks).
            let pending = null;
            const schedule = (ev) => {
                // Typing in game fields (chat, search) is not a navigation signal and is skipped,
                // so no keystroke triggers a full DOM walk (7× captures).
                // Enter on a link or button still produces 'click' and still renders.
                if (ev && ev.type === 'keydown') {
                    const ae = document.activeElement;
                    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' ||
                        ae.tagName === 'SELECT' || ae.isContentEditable)) return;
                }
                // Clicks inside our own UI are handled directly (toggle → applyHidden),
                // so a full re-render would add nothing.
                if (ev && ev.type === 'click' && ev.target && typeof ev.target.closest === 'function') {
                    if (ev.target.closest('.igpas-adv-panel, #' + PREFIX + '-toggle')) return;
                }
                if (pending) clearTimeout(pending);
                pending = setTimeout(() => { pending = null; renderAll(); }, 250);
            };
            document.addEventListener('click', schedule, true);
            document.addEventListener('keydown', schedule, true);
            window.addEventListener('popstate', schedule);
            window.addEventListener('hashchange', schedule);
        }

        return { start: start, renderAll: renderAll };
    })();

    // =====================================================================
    // 4) PAGE CAPTURE (v0.7.1) + SURFACE CENSUS — menu-only tools.
    //  - No page UI: Tampermonkey / Violentmonkey menu entries
    //    (GM_registerMenuCommand). Nothing is added to the site, including on
    //    race pages.
    //  - 100% user-triggered, read-only, no network, no storage.
    //  - "DOM capture": copies the page markup with PII redacted, for fixture
    //    mapping of a page the advisor does not know yet.
    //  - "Surface census": copies a structural map of the current page (ids,
    //    form/field shapes, data-* names, row/table/dialog counts, regions) so
    //    the modifiable surface of a mapped page can be planned. Text, values,
    //    credentials and identity are never part of the census.
    // =====================================================================
    const PageCapture = (() => {
        // PII tables: visible blocks, credential attributes, form identity, and
        // the JSON keys fixture mapping never needs.
        const REDACT_SELECTORS = ['#myProfileName', '#balanceText', '#tokens-total', '#managerRankValue'];
        const SENSITIVE_ATTR = /^(data-)?(csrf|token|session|auth|nonce|password|secret|api[-_]?key|sharkid|visitor|tracker|analytics|fingerprint|device)$/i;
        const SENSITIVE_IDENT = /(csrf|token|session|auth|e-?mail|password|username|user(name)?|manager)/i;
        const SENSITIVE_KEY = /(csrf|token|session|auth|nonce|password|secret|api[-_]?key|e-?mail|manager|username)/i;
        const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
        const TOKEN_RE = /\b(?:[A-Fa-f0-9]{32,}|[A-Za-z0-9_-]{40,})\b/g;
        const scrub = s => String(s)
            .replace(EMAIL_RE, '[REDACTED]')
            .replace(TOKEN_RE, '[REDACTED]');
        // Sweep concrete PII values from the live document (manager name, balance,
        // tokens, rank) across the whole capture, including aria-label, alt, src and
        // style that pattern matching cannot recognise. Without this the real name
        // still leaks in avatars and greetings even though #myProfileName is blocked.
        const scrubKnown = (s, pii) => {
            let out = scrub(s);
            for (const v of (pii || [])) {
                if (v && out.indexOf(v) !== -1) out = out.split(v).join('[REDACTED]');
            }
            return out;
        };
        const collectPii = doc => {
            const out = new Set();
            const add = v => {
                const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
                if (s.length >= 3) out.add(s);
            };
            for (const sel of REDACT_SELECTORS) {
                const el = doc.querySelector(sel);
                if (el) add(el.textContent);
            }
            // Nickname or username shown in the profile form.
            for (const el of doc.querySelectorAll(
                'input[name*="nick" i], input[id*="nick" i], input[name*="username" i]')) {
                add(el.value);
            }
            return Array.from(out).sort((a, b) => b.length - a.length);
        };
        // Elements that fixture mapping does not need but that can carry
        // credentials or identity: meta (csrf-token), link/base, template (content
        // invisible to querySelectorAll), iframe/object/embed (srcdoc).
        const DROP_SELECTOR = 'meta, link, base, template, iframe, object, embed';
        // Attribute classification: structural values are safe and important for
        // fixtures; URLs keep their path but lose sensitive parameters, emails and
        // long tokens.
        const KEEP_ATTR = /^(class|id|type|name|for|role|colspan|rowspan|width|height|viewbox|d|fill|stroke|points|transform)$/i;
        // `data-*` variants are included: avatar/profile images are often lazy-loaded
        // through data-src / data-original rather than src.
        const URL_ATTR = /^(href|src|action|formaction|poster|srcset|data-(?:src|href|original|url|bg|background|image))$/i;

        // Keys whose *object* describes a person/account: nested `id`, `name` and
        // `*Id` values under such a path are identity, not game data. The root of the
        // identity bootstrap script is treated as one of these via `identRoot`.
        const IDENTITY_KEY = /^(user|users|manager|managers|account|profile|owner|member|player|bootstrap|identity)$/i;
        const IDENTITY_VALUE_KEY = /^(id|.*[-_]?id|name|nick(name)?|login|handle|e-?mail)$/i;
        function scrubJson(v, depth, ident) {
            const d = depth || 0;
            if (d > 12) return '[REDACTED]';
            if (Array.isArray(v)) return v.map(x => scrubJson(x, d + 1, ident));
            if (v && typeof v === 'object') {
                const out = {};
                for (const k of Object.keys(v)) {
                    const ownIdent = ident || IDENTITY_KEY.test(k);
                    if (SENSITIVE_KEY.test(k) || (ownIdent && IDENTITY_VALUE_KEY.test(k))) {
                        out[k] = '[REDACTED]';
                    } else {
                        out[k] = scrubJson(v[k], d + 1, ownIdent);
                    }
                }
                return out;
            }
            if (typeof v === 'string') return scrub(v);
            return v;
        }

        // Session/credential query parameters. Covers PHP session names (PHPSESSID,
        // jsessionid), short aliases (sid/sess/sessid), verification hashes and the
        // game's manager identity parameters.
        const URL_SECRET_PARAM =
            /(^|[?&])((?:token|csrf|session|sessid|sess|sid|phpsessid|jsessionid|auth|key|api[-_]?key|hash|verif(?:y|ier)?|manager|managerid|e-?mail|username|uid|userid|user_id|account|profile)=)[^&#]*/gi;
        // Avatar, account and profile image paths, wherever they appear in a URL.
        const URL_IDENTITY_PATH = [
            [/(\/img\/user\/)[^/?#]+/gi, '$1[REDACTED]'],
            [/(\/av(?:atar)?\/)[^/?#]+/gi, '$1[REDACTED]'],
            [/(\/pic\/)[^/?#]+/gi, '$1[REDACTED]'],
        ];

        function scrubUrl(value) {
            let v = String(value);
            // Credential and identity parameters. The `(^|[?&])` prefix also catches
            // relative URLs that start with "p=manager&id=..." and have no "?".
            v = v.replace(URL_SECRET_PARAM, '$1$2[REDACTED]');
            // Manager profile context: every `id=` is an account or player identity.
            if (/(^|[?&])(?:p|page)=manager\b/i.test(v)) {
                v = v.replace(/(^|[?&])id=[^&#]*/gi, '$1id=[REDACTED]');
            }
            // Avatar and account paths: /img/user/<id>/... and /av/<id>...
            for (const [re, rep] of URL_IDENTITY_PATH) v = v.replace(re, rep);
            // Email anywhere in the URL.
            v = v.replace(EMAIL_RE, '[REDACTED]');
            // Long token used as a path segment.
            v = v.replace(/([/])[A-Za-z0-9_-]{40,}(?=[/?#]|$)/g, '$1[REDACTED]');
            return v;
        }

        function redact(clone, pii) {
            if (!clone || !clone.querySelectorAll) return clone;
            // 1) Risky elements: executable script, meta/link/base, template and
            //    iframe/object/embed (srcdoc). JSON scripts are kept because fixtures need
            //    them, but their content is filtered in step 5.
            for (const el of Array.from(clone.querySelectorAll('script, ' + DROP_SELECTOR))) {
                if (String(el.tagName || '').toUpperCase() === 'SCRIPT') {
                    const type = String(el.getAttribute('type') || '').toLowerCase();
                    if (!type.includes('json')) el.remove();
                } else {
                    el.remove();
                }
            }
            // 2) Comments can carry internal or identity data (128 = SHOW_COMMENT).
            if (typeof clone.ownerDocument !== 'undefined' && clone.ownerDocument.createTreeWalker) {
                const walker = clone.ownerDocument.createTreeWalker(clone, 128);
                const comments = [];
                while (walker.nextNode()) comments.push(walker.currentNode);
                for (const c of comments) c.remove();
            }
            // 3) Visible PII values.
            for (const sel of REDACT_SELECTORS) {
                const el = clone.querySelector(sel);
                if (el) el.textContent = '[REDACTED]';
            }
            // 4) Form fields. Blanked: every credential/identity field (hidden,
            //    password, email, tel, search and named csrf/user/session), plus any
            //    free-text field that is not a game number — a search or note box can
            //    hold a typed player name. Game number inputs (e.g. #d1AdvancedFuel)
            //    stay intact so the fixture remains usable.
            for (const el of clone.querySelectorAll('input, textarea, select')) {
                const tag = String(el.tagName || '').toUpperCase();
                const type = String(el.getAttribute('type') || '').toLowerCase();
                const ident = [el.getAttribute('id'), el.getAttribute('name'), el.getAttribute('class')]
                    .filter(Boolean).join(' ');
                // Numbers and checkboxes are game data, never identity.
                const numeric = type === 'number' || type === 'range' || type === 'checkbox' ||
                    type === 'radio' || type === 'submit' || type === 'button';
                // A field whose value is purely numeric is a game number even when the
                // game omits `type` (e.g. #d1AdvancedFuel value="32"). A player name or
                // other identity string is not.
                const rawValue = String(el.getAttribute('value') || '').trim();
                const numericValue = rawValue !== '' && Utils.numOrNull(rawValue) != null;
                const sensitive = tag === 'TEXTAREA' || tag === 'SELECT' ||
                    (!numeric && !numericValue) ||
                    type === 'hidden' || type === 'password' || type === 'email' || type === 'tel' ||
                    SENSITIVE_IDENT.test(ident);
                if (!sensitive) continue;
                if (tag === 'TEXTAREA') el.textContent = '[REDACTED]';
                else if (el.hasAttribute('value')) el.setAttribute('value', '[REDACTED]');
                if (el.hasAttribute('data-initialvalue')) el.setAttribute('data-initialvalue', '[REDACTED]');
                // A <select> is usually a game control (tyre compound, setup level, fuel
                // map); its options are game vocabulary and must survive so the fixture
                // stays usable. Only an option whose value looks like an identity/entity
                // id (long digits) or that repeats known PII is blanked.
                for (const opt of el.querySelectorAll('option')) {
                    const optVal = String(opt.getAttribute('value') || '').trim();
                    const optText = String(opt.textContent || '');
                    const identityOption = /^\d{5,}$/.test(optVal) ||
                        (pii || []).some(v => v && optText.indexOf(v) !== -1);
                    if (!identityOption) continue;
                    if (opt.hasAttribute('value')) opt.setAttribute('value', '[REDACTED]');
                    if (optText.trim()) opt.textContent = '[REDACTED]';
                }
            }
            // 5) JSON scripts: redact per key (token, email, manager) without breaking
            //    game numbers. Broken JSON falls back to a raw text sweep.
            for (const s of clone.querySelectorAll('script')) {
                const raw = String(s.textContent || '');
                let out = raw;
                try {
                    const parsed = JSON.parse(raw);
                    // Identity bootstrap script: its top-level `id` is the user/manager id,
                    // not a game id. Treat the whole root as identity context so nested
                    // `id`/`name` values inside it are redacted too.
                    const ident = String(s.id || '') + ' ' + String(s.className || '');
                    const identRoot = /(user|manager|account|profile|bootstrap|identity)/i.test(ident);
                    out = scrubKnown(JSON.stringify(scrubJson(parsed, 0, identRoot)), pii);
                } catch {
                    out = scrubKnown(raw, pii);
                }
                if (out !== raw) s.textContent = out;
            }
            // 6) Attributes: named credentials, then URLs, then pattern scrubbing.
            for (const el of clone.querySelectorAll('*')) {
                for (const attr of Array.from(el.attributes || [])) {
                    const name = attr.name;
                    if (/^srcdoc$/i.test(name)) { el.removeAttribute(name); continue; }
                    // Inline handlers are an execution vector and can carry internal ids or URLs.
                    if (/^on/i.test(name)) { el.removeAttribute(name); continue; }
                    if (SENSITIVE_ATTR.test(name)) { attr.value = '[REDACTED]'; continue; }
                    if (URL_ATTR.test(name)) {
                        const v = scrubUrl(attr.value);
                        if (v !== attr.value) attr.value = v;
                        continue;
                    }
                    // Identity-bearing attributes (title/alt/aria-label/placeholder) fall
                    // through to the scrubKnown() sweep below: known PII values are
                    // removed but the game's own vocabulary ("Soft tyres") survives, so a
                    // captured fixture stays usable for mapping work.
                    if (KEEP_ATTR.test(name)) continue; // structural value, no PII
                    // Attributes holding JSON (data-config and friends): redact per key.
                    const raw = String(attr.value || '');
                    if (/^[[{]/.test(raw.trim())) {
                        try {
                            const v = JSON.stringify(scrubJson(JSON.parse(raw)));
                            if (v !== raw) attr.value = v;
                            continue;
                        } catch {
                            // Not valid JSON: fall through to the pattern scrub below.
                        }
                    }
                    const v = scrubKnown(raw, pii);
                    if (v !== raw) attr.value = v;
                }
            }
            // 6b) Sweep concrete PII values across all attributes, including src, style,
            //     aria-* and alt, which the structural rules skip.
            for (const el of clone.querySelectorAll('*')) {
                for (const attr of Array.from(el.attributes || [])) {
                    const v = scrubKnown(attr.value, pii);
                    if (v !== attr.value) attr.value = v;
                }
            }
            // 7) Final pattern sweep: emails and long token strings in text nodes.
            //    JSON blocks are excluded so strategy data is not corrupted.
            for (const el of clone.querySelectorAll('*')) {
                if (String(el.tagName || '').toUpperCase() === 'SCRIPT') continue;
                for (const nd of Array.from(el.childNodes || [])) {
                    if (nd.nodeType === 3) nd.textContent = scrubKnown(nd.textContent, pii);
                }
            }
            return clone;
        }

        // ---- surface census -------------------------------------------------
        // Structural only: names and counts, never text, values or identity.
        const CENSUS_REGIONS = [
            '#page-wrap', '#page-content', '#page-title-text', '#menuContainer',
            '#carAttributes', '#carAttributesDisplay',
            '#designInline', '#researchInline', '#repair', '.supplyDialog', '#dialogs-container',
            '#driver-table', '#staff-table', '#engine-table', '#chassis-table',
            '#sponsorSignTable', '#hq-container', '#hq-boost-container', '#hq-json',
            '#race', '#setup', '#strategy',
        ];
        const CENSUS_STORAGE = /^igp/i;
        const OWN_DATA_ATTR = /^data-igpas-/;
        // Attributes injected by unrelated browser extensions (translation, password
        // managers, ad tools). They are not part of the game's vocabulary and would
        // otherwise dominate the data-* list on a real session.
        const NOISE_DATA_ATTR =
            /^data-(protonpass-|immersive-translate-|qb-|uwv|darkreader|grammarly|bitwarden|lastpass|onepassword)/i;

        function censusName(name) {
            const s = String(name == null ? '' : name);
            if (!s) return '';
            if (/csrf|token|session|auth|pass|secret/i.test(s)) return '[redacted]';
            return s.length > 24 ? s.slice(0, 24) + '…' : s;
        }
        function censusForm(form) {
            const id = censusName(form.getAttribute('id')) || '(no id)';
            const action = String(form.getAttribute('action') || '');
            const type = (action.match(/(?:^|[?&])type=([A-Za-z0-9_-]+)/) || [])[1] || '';
            const cb = censusName(form.getAttribute('data-callback'));
            const fields = new Map();
            for (const el of form.querySelectorAll('input, select, textarea')) {
                const tag = String(el.tagName || '').toLowerCase();
                const t = String(el.getAttribute('type') || tag).toLowerCase();
                if (t === 'hidden') {
                    fields.set('hidden', (fields.get('hidden') || 0) + 1);
                    continue;
                }
                const name = censusName(el.getAttribute('name'));
                const key = name ? t + ':' + name : t;
                fields.set(key, (fields.get(key) || 0) + 1);
            }
            const list = Array.from(fields.entries()).map(([k, v]) =>
                (v > 1 || k === 'hidden') ? k + '×' + v : k);
            const rows = form.querySelectorAll('.attribute-row').length;
            return '  #' + id + (type ? ' type=' + type : '') + (cb ? ' cb=' + cb : '') +
                (rows ? ' rows=' + rows : '') +
                ' fields: ' + (list.length ? list.join(', ') : '(none)');
        }
        function censusDataAttrs(doc) {
            const m = new Map();
            for (const el of doc.querySelectorAll('*')) {
                for (const a of Array.from(el.attributes || [])) {
                    const n = String(a.name || '');
                    if (n.indexOf('data-') !== 0 || OWN_DATA_ATTR.test(n) ||
                        NOISE_DATA_ATTR.test(n)) continue;
                    m.set(n, (m.get(n) || 0) + 1);
                }
            }
            return Array.from(m.entries())
                .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
                .slice(0, 25)
                .map(([n, c]) => n + '×' + c);
        }
        // Embedded JSON payloads: page data the userscript can read without any
        // request. Only the key names and sizes are reported — never the values.
        function censusJson(doc) {
            const out = [];
            for (const s of doc.querySelectorAll('script[type="application/json"]')) {
                const id = censusName(s.getAttribute('id')) || '(no id)';
                const raw = String(s.textContent || '').trim();
                let parsed = null;
                try { parsed = JSON.parse(raw); } catch { parsed = null; }
                if (parsed === null) {
                    out.push('  #' + id + ' bytes=' + raw.length + ' unparsed');
                    continue;
                }
                const isArr = Array.isArray(parsed);
                const first = isArr ? parsed[0] : parsed;
                const keys = first && typeof first === 'object' ? Object.keys(first) : [];
                out.push('  #' + id + ' bytes=' + raw.length +
                    (isArr ? ' items=' + parsed.length : '') +
                    ' keys=' + (keys.length ? keys.slice(0, 20).join(', ') : '(none)'));
            }
            return out;
        }
        function censusTables(doc) {
            const out = [];
            for (const t of doc.querySelectorAll('table')) {
                const id = censusName(t.getAttribute('id'));
                if (!id) continue;
                const rows = t.querySelectorAll('tr').length;
                const flags = [];
                if (t.hasAttribute('data-sort')) flags.push('sort');
                if (t.hasAttribute('data-searchable')) flags.push('searchable');
                out.push('  #' + id + ' rows=' + rows + (flags.length ? ' ' + flags.join(' ') : ''));
            }
            return out;
        }
        function censusUrl(loc) {
            if (!loc) return '';
            const parts = [];
            try {
                const q = new URLSearchParams(String(loc.search || ''));
                for (const k of ['p', 'page', 'tab', 'type']) {
                    if (q.has(k)) parts.push(k + '=' + censusName(q.get(k)));
                }
            } catch {}
            const path = scrub(String(loc.pathname || ''));
            return path + (parts.length ? '?' + parts.join('&') : '');
        }
        function censusStorage(win) {
            const out = [];
            try {
                const ls = win && win.localStorage;
                if (!ls) return out;
                for (let i = 0; i < ls.length && out.length < 12; i++) {
                    const k = ls.key(i);
                    if (k && CENSUS_STORAGE.test(k) && !/token|session|auth/i.test(k)) {
                        out.push(censusName(k));
                    }
                }
            } catch {}
            return out;
        }
        function buildCensus(doc, loc, win) {
            if (!doc || !doc.documentElement) return null;
            const pageIdEl = doc.getElementById('pageId');
            const pageId = pageIdEl ? String(pageIdEl.value || '') : '';
            const titleEl = doc.getElementById('page-title-text');
            const title = titleEl
                ? String(titleEl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)
                : '';
            const lines = [];
            lines.push('I.G.P.A.S surface census — v' + VERSION);
            lines.push('host: ' + String((loc && loc.hostname) || '') + '  url: ' + censusUrl(loc));
            lines.push('page: ' + (pageId || '(unknown)') + (title ? ' — ' + title : ''));
            // Regions the advisor can attach to, and the ones this page lacks.
            const present = [];
            const absent = [];
            for (const sel of CENSUS_REGIONS) {
                let el = null;
                try { el = doc.querySelector(sel); } catch { el = null; }
                if (!el) { absent.push(sel); continue; }
                present.push('  ' + sel + ' children=' + (el.children ? el.children.length : 0));
            }
            lines.push('', 'regions present (' + present.length + '):', ...present);
            if (absent.length) lines.push('regions absent: ' + absent.join(', '));
            // Forms: the write surface of the page (type + callback + field shape).
            const forms = Array.from(doc.querySelectorAll('form'));
            lines.push('', 'forms (' + forms.length + '):');
            if (forms.length) for (const f of forms) lines.push(censusForm(f));
            else lines.push('  (none)');
            // Attribute-row lists (Cars / Repair pattern).
            const rowCounts = [];
            for (const sel of ['#carAttributesDisplay', '#designInline', '#researchInline', '#repair']) {
                const el = doc.querySelector(sel);
                if (!el) continue;
                const n = el.querySelectorAll('.attribute-row').length;
                if (n) rowCounts.push(sel + '=' + n);
            }
            if (rowCounts.length) lines.push('', 'attribute rows: ' + rowCounts.join(' '));
            // Tables and their built-in affordances.
            const tables = censusTables(doc);
            lines.push('', 'tables (' + tables.length + '):');
            if (tables.length) lines.push(...tables);
            else lines.push('  (none)');
            // Embedded data (HQ map, and any page that ships its state as JSON).
            const json = censusJson(doc);
            if (json.length) lines.push('', 'embedded json (' + json.length + '):', ...json);
            // Dialogs: what is open and how many stacked layers exist.
            const dc = doc.getElementById('dialogs-container');
            lines.push('', 'dialogs: container' + (dc ? ' children=' + dc.children.length : ' absent') +
                ' dialogId=' + (doc.getElementById('dialogId') ? 'present' : 'absent'));
            // data-* vocabulary: the page's own machine-readable hooks.
            const dataAttrs = censusDataAttrs(doc);
            lines.push('', 'data-* attributes (' + dataAttrs.length + '): ' +
                (dataAttrs.length ? dataAttrs.join(', ') : '(none)'));
            const store = censusStorage(win);
            if (store.length) lines.push('', 'game storage keys: ' + store.join(', '));
            lines.push('', 'counts: buttons=' +
                doc.querySelectorAll('button, .btn, .btn2, [role="button"]').length +
                ' links=' + doc.querySelectorAll('a[href]').length +
                ' inputs=' + doc.querySelectorAll('input, select, textarea').length +
                ' tables=' + doc.querySelectorAll('table').length +
                ' rows=' + doc.querySelectorAll('.attribute-row, tbody tr').length);
            lines.push('', 'not captured by design: text, values, CSRF, profile identity.');
            return scrubKnown(lines.join('\n'), collectPii(doc));
        }

        function buildCapture(doc) {
            if (!doc || !doc.documentElement) return null;
            const pii = collectPii(doc);
            const clone = redact(doc.documentElement.cloneNode(true), pii);
            return '<!doctype html>\n<html>' + clone.innerHTML + '</html>';
        }
        function install() {
            if (typeof document === 'undefined') return;
            if (typeof GM_registerMenuCommand !== 'function' || typeof GM_setClipboard !== 'function') return;
            GM_registerMenuCommand('I.G.P.A.S: copy this page\'s DOM capture (fixture mapping)', () => {
                const html = buildCapture(document);
                if (!html) return;
                GM_setClipboard(html, 'text/html');
                if (typeof GM_notification === 'function') {
                    GM_notification({
                        title: 'I.G.P.A.S v' + VERSION + ' — capture',
                        text: 'Page DOM (PII redacted) copied to clipboard. Paste & send it for fixture mapping.',
                    });
                }
            });
            GM_registerMenuCommand('I.G.P.A.S: copy surface census (read-only map)', () => {
                const census = buildCensus(document, typeof location === 'undefined' ? null : location,
                    typeof window === 'undefined' ? null : window);
                if (!census) return;
                GM_setClipboard(census, 'text/plain');
                if (typeof GM_notification === 'function') {
                    GM_notification({
                        title: 'I.G.P.A.S v' + VERSION + ' — census',
                        text: 'Surface census copied (ids, forms, data-* only — no text, values or identity).',
                    });
                }
            });
        }
        return { buildCapture: buildCapture, buildCensus: buildCensus, install: install };
    })();

    // =====================================================================
    // 5) BOOT — read-only advisor on iGP tabs, plus the capture menu.
    // =====================================================================

    function boot() {
        if (typeof document === 'undefined') return; // lingkungan non-browser (tes)

        const isIgpHost = () => {
            if (typeof location === 'undefined') return false;
            const h = String(location.hostname || '').toLowerCase();
            return h === 'igpmanager.com' || h.endsWith('.igpmanager.com');
        };

        const startUi = () => {
            if (!isIgpHost()) return;
            // In-page read-only advisor: text and titles on original elements only.
            // The live Race tab (#race) is never written to.
            if (typeof Advisor !== 'undefined') Advisor.start();
            // Tampermonkey menu: copy a DOM capture with PII redacted. No page UI.
            if (typeof PageCapture !== 'undefined') PageCapture.install();
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', startUi);
        } else {
            startUi();
        }
    }

    boot();

    // Exports for the Node tests. No effect in the browser, where module is undefined.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { IGPCore, Utils, Advisor, PageCapture, VERSION: VERSION };
    }
})();
