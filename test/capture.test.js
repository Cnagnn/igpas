// PageCapture redaction tests (jsdom) — I.G.P.A.S v0.8.5.
// Goal: capturing the DOM for fixture mapping MUST NOT carry credentials,
// email, tokens, or manager identity — including via meta/template/iframe,
// comments, inline JSON, and attribute values. Game data must stay intact.
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
  if (!cond) throw new Error(msg || "assert failed");
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
<!-- comment LEAKCOMMENT leak.comment@example.com -->
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

t("capture: known credentials & identity do not leak", () => {
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
    assert(out.indexOf(leak) === -1, "sensitive value leaked: " + leak);
  }
});

t("capture: email does not leak in any form", () => {
  const out = capture(hostile);
  assert(!/@example\.com/.test(out), "email is still present in the capture");
});

t("capture: risky elements are dropped (meta/link/base/template/iframe)", () => {
  const out = capture(hostile);
  for (const tag of ["<meta", "<link", "<base", "<template", "<iframe"]) {
    assert(out.toLowerCase().indexOf(tag) === -1, "element " + tag + " is still present");
  }
});

t("capture: executable scripts are dropped, JSON scripts are kept", () => {
  const out = capture(hostile);
  assert(out.indexOf("LEAKSCRIPTEXEC") === -1, "executable script was copied");
  assert(out.indexOf('id="leagueDesignData"') !== -1, "fixture JSON script is missing");
});

t("capture: game data intact (numbers, id, class, data-tip)", () => {
  const out = capture(hostile);
  assert(out.indexOf('"speed":85') !== -1, "JSON number changed");
  assert(out.indexOf('id="d1AdvancedFuel"') !== -1, "game input is missing");
  assert(out.indexOf('value="32"') !== -1, "game input value changed");
  assert(out.indexOf("w-[calc(100%-40px)]") !== -1, "structural class changed");
  assert(out.indexOf('data-tip="Speed: +2"') !== -1, "fixture data-tip changed");
  assert(out.indexOf('id="keep-me"') !== -1, "fixture id is missing");
});

t("capture: inline JSON is redacted per key, safe values stay", () => {
  const out = capture(hostile);
  assert(out.indexOf('"value":7') !== -1, "safe JSON value is missing");
  assert(out.indexOf('"speed":85') !== -1, "safe JSON value changed");
});

t("capture: HTML comments are not included", () => {
  const out = capture(hostile);
  assert(out.indexOf("LEAKCOMMENT") === -1, "comment was copied");
  assert(out.indexOf("<!--") === -1, "comment is still present");
});

t("capture: account/avatar ID, tracker, and bootstrap id are redacted", () => {
  const out = capture(`<!doctype html><html><body>
<div id="myProfileName">Budi Santoso</div>
<a href="p=manager&amp;id=441233">profil</a>
<img src="/img/user/441233/avatar.png" alt="avatar">
<div id="wrap" data-sharkid="SHARK_TRACKER_ID_998877" data-tip="Weight: 41">x</div>
<script type="application/json" id="userBootstrap">{"id":441233,"name":"Budi Santoso","tier":"gold"}</script>
</body></html>`);
  for (const leak of ["441233", "SHARK_TRACKER_ID_998877", "Budi Santoso"]) {
    assert(out.indexOf(leak) === -1, "identity leaked: " + leak);
  }
  assert(out.indexOf('data-tip="Weight: 41"') !== -1, "game data is missing");
  assert(out.indexOf('"tier":"gold"') !== -1, "safe JSON data is missing");
  assert(out.indexOf("id=[REDACTED]") !== -1, "profile id was not redacted");
});

console.log("\n" + pass + " tests, " + fail + " failed" + (fail ? "" : " — all passed ✔"));
process.exit(fail ? 1 : 0);
