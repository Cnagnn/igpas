#!/usr/bin/env node
// check-guards.mjs — userscript compliance gate.
//  - every GM_* used MUST have a matching @grant (real bug: the v0.7.1
//    capture menu called GM_registerMenuCommand without @grant);
//  - @match is restricted to an allowlist: the userscript must not be injected
//    into arbitrary domains (only igpmanager.com; web GUI/deploy was removed in v0.9.0);
//  - there must be no network path / dynamic execution / remote code:
//    fetch, XHR, sendBeacon, WebSocket, EventSource, dynamic import,
//    @require, @resource, @connect, @updateURL;
//  - the userscript must not use eval/unsafeWindow/document.write.
// Run by `npm run verify`, not just CI, so local drift is caught.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC_DIR = path.join(ROOT, "src");

const errors = [];
const files = fs.readdirSync(SRC_DIR).filter(f => f.endsWith(".user.js"));
if (!files.length) errors.push("src/: no *.user.js files");

// @match allowlist — changes must be intentional and reviewed.
const ALLOWED_MATCH = [/^https:\/\/igpmanager\.com\/\*$/, /^https:\/\/\*\.igpmanager\.com\/\*$/];

// Metadata that can pull external code/endpoints on update, plus the inclusion keys
// that would silently widen the injection surface past the @match allowlist
// (`@include *` runs on every site even though @match looks correct).
const FORBIDDEN_META = [
  "@require",
  "@resource",
  "@connect",
  "@updateURL",
  "@downloadURL",
  "@icon",
  "@include",
  "@exclude",
  "@webRequest",
  "@sandbox",
];

for (const file of files) {
  const txt = fs.readFileSync(path.join(SRC_DIR, file), "utf8");
  const headerEnd = txt.indexOf("==/UserScript==");
  if (headerEnd < 0) {
    errors.push(`${file}: ==/UserScript== header not found`);
    continue;
  }
  const header = txt.slice(0, headerEnd);
  const body = txt.slice(headerEnd);

  const granted = new Set([...header.matchAll(/@grant\s+(GM_\w+)/g)].map(m => m[1]));
  const used = new Set([...body.matchAll(/\b(GM_\w+)\b/g)].map(m => m[1]));
  for (const g of used) {
    if (!granted.has(g)) errors.push(`${file}: uses ${g} without @grant ${g}`);
  }

  const matches = [...header.matchAll(/@match\s+(\S+)/g)].map(m => m[1]);
  if (!matches.length) errors.push(`${file}: no @match`);
  for (const m of matches) {
    if (!ALLOWED_MATCH.some(re => re.test(m))) {
      errors.push(`${file}: @match not allowed: ${m}`);
    }
  }
  if (!matches.some(m => /igpmanager\.com/.test(m))) {
    errors.push(`${file}: @match must cover igpmanager.com`);
  }

  for (const meta of FORBIDDEN_META) {
    if (new RegExp("^\\s*//\\s*" + meta + "\\b", "m").test(header)) {
      errors.push(`${file}: ${meta} is forbidden (remote code/endpoint)`);
    }
  }

  const forbidden = [
    [
      "network (fetch/XHR)",
      /\bfetch\s*\(|XMLHttpRequest|GM_xmlhttpRequest|navigator\.sendBeacon|\.sendBeacon\s*\(/,
    ],
    ["realtime socket", /\bnew\s+WebSocket\s*\(|\bnew\s+EventSource\s*\(/],
    ["dynamic import", /\bimport\s*\(/],
    ["eval/new Function", /\beval\s*\(|new\s+Function\s*\(/],
    ["unsafeWindow", /\bunsafeWindow\b/],
    ["document.write", /\bdocument\.write(?:ln)?\s*\(/],
  ];
  for (const [label, re] of forbidden) {
    if (re.test(body)) {
      errors.push(`${file}: contains ${label} — must be 0 (see docs/PRIVACY.md)`);
    }
  }

  // A network grant in the header is a network path even if nothing calls it today:
  // any later edit could use it. The userscript must never request these.
  const FORBIDDEN_GRANTS = ["GM_xmlhttpRequest", "GM_download", "GM_openInTab", "GM_webRequest"];
  for (const g of FORBIDDEN_GRANTS) {
    if (granted.has(g)) errors.push(`${file}: @grant ${g} is forbidden (network/navigation)`);
  }

  // Dead-code guard: every IGPCore method must have at least one production call
  // site. A fully tested function nobody calls still inflates the test count and
  // lets a "green" suite certify behaviour the user can never observe — exactly the
  // drift that left hundreds of lines of orphaned advisor code in the file before
  // v0.13.1 (calcFuel, pitWindow, compareRoster, parseTraits, …).
  const coreMethods = [];
  let inCore = false;
  for (const line of body.split("\n")) {
    if (/const IGPCore = Object\.freeze\(\{/.test(line)) {
      inCore = true;
      continue;
    }
    if (inCore && /^\s{4}\}\);\s*$/.test(line)) {
      inCore = false;
      continue;
    }
    if (!inCore) continue;
    const m = line.match(/^ {8}([A-Za-z]\w*)\(/);
    if (m) coreMethods.push(m[1]);
  }
  if (!coreMethods.length) errors.push(`${file}: no IGPCore methods detected (guard is blind)`);
  for (const name of coreMethods) {
    const callSites = [...body.matchAll(new RegExp(`IGPCore\\.${name}\\(`, "g"))].length;
    if (callSites === 0) {
      errors.push(`${file}: IGPCore.${name}() is unreachable — remove it or wire it up`);
    }
  }
}

if (errors.length) {
  for (const e of errors) console.error("  ✗ " + e);
  process.exit(1);
}
console.log(
  "Guards OK: @grant complete, @match allowlist, no network/eval/remote code, no dead core"
);
