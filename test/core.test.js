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

t("calcFuel: kasus dasar", () => {
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

t("calcFuel: tanpa reserve", () => {
  const r = IGPCore.calcFuel({ lapsRemaining: 10, fuelPerLap: 2, currentFuel: 20, reserveLaps: 0 });
  assert.strictEqual(r.values.fuelToAdd, 0); // 20 dibutuhkan, 20 ada
  assert.strictEqual(r.values.lapsLeftOnFuel, 10);
});

t("calcFuel: reserve setengah lap", () => {
  const r = IGPCore.calcFuel({
    lapsRemaining: 10,
    fuelPerLap: 2,
    currentFuel: 20,
    reserveLaps: 0.5,
  });
  assert.strictEqual(r.values.fuelToAdd, 1); // 20 + 1 - 20
});

t("calcFuel: over-capacity deteksi", () => {
  const r = IGPCore.calcFuel({
    lapsRemaining: 20,
    fuelPerLap: 1.2,
    currentFuel: 0,
    reserveLaps: 1,
    tankCapacity: 20,
  });
  assert.strictEqual(r.values.overCapacity, 5.2); // 25.2 total vs tangki 20
  assert.ok(r.rows.some(row => String(row[0]).includes("⚠")));
});

t("calcFuel: input tak valid → ok:false", () => {
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

t("projectTireWear: monotonic dan cap 100%", () => {
  const r = IGPCore.projectTireWear({ currentWearPct: 50, wearPerLapPct: 6, lapsCount: 10 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.rows.length, 11); // 0..10
  assert.strictEqual(r.rows[2][1], "62 %");
  const last = r.rows[r.rows.length - 1][1];
  assert.strictEqual(last, "100 %"); // 50+60 → cap
});

t("projectTireWear: wear 0 → konstan", () => {
  const r = IGPCore.projectTireWear({ currentWearPct: 10, wearPerLapPct: 0, lapsCount: 5 });
  assert.strictEqual(r.rows[5][1], "10 %");
});

t("projectTireWear: input tak valid", () => {
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

t("lapsToThreshold: floor benar", () => {
  const r = IGPCore.lapsToThreshold({ currentWearPct: 20, wearPerLapPct: 3, thresholdPct: 80 });
  assert.strictEqual(r.values.laps, 20); // floor(60/3)
});

t("lapsToThreshold: floor turun pada fraksi", () => {
  const r = IGPCore.lapsToThreshold({ currentWearPct: 20, wearPerLapPct: 4, thresholdPct: 80 });
  assert.strictEqual(r.values.laps, 15);
});

t("lapsToThreshold: wear 0 → Infinity", () => {
  const r = IGPCore.lapsToThreshold({ currentWearPct: 10, wearPerLapPct: 0, thresholdPct: 80 });
  assert.strictEqual(r.values.laps, Infinity);
  assert.ok(r.rows[0][1].includes("∞"));
});

t("lapsToThreshold: threshold <= wear kini → error", () => {
  assert.strictEqual(
    IGPCore.lapsToThreshold({ currentWearPct: 80, wearPerLapPct: 2, thresholdPct: 80 }).ok,
    false
  );
});

/* ---------- pitWindow ---------- */

t("pitWindow: fuel yang membatasi", () => {
  const r = IGPCore.pitWindow({ lapsLeftOnFuel: 9.5, reserveLaps: 1, tireLaps: 30, marginLaps: 2 });
  assert.strictEqual(r.values.fuelLatest, 8); // floor(9.5-1)
  assert.strictEqual(r.values.latest, 8); // min(8, 30)
  assert.strictEqual(r.values.recommended, 6);
  assert.strictEqual(r.rows[0][1], "8 lap");
});

t("pitWindow: ban yang membatasi", () => {
  const r = IGPCore.pitWindow({ lapsLeftOnFuel: 50, reserveLaps: 1, tireLaps: 12, marginLaps: 0 });
  assert.strictEqual(r.values.latest, 12);
  assert.strictEqual(r.rows[0][1], "49 lap");
  assert.strictEqual(r.rows[1][1], "12 lap");
});

t("pitWindow: tanpa data ban (kosong) → ∞", () => {
  const r = IGPCore.pitWindow({ lapsLeftOnFuel: 20, reserveLaps: 1, tireLaps: "", marginLaps: 0 });
  assert.strictEqual(r.values.tireLatest, Infinity);
  assert.strictEqual(r.values.latest, 19);
});

t("pitWindow: tidak bisa menunggu → peringatan pit sekarang", () => {
  const r = IGPCore.pitWindow({ lapsLeftOnFuel: 1, reserveLaps: 1, tireLaps: 10, marginLaps: 0 });
  assert.strictEqual(r.values.latest, 0);
  assert.ok(r.rows.some(row => String(row[0]).includes("⚠")));
});

/* ---------- stintSplit ---------- */

t("stintSplit: pembagian merata", () => {
  const r = IGPCore.stintSplit({ totalLaps: 30, tireLifeLaps: 18, pitLossLaps: 0.5 });
  assert.strictEqual(r.values.stops, 1);
  assert.deepStrictEqual(r.values.stints, [15, 15]);
  assert.strictEqual(r.values.timeCostLaps, 0.5);
});

t("stintSplit: rema dibagikan ke stint terdepan", () => {
  const r = IGPCore.stintSplit({ totalLaps: 31, tireLifeLaps: 12, pitLossLaps: 0.5 });
  assert.strictEqual(r.values.segments, 3); // ceil(31/12)
  assert.deepStrictEqual(r.values.stints, [11, 10, 10]);
  assert.strictEqual(r.values.timeCostLaps, 1); // 2 * 0.5
});

t("stintSplit: ban lebih awet dari balapan → 0 stop", () => {
  const r = IGPCore.stintSplit({ totalLaps: 10, tireLifeLaps: 20, pitLossLaps: 1 });
  assert.strictEqual(r.values.stops, 0);
  assert.deepStrictEqual(r.values.stints, [10]);
});

t("stintSplit: input tak valid", () => {
  assert.strictEqual(IGPCore.stintSplit({ totalLaps: 0, tireLifeLaps: 10 }).ok, false);
  assert.strictEqual(IGPCore.stintSplit({ totalLaps: 10, tireLifeLaps: 0 }).ok, false);
});

/* ---------- strategyRecommendation ---------- */

t("strategyRecommendation: rencana pit (fuel membatasi)", () => {
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

t("strategyRecommendation: ban membatasi", () => {
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

t("strategyRecommendation: ban tanpa data → ∞", () => {
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

t("strategyRecommendation: pit dalam ±1 lap", () => {
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

t("strategyRecommendation: PIT SEKARANG + peringatan", () => {
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

t("strategyRecommendation: input tidak valid", () => {
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

t("rankOptions: total bobot 0 → error (harus eksplisit)", () => {
  const r = IGPCore.rankOptions({ items: [{ name: "A", ratings: { a: 5 } }], weights: {} });
  assert.strictEqual(r.ok, false);
});

t("rankOptions: ranking benar sesuai bobot", () => {
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

t("rankOptions: item kurang lengkap ditandai * dan tetap dijumlah parsialnya", () => {
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

t("rankOptions: rating di luar 0–10 → error", () => {
  const r = IGPCore.rankOptions({ items: [{ name: "A", ratings: { a: 11 } }], weights: { a: 1 } });
  assert.strictEqual(r.ok, false);
});

t("rankOptions: item tanpa nama → error", () => {
  const r = IGPCore.rankOptions({ items: [{ ratings: { a: 5 } }], weights: { a: 1 } });
  assert.strictEqual(r.ok, false);
});

t("rankOptions: seri → urutan alfabetis", () => {
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

t("designPriority: gap terbesar diprioritaskan, share % proporsional", () => {
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
  assert.strictEqual(r.values.ranked[0].key, "acceleration"); // gap terbesar
  assert.strictEqual(r.values.totalGap, 210); // 180 + 20 + 10
  const shares = r.values.ranked.map(x => x.sharePct);
  assert.strictEqual(r.values.ranked[0].sharePct, Math.round((180 / 210) * 1000) / 10);
  assert.deepStrictEqual(shares, [85.7, 9.5, 4.8]);
  assert.strictEqual(r.values.designPoints, 200);
  assert.strictEqual(r.values.unbenchmarked, 0);
});

t("designPriority: atribut sudah >= max liga -> tanpa saran, ok:false jujur", () => {
  const r = IGPCore.designPriority({
    attrs: { a: { label: "A", val: 320 } },
    best: { a: { max: 300 } },
  });
  assert.strictEqual(r.ok, false); // tidak ada gap: tidak ada yang diusulkan
  assert.match(r.error, /gap/i);
});

t("designPriority: tanpa benchmark liga → gagal jujur", () => {
  const r = IGPCore.designPriority({ attrs: { a: { label: "A", val: 100 } }, best: {} });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /gap/i);
});

t("designPriority: atribut kosong → error", () => {
  assert.strictEqual(IGPCore.designPriority({ attrs: {} }).ok, false);
  assert.strictEqual(IGPCore.designPriority({}).ok, false);
});

t("designPriority: atribut tanpa max tetap tercantum sbg unbenchmarked", () => {
  const r = IGPCore.designPriority({
    attrs: {
      a: { label: "A", val: 100 }, // ada benchmark
      b: { label: "B", val: 50 }, // tanpa benchmark
    },
    best: { a: { max: 200 } },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.values.ranked.length, 1); // hanya yang ada gap
  assert.strictEqual(r.values.unbenchmarked, 1);
  assert.strictEqual(r.values.ranked[0].sharePct, 100);
});

/* ---------- rankSuppliers (v0.7.0 advisor heuristik) ---------- */

t("rankSuppliers: nilai/biaya (per 1M) menentukan urutan, bukan nilai mentah", () => {
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

t("rankSuppliers: bonus negatif menurunkan nilai; tanpa biaya tidak juara nilai", () => {
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
      { supplierId: 22, costPerRace: null, bonuses: [{ stat: "power", value: 9 }] }, // tanpa biaya
    ],
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.values.withoutCost, 1);
  // Supplier tanpa biaya tidak bisa dinilai "nilai/biaya" — jujur ditaruh setelah
  // yang terukur, bukan juara hanya karena Σ bonus besar.
  assert.strictEqual(r.values.ranked[0].id, 21);
  assert.strictEqual(r.values.ranked[0].valuePerCost, 6.67);
  const last = r.values.ranked[r.values.ranked.length - 1];
  assert.strictEqual(last.id, 22);
  assert.strictEqual(last.value, 9);
  assert.strictEqual(last.valuePerCost, null);
});

t("rankSuppliers: kosong → error", () => {
  assert.strictEqual(IGPCore.rankSuppliers({ items: [] }).ok, false);
  assert.strictEqual(IGPCore.rankSuppliers({}).ok, false);
});

/* ---------- rankManufacturerItems (v0.7.0 advisor heuristik) ---------- */

t("rankManufacturerItems: engine — rating menurun, efisiensi sbg tiebreak", () => {
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
  assert.strictEqual(r.values.bestValueId, 2); // 80% pada biaya separuh
});

t("rankManufacturerItems: chassis — rating saja, baris tanpa rating dihitung noData", () => {
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

t("rankManufacturerItems: semua rating kosong → error jujur", () => {
  const r = IGPCore.rankManufacturerItems({
    items: [{ id: 1, name: "A", ratingPct: null }],
    withCost: false,
  });
  assert.strictEqual(r.ok, false);
});

/* ---------- parseTraits (v0.7.2 advisor, halaman Transfers) ---------- */

t("parseTraits: block-green/block-red dan specialA1 terbaca, None dibuang", () => {
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

/* ---------- perbandingan keputusan (v0.8.0) ---------- */

t('numberVerdict: arah naik, toleransi "sama", sisi kosong = unknown', () => {
  assert.strictEqual(IGPCore.numberVerdict(60, 54).verdict, "better");
  assert.strictEqual(IGPCore.numberVerdict(50, 54).verdict, "worse");
  assert.strictEqual(IGPCore.numberVerdict(54, 54).verdict, "equal");
  // selisih 1% masih di dalam toleransi bawaan 2% → sama
  assert.strictEqual(IGPCore.numberVerdict(54.5, 54).verdict, "equal");
  // 5% → keluar toleransi
  assert.strictEqual(IGPCore.numberVerdict(57, 54).verdict, "better");
  // sisi kosong tidak pernah dikarang jadi angka
  assert.strictEqual(IGPCore.numberVerdict(null, 54).verdict, "unknown");
  assert.strictEqual(IGPCore.numberVerdict(54, "").verdict, "unknown");
  assert.strictEqual(IGPCore.numberVerdict(undefined, null).verdict, "unknown");
});

t("numberVerdict: lowerIsBetter untuk biaya (turun = lebih bagus)", () => {
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

t("numberVerdict: nol di sisi pembanding — tidak meledak, delta yang bicara", () => {
  assert.strictEqual(IGPCore.numberVerdict(0, 0).verdict, "equal");
  assert.strictEqual(IGPCore.numberVerdict(5, 0).verdict, "better");
  assert.strictEqual(IGPCore.numberVerdict(5, 0).pct, null); // basis 0 → persen tak bermakna
});

t("compareRoster: driver roster vs pasar — sumbu rating menang, gaji ikut dilaporkan", () => {
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
  assert.strictEqual(v.rows[0].refRating.name, "Breno"); // pembanding = rating tertinggi pasar
  assert.strictEqual(v.rows[0].cost.verdict, "worse"); // gaji 100k > termurah 46k
  assert.strictEqual(v.rows[0].refCost.name, "Luke"); // pembanding = gaji termurah
  assert.strictEqual(v.rows[1].verdict, "worse"); // 30 < 54
  assert.strictEqual(v.counts.better, 1);
  assert.strictEqual(v.counts.worse, 1);
  assert.strictEqual(v.counts.unknown, 0);
});

t("compareRoster: pembanding hanya dari peran yang sama (CD tidak dibanding driver)", () => {
  const r = IGPCore.compareRoster({
    current: [
      { key: "C1", name: "Fanissa", role: "Chief Designer", rating: 41, costPerRace: 50000 },
    ],
    market: [
      { key: "M1", name: "Breno", role: "DRV", rating: 99, costPerRace: 1000 }, // peran beda: diabaikan
      { key: "M2", name: "Rosberg", role: "CD", rating: 40, costPerRace: 31000 }, // kode CD vs label "Chief Designer" tetap cocok
    ],
  });
  assert.strictEqual(r.ok, true);
  const row = r.values.rows[0];
  assert.strictEqual(row.role, "CD");
  assert.strictEqual(row.refRating.name, "Rosberg");
  assert.strictEqual(row.verdict, "better");
  assert.strictEqual(r.values.marketCount, 2); // daftar penuh tetap dilaporkan
});

t("compareRoster: rating tak terbaca → jatuh ke sumbu biaya, sebabnya dilaporkan jujur", () => {
  const r = IGPCore.compareRoster({
    current: [
      { key: "D1", name: "Syarif", role: "DRV", rating: null, costPerRace: 100000 },
      { key: "D2", name: "Kevin", role: "DRV", rating: 60, costPerRace: 100000 },
    ],
    market: [{ key: "M1", name: "Breno", role: "DRV", rating: null, costPerRace: 49000 }],
  });
  const v = r.values;
  assert.strictEqual(v.rows[0].basis, "biaya");
  assert.strictEqual(v.rows[0].verdict, "worse"); // 100k > 49k
  assert.strictEqual(v.rows[0].rating.verdict, "unknown");
  assert.strictEqual(v.ratingUnknown, 2);
  assert.strictEqual(v.ratingKnown, 0);
});

t("compareRoster: kedua sumbu kosong → unknown, bukan tebakan", () => {
  const r = IGPCore.compareRoster({
    current: [{ key: "X", name: "Tanpa Angka", role: "DR", rating: null, costPerRace: null }],
    market: [{ key: "Y", name: "Pasar", role: "DR", rating: null, costPerRace: null }],
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.values.rows[0].verdict, "unknown");
  assert.strictEqual(r.values.rows[0].basis, "tidak ada");
  assert.strictEqual(r.values.counts.unknown, 1);
});

t("compareRoster: roster/pasar kosong → error jujur (bukan verdict palsu)", () => {
  assert.strictEqual(IGPCore.compareRoster({ current: [], market: [{ name: "A" }] }).ok, false);
  assert.strictEqual(IGPCore.compareRoster({ current: [{ name: "A" }], market: [] }).ok, false);
  assert.strictEqual(IGPCore.compareRoster({}).ok, false);
  assert.ok(IGPCore.compareRoster({}).error.length > 3);
});

t("compareSuppliers: supplier aktif vs terbaik/termurah di dialog yang sama", () => {
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
  assert.strictEqual(v.basis, "bonus"); // sumbu bonus yang dipakai untuk verdict akhir
});

t("compareSuppliers: alternatif kosong / aktif tak terbaca → error jujur", () => {
  assert.strictEqual(
    IGPCore.compareSuppliers({ current: { supplierId: 2 }, alternatives: [] }).ok,
    false
  );
  assert.strictEqual(IGPCore.compareSuppliers({ alternatives: [{ eId: 1 }] }).ok, false);
});

/* ---------- statIndex / roleCode (v0.8.0, helper adapter) ---------- */

t("statIndex: rata-rata 12 angka CSV; CSV pendek → null (tidak dikarang)", () => {
  assert.strictEqual(Utils.statIndex("10,10,10,10,10,10,10,10,10,10,10,10,99,1,2"), 10);
  assert.strictEqual(Utils.statIndex("1,2,3,4,5,6,7,8,9,10,11,12"), 6.5);
  assert.strictEqual(Utils.statIndex("40,40,40,40,54"), null); // hanya 5 angka (data-staff)
  assert.strictEqual(Utils.statIndex(""), null);
  assert.strictEqual(Utils.statIndex(null), null);
});

t("roleCode: label & kode peran ternormalisasi agar roster/pasar sebanding", () => {
  assert.strictEqual(Utils.roleCode("Chief Designer"), "CD");
  assert.strictEqual(Utils.roleCode("CD"), "CD");
  assert.strictEqual(Utils.roleCode("Technical Director"), "TD");
  assert.strictEqual(Utils.roleCode("Doctor"), "DR");
  assert.strictEqual(Utils.roleCode("DR"), "DR");
  assert.strictEqual(Utils.roleCode(""), null);
});

/* ---------- parseSliderIdeal / setupAdvice (v0.7.3) ---------- */

t("parseSliderIdeal: style bar ideal game → {left,width}", () => {
  const r = IGPCore.parseSliderIdeal("left:calc(0% + 2px);width:calc(100% - 4px)");
  assert.deepStrictEqual(r, { left: 0, width: 100 });
  const n = IGPCore.parseSliderIdeal("left:calc(20% + 2px);width:calc(40% - 4px)");
  assert.deepStrictEqual(n, { left: 20, width: 40 });
  assert.strictEqual(IGPCore.parseSliderIdeal("width:40px"), null);
  assert.strictEqual(IGPCore.parseSliderIdeal(null), null);
  assert.strictEqual(IGPCore.parseSliderIdeal(""), null);
});

t("setupAdvice: bar setebal track (width 100%) = ideal belum dipelajari", () => {
  const r = IGPCore.setupAdvice({ ideal: { left: 0, width: 100 }, current: 50 });
  assert.strictEqual(r.learned, false);
  assert.strictEqual(r.current, 50);
  assert.strictEqual(r.mid, undefined);
  assert.strictEqual(IGPCore.setupAdvice({ ideal: null, current: 50 }).learned, false);
});

t("setupAdvice: bar menyempit → tengah ideal + selisih arah saja", () => {
  const r = IGPCore.setupAdvice({ ideal: { left: 20, width: 40 }, current: 50 });
  assert.strictEqual(r.learned, true);
  assert.strictEqual(r.mid, 40); // 20 + 40/2
  assert.strictEqual(r.delta, 10); // 50 - 40
  const quarter = IGPCore.setupAdvice({ ideal: { left: 10, width: 25 }, current: 30 });
  assert.strictEqual(quarter.mid, 22.5); // 10 + 12.5
  assert.strictEqual(quarter.delta, 7.5);
  const noCur = IGPCore.setupAdvice({ ideal: { left: 20, width: 40 }, current: null });
  assert.strictEqual(noCur.delta, null);
});

/* ---------- summarizeStrategy (v0.7.3) ---------- */

t("summarizeStrategy: kasus fixture race (63 lap, 2.5 L/lap, bensin 174 L)", () => {
  const st = {
    stint: {
      1: { tyre: "M", fuel: 174, laps: 16 },
      2: { tyre: "M", fuel: 1, laps: 16 },
      3: { tyre: "M", fuel: 1, laps: 16 },
      4: { tyre: "S", fuel: 1, laps: 16 },
      5: { tyre: "S", fuel: 1, laps: 1 },
    },
    isDefault: 1,
    auto_fuel: 0,
    pits: 3,
    stints: 4,
    risk_level: 60,
  };
  const r = IGPCore.summarizeStrategy({
    strategy: st,
    raceLaps: 63,
    fuelPerLap: 2.5,
    advancedFuel: 174,
    ruleTwoTyres: true,
    ruleRefuelling: false,
  });
  assert.strictEqual(r.ok, true);
  const v = r.values;
  assert.strictEqual(v.stints.length, 4); // stints:4 — stint ke-5 nonaktif
  assert.strictEqual(v.lapsTotal, 64);
  assert.strictEqual(v.lapsShort, 0);
  assert.strictEqual(v.fuelNeed, 157.5); // 63 * 2.5
  assert.strictEqual(v.fuelBuffer, 16.5);
  assert.strictEqual(v.bufferLaps, 6.6);
  assert.deepStrictEqual(v.tyres, ["M", "M", "M", "S"]);
  assert.deepStrictEqual(v.dryUnique, ["M", "S"]);
  assert.strictEqual(v.twoTyreOk, true);
  assert.strictEqual(v.pits, 3);
  assert.strictEqual(v.risk, 60);
  assert.strictEqual(v.refuelling, false);
});

t("summarizeStrategy: dua-compound wajib tapi hanya 1 compound kering → gagal", () => {
  const st = {
    stint: { 1: { tyre: "M", laps: 30 }, 2: { tyre: "M", laps: 30 } },
    stints: 2,
    pits: 1,
  };
  const r = IGPCore.summarizeStrategy({
    strategy: st,
    raceLaps: 60,
    fuelPerLap: 2,
    ruleTwoTyres: true,
  });
  assert.strictEqual(r.values.twoTyreOk, false);
  const na = IGPCore.summarizeStrategy({
    strategy: st,
    raceLaps: 60,
    fuelPerLap: 2,
    ruleTwoTyres: false,
  });
  assert.strictEqual(na.values.twoTyreOk, null); // aturan tidak berlaku → n/a
});

t("summarizeStrategy: data tak tampil → null (bukan nol karangan; Number(null)===0)", () => {
  const st = { stint: { 1: { tyre: "M", laps: 10 } }, stints: 1 };
  const r = IGPCore.summarizeStrategy({
    strategy: st,
    raceLaps: "",
    fuelPerLap: null,
    advancedFuel: undefined,
    ruleTwoTyres: true,
  });
  const v = r.values;
  assert.strictEqual(v.raceLaps, null);
  assert.strictEqual(v.fuelPerLap, null);
  assert.strictEqual(v.fuelNeed, null);
  assert.strictEqual(v.fuelBuffer, null);
  assert.strictEqual(v.bufferLaps, null);
  assert.strictEqual(v.lapsShort, null);
  assert.strictEqual(v.advancedFuel, null);
  assert.strictEqual(v.pits, null);
  assert.strictEqual(v.risk, null);
  assert.strictEqual(v.twoTyreOk, false); // aturan wajib, hanya M di stint aktif
});

t("summarizeStrategy: strategi rusak / struktur tak dikenal → ok:false jujur", () => {
  assert.strictEqual(IGPCore.summarizeStrategy({ strategy: null }).ok, false);
  assert.strictEqual(IGPCore.summarizeStrategy({ strategy: {} }).ok, false);
  assert.strictEqual(IGPCore.summarizeStrategy({ strategy: { stint: {} } }).ok, false);
  const r = IGPCore.summarizeStrategy({});
  assert.strictEqual(r.ok, false);
  assert.ok(r.error && r.error.length > 3);
});

/* ---------- practice + track (v0.8.2: fuel/lap, tyre/lap, timelap/stint) ---------- */

t("parseLapTime: m:ss.mmm → detik; tak terbaca → null", () => {
  assert.strictEqual(IGPCore.parseLapTime("1:22.512"), 82.512);
  assert.strictEqual(IGPCore.parseLapTime("1:07.850"), 67.85);
  assert.strictEqual(IGPCore.parseLapTime("82.512"), 82.512);
  assert.strictEqual(IGPCore.parseLapTime(""), null);
  assert.strictEqual(IGPCore.parseLapTime(null), null);
  assert.strictEqual(IGPCore.parseLapTime("—"), null);
});

t("parseUseNumber: '-2.4'/'-8%'/'2.460' → angka; kosong → null", () => {
  assert.strictEqual(IGPCore.parseUseNumber("-2.4"), -2.4);
  assert.strictEqual(IGPCore.parseUseNumber("-8%"), -8);
  assert.strictEqual(IGPCore.parseUseNumber("2.460"), 2.46);
  assert.strictEqual(IGPCore.parseUseNumber(""), null);
  assert.strictEqual(IGPCore.parseUseNumber(null), null);
});

t("summarizePracticeLaps: 3 lap → fuel/lap, tyre/lap, terbaik", () => {
  const r = IGPCore.summarizePracticeLaps([
    { fuelUse: "-2.4", tyreUse: "-8%", time: "1:22.512" },
    { fuelUse: "-2.3", tyreUse: "-8%", time: "1:21.900" },
    { fuelUse: "-2.5", tyreUse: "-9%", time: "1:23.100" },
  ]);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.values.count, 3);
  assert.strictEqual(r.values.fuelAvg, 2.4); // (|2.4|+|2.3|+|2.5|)/3
  assert.strictEqual(r.values.tyreAvg, 8.333);
  assert.strictEqual(r.values.bestLap, "1:21.900");
});

t("summarizePracticeLaps: kosong / tak terbaca → ok:false", () => {
  assert.strictEqual(IGPCore.summarizePracticeLaps([]).ok, false);
  assert.strictEqual(
    IGPCore.summarizePracticeLaps([{ fuelUse: "", tyreUse: "", time: "" }]).ok,
    false
  );
});

t("recommendRaceFuel: 63 lap × 2.4L → butuh 151.2L + reserve", () => {
  const r = IGPCore.recommendRaceFuel({
    raceLaps: 63,
    fuelPerLap: 2.4,
    advancedFuel: 174,
    reserveLaps: 1,
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.values.need, 151.2);
  assert.strictEqual(r.values.total, 153.6);
  assert.strictEqual(r.values.buffer, 22.8);
});

t("recommendRaceFuel: tanpa raceLaps/fuelPerLap → ok:false", () => {
  assert.strictEqual(IGPCore.recommendRaceFuel({ raceLaps: null, fuelPerLap: 2.4 }).ok, false);
  assert.strictEqual(IGPCore.recommendRaceFuel({ raceLaps: 63, fuelPerLap: null }).ok, false);
});

t("practiceTyreLife: 8%/lap → 10 lap pada threshold 80%", () => {
  const r = IGPCore.practiceTyreLife({ tyrePerLap: 8, threshold: 80 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.values.life, 10);
  assert.strictEqual(IGPCore.practiceTyreLife({}).ok, false);
});

t("describeTrack: fuel+wear tinggi → hint BBM & stint pendek", () => {
  const r = IGPCore.describeTrack({ overtaking: 70, bumpiness: 40, fuel: 80, wear: 45 });
  assert.strictEqual(r.ok, true);
  assert.ok(r.values.hints.some(h => /BBM/i.test(h)));
  const w = IGPCore.describeTrack({ overtaking: 20, bumpiness: 70, fuel: 40, wear: 80 });
  assert.ok(w.values.hints.some(h => /stint pendek/i.test(h)));
  assert.ok(w.values.hints.some(h => /overtake/i.test(h)));
  assert.strictEqual(IGPCore.describeTrack({}).ok, false);
});

console.log("\nSemua " + n + " test lulus ✔");
