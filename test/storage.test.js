// Test Storage & failure-path (Node murni) — I.G.P.A.S v0.8.5.
// Fokus: status tulis jujur (kuota/gagal), record snapshot korup/legacy,
// validasi nama profil, dan mailbox yang tidak "spam dispatch" saat hapus gagal.
const store = new Map();
let failWrites = false;
let failDeletes = false;

global.GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
global.GM_setValue = (k, v) => {
  if (failWrites) throw new Error("quota exceeded");
  store.set(k, v);
};
global.GM_deleteValue = k => {
  if (failDeletes) throw new Error("delete failed");
  store.delete(k);
};
global.GM_listValues = () => Array.from(store.keys());

const { Storage, Utils, Mailbox, validateCapture } = require("../src/igpas.user.js");

let pass = 0,
  fail = 0;
function t(name, fn) {
  try {
    store.clear();
    failWrites = false;
    failDeletes = false;
    fn();
    pass++;
    console.log("  ✔ " + name);
  } catch (e) {
    fail++;
    console.error("  ✗ " + name + " — " + e.message);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert gagal");
}
function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error((msg || "") + ": " + JSON.stringify(a) + " != " + JSON.stringify(b));
  }
}

t("profil: simpan/baca/hapus (CRUD) + status tulis", () => {
  assert(Storage.saveProfile("setup-a", { fuel: 32, tyre: 2 }) === true, "saveProfile gagal");
  assert(Storage.saveProfile("setup-b", { fuel: 30 }) === true, "saveProfile kedua gagal");
  eq(Object.keys(Storage.getProfiles()).sort(), ["setup-a", "setup-b"]);
  eq(Storage.getProfiles()["setup-a"], { fuel: 32, tyre: 2 });
  assert(Storage.deleteProfile("setup-a") === true, "deleteProfile gagal");
  eq(Object.keys(Storage.getProfiles()), ["setup-b"]);
  assert(Storage.deleteProfile("tidak-ada") === true, "hapus profil tak ada harus no-op sukses");
});

t("profil: nama tidak aman / snapshot bukan objek ditolak tanpa menulis", () => {
  const before = JSON.stringify(Array.from(store.entries()));
  for (const bad of ["", "__proto__", "constructor", "prototype", "x".repeat(80), 42, null]) {
    assert(
      Storage.saveProfile(bad, { a: 1 }) === false,
      "nama tidak aman diterima: " + String(bad)
    );
  }
  assert(Storage.saveProfile("ok", null) === false, "snapshot null diterima");
  assert(Storage.saveProfile("ok", [1, 2]) === false, "snapshot array diterima");
  eq(JSON.stringify(Array.from(store.entries())), before, "ada penulisan tak sah");
});

t("Utils.isSafeKind: tolak prototype pollution & non-string", () => {
  for (const bad of [
    "",
    "__proto__",
    "constructor",
    "prototype",
    1,
    null,
    undefined,
    "x".repeat(80),
  ]) {
    assert(Utils.isSafeKind(bad) === false, "isSafeKind meloloskan: " + String(bad));
  }
  assert(Utils.isSafeKind("account-data") === true);
});

t("kuota penuh: saveSnapshot & mergeSnapshot melaporkan gagal", () => {
  failWrites = true;
  assert(
    Storage.saveSnapshot("account-data", { manager: "X" }) === false,
    "saveSnapshot pura-pura sukses"
  );
  assert(
    Storage.mergeSnapshot("supply-data", { engine: { type: "engine" } }) === null,
    "mergeSnapshot pura-pura sukses"
  );
  assert(Storage.saveProfile("p", { a: 1 }) === false, "saveProfile pura-pura sukses");
  failDeletes = true;
  assert(Storage.clearSnapshots() === false, "clearSnapshots pura-pura sukses");
});

t("record snapshot korup (data bukan objek) diabaikan & dibersihkan", () => {
  store.set("igpas:snapshots", {
    "account-data": { data: "bukan-objek", ts: Date.now() },
    "car-data": { data: { carType: "OK" }, ts: Date.now() },
  });
  assert(Storage.getSnapshot("account-data") === null, "record korup dibaca");
  assert(!store.get("igpas:snapshots")["account-data"], "record korup tidak dibersihkan");
  eq(Storage.getSnapshot("car-data").data.carType, "OK");
});

t("record tanpa ts (legacy) dianggap kedaluwarsa", () => {
  store.set("igpas:snapshots", { "account-data": { data: { manager: "Lama" } } });
  assert(Storage.getSnapshot("account-data") === null, "record tanpa ts dibaca selamanya");
  assert(!store.get("igpas:snapshots")["account-data"], "record tanpa ts tidak dibersihkan");
});

t("validateCapture: bentuk adapter diterima, bentuk asing ditolak", () => {
  const okAccount = validateCapture("account-data", { manager: "Tester", level: "L7" });
  assert(okAccount === true, "akun valid ditolak");
  assert(
    validateCapture("account-data", { manager: { nested: true } }) === false,
    "manager objek diterima"
  );
  assert(validateCapture("account-data", {}) === false, "objek kosong diterima");
  assert(
    validateCapture("car-data", {
      attrs: {},
      bonuses: [],
      suppliers: [],
      dmax: null,
      designPoints: null,
    }) === true,
    "mobil valid ditolak"
  );
  assert(validateCapture("car-data", { attrs: "x" }) === false, "attrs string diterima");
  assert(
    validateCapture("supply-data", { type: "engine", current: {}, alternatives: [] }) === true,
    "supply valid ditolak"
  );
  assert(
    validateCapture("supply-data", { type: "other", current: {}, alternatives: [] }) === false,
    "tipe supply asing diterima"
  );
  assert(
    validateCapture("manufacturer-data", { engines: [], chassis: [] }) === true,
    "manufaktur valid ditolak"
  );
  assert(
    validateCapture("manufacturer-data", { engines: [] }) === false,
    "chassis hilang diterima"
  );
  assert(
    validateCapture("race-track-data", { overtaking: 40, lengthKm: 5.2 }) === true,
    "track valid ditolak"
  );
  assert(
    validateCapture("race-track-data", { overtaking: "x" }) === false,
    "track string diterima"
  );
  assert(validateCapture("__proto__", { a: 1 }) === false, "kind tidak aman diterima");
});

t("validateCapture: paket raksasa (>256 KB) ditolak", () => {
  const big = { manager: "X", level: "L1", pad: "x".repeat(300 * 1024) };
  assert(validateCapture("account-data", big) === false, "paket raksasa diterima");
});

t("mailbox: hapus gagal → handler TIDAK dipanggil (anti loop dispatch)", () => {
  let hits = 0;
  Mailbox.on("anti-loop", () => {
    hits++;
  });
  store.set("igpas:mb:x1", {
    id: "x1",
    type: "anti-loop",
    to: "*",
    from: "sensor:fake",
    ts: Date.now(),
    payload: {},
  });
  failDeletes = true;
  Mailbox.pollOnce();
  assert(hits === 0, "handler dipanggil padahal paket gagal dihapus");
  assert(store.has("igpas:mb:x1"), "paket terhapus padahal delete gagal");
});

console.log("\n" + pass + " test, " + fail + " gagal" + (fail ? "" : " — semua lulus ✔"));
process.exit(fail ? 1 : 0);
