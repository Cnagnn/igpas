# Contributing — I.G.P.A.S

> Alat **studi read-only**, bukan alat balapan. Jangan kirim perubahan yang
> menambah otomasi, klik/submit, jaringan, atau yang menulis ke tab `#race`
> live. Repo ini hanya berisi userscript — tidak ada web GUI/deploy.

## Quick start

```bash
npm install
npm run verify   # syntax + lint + format:check + versions:check + guards:check + test
```

Butuh Node ≥ 22.22.2 (lihat `.nvmrc`).

## Quality gate (wajib hijau sebelum PR)

| Gate         | Perintah                 | Catatan                                                              |
| ------------ | ------------------------ | -------------------------------------------------------------------- |
| Syntax       | `npm run syntax`         | `node --check src/igpas.user.js`                                     |
| Lint         | `npm run lint`           | `eslint .` (fix: `npm run lint:fix`)                                 |
| Format       | `npm run format:check`   | `prettier --check .` (fix: `npm run format`)                         |
| Version sync | `npm run versions:check` | source: `package.json` → `@version` + `const VERSION` + README badge |
| Guards       | `npm run guards:check`   | `@match` hanya igpmanager.com + 0 network/eval/remote code           |
| Tests        | `npm test`               | 118 tests (82 core + 8 capture + 28 advisor)                         |

CI (`.github/workflows/ci.yml`) menjalankan `npm run verify` di Node 22 **dan** 24. Guard menolak `fetch`/XHR/`sendBeacon`/WebSocket/EventSource/dynamic
import/`eval`/`unsafeWindow`, `@require`/`@connect`, dan `@match` di luar
allowlist.

## Struktur repo

```
src/igpas.user.js          userscript utama — TANPA build step
test/                      Node + jsdom (tanpa framework)
  fixtures/*.html          DOM capture tersanitasi (PII/script dibuang)
  core.test.js             unit test IGPCore/Utils
  capture.test.js          redaksi PageCapture
  advisor.test.js          advisor in-place vs fixture DOM nyata
docs/
  ARCHITECTURE.md          komponen, alur data, disiplin DOM
  PRIVACY.md               data, redaksi, risiko ToS
scripts/check-versions.mjs sinkronisasi versi
scripts/check-guards.mjs   allowlist + anti network/remote code
```

**Kenapa tanpa build?** Userscript instal via copy-paste / raw GitHub — build
step menambah drift & risiko supply-chain. Satu file = audit paling mudah.

## Menambah dukungan halaman baru

1. Capture DOM via menu userscript `I.G.P.A.S: salin capture DOM halaman ini`
   (redaksi PII otomatis) — simpan sebagai `test/fixtures/<halaman>.html`.
2. Tambah parser read-only `Igp<X>Adapter.captures(document)` dengan gate
   `#pageId`/dialog; jangan menyimpan atau mengirim data.
3. Tambah tulisan in-place di `Advisor` (teks + `title` pada node asli),
   lengkap dengan `restore*()` yang menyimpan `data-igpas-orig` /
   `data-igpas-written` dan tidak menimpa teks yang sudah diganti game.
4. Tambah test di `test/advisor.test.js` (jsdom) — termasuk cek restore,
   idempotensi, dan zero-UI di halaman lain / `#race`.
5. Jangan pernah: `click`/`submit`/`fetch`/`GM_xmlhttpRequest`/`unsafeWindow`,
   `GM_setValue` (storage sudah dihapus), atau menulis ke `#race`.

## Konvensi

- Commit: `type(scope): desc` — `feat`, `fix`, `docs`, `chore`, `test`, `ci`.
- Versi: bump `package.json` → sinkronkan `@version` + `const VERSION` + badge
  README (dicek `scripts/check-versions.mjs`).
- Format: `prettier` (LF, 100 cols), lint: `eslint` flat config, editor:
  `.editorconfig`.
- Lisensi: `GPL-3.0-or-later` — jangan commit aset/logo iGP.

## PR checklist

Lihat `.github/pull_request_template.md`. PR harus lulus `npm run verify`;
tidak ada lagi deploy Pages.
