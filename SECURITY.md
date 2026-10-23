# Security Policy

## Supported versions

| Version           | Supported |
| ----------------- | --------- |
| `main` (latest)   | ✅        |
| tag `v*` terakhir | ✅        |

Userscript tidak punya backend — update = install ulang `src/igpas.user.js`
dari `main` / release tag terbaru.

## Reporting a vulnerability

Jangan buka issue publik untuk laporan sensitif.

- Email / DM maintainer (lihat profil GitHub `Cnagnn`) dengan detail +
  langkah reproduksi + dampak.
- Atau buka [Security advisory](https://github.com/Cnagnn/igpas/security/advisories/new)
  (private).

Kami akan konfirmasi dalam **48 jam** dan rilis fix + advisory setelah patch siap.

## Scope & guard

- `src/igpas.user.js` **tidak boleh** mengandung `fetch`/`XHR`/`GM_xmlhttpRequest`/`eval`/`unsafeWindow`
  — di-guard oleh `ci.yml`. Jika Anda menemukan pelanggaran, laporkan segera.
- Userscript membaca DOM yang tampil dan hanya menulis teks/`title`/warna sementara pada
  elemen asli — tanpa klik/submit, tanpa storage lokal (`GM_*`), tanpa exfiltrasi.

## Hardening untuk kontributor

- Jangan commit secret / token / PII ke fixture (`test/fixtures/*.html` sudah disanitasi).
- Dependabot aktif (npm + GitHub Actions) — review PR `deps` via `npm run verify`.
