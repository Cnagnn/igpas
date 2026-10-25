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

/* ---------- calcFuel ---------- */

t("calcFuel: basic case", () => {
  const r = IGPCore.calcFuel({
    lapsRemaining: 20,
    fuelPerLap: 1.2,
    currentFuel: 10,
    reserveLaps: 1,
    tankCapacity: "",
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.values.fuelNeeded, 24); // 20 * 1.2
  assert.strictEqual(r.values.fuelToAdd, 15.2); // 24 + 1.2 - 10
  assert.strictEqual(r.values.lapsLeftOnFuel, 8.3); // 10 / 1.2 = 8.333 -> 8.3
});

t("calcFuel: no reserve", () => {
  const r = IGPCore.calcFuel({ lapsRemaining: 10, fuelPerLap: 2, currentFuel: 20, reserveLaps: 0 });
  assert.strictEqual(r.values.fuelToAdd, 0); // 20 needed, 20 available
  assert.strictEqual(r.values.lapsLeftOnFuel, 10);
});

t("calcFuel: half-lap reserve", () => {
  const r = IGPCore.calcFuel({
    lapsRemaining: 10,
    fuelPerLap: 2,
    currentFuel: 20,
    reserveLaps: 0.5,
  });
  assert.strictEqual(r.values.fuelToAdd, 1); // 20 + 1 - 20
});

t("calcFuel: over-capacity detection", () => {
  const r = IGPCore.calcFuel({
    lapsRemaining: 20,
    fuelPerLap: 1.2,
    currentFuel: 0,
    reserveLaps: 1,
    tankCapacity: 20,
  });
  assert.strictEqual(r.values.overCapacity, 5.2); // 25.2 total vs tank 20
  assert.ok(r.rows.some(row => String(row[0]).includes("⚠")));
});

t("calcFuel: invalid input → ok:false", () => {
  assert.strictEqual(
    IGPCore.calcFuel({ lapsRemaining: 5, fuelPerLap: 0, currentFuel: 1 }).ok,
    false
  );
  assert.strictEqual(
    IGPCore.calcFuel({ lapsRemaining: -1, fuelPerLap: 1, currentFuel: 1 }).ok,
    false
  );
  assert.strictEqual(
    IGPCore.calcFuel({ lapsRemaining: 5, fuelPerLap: 1, currentFuel: -3 }).ok,
    false
  );
});

/* ---------- projectTireWear ---------- */

t("projectTireWear: monotonic and capped at 100%", () => {
  const r = IGPCore.projectTireWear({ currentWearPct: 50, wearPerLapPct: 6, lapsCount: 10 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.rows.length, 11); // 0..10
  assert.strictEqual(r.rows[2][1], "62 %");
  const last = r.rows[r.rows.length - 1][1];
  assert.strictEqual(last, "100 %"); // 50+60 → cap
});

t("projectTireWear: wear 0 → constant", () => {
  const r = IGPCore.projectTireWear({ currentWearPct: 10, wearPerLapPct: 0, lapsCount: 5 });
  assert.strictEqual(r.rows[5][1], "10 %");
});

t("projectTireWear: invalid input", () => {
  assert.strictEqual(
    IGPCore.projectTireWear({ currentWearPct: 120, wearPerLapPct: 1, lapsCount: 5 }).ok,
    false
  );
  assert.strictEqual(
    IGPCore.projectTireWear({ currentWearPct: 10, wearPerLapPct: -1, lapsCount: 5 }).ok,
    false
  );
  assert.strictEqual(
    IGPCore.projectTireWear({ currentWearPct: 10, wearPerLapPct: 1, lapsCount: 0 }).ok,
    false
  );
});

/* ---------- lapsToThreshold ---------- */

t("lapsToThreshold: correct floor", () => {
  const r = IGPCore.lapsToThreshold({ currentWearPct: 20, wearPerLapPct: 3, thresholdPct: 80 });
  assert.strictEqual(r.values.laps, 20); // floor(60/3)
});

t("lapsToThreshold: floor rounds down on fractions", () => {
  const r = IGPCore.lapsToThreshold({ currentWearPct: 20, wearPerLapPct: 4, thresholdPct: 80 });
  assert.strictEqual(r.values.laps, 15);
});

t("lapsToThreshold: wear 0 → Infinity", () => {
  const r = IGPCore.lapsToThreshold({ currentWearPct: 10, wearPerLapPct: 0, thresholdPct: 80 });
  assert.strictEqual(r.values.laps, Infinity);
  assert.ok(r.rows[0][1].includes("∞"));
});

t("lapsToThreshold: threshold <= current wear → error", () => {
  assert.strictEqual(
    IGPCore.lapsToThreshold({ currentWearPct: 80, wearPerLapPct: 2, thresholdPct: 80 }).ok,
    false
  );
});

/* ---------- pitWindow ---------- */

t("pitWindow: fuel is the limit", () => {
  const r = IGPCore.pitWindow({ lapsLeftOnFuel: 9.5, reserveLaps: 1, tireLaps: 30, marginLaps: 2 });
  assert.strictEqual(r.values.fuelLatest, 8); // floor(9.5-1)
  assert.strictEqual(r.values.latest, 8); // min(8, 30)
  assert.strictEqual(r.values.recommended, 6);
  assert.strictEqual(r.rows[0][1], "8 laps");
});

t("pitWindow: tyre is the limit", () => {
  const r = IGPCore.pitWindow({ lapsLeftOnFuel: 50, reserveLaps: 1, tireLaps: 12, marginLaps: 0 });
  assert.strictEqual(r.values.latest, 12);
  assert.strictEqual(r.rows[0][1], "49 laps");
  assert.strictEqual(r.rows[1][1], "12 laps");
});

t("pitWindow: no tyre data (empty) → ∞", () => {
  const r = IGPCore.pitWindow({ lapsLeftOnFuel: 20, reserveLaps: 1, tireLaps: "", marginLaps: 0 });
  assert.strictEqual(r.values.tireLatest, Infinity);
  assert.strictEqual(r.values.latest, 19);
});

t("pitWindow: cannot wait → pit now warning", () => {
  const r = IGPCore.pitWindow({ lapsLeftOnFuel: 1, reserveLaps: 1, tireLaps: 10, marginLaps: 0 });
  assert.strictEqual(r.values.latest, 0);
  assert.ok(r.rows.some(row => String(row[0]).includes("⚠")));
});

/* ---------- stintSplit ---------- */

t("stintSplit: even split", () => {
  const r = IGPCore.stintSplit({ totalLaps: 30, tireLifeLaps: 18, pitLossLaps: 0.5 });
  assert.strictEqual(r.values.stops, 1);
  assert.deepStrictEqual(r.values.stints, [15, 15]);
  assert.strictEqual(r.values.timeCostLaps, 0.5);
});

t("stintSplit: remainder goes to the leading stint", () => {
  const r = IGPCore.stintSplit({ totalLaps: 31, tireLifeLaps: 12, pitLossLaps: 0.5 });
  assert.strictEqual(r.values.segments, 3); // ceil(31/12)
  assert.deepStrictEqual(r.values.stints, [11, 10, 10]);
  assert.strictEqual(r.values.timeCostLaps, 1); // 2 * 0.5
});

t("stintSplit: tyres outlast the race → 0 stops", () => {
  const r = IGPCore.stintSplit({ totalLaps: 10, tireLifeLaps: 20, pitLossLaps: 1 });
  assert.strictEqual(r.values.stops, 0);
  assert.deepStrictEqual(r.values.stints, [10]);
});

t("stintSplit: invalid input", () => {
  assert.strictEqual(IGPCore.stintSplit({ totalLaps: 0, tireLifeLaps: 10 }).ok, false);
  assert.strictEqual(IGPCore.stintSplit({ totalLaps: 10, tireLifeLaps: 0 }).ok, false);
});

/* ---------- strategyRecommendation ---------- */

t("strategyRecommendation: pit plan (fuel is the limit)", () => {
  const r = IGPCore.strategyRecommendation({
    lapsLeftOnFuel: 20,
    tyreLapsLeft: 30,
    reserveLaps: 1,
    pitLossLaps: 0.5,
    marginLaps: 2,
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.values.decision, "plan");
  assert.strictEqual(r.values.limiting, "fuel");
  assert.strictEqual(r.values.latest, 19); // floor(20-1)
  assert.strictEqual(r.values.recommended, 17); // 19-2
});

t("strategyRecommendation: tyre is the limit", () => {
  const r = IGPCore.strategyRecommendation({
    lapsLeftOnFuel: 50,
    tyreLapsLeft: 12,
    reserveLaps: 1,
    pitLossLaps: 0.5,
    marginLaps: 0,
  });
  assert.strictEqual(r.values.latest, 12);
  assert.strictEqual(r.values.limiting, "tyre");
  assert.strictEqual(r.values.decision, "plan");
});

t("strategyRecommendation: no tyre data → ∞", () => {
  const r = IGPCore.strategyRecommendation({
    lapsLeftOnFuel: 10,
    tyreLapsLeft: "",
    reserveLaps: 0,
    pitLossLaps: 0,
    marginLaps: 0,
  });
  assert.strictEqual(r.values.latest, 10);
  assert.strictEqual(r.values.limiting, "fuel");
});

t("strategyRecommendation: pit within ±1 lap", () => {
  const r = IGPCore.strategyRecommendation({
    lapsLeftOnFuel: 3.2,
    tyreLapsLeft: 20,
    reserveLaps: 1,
    pitLossLaps: 0.5,
    marginLaps: 1,
  });
  assert.strictEqual(r.values.latest, 2);
  assert.strictEqual(r.values.recommended, 1);
  assert.strictEqual(r.values.decision, "pit-soon");
});

t("strategyRecommendation: PIT NOW + warning", () => {
  const r = IGPCore.strategyRecommendation({
    lapsLeftOnFuel: 1,
    tyreLapsLeft: 10,
    reserveLaps: 1,
    pitLossLaps: 0.5,
    marginLaps: 0,
  });
  assert.strictEqual(r.values.decision, "pit-now");
  assert.ok(r.rows.some(row => String(row[0]).includes("⚠")));
});

t("strategyRecommendation: invalid input", () => {
  assert.strictEqual(
    IGPCore.strategyRecommendation({ lapsLeftOnFuel: -1, tyreLapsLeft: 10 }).ok,
    false
  );
  assert.strictEqual(
    IGPCore.strategyRecommendation({ lapsLeftOnFuel: 10, tyreLapsLeft: 0 }).ok,
    false
  );
  assert.strictEqual(
    IGPCore.strategyRecommendation({ lapsLeftOnFuel: 10, tyreLapsLeft: 10, marginLaps: -2 }).ok,
    false
  );
});

/* ---------- rankOptions ---------- */

t("rankOptions: total weight 0 → error (must be explicit)", () => {
  const r = IGPCore.rankOptions({ items: [{ name: "A", ratings: { a: 5 } }], weights: {} });
  assert.strictEqual(r.ok, false);
});

t("rankOptions: ranking correct per weights", () => {
  const r = IGPCore.rankOptions({
    items: [
      { name: "A", ratings: { aero: 8, power: 6 } },
      { name: "B", ratings: { aero: 6, power: 8 } },
    ],
    weights: { aero: 2, power: 1 },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.values.best, "A");
  assert.strictEqual(r.rows[0][1], "7.33"); // (8*2+6*1)/3
  assert.strictEqual(r.rows[1][1], "6.67");
});

t("rankOptions: incomplete item marked * and still gets its partial sum", () => {
  const r = IGPCore.rankOptions({
    items: [
      { name: "A", ratings: { a: 8, b: 6 } },
      { name: "C", ratings: { a: 7 } },
    ],
    weights: { a: 2, b: 1 },
  });
  assert.strictEqual(r.ok, true);
  const rowC = r.rows.find(row => row[0].includes("C"));
  assert.ok(rowC[0].includes("*"));
  assert.strictEqual(rowC[1], "4.67"); // 7*2/3
});

t("rankOptions: rating outside 0–10 → error", () => {
  const r = IGPCore.rankOptions({ items: [{ name: "A", ratings: { a: 11 } }], weights: { a: 1 } });
  assert.strictEqual(r.ok, false);
});

t("rankOptions: item without a name → error", () => {
  const r = IGPCore.rankOptions({ items: [{ ratings: { a: 5 } }], weights: { a: 1 } });
  assert.strictEqual(r.ok, false);
});

t("rankOptions: tie → alphabetical order", () => {
  const r = IGPCore.rankOptions({
    items: [
      { name: "Beta", ratings: { x: 5 } },
      { name: "Alpha", ratings: { x: 5 } },
    ],
    weights: { x: 1 },
  });
  assert.strictEqual(r.rows[0][0].includes("Alpha"), true);
  assert.strictEqual(r.values.best, "Alpha");
});

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

/* ---------- parseTraits (v0.7.2 advisor, Transfers page) ---------- */

t("parseTraits: reads block-green/block-red and specialA1, drops None", () => {
  const staffHtml =
    "<div class='px-1 py-0.5 block-green' style='min-height: 32px;'><icon>igp-tyre</icon> Tyre economy</div> " +
    "<div class='px-1 py-0.5 block-red' style='min-height: 32px;'><icon>igp-brake</icon> Braking</div>";
  const r = IGPCore.parseTraits(staffHtml);
  assert.deepStrictEqual(r.boost, ["Tyre economy"]);
  assert.deepStrictEqual(r.weaken, ["Braking"]);
  assert.deepStrictEqual(r.special, []);

  const drvHtml = "<span class='specialA1 '>Street circuits</span><br>";
  const d = IGPCore.parseTraits(drvHtml);
  assert.deepStrictEqual(d.special, ["Street circuits"]);

  const none = IGPCore.parseTraits("<span class='specialA0 '>None</span><br>");
  assert.deepStrictEqual(none.special, []);
  const empty = IGPCore.parseTraits("");
  assert.deepStrictEqual(empty, { boost: [], weaken: [], special: [] });
  assert.deepStrictEqual(IGPCore.parseTraits(null), { boost: [], weaken: [], special: [] });
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

t("compareRoster: driver roster vs market — rating axis wins, wage also reported", () => {
  const r = IGPCore.compareRoster({
    current: [
      { key: "D1", name: "Syarif", role: "DRV", rating: 60, costPerRace: 100000 },
      { key: "D2", name: "Kevin", role: "DRV", rating: 30, costPerRace: 100000 },
    ],
    market: [
      { key: "M1", name: "Breno", role: "DRV", rating: 54, costPerRace: 49000, fee: 988000 },
      { key: "M2", name: "Luke", role: "DRV", rating: 54, costPerRace: 46000, fee: 920000 },
    ],
  });
  assert.strictEqual(r.ok, true);
  const v = r.values;
  assert.strictEqual(v.rows.length, 2);
  assert.strictEqual(v.rows[0].verdict, "better"); // 60 > 54
  assert.strictEqual(v.rows[0].basis, "rating");
  assert.strictEqual(v.rows[0].refRating.name, "Breno"); // reference = highest market rating
  assert.strictEqual(v.rows[0].cost.verdict, "worse"); // wage 100k > cheapest 46k
  assert.strictEqual(v.rows[0].refCost.name, "Luke"); // reference = cheapest wage
  assert.strictEqual(v.rows[1].verdict, "worse"); // 30 < 54
  assert.strictEqual(v.counts.better, 1);
  assert.strictEqual(v.counts.worse, 1);
  assert.strictEqual(v.counts.unknown, 0);
});

t("compareRoster: reference only from the same role (CD is not compared with drivers)", () => {
  const r = IGPCore.compareRoster({
    current: [
      { key: "C1", name: "Fanissa", role: "Chief Designer", rating: 41, costPerRace: 50000 },
    ],
    market: [
      { key: "M1", name: "Breno", role: "DRV", rating: 99, costPerRace: 1000 }, // different role: ignored
      { key: "M2", name: "Rosberg", role: "CD", rating: 40, costPerRace: 31000 }, // code CD vs label "Chief Designer" still matches
    ],
  });
  assert.strictEqual(r.ok, true);
  const row = r.values.rows[0];
  assert.strictEqual(row.role, "CD");
  assert.strictEqual(row.refRating.name, "Rosberg");
  assert.strictEqual(row.verdict, "better");
  assert.strictEqual(r.values.marketCount, 2); // full list still reported
});

t("compareRoster: rating not read → falls back to cost axis, reason reported honestly", () => {
  const r = IGPCore.compareRoster({
    current: [
      { key: "D1", name: "Syarif", role: "DRV", rating: null, costPerRace: 100000 },
      { key: "D2", name: "Kevin", role: "DRV", rating: 60, costPerRace: 100000 },
    ],
    market: [{ key: "M1", name: "Breno", role: "DRV", rating: null, costPerRace: 49000 }],
  });
  const v = r.values;
  assert.strictEqual(v.rows[0].basis, "cost");
  assert.strictEqual(v.rows[0].verdict, "worse"); // 100k > 49k
  assert.strictEqual(v.rows[0].rating.verdict, "unknown");
  assert.strictEqual(v.ratingUnknown, 2);
  assert.strictEqual(v.ratingKnown, 0);
});

t("compareRoster: both axes empty → unknown, not a guess", () => {
  const r = IGPCore.compareRoster({
    current: [{ key: "X", name: "No Numbers", role: "DR", rating: null, costPerRace: null }],
    market: [{ key: "Y", name: "Market", role: "DR", rating: null, costPerRace: null }],
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.values.rows[0].verdict, "unknown");
  assert.strictEqual(r.values.rows[0].basis, "none");
  assert.strictEqual(r.values.counts.unknown, 1);
});

t("compareRoster: empty roster/market → honest error (not a fake verdict)", () => {
  assert.strictEqual(IGPCore.compareRoster({ current: [], market: [{ name: "A" }] }).ok, false);
  assert.strictEqual(IGPCore.compareRoster({ current: [{ name: "A" }], market: [] }).ok, false);
  assert.strictEqual(IGPCore.compareRoster({}).ok, false);
  assert.ok(IGPCore.compareRoster({}).error.length > 3);
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

t("calcFuel: empty field → ok:false (not '0 L')", () => {
  assert.strictEqual(
    IGPCore.calcFuel({
      lapsRemaining: null,
      fuelPerLap: "1.2",
      currentFuel: null,
      reserveLaps: null,
    }).ok,
    false
  );
  assert.strictEqual(
    IGPCore.calcFuel({ lapsRemaining: " ", fuelPerLap: 1, currentFuel: 1 }).ok,
    false
  );
  assert.strictEqual(
    IGPCore.calcFuel({ lapsRemaining: 5, fuelPerLap: 1, currentFuel: null }).ok,
    false
  );
  assert.strictEqual(
    IGPCore.calcFuel({ lapsRemaining: 5, fuelPerLap: 1, currentFuel: 1, reserveLaps: -1 }).ok,
    false
  );
});

t("projectTireWear/lapsToThreshold: empty field → ok:false", () => {
  assert.strictEqual(
    IGPCore.projectTireWear({ currentWearPct: null, wearPerLapPct: 2, lapsCount: 5 }).ok,
    false
  );
  assert.strictEqual(
    IGPCore.projectTireWear({ currentWearPct: 10, wearPerLapPct: 2, lapsCount: null }).ok,
    false
  );
  assert.strictEqual(
    IGPCore.lapsToThreshold({ currentWearPct: 10, wearPerLapPct: 2, thresholdPct: null }).ok,
    false
  );
});

t("pitWindow/stintSplit/strategyRecommendation: null & negative rejected", () => {
  assert.strictEqual(IGPCore.pitWindow({ lapsLeftOnFuel: null, reserveLaps: 0 }).ok, false);
  assert.strictEqual(IGPCore.pitWindow({ lapsLeftOnFuel: 10, reserveLaps: -1 }).ok, false);
  assert.strictEqual(IGPCore.pitWindow({ lapsLeftOnFuel: 10, marginLaps: -2 }).ok, false);
  assert.strictEqual(
    IGPCore.stintSplit({ totalLaps: 30, tireLifeLaps: 10, pitLossLaps: -1 }).ok,
    false
  );
  assert.strictEqual(
    IGPCore.strategyRecommendation({ lapsLeftOnFuel: null, tyreLapsLeft: 5 }).ok,
    false
  );
});

t("compareRoster: unreadable role is not compared across roles", () => {
  const r = IGPCore.compareRoster({
    current: [{ name: "X", role: null, rating: 50 }],
    market: [{ name: "Mechanic", role: "mechanic", rating: 99 }],
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.values.rows[0].verdict, "unknown");
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
