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

// Regression (v0.13.1): four redaction holes found during the project audit.
t("capture: free-text, select and identity fields do not leak names/IDs", () => {
  // The profile name is the page's own identity: it is collected as known PII and
  // must then disappear from every field that repeats it, label attributes included.
  const out = capture(`<!doctype html><html><body>
<div id="myProfileName">AliceSmith</div>
<input type="text" id="search" value="BobJones">
<input type="search" name="q" value="BobJones">
<select id="team"><option value="987654">AliceSmith</option><option value="5">5</option></select>
<span aria-label="AliceSmith">z</span>
<div title="AliceSmith profile">t</div>
<input placeholder="AliceSmith">
</body></html>`);
  for (const leak of ["BobJones", "AliceSmith", "987654"]) {
    assert(out.indexOf(leak) === -1, "identity leaked from a form/identity field: " + leak);
  }
  // Numeric game values still survive.
  assert(out.indexOf(">5<") !== -1, "numeric option lost");
});

t("capture: lazy-loaded data-src avatar paths do not leak the account ID", () => {
  const out = capture(`<!doctype html><html><body>
<div data-src="/img/user/987654/x.png" data-original="/pic/987654.png">q</div>
<a href="/x?PHPSESSID=abc123def456&sid=99">l</a>
</body></html>`);
  for (const leak of ["987654", "abc123def456", "sid=99"]) {
    assert(out.indexOf(leak) === -1, "URL identity/session leaked: " + leak);
  }
});

t("capture: nested JSON identity ids are redacted, game numbers stay", () => {
  const out = capture(`<!doctype html><html><body>
<script type="application/json">{"profile":{"id":441233,"name":"Joan"},"owner":{"managerId":778899},"cash":5}</script>
</body></html>`);
  for (const leak of ["441233", "778899", "Joan"]) {
    assert(out.indexOf(leak) === -1, "nested identity leaked: " + leak);
  }
  assert(out.indexOf('"cash":5') !== -1, "game number lost");
});

t("capture: redaction does not damage ordinary game text or tips", () => {
  // No PII present anywhere: nothing outside the identity tables may be rewritten.
  const out = capture(`<!doctype html><html><body>
<table><tr><td>Ace Racer Team</td></tr></table>
<div data-tip="12">laps 12</div>
</body></html>`);
  assert(out.indexOf("Ace Racer Team") !== -1, "game text was over-redacted");
  assert(out.indexOf('data-tip="12"') !== -1, "game tip was over-redacted");
  assert(out.indexOf("laps 12") !== -1, "game text was over-redacted");
});

// Regression (review finding): an early fix blanked every title/alt/option value,
// which destroyed the game vocabulary a fixture exists to capture — tyre compounds
// and setup levels vanished. Redaction must remove identity, not game data.
t("capture: game vocabulary in title/alt/option survives redaction", () => {
  const out = capture(`<!doctype html><html><body>
<table><tr><td title="Soft tyres">S</td></tr></table>
<img alt="" src="empty.gif">
<select name="tyre"><option value="SS">Super soft tyres</option><option value="H">Hard tyres</option></select>
<select name="ride"><option value="100">Very high</option><option value="60" selected>Neutral</option></select>
</body></html>`);
  assert(out.indexOf('title="Soft tyres"') !== -1, "game tooltip was destroyed");
  assert(out.indexOf("Super soft tyres") !== -1, "tyre compound option was destroyed");
  assert(out.indexOf("Very high") !== -1, "setup level option was destroyed");
  assert(out.indexOf('value="SS"') !== -1, "game option value was destroyed");
});

t("capture: identity hides even when it appears only in title/alt/option", () => {
  const out = capture(`<!doctype html><html><body>
<div id="myProfileName">Zed Quill</div>
<span aria-label="Zed Quill">x</span>
<div title="Zed Quill profile">t</div>
<img alt="Zed Quill" src="empty.gif">
<select><option value="441233">Zed Quill</option></select>
</body></html>`);
  for (const leak of ["Zed Quill", "441233"]) {
    assert(out.indexOf(leak) === -1, "identity leaked via a label attribute: " + leak);
  }
});

console.log("\n" + pass + " tests, " + fail + " failed" + (fail ? "" : " — all passed ✔"));
process.exit(fail ? 1 : 0);
