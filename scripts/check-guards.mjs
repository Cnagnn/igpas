#!/usr/bin/env node
// check-guards.mjs — gerbang kepatuhan userscript.
//  - setiap GM_* yang dipakai WAJIB punya @grant yang cocok (bug nyata: menu
//    capture v0.7.1 memanggil GM_registerMenuCommand tanpa @grant);
//  - userscript tidak boleh mengandung network/eval/unsafeWindow.
// Dijalankan oleh `npm run verify`, bukan hanya CI, agar drift lokal tertangkap.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC_DIR = path.join(ROOT, "src");

const errors = [];
const files = fs.readdirSync(SRC_DIR).filter(f => f.endsWith(".user.js"));
if (!files.length) errors.push("src/: tidak ada *.user.js");

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

  const forbidden = [
    ["network (fetch/XHR)", /\bfetch\s*\(|XMLHttpRequest|GM_xmlhttpRequest/],
    ["eval/new Function", /\beval\s*\(|new\s+Function\s*\(/],
    ["unsafeWindow", /\bunsafeWindow\b/],
  ];
  for (const [label, re] of forbidden) {
    if (re.test(body))
      errors.push(`${file}: mengandung ${label} — harus 0 (lihat docs/COMPLIANCE.md)`);
  }
}

if (errors.length) {
  for (const e of errors) console.error("  ✗ " + e);
  process.exit(1);
}
console.log("Guards OK: @grant lengkap, tanpa network/eval/unsafeWindow");
