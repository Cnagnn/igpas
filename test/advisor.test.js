// Test Advisor in-page (v0.7.0) — userscript sebenarnya atas fixture DOM nyata
// (jsdom, runScripts outside-only). Verifikasi:
//   - label design (Cars) ditulis ulang in-place di baris asli + label "estimasi";
//   - panel supply di dalam .supplyDialog saat dialog terbuka;
//   - panel ranking engine+chassis di halaman Manufacturers;
//   - TIDAK ada jejak UI advisor di halaman lain (race dsb.);
//   - advisor tidak pernah mengirim packet mailbox (request game = 0).
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const load = fixtureFile => fs.readFileSync(path.join(__dirname, "fixtures", fixtureFile), "utf8");

function bootOn(html, url, snapshotIds) {
  const store = new Map();
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const win = dom.window;
  win.GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
  win.GM_setValue = (k, v) => {
    store.set(k, v);
  };
  win.GM_deleteValue = k => {
    store.delete(k);
  };
  win.GM_listValues = () => [...store.keys()];
  win.GM_setClipboard = () => {}; // stub; test override utk capture
  win.GM_registerMenuCommand = (label, fn) => {
    win.__igpasMenuHandler = fn;
  };
  win.GM_notification = () => {};
  // Snapshot innerHTML SEBELUM userscript jalan (untuk uji "dokumen tak berubah").
  const before = {};
  for (const id of snapshotIds || []) {
    const el = win.document.getElementById(id);
    before[id] = el ? el.innerHTML : null;
  }
  win.eval(fs.readFileSync(path.join(__dirname, "../src/igpas.user.js"), "utf8"));
  win.document.dispatchEvent(new win.Event("DOMContentLoaded")); // idempoten di sisi userscript
  return { win, doc: win.document, store, before, close: () => win.close() };
}

function assert(ok, msg) {
  if (!ok) throw new Error(msg);
}

let pass = 0,
  fail = 0;
const asyncTests = [];
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
function ta(name, fn) {
  asyncTests.push([name, fn]);
}

const URL_IGP = "https://www.igpmanager.com/app/p=cars";

t("Design advisor: peringkat ditulis ke label asli Cars, tanpa elemen baru", () => {
  const s = bootOn(load("cars.html"), URL_IGP);
  // Tanpa section/badge baru: satu-satunya elemen advisor = toggle (+ style di head).
  assert(!s.doc.querySelector("section.igpas-adv-panel"), "panel terpisah masih ada");
  assert(!s.doc.querySelector(".igpas-adv-inline"), "badge sisa versi lama masih ada");
  const rows = s.doc.querySelectorAll("#carAttributesDisplay .attribute-row");
  assert(rows.length === 8, "baris asli harus tetap 8, dapat " + rows.length);
  const labels = Array.prototype.map.call(
    rows,
    r => r.querySelector(".attribute-rating-header span:not(.ratingVal)").textContent
  );
  assert(
    labels.every(x => /^#\d+ /.test(x)),
    "semua label harus diawali peringkat (dapat: " + labels.join(" | ") + ")"
  );
  assert(labels.filter(x => /^#1 /.test(x)).length === 1, "harus tepat satu peringkat #1");
  assert(
    /^#1 Fuel economy · 26 DP$/.test(labels.filter(x => /^#1 /.test(x))[0]),
    "peringkat #1 harus Fuel economy ±26 DP (dapat: " + labels.join(" | ") + ")"
  );
  // Teks asli tersimpan untuk restore; angka & bar game tidak disentuh.
  assert(
    s.doc.querySelector("#wrap-acceleration").getAttribute("data-igpas-orig") === "Acceleration",
    "teks asli tidak disimpan di data-igpas-orig"
  );
  assert(
    s.doc.querySelector("#wrap-acceleration .ratingVal").textContent.trim() === "53",
    "nilai game ikut berubah"
  );
  assert(
    s.doc.querySelector("#wrap-acceleration .ratingBar div").getAttribute("style") === "width:18%",
    "bar game ikut berubah"
  );
  // Detail + estimasi di title baris yang sama.
  const t1 = s.doc.querySelector("#wrap-fuel_economy").getAttribute("title");
  assert(/max liga/i.test(t1), "title tanpa max liga");
  assert(/estimasi/i.test(t1), "title tanpa label estimasi");
  s.close();
});

t("Supply advisor: peringkat ditulis ke kartu asli dialog (engine), tanpa elemen baru", () => {
  const s = bootOn(load("supply-engine.html"), URL_IGP);
  // Tanpa panel terpisah: satu-satunya elemen advisor = toggle (+ style di head).
  assert(!s.doc.querySelector("section.igpas-adv-panel"), "panel terpisah masih ada");
  const links = Array.prototype.slice.call(s.doc.querySelectorAll(".supplyDialog a.btn.confirm"));
  assert(links.length === 5, "kartu alternatif harus 5, dapat " + links.length);
  const texts = links.map(a => {
    for (const nd of a.childNodes) {
      if (nd.nodeType === 3 && nd.textContent.trim() !== "") return nd.textContent;
    }
    return "";
  });
  assert(
    texts.every(x => /^#\d+ /.test(x)),
    "semua biaya harus diawali peringkat (dapat: " + texts.join(" | ") + ")"
  );
  assert(texts.filter(x => /^#1 /.test(x)).length === 1, "harus tepat satu peringkat #1");
  // Σ6/400k = nilai/1M tertinggi → #1 + ★; termurah 350k → #2 + penanda.
  assert(
    texts.some(x => /^#1 · 400k ★$/.test(x)),
    "peringkat #1 harus supplier #6 400k ★ (dapat: " + texts.join(" | ") + ")"
  );
  assert(
    texts.some(x => /^#2 · 350k · termurah$/.test(x)),
    "termurah harus #2 350k (dapat: " + texts.join(" | ") + ")"
  );
  // Teks asli tersimpan; ikon & data-tip game tidak disentuh.
  const first = links[0];
  assert(
    first.getAttribute("data-igpas-orig") === "350k",
    "biaya asli tidak disimpan di data-igpas-orig"
  );
  assert(first.querySelector('img[src*="/img/cash2-64.webp"]'), "ikon biaya game hilang");
  assert(/eId=1/.test(first.getAttribute("data-tip") || ""), "data-tip game ikut berubah");
  // Detail + estimasi di title kartu yang sama.
  const card = first.closest(".inline-block");
  assert(/Σ bonus \+5/.test(card.getAttribute("title") || ""), "title tanpa Σ bonus");
  assert(/nilai\/1M/.test(card.getAttribute("title") || ""), "title tanpa nilai/1M");
  assert(/estimasi/i.test(card.getAttribute("title") || ""), "title tanpa label estimasi");
  // Verdict aktif ditulis ke judul dialog asli.
  const h2 = s.doc.querySelector(".dialog-subhead-content h2");
  assert(
    h2.textContent === "Engine supply · bonus kalah, biaya kalah vs alternatif",
    "judul verdict salah: " + h2.textContent
  );
  assert(
    /Supplier aktif #2/.test(h2.getAttribute("title") || ""),
    "title judul tanpa supplier aktif"
  );
  assert(
    /350 rb.*#1/.test(h2.getAttribute("title") || ""),
    "title judul tanpa pembanding termurah"
  );
  assert(/estimasi/i.test(h2.getAttribute("title") || ""), "title judul tanpa label estimasi");
  s.close();
});

t("Supply advisor: dialog Fuel — peringkat in-place + tipe fuel", () => {
  const s = bootOn(load("supply-fuel.html"), URL_IGP);
  assert(!s.doc.querySelector("section.igpas-adv-panel"), "panel terpisah masih ada");
  const texts = Array.prototype.map.call(
    s.doc.querySelectorAll(".supplyDialog a.btn.confirm"),
    a => {
      for (const nd of a.childNodes) {
        if (nd.nodeType === 3 && nd.textContent.trim() !== "") return nd.textContent;
      }
      return "";
    }
  );
  assert(texts.length === 4, "kartu fuel harus 4, dapat " + texts.length);
  assert(
    texts.every(x => /^#\d+ /.test(x)),
    "label tanpa peringkat: " + texts.join(" | ")
  );
  // Semua Σ2 → urut biaya: 30k #1 ★, 35k #2, 40k #3, 60k #4.
  assert(
    texts.some(x => /^#1 · 30k ★$/.test(x)),
    "peringkat #1 fuel salah: " + texts.join(" | ")
  );
  const h2 = s.doc.querySelector(".dialog-subhead-content h2");
  assert(
    /^Fuel supply/.test(h2.textContent),
    "judul dialog fuel berubah tak dikenal: " + h2.textContent
  );
  s.close();
});

t("Supply advisor: dialog Tyre — peringkat in-place + tipe tyre", () => {
  const s = bootOn(load("supply-tyre.html"), URL_IGP);
  assert(!s.doc.querySelector("section.igpas-adv-panel"), "panel terpisah masih ada");
  const texts = Array.prototype.map.call(
    s.doc.querySelectorAll(".supplyDialog a.btn.confirm"),
    a => {
      for (const nd of a.childNodes) {
        if (nd.nodeType === 3 && nd.textContent.trim() !== "") return nd.textContent;
      }
      return "";
    }
  );
  assert(texts.length === 4, "kartu tyre harus 4, dapat " + texts.length);
  assert(
    texts.every(x => /^#\d+ /.test(x)),
    "label tanpa peringkat: " + texts.join(" | ")
  );
  // Σ4/60k → #1 ★; termurah 50k → #2 + penanda.
  assert(
    texts.some(x => /^#1 · 60k ★$/.test(x)),
    "peringkat #1 tyre salah: " + texts.join(" | ")
  );
  assert(
    texts.some(x => /^#2 · 50k · termurah$/.test(x)),
    "termurah tyre salah: " + texts.join(" | ")
  );
  const h2 = s.doc.querySelector(".dialog-subhead-content h2");
  assert(
    /^Tyre supply/.test(h2.textContent),
    "judul dialog tyre berubah tak dikenal: " + h2.textContent
  );
  s.close();
});

t(
  "Manufacturers advisor: peringkat ditulis ke baris asli engine & chassis, tanpa elemen baru",
  () => {
    const s = bootOn(
      load("manufacturers-engines.html"),
      "https://www.igpmanager.com/app/p=manufacturers"
    );
    assert(!s.doc.querySelector("section.igpas-adv-panel"), "panel terpisah masih ada");
    for (const tid of ["engine-table", "chassis-table"]) {
      const rows = s.doc.querySelectorAll("#" + tid + " tbody tr");
      assert(rows.length > 0, "tabel " + tid + " kosong");
      const names = Array.prototype.map.call(rows, tr => {
        const tds = tr.querySelectorAll("td");
        for (const nd of tds[0].childNodes) {
          if (nd.nodeType === 3 && nd.textContent.trim() !== "") return nd.textContent;
        }
        return "";
      });
      assert(
        names.every(x => /^#\d+ /.test(x)),
        tid + ": baris tanpa peringkat (" + names.slice(0, 3).join(" | ") + "…)"
      );
      assert(
        names.filter(x => /^#1 /.test(x)).length === 1,
        tid + ": harus tepat satu peringkat #1"
      );
    }
    // Engine: rating 100 + rating/1M tertinggi → CAVEIRA #1.
    const engNames = Array.prototype.map.call(
      s.doc.querySelectorAll("#engine-table tbody tr td:first-child"),
      td => {
        for (const nd of td.childNodes) {
          if (nd.nodeType === 3 && nd.textContent.trim() !== "") return nd.textContent;
        }
        return "";
      }
    );
    assert(
      engNames.some(x => /^#1 CAVEIRA$/.test(x)),
      "peringkat #1 engine harus CAVEIRA (dapat: " +
        engNames
          .filter(x => /^#\d+ /.test(x))
          .slice(0, 5)
          .join(" | ") +
        ")"
    );
    // Chassis: rating tertinggi → '0 failures' #1 (urutan nama lokal).
    const chNames = Array.prototype.map.call(
      s.doc.querySelectorAll("#chassis-table tbody tr td:first-child"),
      td => {
        for (const nd of td.childNodes) {
          if (nd.nodeType === 3 && nd.textContent.trim() !== "") return nd.textContent;
        }
        return "";
      }
    );
    assert(
      chNames.some(x => /^#1 0 failures$/.test(x)),
      "peringkat #1 chassis salah (dapat: " + chNames.filter(y => /^#1 /.test(y)).join(" | ") + ")"
    );
    // Nama asli tersimpan; link, flag, rating game tidak disentuh.
    const caveira = Array.prototype.slice
      .call(s.doc.querySelectorAll("#engine-table tbody tr"))
      .filter(tr => /^#1 /.test(tr.textContent))[0];
    assert(
      caveira.getAttribute("data-igpas-orig") === "CAVEIRA",
      "nama asli tidak disimpan di data-igpas-orig"
    );
    assert(caveira.querySelector('a[href*="id="]'), "link game hilang");
    assert(
      /Rating: 100%/.test(caveira.querySelector(".tooltip").getAttribute("data-tip") || ""),
      "rating game ikut berubah"
    );
    // Detail + estimasi di title baris yang sama.
    assert(/rating 100%/.test(caveira.getAttribute("title") || ""), "title tanpa rating");
    assert(/rating\/1M/.test(caveira.getAttribute("title") || ""), "title engine tanpa rating/1M");
    assert(/estimasi/i.test(caveira.getAttribute("title") || ""), "title tanpa label estimasi");
    s.close();
  }
);

t(
  "Keamanan: halaman lain (race tanpa wadah tab/unknown) tidak mendapat UI advisor sedikit pun",
  () => {
    const s = bootOn(
      '<!doctype html><html><body><input id="pageId" value="race"></body></html>',
      "https://www.igpmanager.com/app/index.php?page=raceStrategy"
    );
    for (const id of [
      "igpas-adv-toggle",
      "igpas-adv-design",
      "igpas-adv-supply",
      "igpas-adv-supply-compare",
      "igpas-adv-mfg-engine",
      "igpas-adv-mfg-chassis",
      "igpas-adv-team",
      "igpas-adv-team-compare",
      "igpas-adv-tx-driver",
      "igpas-adv-tx-staff",
      "igpas-adv-tx-compare",
      "igpas-adv-rsetup",
      "igpas-adv-rsetup-wrap",
      "igpas-adv-rstrategy",
      "igpas-adv-rstrategy-wrap",
    ]) {
      assert(!s.doc.getElementById(id), "elemen advisor bocor di halaman race: " + id);
    }
    assert(!s.doc.querySelector(".igpas-adv-panel"), "panel advisor bocor di race tanpa wadah tab");
    s.close();
  }
);

t("Advisor read-only: tidak mengirim packet mailbox (tidak memicu request game)", () => {
  const s = bootOn(load("cars.html"), URL_IGP);
  const sent = [...s.store.keys()].filter(k => k.indexOf("igpas:mb:collect-") === 0);
  assert(!sent.length, "advisor mengirim collect-request: " + sent.join(","));
  s.close();
});

t("Toggle advisor: sembunyikan/sembunyikan panel, aria-pressed sinkron, preferensi persist", () => {
  const s = bootOn(load("cars.html"), URL_IGP);
  const btn = s.doc.getElementById("igpas-adv-toggle");
  assert(btn, "tombol toggle tidak ada");
  btn.click();
  assert(s.doc.body.classList.contains("igpas-adv-hide"), "panel tidak tersembunyi setelah toggle");
  assert(btn.getAttribute("aria-pressed") === "true", "aria-pressed tidak true saat sembunyi");
  assert((s.store.get("igpas:advisor") || {}).hidden === true, "preferensi tidak tersimpan");
  btn.click();
  assert(!s.doc.body.classList.contains("igpas-adv-hide"), "panel tidak tampil kembali");
  s.close();
});

t("PageCapture: menu Tampermonkey menyalin DOM dengan PII teredaksi (tanpa UI halaman)", () => {
  const s = bootOn(
    "<!doctype html><html><body>" +
      '<input id="pageId" value="develop">' +
      '<span id="myProfileName">Rahasia Manager</span>' +
      '<span id="balanceText">$12.345.678</span>' +
      '<span id="tokens-total">42</span>' +
      '<span id="managerRankValue">1234</span>' +
      '<div id="design-target">Design page harness</div>' +
      "</body></html>",
    "https://www.igpmanager.com/app/p=develop"
  );
  const captured = [];
  // simulasi menu capture user-driven (tidak ada UI yang di-inject ke halaman)
  s.win.GM_setClipboard = (data, type) => captured.push({ data: data, type: type });
  const handler = s.win.__igpasMenuHandler;
  assert(typeof handler === "function", "menu capture tidak terdaftar");
  assert(
    !s.doc.getElementById("igpas-adv-toggle") && !s.doc.getElementById("igpas-adv-design"),
    "halaman develop belum terpetakan tapi ada UI advisor (harusnya tidak)"
  );
  handler();
  assert(captured.length === 1, "clipboard tidak terisi");
  assert(captured[0].type === "text/html", "tipe clipboard bukan text/html");
  const html = captured[0].data;
  assert(
    html.indexOf("Rahasia Manager") === -1 && html.indexOf("[REDACTED]") >= 0,
    "nama manager tidak teredaksi"
  );
  assert(html.indexOf("$12.345.678") === -1, "saldo tidak teredaksi");
  assert(html.indexOf(">42<") === -1, "token tidak teredaksi");
  assert(html.indexOf("1234") === -1, "angka rank tidak teredaksi");
  assert(html.indexOf("design-target") >= 0, "isi DOM halaman tidak ikut tersalin");
  s.close();
});

t(
  "Staff advisor: panel kondisi tim di halaman staff (health rendah ditandai, pit crew terkunci disebut)",
  () => {
    const s = bootOn(load("staff.html"), "https://www.igpmanager.com/app/p=staff");
    const panel = s.doc.getElementById("igpas-adv-team");
    assert(panel, "panel team tidak ada");
    assert(
      panel.previousElementSibling && panel.previousElementSibling.id === "drivers",
      "panel tidak ditempel tepat setelah blok driver"
    );
    const txt = panel.textContent;
    assert(txt.indexOf("Syarif Hartono") >= 0, "nama driver 1 tidak tampil");
    assert(txt.indexOf("Kevin Yudhoyono") >= 0, "nama driver 2 tidak tampil");
    assert(txt.indexOf("sehat rendah") >= 0, "peringatan health rendah tidak tampil (health 2%)");
    assert(
      txt.indexOf("Chief Designer") >= 0 &&
        txt.indexOf("Technical Director") >= 0 &&
        txt.indexOf("Doctor") >= 0,
      "kartu staff/roleId tidak tampil"
    );
    assert(txt.indexOf("unlock at level 5") >= 0, "status pit crew terkunci tidak disebut");
    assert(/estimasi/i.test(txt), "label estimasi tidak tampil");
    s.close();
  }
);

t("Transfers advisor: panel driver pasar (rank, overall, fee, special ability)", () => {
  const s = bootOn(load("transfers.html"), "https://www.igpmanager.com/app/p=transfers");
  const panel = s.doc.getElementById("igpas-adv-tx-driver");
  assert(panel, "panel driver transfer tidak ada");
  assert(
    panel.nextElementSibling && panel.nextElementSibling.id === "driver-table",
    "panel tidak tepat sebelum tabel driver"
  );
  const txt = panel.textContent;
  assert(txt.indexOf("Breno Maur") >= 0, "driver terbaik (39.51) tidak di baris atas");
  assert(
    txt.indexOf("rating tertinggi") >= 0 && txt.indexOf("nilai terbaik") >= 0,
    "tanda belum lengkap"
  );
  assert(txt.indexOf("Street circuits") >= 0, "special ability tidak tampil");
  assert(txt.indexOf("Overall/1M") >= 0, "kolom heuristik value tidak tampil");
  assert(/estimasi/i.test(txt), "label estimasi tidak tampil");
  const firstRowRank = panel.querySelector("tbody tr td");
  assert(
    firstRowRank && firstRowRank.textContent.indexOf("Breno") > -1,
    "urutan #1 bukan overall tertinggi"
  );
  s.close();
});

t("Transfers advisor: panel staff pasar per peran (CD/TD/DR + spesialisasi hijau/merah)", () => {
  const s = bootOn(load("transfers.html"), "https://www.igpmanager.com/app/p=transfers");
  const panel = s.doc.getElementById("igpas-adv-tx-staff");
  assert(panel, "panel staff transfer tidak ada");
  assert(
    panel.nextElementSibling && panel.nextElementSibling.id === "staff-table",
    "panel tidak tepat sebelum tabel staff"
  );
  const txt = panel.textContent;
  assert(
    txt.indexOf("Chief Designer") >= 0 &&
      txt.indexOf("Technical Director") >= 0 &&
      txt.indexOf("Doctor") >= 0,
    "kelompok peran tidak tampil"
  );
  assert(
    txt.indexOf("+Tyre economy") >= 0 && txt.indexOf("−Braking") >= 0,
    "trait hijau/merah CD terbaik tidak tampil"
  );
  assert(txt.indexOf("Kerekes") === -1, "data yang tidak ada di fixture tidak boleh muncul");
  assert(/heuristik estimasi/i.test(txt), "label heuristik tidak tampil");
  s.close();
});

/* ---------- Perbandingan keputusan (v0.8.0): lebih bagus / lebih buruk / sama ---------- */

const URL_TRANSFERS = "https://www.igpmanager.com/app/p=transfers";

t("Banding supply: verdict aktif vs alternatif tertulis di judul dialog (dua sumbu)", () => {
  const s = bootOn(load("supply-engine.html"), URL_IGP);
  assert(!s.doc.getElementById("igpas-adv-supply-compare"), "panel banding lama masih ada");
  const h2 = s.doc.querySelector(".dialog-subhead-content h2");
  // aktif Σ4 vs terbaik Σ6 (#6) → bonus kalah; aktif 500k vs termurah 350k (#1) → biaya kalah.
  assert(
    h2.textContent.indexOf("bonus kalah") >= 0,
    "verdict Σ bonus tidak muncul di judul: " + h2.textContent
  );
  assert(
    h2.textContent.indexOf("biaya kalah") >= 0,
    "verdict biaya tidak muncul di judul: " + h2.textContent
  );
  const title = h2.getAttribute("title") || "";
  assert(title.indexOf("350 rb") >= 0, "pembanding biaya termurah tidak tampil di title");
  assert(/estimasi, bukan rumus game/i.test(title), "batasan heuristik tidak dinyatakan di title");
  assert(/#6/.test(title), "pembanding bonus terbaik tidak tampil di title");
  s.close();
});

t(
  "Banding pasar (Transfers): tanpa snapshot roster → jujur minta capture, bukan angka karangan",
  () => {
    const s = bootOn(load("transfers.html"), URL_TRANSFERS);
    const panel = s.doc.getElementById("igpas-adv-tx-compare");
    assert(panel, "panel banding pasar tidak ada");
    const txt = panel.textContent;
    assert(/snapshot roster/i.test(txt), "tidak menjelaskan snapshot roster belum ada");
    assert(/Drivers|Staff/i.test(txt), "tidak menunjuk halaman sumber roster");
    // Tanpa snapshot tidak boleh ada baris verdict sama sekali (judul panel
    // memang menyebut ketiga verdict sebagai penjelasan, jadi tabel yang dicek)
    assert(!panel.querySelector("table"), "tabel verdict muncul tanpa data pembanding");
    s.close();
  }
);

t("Banding pasar (Transfers): dengan snapshot roster → verdict per sumbu tampil", () => {
  const store = new Map();
  store.set("igpas:snapshots", {
    "staff-data": {
      ts: Date.now(),
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
      },
    },
  });
  const dom = new JSDOM(load("transfers.html"), {
    url: URL_TRANSFERS,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const win = dom.window;
  win.GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
  win.GM_setValue = (k, v) => {
    store.set(k, v);
  };
  win.GM_deleteValue = k => {
    store.delete(k);
  };
  win.GM_listValues = () => [...store.keys()];
  win.GM_setClipboard = () => {};
  win.GM_registerMenuCommand = () => {};
  win.GM_notification = () => {};
  win.eval(fs.readFileSync(path.join(__dirname, "../src/igpas.user.js"), "utf8"));
  win.document.dispatchEvent(new win.Event("DOMContentLoaded"));
  const panel = win.document.getElementById("igpas-adv-tx-compare");
  assert(panel, "panel banding pasar tidak ada (dengan snapshot)");
  const txt = panel.textContent;
  // Syarif 60 vs rating tertinggi pasar 39.51 → lebih bagus
  assert(txt.indexOf("Syarif Hartono") >= 0, "roster driver tidak tampil");
  assert(/▲ lebih bagus/.test(txt), "verdict driver (60 vs 39.51) tidak muncul");
  // Fanissa CD tanpa indeks stat → sumbu gaji: 50k vs termurah 31k → lebih buruk
  assert(txt.indexOf("Fanissa Panjaitan") >= 0, "roster staff tidak tampil");
  assert(/▼ lebih buruk/.test(txt), "verdict staff via sumbu gaji tidak muncul");
  assert(/tak terbaca/.test(txt), "sisi tanpa angka (kartu Teams) tidak ditandai tak terbaca");
  assert(txt.indexOf("Chief Designer") >= 0, "peran CD tidak dirapikan jadi label");
  assert(/estimasi — bukan rumus game/i.test(txt), "batasan heuristik tidak dinyatakan");
  win.close();
});

/* ---------- Race (v0.7.3; v0.7.4: capture practice nyata): estimasi Setup & Strategy ---------- */

const URL_RACE = "https://www.igpmanager.com/app/index.php?page=race&tab=race";

t(
  "Race: panel estimasi setup dari capture practice nyata (ideal menyempit + arah game + lap terakhir)",
  () => {
    const s = bootOn(load("race.html"), URL_RACE);
    const panel = s.doc.getElementById("igpas-adv-rsetup");
    assert(panel, "panel setup race tidak ada");
    assert(panel.closest("#setup"), "panel setup tidak berada di dalam #setup");
    const wrap = s.doc.getElementById("igpas-adv-rsetup-wrap");
    assert(
      wrap && wrap.contains(panel) && wrap.parentNode === s.doc.getElementById("setup"),
      "wrapper setup race salah tempat"
    );
    const txt = panel.textContent;
    const tblTxt = panel.querySelector("table").textContent; // tabel slider
    assert(txt.indexOf("Estimasi ideal setup") >= 0, "judul panel setup tidak ada");
    // Car 1: bar ideal menyempit (85%, kiri 0/15/0) → mid-bar + selisih + arah label game
    assert(tblTxt.indexOf("≈ 42.5") >= 0, "mid ideal ride/wing (0 + 85/2 = 42.5) tidak tampil");
    assert(tblTxt.indexOf("≈ 57.5") >= 0, "mid ideal suspension (15 + 85/2 = 57.5) tidak tampil");
    assert(
      txt.indexOf("+7.5") >= 0 && txt.indexOf("-7.5") >= 0,
      "selisih arah (+7.5/−7.5) tidak tampil"
    );
    assert(
      txt.indexOf("↓ kurangi") >= 0 && txt.indexOf("↑ tambah") >= 0,
      "arah game dari kelas label decrease/increase tidak tampil"
    );
    // Car 2: tanpa lap practice → bar penuh = "belum dipelajari" ×3, tanpa angka karangan
    const und = tblTxt.split("belum dipelajari").length - 1;
    assert(und === 3, 'ketiga slider car 2 harus "belum dipelajari", dapat ' + und);
    assert(
      tblTxt.split("≈").length - 1 === 3,
      "hanya 3 mid-bar (car 1) yang boleh muncul — ada angka ideal karangan"
    );
    // Nama generik dari fixture ternsanitasi (blok nama car 2 = driver2Include tersembunyi)
    assert(
      txt.indexOf("Andi Pratama") >= 0 && txt.indexOf("Budi Santoso") >= 0,
      "nama driver generik tidak terbaca"
    );
    // Kondisi: game hanya merender blok health untuk mobil yang rusak (car 2: 8%)
    assert(
      txt.indexOf("kritis — repair dulu") >= 0 && txt.indexOf("8%") >= 0,
      "health 8% tidak ditandai kritis"
    );
    // Komentar engineer dua mobil (kata game)
    assert(
      txt.indexOf("much too high") >= 0 && txt.indexOf("bad shape") >= 0,
      "komentar engineer tidak dikutip"
    );
    // Cuaca dari c-head form setup (.waterLevelText + .weatherTemp "5°C")
    assert(
      txt.indexOf("kering") >= 0 && txt.indexOf("0mm") >= 0 && txt.indexOf("5°C") >= 0,
      "cuaca tidak terbaca"
    );
    // Lap practice terakhir dari tabel game (waktu + pemakaian bensin/ban)
    assert(
      txt.indexOf("1:22.512") >= 0 && txt.indexOf("-2.4") >= 0 && txt.indexOf("-8%") >= 0,
      "lap practice terakhir (waktu/bensin/ban) tidak tampil"
    );
    assert(
      txt.indexOf("jalankan practice untuk mempersempit ideal") >= 0,
      "car 2 tanpa practice harus diminta jalankan practice"
    );
    assert(/Estimasi — bukan rumus game/.test(txt), "label estimasi tidak ada");
    s.close();
  }
);

t(
  "Race: panel ringkasan strategi dari capture practice nyata (fuel 2.460, push level, umur ban)",
  () => {
    const s = bootOn(load("race.html"), URL_RACE);
    const panel = s.doc.getElementById("igpas-adv-rstrategy");
    assert(panel, "panel strategi race tidak ada");
    assert(panel.closest("#strategy"), "panel strategi tidak berada di dalam #strategy");
    const txt = panel.textContent;
    assert(txt.indexOf("Ringkasan strategi") >= 0, "judul panel strategi tidak ada");
    assert(txt.indexOf("64/63 lap") >= 0, "alokasi lap 4 stint (64) vs laps balapan (63) salah");
    // Car 1: fuel prediction presisi game 2.460 L/lap → 63 × 2.46 = 154.98 → ±155 L
    assert(
      txt.indexOf("174 L vs ±155 L") >= 0 &&
        txt.indexOf("sisa 19 L") >= 0 &&
        txt.indexOf("≈7.7 lap") >= 0,
      "hitungan bensin car 1 (2.460 L/lap) tidak sesuai"
    );
    // Car 2: fuel prediction 2.5 L/lap → 157.5 / buffer 16.5 / ≈6.6 lap
    assert(
      txt.indexOf("±157.5 L") >= 0 && txt.indexOf("16.5 L") >= 0 && txt.indexOf("6.6 lap") >= 0,
      "hitungan bensin car 2 (2.5 L/lap) tidak sesuai"
    );
    assert(txt.indexOf("M, M, M, S") >= 0, "susunan ban stint tidak terbaca dari JSON game");
    assert(txt.indexOf("2 compound kering ✓") >= 0, "cek dua-compound (two_tyres=1) gagal");
    assert(txt.indexOf("risiko 60") >= 0, "risk_level game tidak ditampilkan");
    assert(txt.indexOf("push 60") >= 0, "push level (select game) tidak ditampilkan");
    assert(txt.indexOf("umur ban game: SS ±12 lap") >= 0, '#d1TyreLife {"SS":12} tidak dikonsumsi');
    assert(txt.indexOf("Driver utama") >= 0, "label driver utama tidak ada");
    assert(txt.indexOf("snapshot") >= 0, "catatan snapshot (data bisa berubah) tidak ada");
    s.close();
  }
);

t("Race: tab Race LIVE tetap 100% bersih — tanpa node advisor & elemen game tak berubah", () => {
  const s = bootOn(load("race.html"), URL_RACE, ["race"]);
  const liveTab = s.doc.getElementById("race");
  assert(liveTab, "tab #race hilang dari fixture");
  assert(
    s.before.race === liveTab.innerHTML,
    "innerHTML tab Race LIVE berubah setelah boot — pelanggaran read-only"
  );
  assert(
    !s.doc.querySelector('#race .igpas-adv-panel, #race [id^="igpas-adv"]'),
    "ada elemen advisor di dalam tab #race"
  );
  assert(
    s.doc.getElementById("igpas-adv-rsetup") && s.doc.getElementById("igpas-adv-rstrategy"),
    "panel race harusnya tetap terpasang di #setup/#strategy (bukan dihapus seluruhnya)"
  );
  s.close();
});

t("Race: zero panel lain + mailbox tetap senyap di halaman race", () => {
  const s = bootOn(load("race.html"), URL_RACE);
  for (const id of [
    "igpas-adv-design",
    "igpas-adv-supply",
    "igpas-adv-supply-compare",
    "igpas-adv-mfg-engine",
    "igpas-adv-mfg-chassis",
    "igpas-adv-team",
    "igpas-adv-team-compare",
    "igpas-adv-tx-driver",
    "igpas-adv-tx-staff",
    "igpas-adv-tx-compare",
  ]) {
    assert(!s.doc.getElementById(id), "panel halaman studi bocor ke race: " + id);
  }
  assert(
    s.doc.getElementById("igpas-adv-toggle"),
    "toggle advisor harus ada saat panel race tampil"
  );
  const sent = [...s.store.keys()].filter(k => k.indexOf("igpas:mb:collect-") === 0);
  assert(!sent.length, "advisor race mengirim collect-request: " + sent.join(","));
  s.close();
});

ta(
  "Render instan: baris Cars yang disuntik game async langsung berlabel tanpa aksi user",
  async () => {
    // Bangun fixture render-async: tabel kosong (game belum commit DOM).
    const base = new JSDOM(load("cars.html"));
    const bdoc = base.window.document;
    const rowsHtml = bdoc.getElementById("carAttributesDisplay").innerHTML;
    assert(
      (rowsHtml.match(/attribute-row/g) || []).length >= 8,
      "pra-kondisi fixture: butuh 8 baris"
    );
    bdoc.getElementById("carAttributesDisplay").innerHTML = "";
    const s = bootOn(base.serialize(), URL_IGP);
    base.window.close();
    const disp = s.doc.getElementById("carAttributesDisplay");
    assert(disp && disp.children.length === 0, "pra-kondisi: tabel harus kosong");
    assert(
      !s.doc.querySelector(".attribute-row[data-igpas-orig]"),
      "pra-kondisi: belum ada tulisan"
    );
    // Game commit DOM async (satu innerHTML, tanpa klik/keyboard/navigasi dari user).
    disp.innerHTML = rowsHtml;
    // Tunggu antrean observer jsdom — tanpa memanggil renderAll manual.
    await new Promise(r => setTimeout(r, 100));
    const labels = Array.prototype.map.call(
      s.doc.querySelectorAll(
        "#carAttributesDisplay .attribute-row .attribute-rating-header span:not(.ratingVal)"
      ),
      el => el.textContent
    );
    assert(labels.length === 8, "observer tidak me-render: " + labels.length + " label");
    assert(
      labels.every(x => /^#\d+ /.test(x)),
      "label tanpa peringkat: " + labels.join(" | ")
    );
    const first = labels.filter(x => /^#1 /.test(x))[0] || "";
    assert(/^#1 Fuel economy · 26 DP$/.test(first), "prioritas #1 salah: " + labels.join(" | "));
    // Stabil: tidak ada loop render (satu pass tambahan tidak mengubah hasil).
    await new Promise(r => setTimeout(r, 100));
    const labels2 = Array.prototype.map.call(
      s.doc.querySelectorAll(
        "#carAttributesDisplay .attribute-row .attribute-rating-header span:not(.ratingVal)"
      ),
      el => el.textContent
    );
    assert(labels2.join("|") === labels.join("|"), "label berubah sendiri (loop observer?)");
    s.close();
  }
);

(async () => {
  for (const [name, fn] of asyncTests) {
    try {
      await fn();
      pass++;
      console.log("  ✔ " + name);
    } catch (e) {
      fail++;
      console.error("  ✗ " + name + " — " + e.message);
    }
  }
  console.log(
    (fail ? "\n" : "") +
      (pass + fail) +
      " test advisor, " +
      fail +
      " gagal" +
      (fail ? "" : " — semua lulus ✔")
  );
  process.exit(fail ? 1 : 0);
})();
