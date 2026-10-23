# PRIVACY & RISIKO — I.G.P.A.S

Berlaku untuk v0.9.0. Ringkas dan faktual: apa yang tidak dilakukan userscript,
apa yang disunting saat capture, dan risiko apa yang tetap ada.

## 1. Tidak ada jaringan

Userscript **tidak** memanggil `fetch`, XHR, `sendBeacon`, WebSocket,
EventSource, `import()` dinamis, atau `@require`/`@connect`. Dijaga otomatis
oleh `scripts/check-guards.mjs` di `npm run verify` dan CI.

Tidak ada server I.G.P.A.S. Tidak ada telemetri. Tidak ada akun.

## 2. Tidak ada penyimpanan data

Sejak v0.9.0 userscript **tidak memakai GM storage** (`GM_getValue`,
`GM_setValue`, `GM_deleteValue`, `GM_listValues` sudah dihapus, termasuk
grant-nya). Tidak ada snapshot, profil, mailbox, atau heartbeat.

- Advisor hanya menulis **teks/`title` sementara** pada elemen asli halaman dan
  **me-restore**-nya otomatis; tidak ada salinan yang dipersistenkan.
- Clipboard hanya terisi ketika Anda sendiri memilih menu **"salin capture DOM
  halaman ini"**. Tidak ada penyalinan/pengiriman otomatis.

## 3. Capture DOM (`salin capture`)

Fitur ini menyalin DOM halaman ke clipboard untuk pemetaan fixture. Hasilnya
**dirancang untuk ditempel ke issue/PR publik**, jadi redaksi bersifat
konservatif:

Dibuang/diredaksi:
- `<meta>`, `<link>`, `<base>`, `<template>`, `<iframe>`, `<object>`, `<embed>`,
  `<script>` eksekutabel, komentar HTML, dan atribut `srcdoc`/`on*`;
- nilai PII yang dikenal dari halaman (nama manajer, saldo, token, rank) di
  **seluruh** teks dan atribut — termasuk `aria-label`, `alt`, `src`, `style`;
- isi field sensitif (input/textarea), email, dan string token panjang
  (32+ hex / 40+ alfanumerik) di teks, atribut, URL, dan JSON;
- kunci JSON sensitif (`csrf`, `token`, `session`, `auth`, `password`,
  `secret`, `apiKey`, `email`, `manager`, `username`);
- parameter URL identitas (`manager`, `uid`, `userid`, `account`, `profile`,
  `email`, `username`, token/csrf/session/auth/key); semua `id=` dalam konteks
  `p=manager`/`page=manager` (profil akun/pemain);
- path avatar/akun `/img/user/<id>/…` dan `/av/<id>…`;
- atribut pelacak `data-sharkid`, `visitor`, `tracker`, `analytics`,
  `fingerprint`, `device`;
- `id` level atas pada script bootstrap identitas (`userBootstrap` dsb.).

**Sisa risiko yang disengaja** (periksa sendiri sebelum menempel di publik):
- nama manajer pihak ketiga / nama tim yang tampil sebagai data permainan
  (tidak bisa dibedakan dari data game lain tanpa merusak fixture);
- ID permainan yang memang dibutuhkan fixture (mis. `id` supplier/brand,
  `data-driver`, id mobil) — bukan identitas akun;
- ID panjang yang bukan token (mis. hash aset) — bisa jadi `[REDACTED]` dan
  membuat sebagian fixture kurang informatif.

Untuk fixture, gunakan capture dari halaman **studi** (bukan halaman profil)
dan buang ID unik sebelum menempel.

## 4. Tidak ada GUI web / mailbox

Web Command Center, GitHub Pages, dan mailbox antar-tab sudah dihapus di
v0.9.0. Userscript hanya berjalan di `igpmanager.com` dan tidak berkomunikasi
dengan tab lain. Implementasi lama tetap ada di riwayat git (tag `v0.8.6`)
tetapi tidak lagi dipelihara atau didistribusikan.

## 5. Risiko ToS

I.G.P.A.S adalah alat studi read-only: tidak mengklik, tidak submit, tidak
mengotomasi balapan. Advisor menulis ulang teks/`title` pada elemen asli game
(ToS § V.J tentang scripts). Risiko interpretasi Terms of Service iGP Manager
sepenuhnya ditanggung pengguna. Jika ragu, jangan pasang userscript saat
balapan live.

## 6. Melaporkan masalah privasi

Buka issue di <https://github.com/Cnagnn/igpas/issues> dengan label `security`
dan sertakan langkah reproduksi **tanpa** data pribadi asli (gunakan nama/ID
palsu).
