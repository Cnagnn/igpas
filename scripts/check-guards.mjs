#!/usr/bin/env node
// check-guards.mjs — gerbang kepatuhan userscript.
//  - setiap GM_* yang dipakai WAJIB punya @grant yang cocok (bug nyata: menu
//    capture v0.7.1 memanggil GM_registerMenuCommand tanpa @grant);
//  - @match dibatasi allowlist: userscript tidak boleh disuntik ke sembarang
//    domain (localhost tetap diizinkan; peran GUI dibatasi /app/ di runtime);
//  - tidak boleh ada jalur jaringan / eksekusi dinamis / remote code:
//    fetch, XHR, sendBeacon, WebSocket, EventSource, dynamic import,
//    @require, @resource, @connect, @updateURL;
//  - userscript tidak boleh memakai eval/unsafeWindow/document.write.
// Dijalankan oleh `npm run verify`, bukan hanya CI, agar drift lokal tertangkap.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC_DIR = path.join(ROOT, "src");

const errors = [];
const files = fs.readdirSync(SRC_DIR).filter(f => f.endsWith(".user.js"));
if (!files.length) errors.push("src/: tidak ada *.user.js");

// Allowlist @match — perubahan harus disengaja dan di-review.
const ALLOWED_MATCH = [
  /^https:\/\/igpmanager\.com\/\*$/,
  /^https:\/\/\*\.igpmanager\.com\/\*$/,
  /^http:\/\/localhost\/\*$/,
  /^https:\/\/cnagnn\.github\.io\/igpas\/\*$/,
];

// Metadata yang bisa menarik kode/endpoint eksternal saat update.
const FORBIDDEN_META = ["@require", "@resource", "@connect", "@updateURL", "@downloadURL", "@icon"];

for (const file of files) {
  const txt = fs.readFileSync(path.join(SRC_DIR, file), "utf8");
  const headerEnd = txt.indexOf("==/UserScript==");
  if (headerEnd < 0) {
    errors.push(`${file}: header ==/UserScript== tidak ditemukan`);
    continue;
  }
  const header = txt.slice(0, headerEnd);
  const body = txt.slice(headerEnd);

  const granted = new Set([...header.matchAll(/@grant\s+(GM_\w+)/g)].map(m => m[1]));
  const used = new Set([...body.matchAll(/\b(GM_\w+)\b/g)].map(m => m[1]));
  for (const g of used) {
    if (!granted.has(g)) errors.push(`${file}: memakai ${g} tanpa @grant ${g}`);
  }

  const matches = [...header.matchAll(/@match\s+(\S+)/g)].map(m => m[1]);
  if (!matches.length) errors.push(`${file}: tidak ada @match`);
  for (const m of matches) {
    if (!ALLOWED_MATCH.some(re => re.test(m))) {
      errors.push(`${file}: @match tidak diizinkan: ${m}`);
    }
  }
  if (!matches.some(m => /igpmanager\.com/.test(m))) {
    errors.push(`${file}: @match wajib mencakup igpmanager.com`);
  }

  for (const meta of FORBIDDEN_META) {
    if (new RegExp("^\\s*//\\s*" + meta + "\\b", "m").test(header)) {
      errors.push(`${file}: ${meta} dilarang (remote code/endpoint)`);
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
      errors.push(`${file}: mengandung ${label} — harus 0 (lihat docs/PRIVACY.md)`);
    }
  }
}

if (errors.length) {
  for (const e of errors) console.error("  ✗ " + e);
  process.exit(1);
}
console.log("Guards OK: @grant lengkap, @match allowlist, tanpa network/eval/remote code");
