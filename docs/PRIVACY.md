# PRIVACY & RISIKO — I.G.P.A.S

Berlaku untuk v0.8.6. Dokumen ini menggantikan `docs/COMPLIANCE.md` (dicabut). Ringkas dan faktual:
apa yang disimpan, ke mana data pergi, apa yang disunting saat capture, dan
risiko apa yang tetap ada.

## 1. Tidak ada jaringan

Userscript **tidak** memanggil `fetch`, XHR, `sendBeacon`, WebSocket,
EventSource, `import()` dinamis, atau `@require`/`@connect`. Dijaga otomatis
oleh `scripts/check-guards.mjs` di `npm run verify` dan CI.

Tidak ada server I.G.P.A.S. Tidak ada telemetri. Tidak ada akun.

## 2. Data yang disimpan (lokal, di pengelola userscript)

| Kunci | Isi | Umur |
|---|---|---|
| `igpas:snapshots` | snapshot akun (nama manajer, level, rank, saldo, token), mobil, supply, manufacturers, tim/staff, pasar transfers | **30 hari** sejak capture; record rusak/tanpa `ts` dianggap kedaluwarsa dan dihapus saat dibaca |
| `igpas:profiles` | setup yang Anda simpan sendiri (angka input) | sampai Anda hapus |
| `igpas:advisor` | preferensi tampilan advisor | sampai Anda hapus |
| `igpas:mb:*` | paket mailbox antar-tab | permintaan **10 menit**, hasil **2 menit** (dibersihkan poll mana pun) |
| `igpas:gui:heartbeat` | detak GUI untuk badge sensor | ditimpa tiap 2 detik |

Semua berada di penyimpanan userscript (GM storage) di browser Anda. Tidak
disinkronkan ke mana pun. Tombol **Hapus snapshot** menghapus snapshot seketika.

Jika penyimpanan penuh/ditolak (mode privat, kuota), userscript **melaporkan
gagal** — tidak berpura-pura "tersimpan".

## 3. Capture DOM (`salin capture`)

Fitur ini menyalin DOM halaman ke clipboard untuk pemetaan fixture. Hasilnya
**dirancang untuk ditempel ke issue/PR publik**, jadi redaksi bersifat
konservatif:

Dibuang/diredaksi:
- `<meta>`, `<link>`, `<base>`, `<template>`, `<iframe>`, `<object>`, `<embed>`,
  `<script>` eksekutabel, komentar HTML, dan atribut `srcdoc`/`on*`;
- nilai PII yang dikenal dari halaman (nama manajer, saldo, token, rank) di
  **seluruh** teks dan atribut — termasuk `aria-label`, `alt`, `src`, `style`;
- email dan string token panjang (32+ hex / 40+ alfanumerik) di teks, atribut,
  URL, dan JSON;
- kunci JSON sensitif (`csrf`, `token`, `session`, `auth`, `password`,
  `secret`, `apiKey`, `email`, `manager`, `username`).

**Sisa risiko yang disengaja** (periksa sendiri sebelum menempel di publik):
- nama manajer pihak ketiga / nama tim yang tampil sebagai data permainan
  (tidak bisa dibedakan dari data game lain tanpa merusak fixture);
- ID permainan yang memang dibutuhkan fixture (mis. `id` supplier/brand,
  `data-driver`, id mobil) — bukan identitas akun;
- ID panjang yang bukan token (mis. hash aset) — bisa jadi `[REDACTED]` dan
  membuat sebagian fixture kurang informatif.

Untuk fixture, gunakan capture dari halaman **studi** (bukan halaman profil)
dan buang ID unik sebelum menempel.

## 4. Mailbox antar-tab

- Hanya aktif di origin yang cocok dengan `@match` (igpmanager.com, localhost,
  `cnagnn.github.io/igpas/`).
- Peran GUI dibatasi: `localhost` hanya pada path `/app/`, GitHub Pages hanya
  `/igpas/app/`; halaman lain menjadi `unknown` dan **tidak** memulai polling.
- Paket berisi `from` (peran + instance id) dan ditampilkan di GUI. Hasil
  capture **dialamatkan** ke `gui:<instance>` yang meminta; GUI hanya menerima
  paket untuk instance-nya dari pengirim berperan `sensor:*`, lalu memvalidasi
  skema data per jenis (dan batas 256 KB) sebelum menyimpan.
- Ini **bukan autentikasi kriptografis**. Penyimpanan GM bersifat per-userscript
  (halaman biasa tidak bisa menulisnya), tetapi tab mana pun yang menjalankan
  userscript ini dapat mengirim paket. Karena itu **jangan membuka halaman lokal
  tidak tepercaya di `localhost/app/` saat tab iGP terbuka**.
- Snapshot yang diterima tetap lokal; tidak ada eksfiltrasi oleh userscript.

## 5. Risiko ToS

I.G.P.A.S adalah alat studi read-only: tidak mengklik, tidak submit, tidak
mengotomasi balapan. Risiko interpretasi Terms of Service iGP Manager
sepenuhnya ditanggung pengguna. Jika ragu, jangan pasang userscript saat
balapan live.

## 6. Melaporkan masalah privasi

Buka issue di <https://github.com/Cnagnn/igpas/issues> dengan label `security`
dan sertakan langkah reproduksi **tanpa** data pribadi asli (gunakan nama/ID
palsu).
