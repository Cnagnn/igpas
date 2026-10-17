'use strict';

const assert = require('assert');
const { IGPCore } = require('../src/igpas.user.js');

let n = 0;
function t(name, fn) {
    fn();
    n++;
    console.log('  ✓ ' + name);
}

console.log('IGPCore unit tests');

/* ---------- calcFuel ---------- */

t('calcFuel: kasus dasar', () => {
    const r = IGPCore.calcFuel({ lapsRemaining: 20, fuelPerLap: 1.2, currentFuel: 10, reserveLaps: 1, tankCapacity: '' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.values.fuelNeeded, 24);          // 20 * 1.2
    assert.strictEqual(r.values.fuelToAdd, 15.2);         // 24 + 1.2 - 10
    assert.strictEqual(r.values.lapsLeftOnFuel, 8.3);     // 10 / 1.2 = 8.333 -> 8.3
});

t('calcFuel: tanpa reserve', () => {
    const r = IGPCore.calcFuel({ lapsRemaining: 10, fuelPerLap: 2, currentFuel: 20, reserveLaps: 0 });
    assert.strictEqual(r.values.fuelToAdd, 0);            // 20 dibutuhkan, 20 ada
    assert.strictEqual(r.values.lapsLeftOnFuel, 10);
});

t('calcFuel: reserve setengah lap', () => {
    const r = IGPCore.calcFuel({ lapsRemaining: 10, fuelPerLap: 2, currentFuel: 20, reserveLaps: 0.5 });
    assert.strictEqual(r.values.fuelToAdd, 1);            // 20 + 1 - 20
});

t('calcFuel: over-capacity deteksi', () => {
    const r = IGPCore.calcFuel({ lapsRemaining: 20, fuelPerLap: 1.2, currentFuel: 0, reserveLaps: 1, tankCapacity: 20 });
    assert.strictEqual(r.values.overCapacity, 5.2);       // 25.2 total vs tangki 20
    assert.ok(r.rows.some(row => String(row[0]).includes('⚠')));
});

t('calcFuel: input tak valid → ok:false', () => {
    assert.strictEqual(IGPCore.calcFuel({ lapsRemaining: 5, fuelPerLap: 0, currentFuel: 1 }).ok, false);
    assert.strictEqual(IGPCore.calcFuel({ lapsRemaining: -1, fuelPerLap: 1, currentFuel: 1 }).ok, false);
    assert.strictEqual(IGPCore.calcFuel({ lapsRemaining: 5, fuelPerLap: 1, currentFuel: -3 }).ok, false);
});

/* ---------- projectTireWear ---------- */

t('projectTireWear: monotonic dan cap 100%', () => {
    const r = IGPCore.projectTireWear({ currentWearPct: 50, wearPerLapPct: 6, lapsCount: 10 });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.rows.length, 11);                 // 0..10
    assert.strictEqual(r.rows[2][1], '62 %');
    const last = r.rows[r.rows.length - 1][1];
    assert.strictEqual(last, '100 %');                     // 50+60 → cap
});

t('projectTireWear: wear 0 → konstan', () => {
    const r = IGPCore.projectTireWear({ currentWearPct: 10, wearPerLapPct: 0, lapsCount: 5 });
    assert.strictEqual(r.rows[5][1], '10 %');
});

t('projectTireWear: input tak valid', () => {
    assert.strictEqual(IGPCore.projectTireWear({ currentWearPct: 120, wearPerLapPct: 1, lapsCount: 5 }).ok, false);
    assert.strictEqual(IGPCore.projectTireWear({ currentWearPct: 10, wearPerLapPct: -1, lapsCount: 5 }).ok, false);
    assert.strictEqual(IGPCore.projectTireWear({ currentWearPct: 10, wearPerLapPct: 1, lapsCount: 0 }).ok, false);
});

/* ---------- lapsToThreshold ---------- */

t('lapsToThreshold: floor benar', () => {
    const r = IGPCore.lapsToThreshold({ currentWearPct: 20, wearPerLapPct: 3, thresholdPct: 80 });
    assert.strictEqual(r.values.laps, 20);                 // floor(60/3)
});

t('lapsToThreshold: floor turun pada fraksi', () => {
    const r = IGPCore.lapsToThreshold({ currentWearPct: 20, wearPerLapPct: 4, thresholdPct: 80 });
    assert.strictEqual(r.values.laps, 15);
});

t('lapsToThreshold: wear 0 → Infinity', () => {
    const r = IGPCore.lapsToThreshold({ currentWearPct: 10, wearPerLapPct: 0, thresholdPct: 80 });
    assert.strictEqual(r.values.laps, Infinity);
    assert.ok(r.rows[0][1].includes('∞'));
});

t('lapsToThreshold: threshold <= wear kini → error', () => {
    assert.strictEqual(IGPCore.lapsToThreshold({ currentWearPct: 80, wearPerLapPct: 2, thresholdPct: 80 }).ok, false);
});

/* ---------- pitWindow ---------- */

t('pitWindow: fuel yang membatasi', () => {
    const r = IGPCore.pitWindow({ lapsLeftOnFuel: 9.5, reserveLaps: 1, tireLaps: 30, marginLaps: 2 });
    assert.strictEqual(r.values.fuelLatest, 8);            // floor(9.5-1)
    assert.strictEqual(r.values.latest, 8);                // min(8, 30)
    assert.strictEqual(r.values.recommended, 6);
    assert.strictEqual(r.rows[0][1], '8 lap');
});

t('pitWindow: ban yang membatasi', () => {
    const r = IGPCore.pitWindow({ lapsLeftOnFuel: 50, reserveLaps: 1, tireLaps: 12, marginLaps: 0 });
    assert.strictEqual(r.values.latest, 12);
    assert.strictEqual(r.rows[0][1], '49 lap');
    assert.strictEqual(r.rows[1][1], '12 lap');
});

t('pitWindow: tanpa data ban (kosong) → ∞', () => {
    const r = IGPCore.pitWindow({ lapsLeftOnFuel: 20, reserveLaps: 1, tireLaps: '', marginLaps: 0 });
    assert.strictEqual(r.values.tireLatest, Infinity);
    assert.strictEqual(r.values.latest, 19);
});

t('pitWindow: tidak bisa menunggu → peringatan pit sekarang', () => {
    const r = IGPCore.pitWindow({ lapsLeftOnFuel: 1, reserveLaps: 1, tireLaps: 10, marginLaps: 0 });
    assert.strictEqual(r.values.latest, 0);
    assert.ok(r.rows.some(row => String(row[0]).includes('⚠')));
});

/* ---------- stintSplit ---------- */

t('stintSplit: pembagian merata', () => {
    const r = IGPCore.stintSplit({ totalLaps: 30, tireLifeLaps: 18, pitLossLaps: 0.5 });
    assert.strictEqual(r.values.stops, 1);
    assert.deepStrictEqual(r.values.stints, [15, 15]);
    assert.strictEqual(r.values.timeCostLaps, 0.5);
});

t('stintSplit: rema dibagikan ke stint terdepan', () => {
    const r = IGPCore.stintSplit({ totalLaps: 31, tireLifeLaps: 12, pitLossLaps: 0.5 });
    assert.strictEqual(r.values.segments, 3);              // ceil(31/12)
    assert.deepStrictEqual(r.values.stints, [11, 10, 10]);
    assert.strictEqual(r.values.timeCostLaps, 1);          // 2 * 0.5
});

t('stintSplit: ban lebih awet dari balapan → 0 stop', () => {
    const r = IGPCore.stintSplit({ totalLaps: 10, tireLifeLaps: 20, pitLossLaps: 1 });
    assert.strictEqual(r.values.stops, 0);
    assert.deepStrictEqual(r.values.stints, [10]);
});

t('stintSplit: input tak valid', () => {
    assert.strictEqual(IGPCore.stintSplit({ totalLaps: 0, tireLifeLaps: 10 }).ok, false);
    assert.strictEqual(IGPCore.stintSplit({ totalLaps: 10, tireLifeLaps: 0 }).ok, false);
});

console.log('\nSemua ' + n + ' test lulus ✔');
