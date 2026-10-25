#!/usr/bin/env node
// check-versions.mjs — ensure versions stay in sync across the userscript repo
// Source of truth: package.json version
// Checked: src/igpas.user.js (@version + const VERSION), README, docs/ARCHITECTURE.md, docs/PRIVACY.md

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
    errors.push(`${file}: could not find ${label}`);
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
      warnings.push(`${file}: could not find ${label} (optional)`);
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
    if (e.code === "ENOENT") warnings.push(`${file}: file does not exist — skip`);
    else throw e;
  }
}

// Required: userscript header & constants
mustContain("src/igpas.user.js", /@version\s+([0-9]+\.[0-9]+\.[0-9]+)/, "@version");
mustContain(
  "src/igpas.user.js",
  /const VERSION\s*=\s*['"]([0-9]+\.[0-9]+\.[0-9]+)['"]/,
  "const VERSION"
);
// Required: the lockfile must not drift from package.json (release 0.8.3 was
// briefly shipped with docs/index.html v0.8.0 — that web page has been removed).
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

// Optional but recommended: docs & README show the same version
shouldContain("README.md", /<b>v([0-9]+\.[0-9]+\.[0-9]+)<\/b>/, "README badge version");
// ARCHITECTURE/PRIVACY often mention the version — loose check
shouldContain(
  "docs/ARCHITECTURE.md",
  /Current version\s+([0-9]+\.[0-9]+\.[0-9]+)/,
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
  console.error(`\nVersion check failed: ${errors.length} error(s)`);
  process.exit(1);
}

console.log("\nVersion check OK ✔");
