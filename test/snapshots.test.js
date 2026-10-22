// Test adapter snapshot Fase 3 — DOM nyata hasil capture (fixture jsdom).
// Adapter HARUS lulus di sini karena selektor dipetakan dari halaman iGP asli.
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { AdapterRegistry, Storage } = require("../src/igpas.user.js");

let pass = 0,
  fail = 0;
function t(name, fn) {
  try {
    fn();
    pass++;
    console.log("  ✔ " + name);
  } catch (e) {
    fail++;
    console.error("  ✗ " + name + " — " + e.message);
  }
}
function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error((msg || "") + " " + JSON.stringify(a) + " != " + JSON.stringify(b));
  }
}

const carsDoc = new JSDOM(fs.readFileSync(path.join(__dirname, "fixtures/cars.html"), "utf8"))
  .window.document;
const accDoc = new JSDOM(fs.readFileSync(path.join(__dirname, "fixtures/account.html"), "utf8"))
  .window.document;
const engSupDoc = new JSDOM(
  fs.readFileSync(path.join(__dirname, "fixtures/supply-engine.html"), "utf8")
).window.document;
const fuelSupDoc = new JSDOM(
  fs.readFileSync(path.join(__dirname, "fixtures/supply-fuel.html"), "utf8")
).window.document;
const tyreSupDoc = new JSDOM(
  fs.readFileSync(path.join(__dirname, "fixtures/supply-tyre.html"), "utf8")
).window.document;
const mfrEngDoc = new JSDOM(
  fs.readFileSync(path.join(__dirname, "fixtures/manufacturers-engines.html"), "utf8")
).window.document;
const mfrChsDoc = new JSDOM(
  fs.readFileSync(path.join(__dirname, "fixtures/manufacturers-chassis.html"), "utf8")
).window.document;
const blankDoc = new JSDOM("<html><body></body></html>").window.document;
const raceDoc = new JSDOM(fs.readFileSync(path.join(__dirname, "fixtures/race.html"), "utf8"))
  .window.document;

t("car-data: gate pageId — halaman lain ditolak", () => {
  const r = AdapterRegistry.capture("car-data", blankDoc);
  eq(r.ok, false);
});

t("car-data: atribut mobil terbaca (8 kanal kanonis)", () => {
  const r = AdapterRegistry.capture("car-data", carsDoc);
  eq(r.ok, true);
  eq(r.data.carType, "Sprint car");
  eq(r.data.dmax, 300);
  eq(r.data.designPoints, 200);
  eq(r.data.attrs.acceleration, { label: "Acceleration", val: 53 });
  eq(r.data.attrs.tyre_economy.val, 47);
  eq(Object.keys(r.data.attrs).length, 8);
});

t("car-data: bonus supplier terurai dari data-tip", () => {
  const r = AdapterRegistry.capture("car-data", carsDoc);
  eq(r.data.bonuses.find(b => b.key === "Braking").bonus, 15);
  eq(r.data.bonuses.find(b => b.key === "Fuel economy").bonus, -7);
  eq(r.data.bonuses.length, 8);
});

t("car-data: id supplier dari filename gambar", () => {
  const r = AdapterRegistry.capture("car-data", carsDoc);
  eq(r.data.suppliers, [
    { kind: "engines", id: "2" },
    { kind: "fuel", id: "8" },
    { kind: "tyres", id: "13" },
  ]);
});

t("car-data: best rival dari leagueDesignData", () => {
  const r = AdapterRegistry.capture("car-data", carsDoc);
  eq(r.data.best.acceleration.max, 300);
  eq(r.data.best.braking.max, 300);
});

t("supply-data: gate — tanpa dialog Supply ditolak", () => {
  eq(AdapterRegistry.capture("supply-data", blankDoc).ok, false);
  eq(AdapterRegistry.capture("supply-data", carsDoc).ok, false);
});

t("supply-data: engine — supplier aktif + bonus + cost/race", () => {
  const r = AdapterRegistry.capture("supply-data", engSupDoc);
  eq(r.ok, true);
  eq(r.data.type, "engine");
  eq(r.data.current.supplierId, 2);
  eq(r.data.current.costPerRace, 500000);
  eq(r.data.current.bonuses, [
    { stat: "Braking", value: 10 },
    { stat: "Fuel economy", value: -6 },
  ]);
});

t("supply-data: engine — 5 alternatif (eId + id gambar + cost)", () => {
  const r = AdapterRegistry.capture("supply-data", engSupDoc);
  eq(r.data.alternatives.length, 5);
  eq(
    r.data.alternatives.map(a => a.eId),
    [1, 3, 4, 5, 6]
  );
  eq(
    r.data.alternatives.map(a => a.supplierId),
    [1, 3, 4, 5, 6]
  );
  eq(r.data.alternatives[4].costPerRace, 400000);
  eq(r.data.alternatives[1].bonuses, [
    { stat: "Acceleration", value: 10 },
    { stat: "Fuel economy", value: -6 },
  ]);
});

t("supply-data: fuel — tipe, id, cost 50k/race, daftar alternatif", () => {
  const r = AdapterRegistry.capture("supply-data", fuelSupDoc);
  eq(r.ok, true);
  eq(r.data.type, "fuel");
  eq(r.data.current.supplierId, 8);
  eq(r.data.current.costPerRace, 50000);
  eq(
    r.data.alternatives.map(a => a.eId),
    [7, 9, 10, 11]
  );
  eq(r.data.alternatives[0].costPerRace, 35000);
});

t("supply-data: tyre — bonus negatif terbaca", () => {
  const r = AdapterRegistry.capture("supply-data", tyreSupDoc);
  eq(r.ok, true);
  eq(r.data.type, "tyre");
  eq(r.data.current.supplierId, 13);
  eq(r.data.current.bonuses.find(b => b.stat === "Tyre economy").value, -3);
  eq(
    r.data.alternatives.find(a => a.eId === 14).bonuses.find(b => b.stat === "Handling").value,
    -1
  );
});

t("supply-data: gate dialog saja — tak bergantung pageId/URL (hal serupa manufacturers)", () => {
  const doc = new JSDOM(
    fs.readFileSync(path.join(__dirname, "fixtures/supply-engine.html"), "utf8")
  ).window.document;
  doc.getElementById("pageId").remove(); // seolah halaman/URL lain — gate tetap hanya `.supplyDialog`
  const r = AdapterRegistry.capture("supply-data", doc);
  eq(r.ok, true);
  eq(r.data.current.supplierId, 2);
});

t("account-data: header akun terbaca penuh", () => {
  const r = AdapterRegistry.capture("account-data", accDoc);
  eq(r.ok, true);
  eq(r.data, {
    manager: "Tester",
    level: "L7",
    rank: "1200",
    rankTier: "challenger-i",
    balance: "8.4m",
    tokens: "12",
  });
});

t("account-data: halaman kosong ditolak", () => {
  const r = AdapterRegistry.capture("account-data", blankDoc);
  eq(r.ok, false);
});

t("account-data: valid di halaman Cars (header global)", () => {
  const r = AdapterRegistry.capture("account-data", carsDoc);
  eq(r.ok, true);
  eq(r.data.balance, "8.4m");
});

t("manufacturer-data: gate pageId — halaman lain ditolak (error sebut halaman aktif)", () => {
  eq(AdapterRegistry.capture("manufacturer-data", blankDoc).ok, false);
  const r = AdapterRegistry.capture("manufacturer-data", carsDoc);
  eq(r.ok, false);
  if (!/halaman aktif: cars/.test(r.error)) throw new Error(r.error);
});

t("manufacturer-data: engine — 20 baris, bentuk data lengkap (baris pertama)", () => {
  const r = AdapterRegistry.capture("manufacturer-data", mfrEngDoc);
  eq(r.ok, true);
  eq(r.data.engines.length, 20);
  eq(r.data.engines[0], {
    id: 5108,
    name: "Akina SpeedStars",
    nationality: "FR",
    ratingPct: 0,
    costPerRace: 500000,
    statsVisible: false,
    customers: 1,
  });
});

t("manufacturer-data: engine — edge case nyata (spasi ganda, 1m, dot, eye)", () => {
  const r = AdapterRegistry.capture("manufacturer-data", mfrEngDoc);
  const byId = id => r.data.engines.find(x => x.id === id);
  eq(byId(148).name, "Aston Martin Red Bull racing"); // spasi ganda di DOM dinormalisasi
  const mous = byId(6381); // trailing spaces + cost '1m' + stats disembunyikan
  eq(
    [mous.name, mous.costPerRace, mous.statsVisible, mous.customers],
    ["Moustache racing", 1000000, false, 20]
  );
  eq(byId(4865).name, "."); // nama " ." -> "."
  const cav = byId(5586);
  eq([cav.ratingPct, cav.statsVisible, cav.costPerRace], [100, true, 500000]);
});

t("manufacturer-data: chassis — kolom tanpa cost/stats + edge case", () => {
  const r = AdapterRegistry.capture("manufacturer-data", mfrEngDoc);
  eq(r.data.chassis.length, 20);
  eq(r.data.chassis[0], {
    id: 14263,
    name: "Bibo Racing",
    nationality: "GB",
    ratingPct: 38,
    customers: 10,
  });
  eq(r.data.chassis.find(x => x.id === 13161).name, "0 failures");
  eq(
    r.data.chassis.find(x => x.id === 17611),
    { id: 17611, name: "Royal Alphä", nationality: "BR", ratingPct: 2, customers: 1 }
  );
  if ("costPerRace" in r.data.chassis[0] || "statsVisible" in r.data.chassis[0]) {
    throw new Error("chassis tidak boleh punya costPerRace/statsVisible");
  }
});

t("manufacturer-data: kedua varian URL (…&tab=engines vs …&tab=chassis) -> data identik", () => {
  const a = AdapterRegistry.capture("manufacturer-data", mfrEngDoc); // fixture = capture URL …&tab=engines
  const b = AdapterRegistry.capture("manufacturer-data", mfrChsDoc); // fixture = capture URL …&tab=chassis
  eq(a.ok, true);
  eq(b.ok, true);
  eq(b.data, a.data); // deteksi berbasis DOM (#pageId), bukan URL — kedua varian lolos & hasil sama
});

t("manufacturer-data: total halaman pager (engine 672 / chassis 204)", () => {
  const r = AdapterRegistry.capture("manufacturer-data", mfrEngDoc);
  eq(r.data.totalPages, { engines: 672, chassis: 204 });
});

t("adapter belum ada -> pesan error jujur", () => {
  const r = AdapterRegistry.capture("race-strategy", carsDoc);
  eq(r.ok, false);
  if (!/belum tersedia/.test(r.error)) throw new Error(r.error);
});

/* ---------- race data (pra-balapan) — snapshot v0.8.4 ---------- */

t("race-setup-data: gate pageId + cuaca/slider/practice terbaca", () => {
  eq(AdapterRegistry.capture("race-setup-data", blankDoc).ok, false);
  const r = AdapterRegistry.capture("race-setup-data", raceDoc);
  eq(r.ok, true);
  eq(r.data.weather, { rainText: "0mm", tempText: "5°C" });
  eq(r.data.drivers.length, 2);
  const d = r.data.drivers[0];
  eq(d.name, "Andi Pratama");
  eq(
    d.sliders.map(s => s.key),
    ["ride", "suspension", "aerodynamics"]
  );
  eq(d.sliders[0].value, 50);
  eq(d.sliders[0].ideal, { left: 0, width: 85 });
  eq(d.sliders[0].dir, "decrease");
  eq(d.practiceLaps, 1);
  eq(d.practiceLast.time, "1:22.512");
  eq(d.practiceHistory[0].timeSec, 82.512);
  eq(d.practiceHistory[0].fuelNum, -2.4);
});

t("race-setup-data: slider memakai nilai hidup, bukan atribut basi", () => {
  const doc = new JSDOM(fs.readFileSync(path.join(__dirname, "fixtures/race.html"), "utf8")).window
    .document;
  const input = doc.querySelector("#setup .setupSliderWrap input");
  eq(input.getAttribute("value"), "50"); // atribut tetap nilai awal
  input.value = "60"; // game menggeser slider → properti berubah
  const r = AdapterRegistry.capture("race-setup-data", doc);
  eq(r.data.drivers[0].sliders[0].value, 60);
});

t("race-strategy-data: gate + strategy/fuel/tyre-life/push level", () => {
  eq(AdapterRegistry.capture("race-strategy-data", blankDoc).ok, false);
  const r = AdapterRegistry.capture("race-strategy-data", raceDoc);
  eq(r.ok, true);
  eq(r.data.raceLaps, 63);
  eq(r.data.rules.two_tyres, "1");
  const d = r.data.drivers[0];
  eq(d.strategy.stints, 4);
  eq(d.strategy.stint["1"].tyre, "M");
  eq(d.fuelPerLap, 2.46);
  eq(d.advancedFuel, 174);
  eq(d.totalLapsGame, 64);
  eq(d.tyreLife, { SS: 12 });
  eq(d.pushLevel, 60);
});

t("race-strategy-data: advancedFuel memakai nilai hidup input", () => {
  const doc = new JSDOM(fs.readFileSync(path.join(__dirname, "fixtures/race.html"), "utf8")).window
    .document;
  const adv = doc.getElementById("d1AdvancedFuel");
  eq(adv.getAttribute("value"), "174");
  adv.value = "200";
  const r = AdapterRegistry.capture("race-strategy-data", doc);
  eq(r.data.drivers[0].advancedFuel, 200);
});

t("race-track-data: gate + karakteristik & panjang sirkuit", () => {
  eq(AdapterRegistry.capture("race-track-data", blankDoc).ok, false);
  const r = AdapterRegistry.capture("race-track-data", raceDoc);
  eq(r.ok, true);
  eq(r.data.name, "Circuit Nordvik");
  eq(r.data.laps, 63);
  eq(r.data.overtaking, 70);
  eq(r.data.bumpiness, 40);
  eq(r.data.fuel, 80);
  eq(r.data.wear, 45);
  eq(r.data.lengthKm, 4.341);
});

t("status registry jujur (ready vs menunggu-map)", () => {
  eq(
    AdapterRegistry.status(),
    "account-data:ready, car-data:ready, supply-data:ready, manufacturer-data:ready, staff-data:ready, transfers-data:ready, race-setup-data:ready, race-strategy-data:ready, race-track-data:ready, race-strategy:menunggu-map"
  );
});

t("Storage: snapshot simpan/baca/hapus", () => {
  Storage.saveSnapshot("account-data", { manager: "X" });
  eq(Storage.getSnapshot("account-data").data.manager, "X");
  Storage.saveSnapshot("car-data", { carType: "Y" });
  eq(Storage.getSnapshot("car-data").data.carType, "Y");
  Storage.clearSnapshots();
  eq(Storage.getSnapshot("account-data"), null);
  eq(Storage.getSnapshot("car-data"), null);
});

t("Storage: mergeSnapshot supply per tipe", () => {
  Storage.clearSnapshots();
  Storage.mergeSnapshot("supply-data", { engine: { type: "engine" } });
  Storage.mergeSnapshot("supply-data", { fuel: { type: "fuel" } });
  const s = Storage.getSnapshot("supply-data");
  eq(Object.keys(s.data).sort(), ["engine", "fuel"]);
  eq(s.data.engine.type, "engine");
  Storage.clearSnapshots();
  eq(Storage.getSnapshot("supply-data"), null);
});

t("Storage: snapshot lebih tua dari TTL (30 hari) diabaikan & dibersihkan", () => {
  Storage.clearSnapshots();
  const realNow = Date.now;
  Date.now = () => realNow() - 31 * 24 * 60 * 60 * 1000; // simpan seolah 31 hari lalu
  Storage.saveSnapshot("account-data", { manager: "Lama" });
  Date.now = realNow;
  eq(Storage.getSnapshot("account-data"), null);
  // Snapshot baru tetap terbaca normal.
  Storage.saveSnapshot("car-data", { carType: "Baru" });
  eq(Storage.getSnapshot("car-data").data.carType, "Baru");
  Storage.clearSnapshots();
});

console.log(pass + fail + " test, " + fail + " gagal");
if (fail > 0) process.exit(1);
