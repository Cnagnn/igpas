#!/usr/bin/env node
// check-versions.mjs — pastikan versi sinkron di seluruh repo userscript
// Sumber kebenaran: package.json version
// Diperiksa: src/igpas.user.js (@version + const VERSION), README, docs/index.html, docs/app

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

function read(p) {
  return fs.readFileSync(path.join(ROOT, p), "utf8");
}

const pkg = JSON.parse(read("package.json"));
const expected = pkg.version;
console.log(`expected version (package.json): ${expected}`);

const errors = [];
const warnings = [];

function mustContain(file, pattern, label) {
  const txt = read(file);
  const m = txt.match(pattern);
  if (!m) {
    errors.push(`${file}: tidak menemukan ${label}`);
    return null;
  }
  const found = m[1];
  if (found !== expected) {
    errors.push(`${file}: ${label} = ${found} (expected ${expected})`);
  } else {
    console.log(`  ✔ ${file} — ${label} = ${found}`);
  }
  return found;
}

function shouldContain(file, pattern, label) {
  try {
    const txt = read(file);
    const m = txt.match(pattern);
    if (!m) {
      warnings.push(`${file}: tidak menemukan ${label} (opsional)`);
      return null;
    }
    const found = m[1];
    if (found !== expected) {
      warnings.push(`${file}: ${label} = ${found} (expected ${expected})`);
    } else {
      console.log(`  ✔ ${file} — ${label} = ${found}`);
    }
    return found;
  } catch (e) {
    if (e.code === "ENOENT") warnings.push(`${file}: file tidak ada — skip`);
    else throw e;
  }
}

// Wajib: userscript header & konstanta
mustContain("src/igpas.user.js", /@version\s+([0-9]+\.[0-9]+\.[0-9]+)/, "@version");
mustContain(
  "src/igpas.user.js",
  /const VERSION\s*=\s*['"]([0-9]+\.[0-9]+\.[0-9]+)['"]/,
  "const VERSION"
);
// Wajib: halaman publik & lockfile tidak boleh drift dari package.json —
// rilis 0.8.3 sempat terkirim dengan docs/index.html v0.8.0 (warning-only).
mustContain("docs/index.html", /<b>v([0-9]+\.[0-9]+\.[0-9]+)<\/b>/, "docs/index.html version");
const lock = JSON.parse(read("package-lock.json"));
if (lock.version !== expected) {
  errors.push(`package-lock.json: version = ${lock.version} (expected ${expected})`);
} else {
  console.log(`  ✔ package-lock.json — version = ${lock.version}`);
}
const lockRoot = lock.packages && lock.packages[""];
if (lockRoot && lockRoot.version !== expected) {
  errors.push(
    `package-lock.json: packages[""].version = ${lockRoot.version} (expected ${expected})`
  );
} else if (lockRoot) {
  console.log(`  ✔ package-lock.json — packages[""].version = ${lockRoot.version}`);
}

// Opsional tapi disarankan: docs & README menampilkan versi yang sama
shouldContain("README.md", /<b>v([0-9]+\.[0-9]+\.[0-9]+)<\/b>/, "README badge version");
shouldContain(
  "docs/app/index.html",
  /GUI v([0-9]+\.[0-9]+\.[0-9]+)/,
  "docs/app GUI version (test fixture)"
);
// ARCHITECTURE/PRIVACY sering menyebut versi — cek longgar
shouldContain(
  "docs/ARCHITECTURE.md",
  /Versi saat ini\s+([0-9]+\.[0-9]+\.[0-9]+)/,
  "ARCHITECTURE version"
);
shouldContain("docs/PRIVACY.md", /v([0-9]+\.[0-9]+\.[0-9]+)/, "PRIVACY version mention");

if (warnings.length) {
  console.log("\nWarnings:");
  for (const w of warnings) console.log("  ⚠ " + w);
}

if (errors.length) {
  console.error("\nErrors:");
  for (const e of errors) console.error("  ✗ " + e);
  console.error(`\nVersion check gagal: ${errors.length} error(s)`);
  process.exit(1);
}

console.log("\nVersion check OK ✔");
