// Test redaksi PageCapture (jsdom) — I.G.P.A.S v0.8.5.
// Tujuan: capture DOM untuk pemetaan fixture TIDAK boleh membawa kredensial,
// email, token, atau identitas manajer — termasuk lewat meta/template/iframe,
// komentar, JSON inline, dan nilai atribut. Data permainan harus tetap utuh.
const { JSDOM } = require("jsdom");
const { PageCapture } = require("../src/igpas.user.js");

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
function capture(html) {
  const dom = new JSDOM(html);
  return PageCapture.buildCapture(dom.window.document) || "";
}

const hostile = `<!doctype html><html><head>
<meta name="csrf-token" content="LEAKMETA1A2B3C4D5E6F7A8B9C0D1E2F3A4B5C6">
<link rel="stylesheet" href="/x.css?token=LEAKLINKTOKEN">
<base href="https://x.test/?session=LEAKBASESESSION">
<script>var secret = "LEAKSCRIPTEXEC";</script>
<script type="application/json" id="leagueDesignData">{"speed":85,"manager":"LEAKJSONMANAGER","token":"LEAKJSONTOKEN","email":"leak.json@example.com","nested":{"csrf":"LEAKNEST","value":7}}</script>
<script type="application/json" id="brokenJson">{not json leak.broken@example.com}</script>
</head><body>
<!-- komentar LEAKCOMMENT leak.comment@example.com -->
<template><div data-token="LEAKTEMPLATE">x</div></template>
<iframe srcdoc="<p>LEAKSRCDOC leak.srcdoc@example.com</p>"></iframe>
<div id="myProfileName">LEAKPROFILE</div>
<div id="balanceText">LEAKBALANCE</div>
<div data-csrf="LEAKDATACSRF" data-json='{"email":"LEAKATTRJSON@example.com"}' data-plain="leak.attr@example.com" data-note="leak.note@example.com"></div>
<a href="/go?manager=LEAKMGR&token=LEAKTOKEN&x=1">link</a>
<img src="/reset/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?email=LEAKIMG@example.com" title="LEAKTITLE leak.title@example.com" alt="LEAKALT">
<input type="hidden" name="csrf" value="LEAKINPUT">
<input id="d1AdvancedFuel" value="32">
<textarea>LEAKTEXTAREA leak.textarea@example.com</textarea>
<div title="leak.title.attr@example.com">teks biasa</div>
<div class="w-[calc(100%-40px)]" id="keep-me" data-tip="Speed: +2">ok</div>
</body></html>`;

t("capture: kredensial & identitas yang dikenal tidak lolos", () => {
  const out = capture(hostile);
  const leaks = [
    "LEAKMETA1A2B3C4D5E6F7A8B9C0D1E2F3A4B5C6",
    "LEAKLINKTOKEN",
    "LEAKBASESESSION",
    "LEAKSCRIPTEXEC",
    "LEAKJSONMANAGER",
    "LEAKJSONTOKEN",
    "LEAKNEST",
    "LEAKCOMMENT",
    "LEAKTEMPLATE",
    "LEAKSRCDOC",
    "LEAKPROFILE",
    "LEAKBALANCE",
    "LEAKDATACSRF",
    "LEAKATTRJSON",
    "LEAKTOKEN",
    "LEAKMGR",
    "LEAKIMG",
    "LEAKINPUT",
    "LEAKTEXTAREA",
  ];
  for (const leak of leaks) {
    assert(out.indexOf(leak) === -1, "nilai sensitif lolos: " + leak);
  }
});

t("capture: email tidak lolos dalam bentuk apa pun", () => {
  const out = capture(hostile);
  assert(!/@example\.com/.test(out), "email masih ada di capture");
});

t("capture: elemen berisiko dibuang (meta/link/base/template/iframe)", () => {
  const out = capture(hostile);
  for (const tag of ["<meta", "<link", "<base", "<template", "<iframe"]) {
    assert(out.toLowerCase().indexOf(tag) === -1, "elemen " + tag + " masih ada");
  }
});

t("capture: script eksekutabel dibuang, script JSON dipertahankan", () => {
  const out = capture(hostile);
  assert(out.indexOf("LEAKSCRIPTEXEC") === -1, "script eksekutabel ikut tersalin");
  assert(out.indexOf('id="leagueDesignData"') !== -1, "script JSON fixture hilang");
});

t("capture: data permainan utuh (angka, id, class, data-tip)", () => {
  const out = capture(hostile);
  assert(out.indexOf('"speed":85') !== -1, "angka JSON berubah");
  assert(out.indexOf('id="d1AdvancedFuel"') !== -1, "input game hilang");
  assert(out.indexOf('value="32"') !== -1, "nilai input game berubah");
  assert(out.indexOf("w-[calc(100%-40px)]") !== -1, "class struktural berubah");
  assert(out.indexOf('data-tip="Speed: +2"') !== -1, "data-tip fixture berubah");
  assert(out.indexOf('id="keep-me"') !== -1, "id fixture hilang");
});

t("capture: JSON inline di-redaksi per kunci, nilai aman tetap", () => {
  const out = capture(hostile);
  assert(out.indexOf('"value":7') !== -1, "nilai JSON aman hilang");
  assert(out.indexOf('"speed":85') !== -1, "nilai JSON aman berubah");
});

t("capture: komentar HTML tidak ikut", () => {
  const out = capture(hostile);
  assert(out.indexOf("LEAKCOMMENT") === -1, "komentar ikut tersalin");
  assert(out.indexOf("<!--") === -1, "komentar masih ada");
});

t("capture: ID akun/avatar, tracker, dan id bootstrap diredaksi", () => {
  const out = capture(`<!doctype html><html><body>
<div id="myProfileName">Budi Santoso</div>
<a href="p=manager&amp;id=441233">profil</a>
<img src="/img/user/441233/avatar.png" alt="avatar">
<div id="wrap" data-sharkid="SHARK_TRACKER_ID_998877" data-tip="Weight: 41">x</div>
<script type="application/json" id="userBootstrap">{"id":441233,"name":"Budi Santoso","tier":"gold"}</script>
</body></html>`);
  for (const leak of ["441233", "SHARK_TRACKER_ID_998877", "Budi Santoso"]) {
    assert(out.indexOf(leak) === -1, "identitas lolos: " + leak);
  }
  assert(out.indexOf('data-tip="Weight: 41"') !== -1, "data permainan hilang");
  assert(out.indexOf('"tier":"gold"') !== -1, "data JSON aman hilang");
  assert(out.indexOf("id=[REDACTED]") !== -1, "id profil tidak diredaksi");
});

console.log("\n" + pass + " test, " + fail + " gagal" + (fail ? "" : " — semua lulus ✔"));
process.exit(fail ? 1 : 0);
