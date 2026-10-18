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
const URL_TRANSFERS = "https://www.igpmanager.com/app/p=transfers";
const URL_RACE = "https://www.igpmanager.com/app/index.php?page=race&tab=race";

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

t("No elemen advisor tambahan atau toggle", () => {
  const s = bootOn(load("cars.html"), URL_IGP);
  assert(!s.doc.querySelector(".igpas-adv-panel"), "panel advisor masih ada");
  assert(!s.doc.getElementById("igpas-adv-toggle"), "toggle advisor masih ada");
  assert(!s.doc.getElementById("igpas-adv-style"), "style advisor masih ada");
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

t("Staff advisor in-place", () => {
  const s = bootOn(load("staff.html"), "https://www.igpmanager.com/app/p=staff");
  assert(!s.doc.querySelector(".igpas-adv-panel"), "panel team masih ada");
  const d = s.doc.querySelector("#d1Pic .driverName");
  assert(d, ".driverName hilang");
  // <br> tidak menyumbang spasi ke textContent: cek kedua potongan nama.
  assert(d.textContent.indexOf("Syarif") >= 0, "nama depan driver hilang");
  assert(d.textContent.indexOf("Hartono") >= 0, "nama belakang driver hilang");
  // Struktur game utuh: br + span tetap ada, tanpa elemen advisor baru.
  assert(d.querySelector("br") && d.querySelector("span"), "struktur .driverName rusak");
  assert(!d.querySelector("[class*=igpas]"), "elemen advisor bocor di .driverName");
  assert(
    /health rendah|pulih/.test(d.getAttribute("title") || ""),
    "rekomendasi driver tidak masuk title"
  );
  const h = s.doc.querySelector("#staff .c-wrap .c-head");
  assert(h && /Chief Designer/i.test(h.textContent), "header staff hilang");
  assert(
    /Gaji|kontrak|rating kartu/i.test(h.getAttribute("title") || ""),
    "detail staff tidak masuk title"
  );
  s.close();
});

t("Transfers advisor in-place driver dan staff", () => {
  const s = bootOn(load("transfers.html"), "https://www.igpmanager.com/app/p=transfers");
  assert(!s.doc.querySelector(".igpas-adv-panel"), "panel transfers masih ada");
  const d = s.doc.querySelector("#driver-table tbody tr td");
  const st = s.doc.querySelector("#staff-table tbody tr td");
  assert(d && /^#\d+ /.test(d.textContent), "driver tidak diberi ranking in-place");
  assert(st && /^#\d+ /.test(st.textContent), "staff tidak diberi ranking in-place");
  // Link & flag game di dalam sel tetap hidup (bukan korban textContent).
  assert(d.querySelector("a.linkParent"), "link kontrak driver rusak");
  assert(d.querySelector("img.flag"), "flag driver hilang");
  assert(
    /overall|estimasi/i.test(d.getAttribute("title") || ""),
    "detail driver tidak masuk title"
  );
  assert(
    /overall|estimasi/i.test(st.getAttribute("title") || ""),
    "detail staff tidak masuk title"
  );
  s.close();
});

/* In-place advisor contract: no comparison panels are injected. */
t("Transfers comparison tidak menyuntik panel", () => {
  const s = bootOn(load("transfers.html"), URL_TRANSFERS);
  assert(!s.doc.querySelector(".igpas-adv-panel"), "panel comparison masih ada");
  s.close();
});

/* Race live/setup/strategy remain untouched: no advisor-owned DOM. */
t("Race tidak menyuntik elemen advisor", () => {
  const s = bootOn(load("race.html"), URL_RACE);
  assert(!s.doc.querySelector(".igpas-adv-panel"), "panel race masih ada");
  assert(!s.doc.querySelector('[id^="igpas-adv"]'), "elemen advisor race masih ada");
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
