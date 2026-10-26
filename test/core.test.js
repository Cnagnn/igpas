"use strict";

const assert = require("assert");
const { IGPCore, Utils } = require("../src/igpas.user.js");

let n = 0;
function t(name, fn) {
  fn();
  n++;
  console.log("  ✓ " + name);
}

console.log("IGPCore unit tests");

/* ---------- designPriority (v0.7.0 advisor heuristik) ---------- */

t("designPriority: largest gap prioritized, share % proportional", () => {
  const r = IGPCore.designPriority({
    attrs: {
      acceleration: { label: "Acceleration", val: 120 },
      handling: { label: "Handling", val: 280 },
      cooling: { label: "Cooling", val: 250 },
    },
    best: {
      acceleration: { max: 300 }, // gap 180
      handling: { max: 300 }, // gap 20
      cooling: { max: 260 }, // gap 10
    },
    designPoints: 200,
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.values.ranked[0].key, "acceleration"); // largest gap
  assert.strictEqual(r.values.totalGap, 210); // 180 + 20 + 10
  const shares = r.values.ranked.map(x => x.sharePct);
  assert.strictEqual(r.values.ranked[0].sharePct, Math.round((180 / 210) * 1000) / 10);
  assert.deepStrictEqual(shares, [85.7, 9.5, 4.8]);
  assert.strictEqual(r.values.designPoints, 200);
  assert.strictEqual(r.values.unbenchmarked, 0);
});

t("designPriority: attribute already >= league max -> no advice, honest ok:false", () => {
  const r = IGPCore.designPriority({
    attrs: { a: { label: "A", val: 320 } },
    best: { a: { max: 300 } },
  });
  assert.strictEqual(r.ok, false); // no gap: nothing proposed
  assert.match(r.error, /gap/i);
});

t("designPriority: no league benchmark → fail honestly", () => {
  const r = IGPCore.designPriority({ attrs: { a: { label: "A", val: 100 } }, best: {} });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /gap/i);
});

t("designPriority: empty attributes → error", () => {
  assert.strictEqual(IGPCore.designPriority({ attrs: {} }).ok, false);
  assert.strictEqual(IGPCore.designPriority({}).ok, false);
});

t("designPriority: attributes without max still listed as unbenchmarked", () => {
  const r = IGPCore.designPriority({
    attrs: {
      a: { label: "A", val: 100 }, // has benchmark
      b: { label: "B", val: 50 }, // without benchmark
    },
    best: { a: { max: 200 } },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.values.ranked.length, 1); // only those with a gap
  assert.strictEqual(r.values.unbenchmarked, 1);
  assert.strictEqual(r.values.ranked[0].sharePct, 100);
});

/* ---------- rankSuppliers (v0.7.0 advisor heuristik) ---------- */

t("rankSuppliers: value/cost (per 1M) determines order, not raw value", () => {
  const r = IGPCore.rankSuppliers({
    items: [
      { supplierId: 11, costPerRace: 1000000, bonuses: [{ stat: "handling", value: 5 }] }, // 5/1M
      { supplierId: 12, costPerRace: 500000, bonuses: [{ stat: "handling", value: 3 }] }, // 6/1M
    ],
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.values.ranked[0].id, 12); // 6 per 1M > 5 per 1M
  assert.strictEqual(r.values.bestValueId, 12);
  assert.strictEqual(r.values.cheapestId, 12);
  assert.strictEqual(r.values.ranked[0].valuePerCost, 6);
});

t("rankSuppliers: negative bonus lowers value; no cost cannot win on value", () => {
  const r = IGPCore.rankSuppliers({
    items: [
      {
        supplierId: 21,
        costPerRace: 300000,
        bonuses: [
          { stat: "tyre", value: -2 },
          { stat: "power", value: 4 },
        ],
      }, // Σ2 -> 6.67/1M
      { supplierId: 22, costPerRace: null, bonuses: [{ stat: "power", value: 9 }] }, // no cost
    ],
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.values.withoutCost, 1);
  // A supplier without a cost cannot be scored on "value/cost" — honestly placed after
  // the measurable ones, not crowned just because Σ bonus is large.
  assert.strictEqual(r.values.ranked[0].id, 21);
  assert.strictEqual(r.values.ranked[0].valuePerCost, 6.67);
  const last = r.values.ranked[r.values.ranked.length - 1];
  assert.strictEqual(last.id, 22);
  assert.strictEqual(last.value, 9);
  assert.strictEqual(last.valuePerCost, null);
});

t("rankSuppliers: empty → error", () => {
  assert.strictEqual(IGPCore.rankSuppliers({ items: [] }).ok, false);
  assert.strictEqual(IGPCore.rankSuppliers({}).ok, false);
});

/* ---------- rankManufacturerItems (v0.7.0 advisor heuristik) ---------- */

t("rankManufacturerItems: engine — rating descending, efficiency as tiebreak", () => {
  const r = IGPCore.rankManufacturerItems({
    items: [
      { id: 1, name: "A", ratingPct: 80, costPerRace: 1000000 },
      { id: 2, name: "B", ratingPct: 80, costPerRace: 500000 },
      { id: 3, name: "C", ratingPct: 90, costPerRace: 5000000 },
    ],
    withCost: true,
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.values.bestRatingId, 3);
  assert.strictEqual(r.values.ranked[0].id, 3);
  assert.strictEqual(r.values.bestValueId, 2); // 80% at half the cost
});

t("rankManufacturerItems: chassis — rating only, rows without rating counted as noData", () => {
  const r = IGPCore.rankManufacturerItems({
    items: [
      { id: 5, name: "X", ratingPct: 40 },
      { id: 6, name: "Y", ratingPct: null },
      { id: 7, name: "Z", ratingPct: 55 },
    ],
    withCost: false,
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.values.ranked.length, 2);
  assert.strictEqual(r.values.ranked[0].id, 7);
  assert.strictEqual(r.values.noData, 1);
});

t("rankManufacturerItems: all ratings empty → honest error", () => {
  const r = IGPCore.rankManufacturerItems({
    items: [{ id: 1, name: "A", ratingPct: null }],
    withCost: false,
  });
  assert.strictEqual(r.ok, false);
});

/* ---------- rankSponsors (v0.11.0 advisor, Sponsor dialog) ---------- */

// Real numbers from the Secondary sponsor dialog (16 offers, subset of 4).
// Income & bonus are both PER RACE; bonus only when the objective is met.
const SPONSOR_OFFERS = [
  { eId: 2, income: 171000, bonus: 1800000 },
  { eId: 5, income: 428000, bonus: 1500000 },
  { eId: 17, income: 1500000, bonus: 306000 },
  { eId: 19, income: 1600000, bonus: 102000 },
];

t("rankSponsors cash: ranking by income (guarantee), cash bonus becomes the alternative", () => {
  const r = IGPCore.rankSponsors({ offers: SPONSOR_OFFERS, termRaces: 5 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.values.incomeKind, "cash");
  assert.deepStrictEqual(
    r.values.ranked.map(x => x.eId),
    ["19", "17", "5", "2"]
  );
  assert.strictEqual(r.values.bestEId, "19"); // highest income = guarantee
  assert.strictEqual(r.values.bestGuaranteeEId, "19");
  assert.strictEqual(r.values.bestBonusEId, "2"); // 1.8m/race
  assert.strictEqual(r.values.bestPotentialEId, "2"); // 171k + 1.8m = 1.971m/race
  assert.strictEqual(r.values.alternativeEId, "2"); // trade-off bonus vs income
  assert.strictEqual(r.values.termRaces, 5);
  assert.strictEqual(r.values.breakEvenP, 0.84); // 84% objective rate for eId2 to win
  const top = r.values.ranked[0];
  assert.strictEqual(top.income, 1600000);
  assert.strictEqual(top.guaranteeTotal, 8000000); // 1.6m × 5
  assert.strictEqual(top.potentialTotal, 8510000); // (1.6m + 102k) × 5
  assert.strictEqual(top.bonus, 102000);
  assert.strictEqual(r.values.ranked[3].guaranteeTotal, 855000); // 171k × 5
  assert.strictEqual(r.values.ranked[3].potentialTotal, 9855000); // 1.971m × 5
});

t("rankSponsors cash: term does not change ranking (bonus per race), totals follow term", () => {
  const r1 = IGPCore.rankSponsors({ offers: SPONSOR_OFFERS, termRaces: 1 });
  const r5 = IGPCore.rankSponsors({ offers: SPONSOR_OFFERS, termRaces: 5 });
  assert.deepStrictEqual(
    r1.values.ranked.map(x => x.eId),
    ["19", "17", "5", "2"]
  );
  assert.deepStrictEqual(
    r5.values.ranked.map(x => x.eId),
    ["19", "17", "5", "2"]
  );
  assert.strictEqual(r1.values.ranked[0].guaranteeTotal, 1600000);
  assert.strictEqual(r5.values.ranked[0].guaranteeTotal, 8000000);
  assert.strictEqual(r1.values.breakEvenP, 0.84); // per race, not per contract
});

t("rankSponsors cash: term not read → totals null, ranking & break-even stay honest", () => {
  const r = IGPCore.rankSponsors({ offers: SPONSOR_OFFERS, termRaces: null });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.values.termRaces, null);
  assert.deepStrictEqual(
    r.values.ranked.map(x => x.eId),
    ["19", "17", "5", "2"]
  );
  assert.strictEqual(r.values.ranked[0].guaranteeTotal, null);
  assert.strictEqual(r.values.ranked[0].potentialTotal, null);
  assert.strictEqual(r.values.bestEId, "19");
  assert.strictEqual(r.values.alternativeEId, "2");
  assert.strictEqual(r.values.breakEvenP, 0.84);
});

t("rankSponsors cash: empty/zero income skipped, all empty → honest error", () => {
  const r = IGPCore.rankSponsors({
    offers: [
      ...SPONSOR_OFFERS,
      { eId: 99, income: null, bonus: 5000000 },
      { eId: 98, income: 0, bonus: 1 },
    ],
    termRaces: 5,
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.values.ranked.length, 4);
  assert.strictEqual(r.values.unreadable, 2);
  assert.strictEqual(IGPCore.rankSponsors({ offers: [{ eId: 1, income: null }] }).ok, false);
  assert.strictEqual(IGPCore.rankSponsors({}).ok, false);
});

t("rankSponsors cash: income tie → higher potential (bonus) wins", () => {
  const r = IGPCore.rankSponsors({
    offers: [
      { eId: 1, income: 100000, bonus: 900000 },
      { eId: 2, income: 100000, bonus: 700000 },
    ],
    termRaces: 2,
  });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(
    r.values.ranked.map(x => x.eId),
    ["1", "2"]
  );
  assert.strictEqual(r.values.bestEId, "1");
  assert.strictEqual(r.values.alternativeEId, null); // same income → #1 already has the best potential
  assert.strictEqual(r.values.breakEvenP, null); // no income trade-off
});

// Primary sponsor: TOKEN income, cash bonus — never mixed.
const PRIMARY_EIDS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 19];
const PRIMARY_TOKENS = [1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3];
const PRIMARY_BONUS = [
  1800000, 1700000, 1600000, 1500000, 1400000, 1300000, 1200000, 1100000, 1000000, 918000, 816000,
  714000, 612000, 510000, 306000, 102000,
];
const PRIMARY_OFFERS = PRIMARY_EIDS.map((eId, i) => ({
  eId: eId,
  tokens: PRIMARY_TOKENS[i],
  bonus: PRIMARY_BONUS[i],
}));

t("rankSponsors token: tokens first, cash bonus as tie-break, no mixed totals", () => {
  const r = IGPCore.rankSponsors({ offers: PRIMARY_OFFERS, termRaces: 5, incomeKind: "token" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.values.incomeKind, "token");
  assert.strictEqual(r.values.bestEId, "14"); // 3 tokens, bonus 612k (highest in the 3-token group)
  assert.strictEqual(r.values.bestBonusEId, "2"); // 1.8m cash
  assert.strictEqual(r.values.alternativeEId, "2"); // trade-off: highest cash bonus
  assert.strictEqual(r.values.bestGuaranteeEId, null); // "cash guarantee" does not apply
  assert.strictEqual(r.values.bestPotentialEId, null); // not a cash axis
  assert.strictEqual(r.values.breakEvenP, null); // tokens vs cash are not compared
  const top = r.values.ranked[0];
  assert.strictEqual(top.tokens, 3);
  assert.strictEqual(top.guaranteeTotal, null);
  assert.strictEqual(top.potentialTotal, null); // token × term + cash are NOT summed
  assert.deepStrictEqual(
    r.values.ranked.slice(0, 4).map(x => x.eId),
    ["14", "15", "17", "19"]
  );
  assert.deepStrictEqual(
    r.values.ranked.slice(4, 7).map(x => x.eId),
    ["5", "6", "7"]
  );
  assert.deepStrictEqual(
    r.values.ranked.slice(-3).map(x => x.eId),
    ["2", "3", "4"]
  );
});

t("rankSponsors token: empty/zero tokens skipped, all empty → honest error", () => {
  const r = IGPCore.rankSponsors({
    offers: [
      { eId: 1, tokens: 0, bonus: 900000 },
      { eId: 2, tokens: null, bonus: 800000 },
      { eId: 3, tokens: 2, bonus: 700000 },
    ],
    incomeKind: "token",
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.values.ranked.length, 1);
  assert.strictEqual(r.values.unreadable, 2);
  assert.strictEqual(
    IGPCore.rankSponsors({ offers: [{ eId: 1, tokens: null }], incomeKind: "token" }).ok,
    false
  );
});

/* ---------- decision comparison (v0.8.0) ---------- */

t('numberVerdict: upward direction, "same" tolerance, empty side = unknown', () => {
  assert.strictEqual(IGPCore.numberVerdict(60, 54).verdict, "better");
  assert.strictEqual(IGPCore.numberVerdict(50, 54).verdict, "worse");
  assert.strictEqual(IGPCore.numberVerdict(54, 54).verdict, "equal");
  // 1% difference is still within the default 2% tolerance → equal
  assert.strictEqual(IGPCore.numberVerdict(54.5, 54).verdict, "equal");
  // 5% → outside tolerance
  assert.strictEqual(IGPCore.numberVerdict(57, 54).verdict, "better");
  // empty sides are never invented into numbers
  assert.strictEqual(IGPCore.numberVerdict(null, 54).verdict, "unknown");
  assert.strictEqual(IGPCore.numberVerdict(54, "").verdict, "unknown");
  assert.strictEqual(IGPCore.numberVerdict(undefined, null).verdict, "unknown");
});

t("numberVerdict: lowerIsBetter for cost (down = better)", () => {
  assert.strictEqual(
    IGPCore.numberVerdict(40000, 49000, { lowerIsBetter: true }).verdict,
    "better"
  );
  assert.strictEqual(IGPCore.numberVerdict(60000, 49000, { lowerIsBetter: true }).verdict, "worse");
  assert.strictEqual(IGPCore.numberVerdict(49000, 49000, { lowerIsBetter: true }).verdict, "equal");
  const d = IGPCore.numberVerdict(60, 54);
  assert.strictEqual(d.delta, 6);
  assert.strictEqual(d.pct, 11.1);
});

t("numberVerdict: zero on the comparison side — no blow-up, delta speaks", () => {
  assert.strictEqual(IGPCore.numberVerdict(0, 0).verdict, "equal");
  assert.strictEqual(IGPCore.numberVerdict(5, 0).verdict, "better");
  assert.strictEqual(IGPCore.numberVerdict(5, 0).pct, null); // base 0 → percentage is meaningless
});

t("compareSuppliers: active supplier vs best/cheapest in the same dialog", () => {
  const r = IGPCore.compareSuppliers({
    current: {
      supplierId: 2,
      costPerRace: 500000,
      bonuses: [
        { stat: "Braking", value: 10 },
        { stat: "Fuel economy", value: -6 },
      ],
    },
    alternatives: [
      { eId: 1, supplierId: 1, costPerRace: 350000, bonuses: [{ stat: "Tyre economy", value: 5 }] },
      {
        eId: 3,
        supplierId: 3,
        costPerRace: 500000,
        bonuses: [
          { stat: "Acceleration", value: 10 },
          { stat: "Fuel economy", value: -6 },
        ],
      },
      {
        eId: 6,
        supplierId: 6,
        costPerRace: 400000,
        bonuses: [
          { stat: "Fuel economy", value: 10 },
          { stat: "Acceleration", value: -4 },
        ],
      },
    ],
  });
  assert.strictEqual(r.ok, true);
  const v = r.values;
  assert.strictEqual(v.current.bonus, 4); // 10 + (−6)
  assert.strictEqual(v.bestBonus.value, 6); // supplier 6: 10 + (−4)
  assert.strictEqual(v.bestBonus.id, 6);
  assert.strictEqual(v.cheapest.value, 350000);
  assert.strictEqual(v.cheapest.id, 1);
  assert.strictEqual(v.bonus.verdict, "worse"); // 4 < 6
  assert.strictEqual(v.cost.verdict, "worse"); // 500k > 350k
  assert.strictEqual(v.basis, "bonus"); // bonus axis used for the final verdict
});

t("compareSuppliers: empty alternatives / active not read → honest error", () => {
  assert.strictEqual(
    IGPCore.compareSuppliers({ current: { supplierId: 2 }, alternatives: [] }).ok,
    false
  );
  assert.strictEqual(IGPCore.compareSuppliers({ alternatives: [{ eId: 1 }] }).ok, false);
});

/* ---------- statIndex / roleCode (v0.8.0, adapter helpers) ---------- */

t("statIndex: average of 12 CSV numbers; short CSV → null (not invented)", () => {
  assert.strictEqual(Utils.statIndex("10,10,10,10,10,10,10,10,10,10,10,10,99,1,2"), 10);
  assert.strictEqual(Utils.statIndex("1,2,3,4,5,6,7,8,9,10,11,12"), 6.5);
  assert.strictEqual(Utils.statIndex("40,40,40,40,54"), null); // only 5 numbers (staff data)
  assert.strictEqual(Utils.statIndex(""), null);
  assert.strictEqual(Utils.statIndex(null), null);
});

t("roleCode: role labels & codes normalized so roster/market are comparable", () => {
  assert.strictEqual(Utils.roleCode("Chief Designer"), "CD");
  assert.strictEqual(Utils.roleCode("CD"), "CD");
  assert.strictEqual(Utils.roleCode("Technical Director"), "TD");
  assert.strictEqual(Utils.roleCode("Doctor"), "DR");
  assert.strictEqual(Utils.roleCode("DR"), "DR");
  assert.strictEqual(Utils.roleCode(""), null);
});

/* ---------- v0.8.4 regression: null is not 0 (honest calculator) ---------- */

t("numOrNull: blank whitespace → null; the number 0 stays 0", () => {
  assert.strictEqual(Utils.numOrNull("   "), null);
  assert.strictEqual(Utils.numOrNull(""), null);
  assert.strictEqual(Utils.numOrNull(null), null);
  assert.strictEqual(Utils.numOrNull(" 0 "), 0);
  assert.strictEqual(Utils.numOrNull(0), 0);
});

t("designPriority: designPoints null → null (not 0 DP)", () => {
  const r = IGPCore.designPriority({
    attrs: { a: { val: 10 } },
    best: { a: { max: 20 } },
    designPoints: null,
  });
  assert.strictEqual(r.values.designPoints, null);
  const z = IGPCore.designPriority({
    attrs: { a: { val: 10 } },
    best: { a: { max: 20 } },
    designPoints: 0,
  });
  assert.strictEqual(z.values.designPoints, 0);
});

t("repairAdvice: parts 30% fix now, engine 62% defer replace", () => {
  const r = IGPCore.repairAdvice({
    condition: "30",
    engine: "62",
    partCost: "6",
    engineCost: "1",
    partsStock: "51",
    engineStock: "40",
    restockRaces: "15",
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.values.parts.value, 30);
  assert.strictEqual(r.values.parts.status, "now");
  assert.strictEqual(r.values.parts.cost, 6);
  assert.strictEqual(r.values.parts.stock, 51);
  assert.strictEqual(r.values.parts.enough, true);
  assert.strictEqual(r.values.engine.value, 62);
  assert.strictEqual(r.values.engine.status, "hold");
  assert.strictEqual(r.values.engine.enough, true);
  assert.strictEqual(r.values.restockRaces, 15);
  assert.deepStrictEqual(r.values.thresholds, { now: 50, soon: 60 });
});

t("repairAdvice: 50/60 threshold boundaries and low stock", () => {
  const at = v => IGPCore.repairAdvice({ condition: v, partsStock: 10, partCost: 6 }).values.parts;
  assert.strictEqual(at(50).status, "now");
  assert.strictEqual(at(51).status, "soon");
  assert.strictEqual(at(60).status, "soon");
  assert.strictEqual(at(61).status, "hold");
  const short = IGPCore.repairAdvice({
    condition: 30,
    partCost: 6,
    partsStock: 5,
  }).values.parts;
  assert.strictEqual(short.enough, false);
});

t("repairAdvice: unreadable data is not invented", () => {
  assert.strictEqual(IGPCore.repairAdvice({}).ok, false);
  assert.strictEqual(IGPCore.repairAdvice({ condition: 101 }).ok, false);
  const r = IGPCore.repairAdvice({ condition: 30, engine: null });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.values.engine.value, null);
  assert.strictEqual(r.values.engine.status, "unknown");
  assert.strictEqual(r.values.engine.enough, null);
  assert.strictEqual(r.values.parts.enough, null); // cost & stock not read
});

console.log("\nAll " + n + " tests passed ✔");
