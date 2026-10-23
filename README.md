# I.G.P.A.S — userscript penasihat studi iGP Manager (read-only)

[![CI](https://github.com/Cnagnn/igpas/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Cnagnn/igpas/actions/workflows/ci.yml)
[![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg)](LICENSE)

**Penasihat keputusan read-only untuk [iGP Manager](https://igpmanager.com) — langsung di
halaman yang sudah Anda buka.** I.G.P.A.S membaca angka yang memang tampil pada halaman studi
(prioritas design, kondisi parts, supplier, penawaran sponsor, target transfer) dan menuliskan
rekomendasinya pada elemen asli game: teks, atribut `title`, dan warna tombol sementara. Satu
file userscript, tanpa build step, dan **tanpa satu pun elemen baru** di halaman — tanpa panel,
badge, atau tombol tambahan.

**"Read-only" berarti tidak ada aksi ke game.** Tidak ada klik atau submit atas nama Anda,
tidak ada permintaan jaringan, dan tidak ada nilai game yang diubah. Halaman **Race, Setup, dan
Strategy tidak pernah dibaca atau ditulis**. Semua tulisan advisor disimpan sebagai teks asli
dan di-restore otomatis setiap re-render serta saat pindah halaman; angka yang tidak terbaca
dibiarkan kosong — tidak pernah diganti tebakan.

> ⚠️ **Alat studi — bukan alat balapan.** Tidak ada otomasi. Risiko interpretasi ToS iGP
> Manager ditanggung sepenuhnya oleh pengguna — rinciannya di
> [docs/PRIVACY.md](docs/PRIVACY.md).

`Status: <b>v0.11.0</b> · GPL-3.0-or-later · tanpa jaringan · tanpa penyimpanan persisten`

[Cara kerja](#cara-kerja) · [Fitur](#fitur) · [Instalasi](#instalasi-tampermonkey) ·
[Batasan](#batasan) · [FAQ](#faq)

## Cara kerja

Setiap rekomendasi menghasilkan satu siklus yang sama: adapter **membaca** DOM halaman studi
(angka game tidak diubah), heuristik murni **menghitung** opsi yang ada dengan ambang yang
ditulis terbuka, hasilnya **ditulis** pada node asli sebagai teks/`title` atau warna tombol,
lalu **di-restore** persis saat re-render dan pindah halaman. Render bereaksi lewat
`MutationObserver` tanpa polling, selalu setelah teks asli dipulihkan — pembacaan tidak pernah
memakai data yang sudah ditulis advisor sendiri.

## Fitur

| Halaman         | Output advisor                                                      | Bentuk          |
| --------------- | ------------------------------------------------------------------- | --------------- |
| Cars — Overview | Urutan atribut `#1..#n` + DP; val/max/gap di `title`                | teks + `title`  |
| Cars — Repair   | Warna tombol `Fix`/`Replace`: ganti / siap-siap / tunda             | warna + `title` |
| Manufacturers   | Peringkat engine & chassis (`★` terbaik); rating/biaya di `title`   | teks + `title`  |
| Supply          | Tombol supplier diwarnai sesuai rekomendasi switch                  | warna + `title` |
| Drivers & Staff | Countdown `Full Recover` pada nama driver; kontrak staff di `title` | teks + `title`  |
| Transfers       | Peringkat baris pasar (driver/staff); link & flag tetap hidup       | teks + `title`  |
| Sponsor         | Tombol `Sign` diwarnai sesuai model nilai (lihat di bawah)          | teks + warna    |

### Sponsor: Primary vs Secondary

- **Secondary (cash)** — hijau + `Sign ★` = income/race tertinggi yang **dijamin**; tombol
  amber = bonus tunai/race tertinggi, lengkap dengan break-even peluang objektif.
- **Primary (token)** — hijau + `Sign ★` = token/race tertinggi; tombol amber = bonus tunai
  tertinggi sebagai trade-off. Token dan cash beda satuan dan **tidak pernah dijumlahkan**.
- Bonus adalah pembayaran **per race** hanya saat objektif tercapai; total kontrak ditampilkan
  hanya bila term kontrak terbaca — tidak ada angka karangan.

### Cars: design & repair

Prioritas design point memakai gap ke max liga; ambang repair 50/60% menentukan ganti,
siap-siap, atau tunda — biaya, stok, dan restock tetap di `title`.

### Supply: switch-aware

Peringkat menggabungkan supplier aktif dan kandidat (Σ bonus per biaya); tombol alternatif
merah hanya bila ≥5% lebih efisien — mencegah loop ganti-mengganti supplier.

### Race, Setup, Strategy: tidak disentuh

Advisor hanya aktif di halaman studi dan dialog Sponsor. Tab Race, Setup, dan Strategy
pra-balapan tidak dibaca dan tidak ditulis — sama sekali.

Semua tulisan berlabel **"estimasi — bukan rumus game"**: heuristik transparan atas angka yang
tampil, bukan kepastian performa.

## Instalasi (Tampermonkey)

1. Pasang [Tampermonkey](https://www.tampermonkey.net/) (runner lain, mis. Violentmonkey,
   belum diuji).
2. Buka [src/igpas.user.js](https://raw.githubusercontent.com/Cnagnn/igpas/main/src/igpas.user.js)
   dan setujui prompt instalasi userscript.
3. Buka `igpmanager.com` — halaman studi dan dialog Sponsor langsung menampilkan rekomendasi;
   halaman lain tetap senyap.
4. Pembaruan: pasang ulang dari tautan di atas atau dari
   [halaman Release](https://github.com/Cnagnn/igpas/releases) (setiap rilis bertag
   `v*.*.*`), lalu biasanya cukup muat ulang tab iGP.

<details>
<summary>Alternatif pemasangan manual</summary>

Dasbor Tampermonkey → **Create new script** → tempel isi `src/igpas.user.js`, simpan, lalu muat
ulang tab iGP. Tidak ada langkah build atau server lain.
</details>

## Batasan

- **Tanpa jaringan** — tidak ada `fetch`, XHR, `sendBeacon`, WebSocket, `import()` dinamis,
  `@require`, atau `@connect`; dijaga mekanis oleh `scripts/check-guards.mjs`.
- **Tanpa penyimpanan persisten** — tidak ada GM storage, profil, snapshot, atau mailbox.
  Clipboard hanya terisi saat Anda memilih menu capture; penanda internal `data-igpas-*`
  hanya hidup di DOM selama halaman terbuka.
- **Tanpa aksi game** — tidak ada klik/submit pada elemen game; advisor tidak pernah
  mengubah nilai, state, atau urutan balapan.
- **Risiko ToS ditanggung pengguna** — tool menulis ke DOM, jadi interpretasi ToS tetap milik
  Anda ([docs/PRIVACY.md](docs/PRIVACY.md)). Jika ragu, jangan memasang userscript saat
  balapan live.

## Kualitas & pemeliharaan

`npm run verify` menjalankan syntax, lint, format, version sync, guards, dan **110 test**
(72 core + 8 capture + 30 advisor) di Node 22 dan 24. Guards menolak network, `eval`,
remote code, dan `@match` di luar `igpmanager.com`. Setiap rilis bertag memicu workflow yang
memvalidasi tag = `package.json`, menjalankan gate penuh, dan mengunggah asset userscript.

Tidak ada janji jadwal rilis. Jika data halaman tidak terbaca, advisor dirancang gagal jujur —
menyembunyikan dirinya, bukan menulis angka karangan.

Menu **"I.G.P.A.S: salin capture DOM halaman ini"** menyalin DOM halaman aktif ke clipboard
dengan PII otomatis teredaksi — tanpa pengiriman otomatis ([docs/PRIVACY.md](docs/PRIVACY.md)).

## Pengembangan

```bash
npm install
npm run verify   # syntax + lint + format + versions + guards + test
```

Pre-commit memakai Git hook native (`scripts/githooks`, dipasang otomatis oleh `npm install`
lewat script `prepare`). Panduan kontribusi, struktur repo, dan alur fixture ada di
[CONTRIBUTING.md](CONTRIBUTING.md); butuh **Node ≥ 22.22.2** (`.nvmrc` memakai 24).

## FAQ

### Apakah ini bot atau cheat?

Bukan. Tidak ada klik, submit, atau otomasi; Race/Setup/Strategy tidak disentuh.

### Apakah akun saya bisa kena ban?

Tidak ada jaminan. Userscript menulis pada DOM game, sehingga interpretasi ToS iGP Manager
sepenuhnya risiko pengguna — jangan memasangnya saat balapan live jika ragu.

### Apakah data saya dikirim ke mana pun?

Tidak. Tidak ada request jaringan dan tidak ada penyimpanan persisten; keduanya dijaga guard
yang dijalankan CI, bukan sekadar janji di dokumen.

### Kenapa rekomendasi tidak muncul?

Pastikan halaman studi atau dialog Sponsor sedang terbuka dan userscript aktif. Jika data
tidak terbaca, I.G.P.A.S sengaja tidak menulis apa pun — bukan menampilkan angka `0`.

### Apakah ada kalkulator setup atau strategi balapan?

Tidak. Advisor Setup dan Strategy pra-balapan dihapus sejak v0.10.0; fokus tetap pada halaman
studi dan dialog Sponsor.

## Lisensi

GPL-3.0-or-later (SPDX) — lihat [LICENSE](LICENSE).
Dokumen terkait: [PRIVACY](docs/PRIVACY.md) · [ARSITEKTUR](docs/ARCHITECTURE.md) ·
[SECURITY](SECURITY.md) · [CONTRIBUTING](CONTRIBUTING.md) ·
[Issues](https://github.com/Cnagnn/igpas/issues) ·
[Releases](https://github.com/Cnagnn/igpas/releases).
