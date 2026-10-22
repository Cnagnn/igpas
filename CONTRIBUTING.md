# Contributing — I.G.P.A.S

> Alat **studi**, bukan alat balapan. Jangan kirim perubahan yang menambah otomasi
> saat live race atau menyentuh tab `#race` live.

## Quick start

```bash
npm install
npm run verify   # syntax + lint + format:check + versions:check + guards:check + npm test
npm run dev      # http://localhost:8787/  (docs/)
```

## Quality gate (wajib hijau sebelum PR)

| Gate         | Perintah                 | Catatan                                                                                      |
| ------------ | ------------------------ | -------------------------------------------------------------------------------------------- |
| Syntax       | `npm run syntax`         | `node --check src/igpas.user.js`                                                             |
| Lint         | `npm run lint`           | `eslint .` (fix: `npm run lint:fix`)                                                         |
| Format       | `npm run format:check`   | `prettier --check .` (fix: `npm run format`)                                                 |
| Version sync | `npm run versions:check` | source: `package.json` → `@version` + `const VERSION`                                        |
| Guards       | `npm run guards:check`   | `@match` allowlist + 0 network/eval/remote code                                              |
| Tests        | `npm test`               | 178 tests (82 core + 31 snapshot + 7 storage + 7 capture + 10 mailbox + 14 gui + 27 advisor) |

CI (`ci.yml`) menjalankan `npm run verify` di Node 22 **dan** 24; guard userscript
(`fetch`/`XHR`/`sendBeacon`/WebSocket/EventSource/dynamic import/`eval`/`unsafeWindow`
mustahil 0 di `src/`, `@match` dibatasi allowlist).

## Struktur repo (userscript-oriented)

```
src/igpas.user.js          userscript utama — TANPA build step
test/                      Node + jsdom (tanpa framework)
  fixtures/*.html          DOM capture tersanitasi (PII/script dibuang)
  core.test.js | snapshots.test.js | storage.test.js | capture.test.js |
  mailbox.test.js | gui.test.js | advisor.test.js
docs/                      GitHub Pages (landing + /app/ Command Center)
  ARCHITECTURE.md | PRIVACY.md
scripts/check-versions.mjs guard sinkronisasi versi
```

**Kenapa tanpa build?** Userscript instal via copy-paste / raw GitHub — build step
menambah drift & risiko supply-chain. Satu file = audit paling mudah.

## Menambah adapter halaman baru

1. Capture DOM via menu userscript `I.G.P.A.S: salin capture DOM halaman ini`
   (otomatis redact PII) — simpan sebagai `test/fixtures/<halaman>.html`.
2. Map selector read-only di `src/igpas.user.js` (gate `#pageId` / dialog).
3. Tambah test snapshot di `test/snapshots.test.js` + panel advisor bila ada
   di `test/advisor.test.js` (stub `GM_*` + `JSDOM`).
4. Jangan pernah: `click`/`submit`/`fetch`/`GM_xmlhttpRequest`/`unsafeWindow`.

## Konvensi

- Commit: `type(scope): desc` — `feat`, `fix`, `docs`, `chore`, `test`, `ci`.
- Versi: bump `package.json` → sinkronkan `@version` + `VERSION` + badge docs
  (dicek `scripts/check-versions.mjs`).
- Format: `prettier` (LF, 100 cols), lint: `eslint` flat config, editor: `.editorconfig`.
- Lisensi: `GPL-3.0-or-later` — jangan commit aset/logo iGP.

## PR checklist

Lihat `.github/pull_request_template.md` — CI `pages.yml` tidak akan deploy
kalau verify gagal.
