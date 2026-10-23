# I.G.P.A.S — iGP Analytics & Study System

Penasihat studi **read-only** untuk [iGP Manager](https://igpmanager.com), berupa
**satu userscript tanpa build step**. Tidak ada web GUI, tidak ada server, tidak
ada jaringan, dan tidak ada data yang disimpan.

> **Versi saat ini: <b>v0.9.0</b>.** ⚠️ **Alat studi — bukan alat balapan.**
> Tidak ada otomasi, tidak ada aksi ke situs, tidak membantu kendali saat
> balapan live. Risiko banned/pelanggaran ToS iGP Manager **ditanggung penuh
> oleh user**.

## Yang dilakukan userscript

Hanya berjalan di `igpmanager.com`. Userscript **tidak menambahkan elemen apa
pun** ke halaman: tanpa panel, tanpa badge, tanpa tombol. Rekomendasi ditulis
sebagai **teks pada node asli** dan **detail di atribut `title` elemen yang
sama**; angka, bar, link, flag, dan ikon game tidak disentuh. Teks/title asli
disimpan dan **di-restore otomatis** setiap re-render dan saat pindah halaman.

| Halaman (gate `#pageId`)                      | Yang ditulis di elemen asli                                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cars**                                      | Prioritas design point: label baris jadi `#1 Fuel economy · 26 DP` (gap vs max rival liga); val/max/gap di `title`                          |
| **Manufacturers**                             | Peringkat nama baris engine/chassis (`#n Nama`, `★` terbaik); rating/biaya/rating-per-1jt di `title`                                        |
| **Supply** (dialog Engine/Fuel/Tyres terbuka) | Peringkat pada kartu asli (`#n · biaya ★`), verdict supplier aktif vs alternatif di judul dialog; Σ bonus, biaya/race, nilai/1jt di `title` |
| **Drivers & Staff**                           | Saran kesehatan/pemulihan pada span nama driver; gaji & kontrak staff di `title` kartu                                                      |
| **Transfers**                                 | Peringkat pada text node nama baris (`#n Nama ★ rekomendasi`); overall/fee di `title` — link kontrak & flag tetap hidup                     |
| **Setup** (pra-balapan)                       | Ringkasan practice pada span nama driver + `title` agregasi; hint trek; arah slider game                                                    |
| **Strategy** (pra-balapan)                    | Estimasi fuel pada label asli **Fuel (litres)**; ringkasan stint/ban di `title`; komentar pembalap tidak ditulis                            |
| **Race live (`#race`)**                       | **Tidak pernah ditulis.** Hanya dibaca read-only untuk karakteristik trek (overtaking/bumpiness/fuel/wear + panjang sirkuit)                |

Semua tulisan berlabel **"estimasi — bukan rumus game"** di `title`: heuristik
transparan atas angka yang memang tampil, bukan kepastian performa. Render
**instan**: MutationObserver bereaksi saat game commit DOM, dengan
restore-dulu agar pembacaan selalu memakai data murni.

### Menu capture fixture

Lewat menu userscript **"I.G.P.A.S: salin capture DOM halaman ini"** Anda bisa
menyalin DOM halaman yang sedang dibuka ke clipboard — **dengan PII otomatis
teredaksi** (nama manager, saldo, token, rank, email, token/csrf, ID
akun/avatar/tracker) — untuk pemetaan halaman baru. Tidak ada UI yang
ditambahkan ke halaman dan tidak ada pengiriman otomatis; Anda yang memilih
menempelkan hasilnya.

## Instal / update

1. Pasang **Tampermonkey** (atau Violentmonkey).
2. Buka
   <https://raw.githubusercontent.com/Cnagnn/igpas/main/src/igpas.user.js> →
   Tampermonkey menawarkan **Install/Update**. Alternatif: Dashboard →
   **Create new script** → tempel isi `src/igpas.user.js`, atau **Check for
   updates**.
3. Buka `igpmanager.com` — halaman studi menampilkan rekomendasi langsung pada
   teks & judul elemen asli. Halaman lain tetap senyap.
4. Setelah update, cukup **reload tab iGP**. Tidak ada langkah GUI/web lain.

## Batasan

- **Tanpa jaringan**: tidak ada `fetch`, XHR, `sendBeacon`, WebSocket,
  `import()` dinamis, `@require`, atau `@connect` (dijaga
  `scripts/check-guards.mjs`).
- **Tanpa penyimpanan**: tidak memakai `GM_getValue`/`GM_setValue`; tidak ada
  profil, snapshot, atau mailbox. Clipboard hanya terisi saat Anda memilih menu
  capture.
- **Tanpa klik/submit** pada elemen game; tab Race live tidak pernah ditulis.
- **Risiko ToS** atas penulisan teks pada elemen asli ditanggung user
  sepenuhnya — lihat [docs/PRIVACY.md](docs/PRIVACY.md).

## Pengembangan

```bash
npm install
npm run verify   # syntax + lint + format:check + versions:check + guards:check + test
```

```
src/igpas.user.js        userscript (tanpa build step)
test/core.test.js        unit test inti/IGPCore (Node)
test/capture.test.js     redaksi PageCapture (jsdom)
test/advisor.test.js     advisor in-place vs fixture DOM nyata (jsdom)
test/fixtures/*.html     DOM halaman iGP yang disanitasi (tanpa data pribadi)
docs/ARCHITECTURE.md     arsitektur & peta komponen
docs/PRIVACY.md          data, redaksi, risiko ToS
```

`npm test` menjalankan **117 test** (82 core + 8 capture + 27 advisor). Butuh
**Node ≥ 22.22.2** (lihat `.nvmrc`); `jsdom@30` menarik `undici@8` yang
mensyaratkan Node ≥ 22.19.

| Gate    | Perintah                 | Catatan                                                                        |
| ------- | ------------------------ | ------------------------------------------------------------------------------ |
| Syntax  | `npm run syntax`         | `node --check src/igpas.user.js`                                               |
| Lint    | `npm run lint`           | `eslint .` (fix: `npm run lint:fix`)                                           |
| Format  | `npm run format:check`   | `prettier --check .` (fix: `npm run format`)                                   |
| Version | `npm run versions:check` | `@version` + `const VERSION` vs `package.json`                                 |
| Guards  | `npm run guards:check`   | `@grant` lengkap, `@match` hanya igpmanager.com, nol jaringan/eval/remote code |
| Tests   | `npm test`               | 117 test                                                                       |

CI (`.github/workflows/ci.yml`) menjalankan `npm run verify` di Node 22 **dan** 24. Release (`.github/workflows/release.yml`) terpicu pada tag `v*.*.*`,
memvalidasi tag = `package.json`, dan mengunggah asset userscript.

Husky opsional lokal:

```bash
npm run prepare   # pre-commit: syntax + lint + guards + versions + tests
```

## Lisensi

GPL-3.0-or-later (SPDX).
