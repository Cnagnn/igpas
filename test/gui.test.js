// Test GUI Command Center (jsdom, shell nyata docs/app/index.html) — I.G.P.A.S v0.6.2.
// Menguji: mount wiring, autoload saat halaman "dibuka" (collect-request + report-request),
// agregasi hasil per-kind (reqId), simpan snapshot, tombol Capture manual, dan
// alur Capture manufacturers (request → hasil → snapshot + panel terisi).
// Proses terpisah: GM_* + document/location di-stub SEBELUM require (ROLE → 'gui').
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const store = new Map();
global.GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
global.GM_setValue = (k, v) => {
  store.set(k, v);
};
global.GM_deleteValue = k => {
  store.delete(k);
};
global.GM_listValues = () => Array.from(store.keys());

const shell = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
const dom = new JSDOM(shell, { url: "https://cnagnn.github.io/igpas/app/" });
global.window = dom.window;
global.document = dom.window.document;
global.location = dom.window.location;

require("../src/igpas.user.js"); // boot() → ROLE 'gui' → GuiMaster.mount()

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
function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert gagal");
}
const $ = id => dom.window.document.getElementById(id);
const wait = ms => new Promise(r => setTimeout(r, ms));
const mbPackets = () =>
  Array.from(store.entries())
    .filter(([k]) => k.indexOf("igpas:mb:") === 0)
    .map(([, v]) => v)
    .filter(v => v && typeof v === "object");

let autoReqId = null;

(async () => {
  await wait(80);
  if (!$("igpas-gui-version").textContent) {
    // jsdom belum fire DOMContentLoaded — picu manual
    dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
    await wait(80);
  }

  t("mount: badge versi + mode live (userscript aktif)", () => {
    const expected = "GUI v" + require("../package.json").version;
    assert(
      $("igpas-gui-version").textContent === expected,
      "versi: " + $("igpas-gui-version").textContent
    );
    assert(/live/.test($("igpas-gui-mode").textContent), "mode tidak live");
  });

  t("autoload: saat dibuka → collect-request (akun+mobil, reqId) + report-request", () => {
    const reqs = mbPackets().filter(p => p.type === "collect-request");
    const auto = reqs.find(
      p =>
        p.payload &&
        Array.isArray(p.payload.kinds) &&
        p.payload.kinds.indexOf("account-data") >= 0 &&
        p.payload.kinds.indexOf("car-data") >= 0
    );
    assert(auto, "tidak ada collect-request autoload");
    assert(typeof auto.payload.reqId === "string" && auto.payload.reqId, "reqId hilang");
    assert(
      mbPackets().some(p => p.type === "report-request"),
      "report-request (deteksi) tidak terkirim"
    );
    assert(
      $("igpas-snap-status").textContent.indexOf("autoload") === 0,
      "status: " + $("igpas-snap-status").textContent
    );
    autoReqId = auto.payload.reqId;
  });

  // Sensor menjawab: akun sukses; mobil gagal (tab iGP bukan di halaman Cars).
  store.set("igpas:mb:res1", {
    id: "res1",
    type: "collect-result",
    to: "*",
    from: "sensor:test",
    ts: Date.now(),
    payload: {
      reqId: autoReqId,
      kind: "account-data",
      ok: true,
      data: {
        manager: "Tester",
        level: "Level 7",
        rank: "1200",
        rankTier: "Gold",
        balance: "8.4m",
        tokens: "12",
      },
      error: null,
      pageUrl: "https://igpmanager.com/",
    },
  });
  store.set("igpas:mb:res2", {
    id: "res2",
    type: "collect-result",
    to: "*",
    from: "sensor:test",
    ts: Date.now(),
    payload: {
      reqId: autoReqId,
      kind: "car-data",
      ok: false,
      data: null,
      error: "halaman tidak cocok untuk car-data",
      pageUrl: "https://igpmanager.com/",
    },
  });

  await wait(900); // mailbox poll 400 ms

  t("hasil masuk: ringkasan per-kind + snapshot akun tersimpan + kartu terisi", () => {
    const s = $("igpas-snap-status").textContent;
    assert(s.indexOf("akun ✓") >= 0, "ringkasan akun: " + s);
    assert(s.indexOf("mobil ✗") >= 0, "ringkasan mobil: " + s);
    assert(s.indexOf("selesai") >= 0, "tidak final: " + s);
    const snaps = store.get("igpas:snapshots") || {};
    assert(
      snaps["account-data"] && snaps["account-data"].data.manager === "Tester",
      "snapshot akun tidak tersimpan"
    );
    assert(
      $("igpas-snap-account-body").textContent.indexOf("Tester") >= 0,
      "kartu akun tidak terisi"
    );
    assert(
      $("igpas-snap-badge").textContent.indexOf("akun ✓") >= 0,
      "badge: " + $("igpas-snap-badge").textContent
    );
  });

  t("Capture manual: klik tombol → permintaan baru (reqId berbeda)", () => {
    $("igpas-snap-capture").click();
    const reqs = mbPackets().filter(p => p.type === "collect-request");
    const last = reqs[reqs.length - 1];
    assert(last && last.payload.reqId !== autoReqId, "tidak ada permintaan manual baru");
    assert(
      $("igpas-snap-status").textContent.indexOf("Capture") === 0,
      "status: " + $("igpas-snap-status").textContent
    );
  });

  const manualReqId = mbPackets()
    .filter(p => p.type === "collect-request")
    .pop().payload.reqId;
  store.set("igpas:mb:stale", {
    id: "stale",
    type: "collect-result",
    to: "*",
    from: "sensor:old",
    ts: Date.now(),
    payload: {
      reqId: autoReqId,
      kind: "account-data",
      ok: true,
      data: { manager: "STALE", level: "L0", rank: "0", rankTier: null, balance: "0", tokens: "0" },
      error: null,
      pageUrl: "https://igpmanager.com/",
    },
  });
  store.set("igpas:mb:unrequested", {
    id: "unrequested",
    type: "collect-result",
    to: "*",
    from: "sensor:other",
    ts: Date.now(),
    payload: {
      reqId: manualReqId,
      kind: "manufacturer-data",
      ok: true,
      data: { engines: [{ id: 1 }], chassis: [], totalPages: {} },
      error: null,
      pageUrl: "https://igpmanager.com/app/p=manufacturers",
    },
  });

  await wait(900);

  t("hasil stale/unrequested: tidak menimpa snapshot atau status request aktif", () => {
    const snaps = store.get("igpas:snapshots") || {};
    assert(
      snaps["account-data"] && snaps["account-data"].data.manager === "Tester",
      "respons stale menimpa snapshot akun"
    );
    assert(!snaps["manufacturer-data"], "kind yang tidak diminta tersimpan");
    assert(
      $("igpas-snap-status").textContent.indexOf("Capture") === 0,
      "status berubah oleh respons stale/unrequested: " + $("igpas-snap-status").textContent
    );
  });

  // Dua sensor broadcast: error dari sensor pertama tidak boleh mengunci kind.
  $("igpas-snap-capture").click();
  const retryReqId = mbPackets()
    .filter(p => p.type === "collect-request")
    .pop().payload.reqId;
  store.set("igpas:mb:error-first", {
    id: "error-first",
    type: "collect-result",
    to: "*",
    from: "sensor:wrong-tab",
    ts: Date.now(),
    payload: {
      reqId: retryReqId,
      kind: "account-data",
      ok: false,
      data: null,
      error: "halaman tidak cocok untuk account-data",
      pageUrl: "https://igpmanager.com/app/p=cars",
    },
  });
  store.set("igpas:mb:success-after-error", {
    id: "success-after-error",
    type: "collect-result",
    to: "*",
    from: "sensor:right-tab",
    ts: Date.now(),
    payload: {
      reqId: retryReqId,
      kind: "account-data",
      ok: true,
      data: {
        manager: "Tester-2",
        level: "L8",
        rank: "1300",
        rankTier: "gold",
        balance: "9m",
        tokens: "13",
      },
      error: null,
      pageUrl: "https://igpmanager.com/",
    },
  });
  await wait(900);

  t("multi-sensor: sukses dari sensor kedua dapat menggantikan error pertama", () => {
    const snaps = store.get("igpas:snapshots") || {};
    assert(
      snaps["account-data"] && snaps["account-data"].data.manager === "Tester-2",
      "sukses sensor kedua tertolak setelah error sensor pertama"
    );
  });

  // Hasil "ok" dengan bentuk data asing tidak boleh menyentuh storage.
  $("igpas-snap-capture").click();
  const badReqId = mbPackets()
    .filter(p => p.type === "collect-request")
    .pop().payload.reqId;
  const beforeAcc = JSON.stringify((store.get("igpas:snapshots") || {})["account-data"] || null);
  store.set("igpas:mb:bad-shape", {
    id: "bad-shape",
    type: "collect-result",
    to: "*",
    from: "sensor:test",
    ts: Date.now(),
    payload: {
      reqId: badReqId,
      kind: "account-data",
      ok: true,
      data: { manager: { nested: true } },
      error: null,
      pageUrl: "https://igpmanager.com/",
    },
  });
  await wait(900);

  t("skema data asing: tidak ditulis, status menyebut skema", () => {
    const afterAcc = JSON.stringify((store.get("igpas:snapshots") || {})["account-data"] || null);
    assert(beforeAcc === afterAcc, "snapshot tertimpa data berskema asing");
    assert(
      $("igpas-snap-status").title.indexOf("skema") >= 0,
      "detail status: " + $("igpas-snap-status").title
    );
    assert(
      $("igpas-snap-status").textContent.indexOf("akun ✗") >= 0,
      "ringkasan: " + $("igpas-snap-status").textContent
    );
  });

  let mfrReqId = null;
  t("Capture manufacturers: klik → collect-request manufacturer-data + status", () => {
    $("igpas-snap-capture-manufacturers").click();
    const reqs = mbPackets().filter(p => p.type === "collect-request");
    const last = reqs[reqs.length - 1];
    assert(
      last && JSON.stringify(last.payload.kinds) === JSON.stringify(["manufacturer-data"]),
      "kinds: " + JSON.stringify(last && last.payload.kinds)
    );
    mfrReqId = last.payload.reqId;
    assert(
      $("igpas-snap-status").textContent.indexOf("Capture manufacturers") === 0,
      "status: " + $("igpas-snap-status").textContent
    );
  });

  // Sensor menjawab permintaan manufacturers (bentuk data dari adapter nyata).
  store.set("igpas:mb:res3", {
    id: "res3",
    type: "collect-result",
    to: "*",
    from: "sensor:test",
    ts: Date.now(),
    payload: {
      reqId: mfrReqId,
      kind: "manufacturer-data",
      ok: true,
      error: null,
      pageUrl: "https://igpmanager.com/app/p=manufacturers",
      data: {
        engines: [
          {
            id: 5108,
            name: "Akina SpeedStars",
            nationality: "FR",
            ratingPct: 0,
            costPerRace: 500000,
            statsVisible: false,
            customers: 1,
          },
        ],
        chassis: [
          { id: 14263, name: "Bibo Racing", nationality: "GB", ratingPct: 38, customers: 10 },
        ],
        totalPages: { engines: 672, chassis: 204 },
      },
    },
  });
  store.set("igpas:mb:res4", {
    id: "res4",
    type: "collect-result",
    to: "*",
    from: "sensor:other",
    ts: Date.now(),
    payload: {
      reqId: mfrReqId,
      kind: "manufacturer-data",
      ok: true,
      error: null,
      pageUrl: "https://igpmanager.com/app/p=manufacturers&tab=chassis",
      data: {
        engines: [
          {
            id: 9999,
            name: "DUPLICATE",
            nationality: "XX",
            ratingPct: 99,
            costPerRace: 999,
            statsVisible: true,
            customers: 99,
          },
        ],
        chassis: [],
        totalPages: { engines: 1, chassis: 1 },
      },
    },
  });
  store.set("igpas:mb:legacy", {
    id: "legacy",
    type: "collect-result",
    to: "*",
    from: "sensor:legacy",
    ts: Date.now(),
    payload: {
      reqId: null,
      kind: "account-data",
      ok: true,
      data: {
        manager: "LEGACY",
        level: "L0",
        rank: "0",
        rankTier: null,
        balance: "0",
        tokens: "0",
      },
      error: null,
      pageUrl: "https://igpmanager.com/",
    },
  });

  await wait(900);

  t("hasil manufacturers: snapshot tersimpan + panel & badge terisi", () => {
    const snaps = store.get("igpas:snapshots") || {};
    assert(
      snaps["manufacturer-data"] && snaps["manufacturer-data"].data.engines.length === 1,
      "snapshot manufacturers tidak tersimpan"
    );
    assert(
      snaps["manufacturer-data"].data.engines[0].id === 5108,
      "duplicate/sender lain menimpa snapshot manufacturers"
    );
    assert(
      snaps["account-data"].data.manager === "Tester-2",
      "legacy result menimpa snapshot akun"
    );
    assert(
      $("igpas-snap-manufacturer-body").textContent.indexOf("Akina SpeedStars") >= 0,
      "panel manufacturers tidak terisi"
    );
    assert(
      $("igpas-snap-badge").textContent.indexOf("mfr 2/2") >= 0,
      "badge: " + $("igpas-snap-badge").textContent
    );
  });

  /* ---------- Decision Compare (v0.8.0) ---------- */

  t("Decision Compare: tanpa snapshot → jujur menyebut mana yang belum ada", () => {
    const box = $("igpas-compare-body");
    assert(box, "wadah compare tidak ada di shell");
    assert(/belum ada/i.test(box.textContent), "kondisi awal tidak dijelaskan: " + box.textContent);
    assert($("igpas-compare-run"), "tombol Bandingkan tidak ada");
  });

  t("Decision Compare: tombol ambil roster & pasar → collect-request kinds yang benar", () => {
    $("igpas-compare-capture-team").click();
    const tReq = mbPackets()
      .filter(p => p.type === "collect-request")
      .pop();
    assert(
      JSON.stringify(tReq.payload.kinds) === JSON.stringify(["staff-data"]),
      "kinds roster: " + JSON.stringify(tReq.payload.kinds)
    );
  });

  // Sensor menjawab sisi roster (korelasi hanya menerima permintaan aktif).
  store.set("igpas:mb:cmp-team", {
    id: "cmp-team",
    type: "collect-result",
    to: "*",
    from: "sensor:team",
    ts: Date.now(),
    payload: {
      reqId: mbPackets()
        .filter(p => p.type === "collect-request")
        .pop().payload.reqId,
      kind: "staff-data",
      ok: true,
      error: null,
      pageUrl: "https://igpmanager.com/app/p=staff",
      data: {
        drivers: [
          {
            id: 1,
            name: "Syarif Hartono",
            ability: 5,
            mental: 6,
            statIndex: 60,
            salaryPerRace: 100000,
          },
        ],
        staffCards: [
          { id: 10, role: "Chief Designer", name: "Fanissa Panjaitan", salaryPerRace: 50000 },
        ],
        pitLocked: null,
        reserveCount: 0,
      },
    },
  });
  await wait(900);

  t("Decision Compare: sisi pasar → collect-request kinds yang benar", () => {
    $("igpas-compare-capture-market").click();
    const mReq = mbPackets()
      .filter(p => p.type === "collect-request")
      .pop();
    assert(
      JSON.stringify(mReq.payload.kinds) === JSON.stringify(["transfers-data"]),
      "kinds pasar: " + JSON.stringify(mReq.payload.kinds)
    );
  });

  store.set("igpas:mb:cmp-market", {
    id: "cmp-market",
    type: "collect-result",
    to: "*",
    from: "sensor:market",
    ts: Date.now(),
    payload: {
      reqId: mbPackets()
        .filter(p => p.type === "collect-request")
        .pop().payload.reqId,
      kind: "transfers-data",
      ok: true,
      error: null,
      pageUrl: "https://igpmanager.com/app/p=transfers",
      data: {
        drivers: [
          {
            id: 900,
            name: "Breno Maurício",
            overall: 39.51,
            statIndex: 39.51,
            fee: 988000,
            wage: 49000,
            age: 30,
          },
        ],
        staff: [
          {
            id: 901,
            name: "Christian Rosberg",
            role: "CD",
            overall: 40,
            statIndex: 40,
            fee: 10000,
            wage: 31000,
          },
        ],
        refreshIn: "4m 12s",
      },
    },
  });

  await wait(900);

  t("Decision Compare: snapshot tim & pasar tampil di kartu masing-masing", () => {
    assert(
      $("igpas-snap-team-body").textContent.indexOf("Syarif Hartono") >= 0,
      "kartu team tidak terisi"
    );
    assert(
      $("igpas-snap-team-body").textContent.indexOf("Fanissa Panjaitan") >= 0,
      "staff roster tidak tampil di kartu team"
    );
    assert(
      $("igpas-snap-market-body").textContent.indexOf("Breno Maur") >= 0,
      "kartu market tidak terisi"
    );
    assert(
      $("igpas-snap-market-body").textContent.indexOf("Christian Rosberg") >= 0,
      "staff pasar tidak tampil di kartu market"
    );
  });

  t("Decision Compare: verdict lebih bagus / lebih buruk / sama + sebab tak terbaca", () => {
    const txt = $("igpas-compare-body").textContent;
    assert($("igpas-compare-body").querySelector("table"), "tabel perbandingan tidak dirender");
    assert(txt.indexOf("Syarif Hartono") >= 0, "roster driver tidak tampil");
    assert(/▲ lebih bagus/.test(txt), "Syarif 60 vs 39.51 harusnya lebih bagus");
    assert(txt.indexOf("Fanissa Panjaitan") >= 0, "roster staff tidak tampil");
    assert(/▼ lebih buruk/.test(txt), "Fanissa 50k vs termurah 31k harusnya lebih buruk");
    assert(/tak terbaca/.test(txt), "sisi tanpa indeks stat tidak ditandai tak terbaca");
    assert(txt.indexOf("Chief Designer") >= 0, "peran CD tidak ditampilkan sebagai label");
    assert(
      /Indeks stat/.test(txt) && /bukan overall game/i.test(txt),
      "asumsi angka (bukan overall game) tidak dinyatakan"
    );
    assert(/estimasi — bukan rumus game/i.test(txt), "batasan heuristik tidak dinyatakan");
    assert(/Ringkas/.test(txt), "ringkasan hitungan verdict tidak ada");
  });

  t("Decision Compare: tombol Bandingkan me-render ulang dari snapshot terkini", () => {
    $("igpas-compare-body").innerHTML = "";
    $("igpas-compare-run").click();
    assert(
      /Syarif Hartono/.test($("igpas-compare-body").textContent),
      "tombol Bandingkan tidak me-render ulang panel"
    );
  });

  console.log("\n" + pass + " test, " + fail + " gagal" + (fail ? "" : " — semua lulus ✔"));
  process.exit(fail ? 1 : 0);
})();
