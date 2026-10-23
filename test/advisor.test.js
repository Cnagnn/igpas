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
  const writes = []; // spion: userscript TIDAK boleh menulis storage
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const win = dom.window;
  win.GM_setValue = (k, v) => {
    writes.push(k);
  };
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
  return { win, doc: win.document, writes, before, close: () => win.close() };
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

t("Repair advisor: saran fix parts/engine ditulis di judul kartu asli", () => {
  const s = bootOn(load("cars-repair.html"), URL_IGP);
  const clean = el =>
    String(el.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  const heads = Array.prototype.slice.call(s.doc.querySelectorAll("#repair .c-head"));
  assert(heads.length === 2, "kartu mobil harus 2, dapat " + heads.length);
  assert(
    clean(heads[0]) === "Car 1 | FIX parts 30% · engine 62% (tunda)",
    "saran Car 1 salah: " + clean(heads[0])
  );
  assert(
    clean(heads[1]) === "Car 2 | FIX parts 31% · engine 64% (tunda)",
    "saran Car 2 salah: " + clean(heads[1])
  );
  // Teks asli tersimpan untuk restore; tombol game tidak diubah/diklik.
  assert(heads[0].getAttribute("data-igpas-orig") === "Car 1", "teks asli Car 1 tidak disimpan");
  const fix = s.doc.getElementById("c1PartSwap");
  const eng = s.doc.getElementById("c1EngSwap");
  assert(/^Fix\s+6$/.test(clean(fix)), "teks tombol Fix berubah: " + clean(fix));
  assert(/^Replace\s+1$/.test(clean(eng)), "teks tombol Replace berubah: " + clean(eng));
  assert(fix.getAttribute("href").indexOf("btn=c1PartSwap") >= 0, "href tombol Fix berubah");
  assert(!fix.hasAttribute("data-igpas-orig"), "tombol Fix ikut ditulisi advisor");
  // Detail stok/restock/estimasi ada di title kartu dan lingkaran kondisi.
  const headTitle = heads[0].getAttribute("title") || "";
  const condTitle = s.doc.getElementById("c6745727Condition").getAttribute("title") || "";
  const engTitle = s.doc.getElementById("c6745727Engine").getAttribute("title") || "";
  assert(/fix sekarang/.test(condTitle), "title parts tanpa saran fix: " + condTitle);
  assert(/6 parts/.test(condTitle) && /stok 51/.test(condTitle), "title parts tanpa biaya/stok");
  assert(/tunda replace/.test(engTitle), "title engine tanpa saran tunda: " + engTitle);
  assert(/1 engine/.test(engTitle) && /stok 40/.test(engTitle), "title engine tanpa biaya/stok");
  assert(/restock 15 race/.test(engTitle), "title engine tanpa restock");
  assert(/estimasi/i.test(headTitle), "title kartu tanpa label estimasi");
  assert(!s.doc.querySelector("#repair [class*='igpas-adv']"), "elemen advisor bocor di Repair");
  s.close();
});

ta("Restore: judul Repair kembali setelah pindah halaman", async () => {
  const s = bootOn(load("cars-repair.html"), URL_IGP);
  const head = s.doc.querySelector("#repair .c-head");
  const cond = s.doc.getElementById("c6745727Condition");
  assert(/ \| FIX parts /.test(head.textContent), "saran Repair tidak terpasang");
  assert(cond.getAttribute("title"), "title kondisi tidak terpasang");
  s.doc.getElementById("pageId").value = "staff";
  s.doc.getElementById("repair").appendChild(s.doc.createElement("div"));
  await new Promise(r => setTimeout(r, 25));
  assert(
    head.textContent.replace(/\s+/g, " ").trim() === "Car 1",
    "judul Repair tidak kembali: " + head.textContent
  );
  assert(!head.hasAttribute("data-igpas-orig"), "data-igpas-orig tertinggal di judul");
  assert(!head.hasAttribute("title"), "title advisor tertinggal di judul");
  assert(!cond.hasAttribute("title"), "title advisor tertinggal di kondisi");
  assert(!cond.hasAttribute("data-igpas-title"), "data-igpas-title tertinggal di kondisi");
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
    texts.every(x => /^#\d+ · .+\/1M · /.test(x)),
    "semua biaya harus diawali peringkat + nilai/1M (dapat: " + texts.join(" | ") + ")"
  );
  assert(texts.filter(x => /^#1 /.test(x)).length === 1, "harus tepat satu peringkat #1");
  // Aktif 8/1M vs alternatif terbaik Σ6/400k = 15/1M → #1 + ★.
  assert(
    texts.some(x => /^#1 · 15\/1M · 400k ★$/.test(x)),
    "peringkat #1 harus supplier #6 15/1M ★ (dapat: " + texts.join(" | ") + ")"
  );
  assert(
    texts.some(x => /^#2 · 14\.29\/1M · 350k$/.test(x)),
    "peringkat #2 harus 350k (dapat: " + texts.join(" | ") + ")"
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
    h2.textContent === "Engine supply · TERBAIK: ALTERNATIF #1 (15/1M, +88%) · ganti dianjurkan",
    "judul verdict salah: " + h2.textContent
  );
  assert(
    /Supplier aktif #2/.test(h2.getAttribute("title") || ""),
    "title judul tanpa supplier aktif"
  );
  assert(
    /Alternatif terbaik: #1/.test(h2.getAttribute("title") || ""),
    "title judul tanpa alternatif terbaik"
  );
  assert(
    /Aturan: ganti hanya bila alternatif ≥5% lebih efisien/.test(h2.getAttribute("title") || ""),
    "title judul tanpa aturan ambang ganti"
  );
  assert(/estimasi/i.test(h2.getAttribute("title") || ""), "title judul tanpa label estimasi");
  s.close();
});

t("Supply advisor: supplier aktif lebih efisien → alternatif tanpa #1/★", () => {
  // Skenario keluhan: supplier aktif Σ4 @250k = 16/1M, alternatif terbaik
  // Σ6 @400k = 15/1M. Jangan menobatkan alternatif #1 — itu memicu loop ganti
  // supplier. Tampilkan nilai/1M saja dan tegaskan "tetap".
  const s = bootOn(load("supply-engine.html").replace("500k per race", "250k per race"), URL_IGP);
  const links = Array.prototype.slice.call(s.doc.querySelectorAll(".supplyDialog a.btn.confirm"));
  const texts = links.map(a => {
    for (const nd of a.childNodes) {
      if (nd.nodeType === 3 && nd.textContent.trim() !== "") return nd.textContent;
    }
    return "";
  });
  assert(texts.length === 5, "kartu alternatif harus 5, dapat " + texts.length);
  assert(
    texts.every(x => !/^#1 /.test(x)),
    "alternatif masih dinobatkan #1 saat aktif lebih efisien: " + texts.join(" | ")
  );
  assert(
    texts.every(x => /^#[2-9] · .+\/1M · /.test(x)),
    "peringkat gabungan tidak ditulis: " + texts.join(" | ")
  );
  assert(
    texts.every(x => !/★/.test(x)),
    "alternatif masih diberi ★ saat aktif lebih efisien: " + texts.join(" | ")
  );
  const h2 = s.doc.querySelector(".dialog-subhead-content h2");
  assert(
    / · TERBAIK: AKTIF \(16\/1M\) · tetap$/.test(h2.textContent),
    "judul harus menyebut aktif terbaik: " + h2.textContent
  );
  assert(
    /nilai\/1M 16 \(#1 dari 6\)/.test(h2.getAttribute("title") || ""),
    "title judul tanpa peringkat aktif: " + h2.getAttribute("title")
  );
  const card = links[0].closest(".inline-block");
  assert(
    /aktif #1 \(16\/1M\) — tetap/.test(card.getAttribute("title") || ""),
    "title kartu tidak menegaskan tetap: " + card.getAttribute("title")
  );
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
  // Aktif 40/1M. Semua alternatif Σ2 → 30k #1 ★, 35k #2, 40k #3, 60k #5.
  assert(
    texts.some(x => /^#1 · 66\.67\/1M · 30k ★$/.test(x)),
    "peringkat #1 fuel salah: " + texts.join(" | ")
  );
  assert(
    texts.some(x => /^#5 · 33\.33\/1M · 60k$/.test(x)),
    "peringkat gabungan fuel salah: " + texts.join(" | ")
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
  // Aktif 20/1M (seri dengan 100k, aktif menang). 60k → #1 ★; 50k → #2.
  assert(
    texts.some(x => /^#1 · 66\.67\/1M · 60k ★$/.test(x)),
    "peringkat #1 tyre salah: " + texts.join(" | ")
  );
  assert(
    texts.some(x => /^#2 · 60\/1M · 50k$/.test(x)),
    "peringkat #2 tyre salah: " + texts.join(" | ")
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

t("Advisor read-only: tidak menulis GM storage", () => {
  const s = bootOn(load("cars.html"), URL_IGP);
  assert(!s.writes.length, "advisor menulis storage: " + s.writes.join(","));
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

t("PageCapture: field sensitif, email, dan script eksekutabel tidak ikut tersalin", () => {
  const s = bootOn(
    "<!doctype html><html><body>" +
      '<input id="pageId" value="develop">' +
      '<input type="hidden" id="csrfToken" value="abc123secret">' +
      '<input id="d1AdvancedFuel" type="number" value="174">' +
      '<textarea id="notes">private text</textarea>' +
      '<div id="bio">hubungi manager@example.com</div>' +
      '<div data-token="tok_live_123">x</div>' +
      '<script>window.__token = "inline-secret";</script>' +
      '<script type="application/json" id="d1StrategyJson">{"stint":{"1":{"tyre":"M","laps":16}}}</script>' +
      "</body></html>",
    "https://www.igpmanager.com/app/p=develop"
  );
  const captured = [];
  s.win.GM_setClipboard = data => captured.push(data);
  s.win.__igpasMenuHandler();
  const html = captured[0];
  assert(html.indexOf("abc123secret") === -1, "nilai hidden input (csrf) lolos");
  assert(html.indexOf("private text") === -1, "isi textarea lolos");
  assert(html.indexOf("manager@example.com") === -1, "email lolos");
  assert(html.indexOf("tok_live_123") === -1, "atribut data-token lolos");
  assert(html.indexOf("inline-secret") === -1, "script eksekutabel ikut tersalin");
  // Data permainan yang dibutuhkan pemetaan tetap utuh.
  assert(html.indexOf('value="174"') >= 0, "nilai fuel game ikut teredaksi");
  assert(html.indexOf('"tyre":"M"') >= 0, "blok JSON strategi ikut hilang");
  s.close();
});

ta("Restore: anotasi title-only (portrait staff) dibersihkan setelah pindah halaman", async () => {
  const s = bootOn(load("staff.html"), "https://www.igpmanager.com/app/p=staff");
  const name = s.doc.querySelector("#d1Pic .driverName");
  assert(name, ".driverName tidak ada");
  assert(/health|pulih/.test(name.getAttribute("title") || ""), "title advisor tidak terpasang");
  assert(name.hasAttribute("data-igpas-title"), "penanda title advisor tidak ada");
  // Pindah halaman: renderAll berikutnya wajib mengembalikan title asli.
  s.doc.getElementById("pageId").value = "cars";
  s.doc.getElementById("staff").appendChild(s.doc.createElement("div"));
  await new Promise(r => setTimeout(r, 25));
  assert(!name.hasAttribute("title"), "title advisor tertinggal: " + name.getAttribute("title"));
  assert(!name.hasAttribute("data-igpas-title"), "data-igpas-title tertinggal");
  assert(!name.hasAttribute("data-igpas-written-title"), "data-igpas-written-title tertinggal");
  s.close();
});

ta("Restore: teks game yang berubah setelah tulisan advisor tidak ditimpa", async () => {
  const s = bootOn(load("transfers.html"), URL_TRANSFERS);
  const td = s.doc.querySelector("#driver-table tbody tr td");
  assert(/^#\d+ /.test(td.textContent), "ranking advisor tidak tertulis");
  // Game memperbarui sel (AJAX/re-render) setelah advisor menulis.
  td.textContent = "NEW DRIVER NAME";
  s.doc.getElementById("pageId").value = "cars";
  s.doc.getElementById("driver-table").appendChild(s.doc.createElement("div"));
  await new Promise(r => setTimeout(r, 25));
  assert(td.textContent === "NEW DRIVER NAME", "data game tertimpa restore: " + td.textContent);
  assert(!td.hasAttribute("data-igpas-orig"), "data-igpas-orig tertinggal");
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
  // Label bersih: nama | Full Recover <countdown>, bukan jargon "health rendah".
  const span = d.querySelector("span");
  assert(
    / \| Full Recover 14j 49m$/.test(span.textContent),
    "label Full Recover salah: " + span.textContent
  );
  const tip = d.getAttribute("title") || "";
  assert(/Health 2%/.test(tip), "health tidak masuk title: " + tip);
  assert(/pulih 6\.615\/jam/.test(tip), "laju pulih tidak masuk title: " + tip);
  assert(/Full Recover ±14j 49m/.test(tip), "ETA tidak masuk title: " + tip);
  assert(/estimasi/i.test(tip), "title tanpa label estimasi: " + tip);
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

ta("Race live (#race): innerHTML identik sebelum/sesudah boot & re-render", async () => {
  const s = bootOn(load("race.html"), URL_RACE, ["race"]);
  assert(s.before.race != null, "snapshot #race tidak tersedia");
  // Render ulang penuh (navigasi user) tidak boleh menyentuh tab Race live.
  s.doc.body.dispatchEvent(new s.win.Event("click", { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  assert(
    s.doc.getElementById("race").innerHTML === s.before.race,
    "#race berubah setelah render (live-race harus read-only)"
  );
  s.close();
});

ta("Restore manufacturers: nama asli kembali persis, tanpa penggandaan", async () => {
  const s = bootOn(
    load("manufacturers-engines.html"),
    "https://www.igpmanager.com/app/p=manufacturers"
  );
  const rows = Array.prototype.slice.call(s.doc.querySelectorAll("#engine-table tbody tr"));
  const tr = rows.filter(x => /Akina SpeedStars/.test(x.textContent))[0];
  assert(tr, "baris Akina tidak ditemukan");
  const td = tr.querySelector("td");
  assert(/^#\d+ /.test(td.textContent), "ranking tidak tertulis: " + td.textContent);
  s.doc.getElementById("pageId").value = "cars";
  s.doc.getElementById("engine-table").appendChild(s.doc.createElement("div"));
  await new Promise(r => setTimeout(r, 25));
  assert(
    td.textContent.trim() === "Akina SpeedStars",
    "restore manufacturers salah: " + JSON.stringify(td.textContent)
  );
  assert(
    td.textContent.split("Akina SpeedStars").length === 2,
    "nama tergandakan setelah restore: " + td.textContent
  );
  assert(!tr.hasAttribute("data-igpas-orig"), "data-igpas-orig tertinggal");
  s.close();
});

t(
  "Race setup in-place: agregasi practice di nama driver + title engineer, #race tak ditulis",
  () => {
    const s = bootOn(load("race.html"), URL_RACE);
    const raceBox = s.doc.getElementById("race");
    assert(
      raceBox && !raceBox.querySelector("[data-igpas-orig]"),
      "#race ikut ditulis (live-race harus bersih)"
    );
    assert(!raceBox.querySelector("[data-igpas-title]"), "title #race ikut ditulis");
    const span = s.doc.querySelector("#setup .driver1Include .driverName span:last-child");
    assert(
      span && /lap practice/.test(span.textContent),
      "nama driver tanpa ringkasan practice: " + (span && span.textContent)
    );
    assert(/2\.4L\/lap/.test(span.textContent), "fuel/lap practice salah: " + span.textContent);
    assert(/estimasi/i.test(span.getAttribute("title") || ""), "title nama tanpa estimasi");
    const eng = s.doc.querySelector("#d1SetupComments .shrinkText");
    assert(
      eng && /estimasi/i.test(eng.getAttribute("title") || ""),
      "title engineer tanpa estimasi"
    );
    assert(eng.querySelector(".red"), "struktur span merah engineer rusak");
    s.close();
  }
);

t("Race strategy: estimasi di Fuel (litres), komentar asli utuh", () => {
  const pristine = new JSDOM(load("race.html"));
  const pristineComment = pristine.window.document.querySelector(
    "#d1StrategyComments .shrinkText"
  ).textContent;
  pristine.window.close();
  const s = bootOn(load("race.html"), URL_RACE);
  const cmt = s.doc.querySelector("#d1StrategyComments .shrinkText");
  assert(cmt && !/IGPAS:/.test(cmt.textContent), "advisor masih di komentar strategi");
  assert(!cmt.hasAttribute("data-igpas-title"), "komentar masih dianotasi");
  assert(cmt.textContent === pristineComment, "komentar pembalap berubah: " + cmt.textContent);
  const adv = s.doc.getElementById("d1AdvancedFuel");
  assert(
    adv &&
      /153.6 L/.test(adv.closest(".c-wrap").textContent) &&
      !/cadangan|156 L/.test(adv.closest(".c-wrap").textContent),
    "title fuel tanpa rekomendasi"
  );
  // Perbandingan terlihat langsung di label: Total laps estimate × practice/lap.
  assert(
    /estimasi 153\.6 L \/ 64 lap/.test(adv.closest(".c-wrap").textContent),
    "estimasi fuel tidak di label: " + adv.closest(".c-wrap").textContent
  );
  assert(
    /terisi 174 L \(\+20\.4 L\)/.test(adv.closest(".c-wrap").textContent),
    "selisih fuel tidak di label: " + adv.closest(".c-wrap").textContent
  );
  assert(adv.getAttribute("value") === "174", "nilai fuel game ikut berubah");
  assert(/tanpa cadangan tambahan/.test(adv.closest(".c-wrap").title), "cadangan harus nol");
  assert(
    /20.4 L/.test(adv.closest(".c-wrap").title),
    "selisih harus terhadap kebutuhan tanpa cadangan"
  );
  const tot = s.doc.getElementById("d1TotalLaps");
  assert(
    tot && /estimasi/i.test(tot.getAttribute("title") || ""),
    "title total laps tanpa estimasi"
  );
  assert(tot.textContent.trim() === "64", "angka total game ikut berubah");
  // Kedua mobil: label fuel dianotasi, komentar tetap bersih.
  const adv2 = s.doc.getElementById("d2AdvancedFuel");
  assert(
    adv2 && /estimasi \d/.test(adv2.closest(".c-wrap").textContent),
    "driver 2 tanpa estimasi: " + (adv2 && adv2.closest(".c-wrap").textContent)
  );
  const cmt2 = s.doc.querySelector("#d2StrategyComments .shrinkText");
  assert(
    cmt2 && !/IGPAS:/.test(cmt2.textContent) && !cmt2.hasAttribute("data-igpas-title"),
    "komentar driver 2 dianotasi"
  );
  s.close();
});

/* Widget Fuel nyata (tooltip + igpNum game): label dapat estimasi, kontrol utuh. */
ta("Race strategy: widget Fuel asli utuh, reaktif, idempoten, restore bersih", async () => {
  const base = new JSDOM(load("race.html"));
  const bdoc = base.window.document;
  const host = bdoc.getElementById("d1AdvancedFuel").closest(".c-wrap");
  host.innerHTML =
    '<span class="teal tooltip" data-tip="Refuelling during the race is disabled.">' +
    '<svg class="inline-block pointer-events-none align-middle icon-24"><use xlink:href="#md-information-circle"></use></svg></span> Fuel (litres)' +
    '<div class="igpNum s">' +
    '<div class="minus"><svg><use xlink:href="#subtract"></use></svg></div>' +
    '<div class="num green"><span class="valueLine"><span class="value">174</span></span></div>' +
    '<div class="plus"><svg><use xlink:href="#add"></use></svg></div>' +
    "</div>" +
    '<input type="number" value="174" data-initialvalue="174" min="0" max="300" name="advancedFuel" id="d1AdvancedFuel" class="number">';
  const html = base.serialize();
  base.window.close();

  const s = bootOn(html, URL_RACE);
  const adv = s.doc.getElementById("d1AdvancedFuel");
  const wrap = adv.closest(".c-wrap");
  const labelOf = () =>
    Array.from(wrap.childNodes).find(n => n.nodeType === 3 && /Fuel/.test(n.textContent));
  const label = labelOf();

  assert(wrap.querySelector(".igpNum .minus"), "tombol minus hilang");
  assert(wrap.querySelector(".igpNum .plus"), "tombol plus hilang");
  assert(wrap.querySelector(".igpNum .value").textContent === "174", "angka kontrol game berubah");
  assert(adv.value === "174", "nilai input game berubah");
  assert(adv.getAttribute("data-initialvalue") === "174", "data-initialvalue game berubah");
  assert(wrap.children.length === 3, "elemen baru disuntik: " + wrap.children.length);
  assert(label && /estimasi 153\.6 L \/ 64 lap/.test(label.textContent), "label tanpa estimasi");
  assert(
    /Total laps estimate game/.test(wrap.getAttribute("title") || ""),
    "basis Total laps estimate tidak disebut"
  );

  // Reaktif: input game berubah → label ikut, tanpa menggandakan suffix.
  // (input di-debounce 140 ms agar spinner tidak memicu render per event)
  adv.value = "200";
  adv.dispatchEvent(new s.win.Event("input", { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  const afterInput = labelOf().textContent;
  assert(/terisi 200 L \(\+46\.4 L\)/.test(afterInput), "label tidak reaktif: " + afterInput);
  assert((afterInput.match(/estimasi/g) || []).length === 1, "suffix estimasi mengganda");
  assert((afterInput.match(/Fuel \(litres\)/g) || []).length === 1, "label asli mengganda");
  assert(afterInput.trim().startsWith("Fuel (litres)"), "teks asli label hilang: " + afterInput);

  // Restore: pindah halaman → label asli kembali, tanpa sisa atribut advisor.
  s.doc.getElementById("pageId").value = "cars";
  s.doc.getElementById("setup").appendChild(s.doc.createElement("div"));
  await new Promise(r => setTimeout(r, 25));
  assert(
    labelOf().textContent.trim() === "Fuel (litres)",
    "label tidak dipulihkan: " + labelOf().textContent
  );
  assert(!wrap.hasAttribute("data-igpas-orig"), "data-igpas-orig tertinggal");
  assert(!wrap.hasAttribute("title"), "title advisor tertinggal: " + wrap.getAttribute("title"));
  assert(
    wrap.querySelector(".igpNum .value").textContent === "174",
    "kontrol game rusak setelah restore"
  );
  s.close();
});

t("Race strategy: peringatan dua-compound hanya di title total laps", () => {
  const base = new JSDOM(load("race.html"));
  const bdoc = base.window.document;
  const el = bdoc.getElementById("d1StrategyJson");
  const json = JSON.parse(el.textContent);
  json.stint["4"].tyre = "M"; // semua stint kering 1 compound → langgar two_tyres
  el.textContent = JSON.stringify(json);
  const html = base.serialize();
  base.window.close();
  const s = bootOn(html, URL_RACE);
  const tot = s.doc.getElementById("d1TotalLaps");
  assert(
    /2 compound kering/.test(tot.getAttribute("title") || ""),
    "peringatan dua-compound hilang dari title: " + tot.getAttribute("title")
  );
  const cmt = s.doc.querySelector("#d1StrategyComments .shrinkText");
  assert(
    !/compound|IGPAS/i.test(cmt.textContent),
    "peringatan bocor ke komentar: " + cmt.textContent
  );
  s.close();
});

t("Race practice multi-lap: rata-rata 3 lap benar + idempoten render", () => {
  const base = new JSDOM(load("race.html"));
  const bdoc = base.window.document;
  const tbody = bdoc.querySelector("#d1Laps tbody");
  tbody.innerHTML +=
    '<tr><td class="ts-SS">2</td><td>50</td><td>50</td><td>50</td><td><span class="red">-2.3</span></td><td><span class="red">-8%</span></td><td>1:21.900</td></tr>';
  tbody.innerHTML +=
    '<tr><td class="ts-SS">3</td><td>50</td><td>50</td><td>50</td><td><span class="red">-2.5</span></td><td><span class="red">-9%</span></td><td>1:23.100</td></tr>';
  const html = base.serialize();
  base.window.close();
  const s = bootOn(html, URL_RACE);
  const span = s.doc.querySelector("#setup .driver1Include .driverName span:last-child");
  assert(
    span && /3 lap practice/.test(span.textContent),
    "count 3 lap salah: " + (span && span.textContent)
  );
  assert(/2\.4L\/lap/.test(span.textContent), "avg fuel 2.4 salah: " + span.textContent);
  assert(/terbaik 1:21\.900/.test(span.textContent), "best lap salah: " + span.textContent);
  // Idempoten: suffix hanya sekali (tidak mengganda).
  assert((span.textContent.match(/lap practice/g) || []).length === 1, "suffix mengganda");
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

const tick = ms => new Promise(r => setTimeout(r, ms || 20));

ta("Restore: game update label Cars → anotasi tunggal & orig ikut teks baru", async () => {
  const s = bootOn(load("cars.html"), URL_IGP);
  await tick();
  const row = s.doc.querySelector("#carAttributesDisplay .attribute-row[data-igpas-orig]");
  assert(row, "pra-kondisi: advisor belum menulis label");
  const label = row.querySelector(".attribute-rating-header span:not(.ratingVal)");
  label.textContent = "Acceleration MAX"; // game menulis ulang label
  await tick(40);
  const text = label.textContent;
  assert(
    /^#\d+ Acceleration MAX · \d+ DP$/.test(text),
    "anotasi tidak mengikuti teks game baru: " + text
  );
  assert((text.match(/ · /g) || []).length === 1, "anotasi menumpuk: " + text);
  assert(
    row.getAttribute("data-igpas-orig") === "Acceleration MAX",
    "data-igpas-orig basi: " + row.getAttribute("data-igpas-orig")
  );
  s.close();
});

ta("Restore: game update judul Supply → verdict dihitung ulang tanpa duplikasi", async () => {
  const s = bootOn(load("supply-engine.html"), URL_IGP);
  await tick();
  const h2 = s.doc.querySelector(".dialog-subhead-content h2");
  assert(h2 && /^Engine supply · /.test(h2.textContent), "pra-kondisi verdict belum ditulis");
  // Game mengganti dialog ke tipe lain: judul + semua kartu ikut berubah.
  for (const a of s.doc.querySelectorAll('.supplyDialog a[data-tip*="supplyType=engine"]')) {
    a.setAttribute(
      "data-tip",
      a.getAttribute("data-tip").replace("supplyType=engine", "supplyType=fuel")
    );
  }
  h2.textContent = "Fuel supply";
  await tick(40);
  assert(
    /^Fuel supply · /.test(h2.textContent),
    "verdict tidak mengikuti judul baru: " + h2.textContent
  );
  assert(
    (h2.textContent.match(/Fuel supply/g) || []).length === 1,
    "verdict menumpuk: " + h2.textContent
  );
  assert(
    h2.getAttribute("data-igpas-orig") === "Fuel supply",
    "orig judul basi: " + h2.getAttribute("data-igpas-orig")
  );
  s.close();
});

ta("Restore: navigasi keluar mengembalikan teks game TERBARU (bukan teks lama)", async () => {
  const s = bootOn(load("cars.html"), URL_IGP);
  await tick();
  const row = s.doc.querySelector("#carAttributesDisplay .attribute-row[data-igpas-orig]");
  assert(row, "pra-kondisi: advisor belum menulis label");
  const label = row.querySelector(".attribute-rating-header span:not(.ratingVal)");
  label.textContent = "Braking MAX";
  await tick(40);
  // Game berpindah halaman studi → bukan halaman yang di-advisor-i.
  s.doc.getElementById("pageId").value = "standings";
  s.doc.dispatchEvent(new s.win.Event("click", { bubbles: true }));
  await tick(350); // debounce navigasi 250 ms
  assert(
    label.textContent === "Braking MAX",
    "label tidak dikembalikan ke teks game terbaru: " + label.textContent
  );
  assert(!row.hasAttribute("data-igpas-orig"), "data-igpas-orig tertinggal");
  assert(!row.hasAttribute("title"), "title advisor tertinggal: " + row.getAttribute("title"));
  s.close();
});

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
