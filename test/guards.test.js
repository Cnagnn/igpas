// Guard script tests (v0.13.1) — the guards are the mechanical proof behind the
// README's "no network / only igpmanager.com" claims, so the guards themselves
// must be tested: a guard that cannot fail proves nothing.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..");
const GUARD = path.join(REPO, "scripts", "check-guards.mjs");
const SRC = fs.readFileSync(path.join(REPO, "src", "igpas.user.js"), "utf8");

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

// Run the real guard script against a temporary copy of the userscript.
// Returns { ok, out } — ok is false when the guard rejects the input.
function guard(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "igpas-guard-"));
  try {
    fs.mkdirSync(path.join(dir, "src"));
    // The script reads <its own dir>/../src/*.user.js, so copy the guard next to it.
    const scriptsDir = path.join(dir, "scripts");
    fs.mkdirSync(scriptsDir);
    fs.copyFileSync(GUARD, path.join(scriptsDir, "check-guards.mjs"));
    fs.writeFileSync(path.join(dir, "src", "igpas.user.js"), source);
    try {
      const out = execFileSync(process.execPath, [path.join(scriptsDir, "check-guards.mjs")], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { ok: true, out };
    } catch (e) {
      return { ok: false, out: String(e.stderr || "") };
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

t("guards: the shipped userscript passes every guard", () => {
  const r = guard(SRC);
  assert(r.ok, "shipped source must pass the guards: " + r.out);
});

t("guards: @include is rejected (it would widen injection past @match)", () => {
  const r = guard(SRC.replace("// @match", "// @include    *\n// @match"));
  assert(!r.ok, "@include * was accepted — injection surface is not enforced");
  assert(/@include/.test(r.out), "expected an @include error, got: " + r.out);
});

t("guards: @exclude/@webRequest/@sandbox are rejected", () => {
  for (const meta of ["@exclude", "@webRequest", "@sandbox"]) {
    const r = guard(SRC.replace("// @match", `// ${meta}   *\n// @match`));
    assert(!r.ok, `${meta} was accepted`);
  }
});

t("guards: a network grant is rejected even when nothing calls it", () => {
  const r = guard(
    SRC.replace("// @grant        GM_notification", "// @grant        GM_xmlhttpRequest")
  );
  assert(!r.ok, "GM_xmlhttpRequest grant was accepted");
});

t("guards: unreachable IGPCore code is rejected", () => {
  const injected = SRC.replace(
    "    const IGPCore = Object.freeze({",
    "    const IGPCore = Object.freeze({\n\n        deadProbe(p) {\n            return p;\n        },"
  );
  assert(injected !== SRC, "injection point not found");
  const r = guard(injected);
  assert(!r.ok, "dead IGPCore method was accepted");
  assert(/unreachable/.test(r.out), "expected a dead-code error, got: " + r.out);
});

t("guards: network calls in the body are rejected", () => {
  const r = guard(SRC.replace("'use strict';", "'use strict';\n    fetch('https://x.test');"));
  assert(!r.ok, "fetch() was accepted");
});

console.log("\n" + pass + " tests, " + fail + " failed" + (fail ? "" : " — all passed ✔"));
process.exit(fail ? 1 : 0);
