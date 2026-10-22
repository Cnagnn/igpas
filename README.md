# I.G.P.A.S — iGP Analytics & Study System

Kalkulator **analisis & studi strategi** untuk [iGP Manager](https://igpmanager.com),
sebagai userscript. Terinspirasi arsitektur [A.C.A.S](https://psyyke.github.io/A.C.A.S/)
(studi reverse-engineering via REA, lihat `docs/ARCHITECTURE.md`).

> ⚠️ **Alat studi — bukan alat balapan.** Tidak ada otomasi, tidak ada aksi ke
> situs, tidak membantu kendali saat balapan live. Gunakan untuk analisis,
> latihan berpikir strategi, dan evaluasi post-race. Risiko banned/pelanggaran
> ToS iGP Manager **ditanggung penuh oleh user** — projek ini tidak bertanggung
> jawab atas akun anda.

## Fitur (v0.2)

| Kalkulator                          | Input                                                          | Output                                                 |
| ----------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------ |
| Fuel planner                        | laps remaining, fuel/lap, fuel kini, reserve, kapasitas tangki | total butuh, fuel tambah, laps left on fuel, over-tank |
| Tire projection                     | wear kini, wear/lap, horizon lap                               | tabel proyeksi wear per lap                            |
| Tire life                           | wear kini, wear/lap, threshold                                 | laps sampai threshold                                  |
| Pit window                          | fuel-laps left, reserve, tire-laps, margin                     | latest pit lap, rekomendasi, faktor pembatas           |
| Stint splitter                      | total laps, tire life, pit loss                                | jumlah stop, distribusi stint, biaya waktu             |
| **Strategy recommendation** (v0.2)  | fuel-laps, tyre-laps, reserve, pit loss, margin                | keputusan pit (plan/pit-soon/pit-now) + alasan         |
| **Ranking mobil/manufaktur** (v0.2) | item + rating kriteria 0–10 + bobot                            | skor & juara, transparan Σ(rating×bobot)/Σbobot        |

Profil setup per sirkuit tersimpan lokal (GM storage) dan dirender langsung
di **Command Center**. Sejak v0.7.0, tab iGP **tidak lagi 100% senyap**:
userscript menambahkan **Advisor in-page** di halaman studi (lihat di bawah).
Di halaman Cars, **teks label asli tiap baris stats ditulis ulang**
(`#1 Fuel economy · 26 DP`) — tanpa elemen baru; angka & bar game tidak
disentuh, teks asli dikembalikan otomatis saat cleanup. Pola yang sama
berlaku di dialog Supply (biaya kartu ditulis `#n · 350k ★`, verdict aktif
di judul dialog) dan halaman Manufacturers (nama baris ditulis `#n Nama`).
Risiko ToS atas
modifikasi DOM ini **ditanggung user sepenuhnya**.

**Autoload akun, mobil & supply (v0.4.0 → v0.6.2)** — snapshot dimuat **otomatis
setiap Command Center dibuka** (dan saat kembali ke tab itu dengan jeda ≥30 dtk):
satu permintaan **baca-saja per aktivasi** ke tab iGP — bukan polling halaman
game. Seksi **Account & Car Snapshot**: klik _Capture now_ untuk menyegarkan
kapan pun (header akun = semua halaman; atribut mobil = halaman _Cars_ saja):
nama/level/rank/saldo/token, 8 atribut mobil, design points, bonus supplier, id
supplier engine/fuel/tyre. **Capture supply (v0.5.0)**: buka dialog Supply di
halaman _Cars_ (klik tile Engines/Fuel/Tyres — Anda yang membukanya) lalu klik
_Capture supply_ → snapshot supplier aktif + semua alternatif (bonus stat &
biaya per balapan, id gambar + eId) untuk engine, fuel, dan tyres — tersimpan
per tipe (merge). Gate-nya **dialog terbuka** (`.supplyDialog`), bukan URL —
asal dialog Supply tampil di tab iGP, capture bekerja dari halaman/varian URL
mana pun. **Capture manufacturers (v0.6.2)**: buka halaman
_Manufacturers_ (`p=manufacturers`) di tab iGP — tab **engines** atau
**chassis**, keduanya selalu terbaca karena kedua tabel ada di DOM — lalu klik
_Capture manufacturers_ → snapshot daftar engine (name, rating, biaya/balapan,
stats terlihat/disembunyikan, customers) & chassis (name, rating, customers)
plus total halaman pager. **Deteksi berbasis DOM, bukan URL** — ketiga bentuk
URL bekerja sama: `…/app/p=manufacturers`, `…&tab=engines`, dan `…&tab=chassis`
(gate `#pageId=manufacturers`; kedua tabel selalu ada di DOM). Snapshot
tersimpan lokal (GM storage); bila tab iGP belum terbuka, status menampilkan
pesan jujur (bukan data palsu). Tanpa aksi apa pun pada elemen game, dan
halaman balapan tidak pernah dibaca.

## Dual-Tab Command Center (v0.2)

Struktur ala A.C.A.S: **tab 1** GUI Command Center (ter-host GitHub Pages),
**tab 2** igpmanager.com (sensor), tersambung via **mailbox GM-storage**
(polling, read-once — pola CommLink).

1. Buka **tab 1**: <https://cnagnn.github.io/igpas/> (landing) → klik
   **Open Command Center** (atau langsung <https://cnagnn.github.io/igpas/app/>)
   → badge "● live (userscript aktif)" (butuh userscript terpasang).
2. Buka **tab 2**: igpmanager.com (sensor **senyap** — v0.3.0 tidak meng-inject
   UI apa pun ke halaman permainan). Deteksi sensor otomatis: panel
   **Connection** tab 1 menampilkan badge sensor begitu tab iGP menjawab.
3. Di GUI: panel **Strategy Recommendations** dan **Data Lab**
   (ranking mobil & manufaktur) siap dipakai. Seksi **Account & Car Snapshot**
   **autoload** saat halaman dibuka (v0.5.1); **Capture now** / _Request data
   from tabs_ tetap tersedia untuk menyegarkan manual.

Fallback dev lokal (opsional):

```bash
python3 -m http.server 8787 -d docs   # lalu buka http://localhost:8787/ (landing) atau /app/
```

> Data akun, mobil (v0.4.0), supply engine/fuel/tyre (v0.5.0), dan daftar
> manufacturers engine/chassis (v0.6.2) bisa di-**autoload/ capture** dari
> halaman iGP (read-only, satu permintaan per aksi GUI). Data Lab juga menerima
> input manual/JSON. Tidak ada selector fiktif — semua selektor dipetakan dari
> capture DOM halaman nyata (`test/fixtures/`).

Semua angka berasal dari **input Anda sendiri** — tidak ada asumsi data game.

## Advisor in-page (v0.7.0, diperluas v0.7.3–0.8.0, penuh in-place sejak v0.8.1)

Userscript **tidak menambahkan elemen apa pun** ke halaman iGP: tanpa panel,
tanpa badge, tanpa tombol toggle. Semua rekomendasi **menyatu dengan elemen
asli game** — di halaman **studi** (`#pageId` `cars`, `manufacturers`,
`staff`, dan `transfers`, termasuk dialog Supply terbuka) serta tab
**Setup/Strategy pra-balapan** (`#pageId` `race` + wadah `#setup`/`#strategy`;
v0.8.2). Rekomendasi ditulis sebagai **teks pada node asli** (peringkat `#n …`,
tanda `★`, ringkasan practice/fuel/stint) plus **detail di
atribut `title` elemen yang sama**; angka, bar, link, flag, dan ikon game tidak
pernah disentuh. Teks/title asli disimpan dan **di-restore otomatis** setiap
re-render dan saat pindah halaman — tidak ada tombol untuk diklik. Div
**`#race` (tab Race live) tidak pernah ditulis** — hanya dibaca read-only
untuk karakteristik trek (overtaking/bumpiness/fuel/wear + panjang sirkuit),
dan halaman lain juga tidak. Sifatnya:

- **Supply (dialog Engine/Fuel/Tyres terbuka)** — peringkat ditulis ke kartu
  asli dialog (`#n · biaya ★`), verdict supplier aktif vs alternatif di judul
  dialog: Σ bonus stat, biaya per balapan, dan nilai/biaya (bonus per 1jt).
- **Manufacturers** — peringkat ditulis ke nama baris asli (`#n Nama`) engine
  (rating, biaya, rating per 1jt) dan chassis (rating) dari baris yang tampil
  di pager halaman itu.
- **Design points (halaman Cars)** — label asli tiap baris ditulis ulang
  (`#1 Fuel economy · 26 DP`): gap nilai atribut Anda terhadap **max rival
  liga** (`leagueDesignData`), dengan usulan % porsi DP proporsional gap
  terbesar; detail val/max/gap di `title` baris yang sama.
- **Drivers & Staff (v0.7.2)** — kondisi tim aktif langsung pada kartu asli:
  saran kesehatan/pemulihan driver ditempel pada **span nama yang sudah ada**
  (struktur `br` + `span` dipertahankan) dengan detail di `title` container;
  gaji & kontrak staff aktif di `title` header kartu. Kartu staff hanya
  menampilkan bintang — **tidak ada angka rating karangan**; angka kandidat
  lengkap ada di halaman Transfers.
- **Transfers (v0.7.2)** — peringkat ditulis ke **text node nama** baris asli
  (`#n Nama ★ rekomendasi` untuk peringkat 1): driver (overall, fee di
  `title`) dan staff per peran; **link kontrak dan flag negara di dalam sel
  tetap hidup** karena hanya text node yang ditulis ulang.
- **Setup & Strategy pra-balapan (v0.8.2; fuel v0.8.3)** — pembaca perilaku track
  (overtaking/bumpiness/fuel/wear + panjang sirkuit, read-only dari tab Race)
  - agregasi **seluruh lap practice** menjadi fuel/lap, tyre %/lap, dan timelap
    per stint. Setup: ringkasan practice di span nama driver + `title` agregasi,
    hint trek, dan arah slider game; komentar engineer hanya `title` (span merah
    utuh). Strategy: **komentar pembalap tidak ditulis**; estimasi fuel tampil
    langsung pada label asli **Fuel (litres)** di wadah `#dNAdvancedFuel`
    (`estimasi <practice/lap × Total laps estimate> L · terisi <nilai game> L
(selisih)`), **tanpa cadangan**, dengan `title` berisi rumus + sumber data;
    `title` juga pada span total laps. Nilai fuel, tombol −/+, dan ikon game
    tidak diubah. Div `#race` tidak pernah ditulis.

Semua tulisan berlabel **"estimasi — bukan rumus game"** di `title`: heuristik
transparan atas angka yang memang tampil, bukan kepastian performa. Render
**instan**: MutationObserver bereaksi di microtask yang sama saat game commit
DOM (tanpa menunggu klik user), dengan restore-dulu agar adapter selalu
membaca data murni. Advisor hanya **membaca** DOM yang tampak: tanpa klik,
tanpa submit, tanpa jaringan, tanpa request mailbox.

**Menu capture fixture (v0.7.1):** lewat menu userscript
("I.G.P.A.S: salin capture DOM halaman ini") Anda bisa menyalin DOM halaman
yang sedang dibuka — **dengan PII otomatis teredaksi** (nama manager, saldo,
token, rank) — untuk dikirim agar halaman yang belum terpetakan (mis.
Develop/Design) bisa didukung advisor. Tidak ada UI yang ditambahkan ke
halaman oleh fitur ini dan tidak ada pengiriman otomatis; Anda yang
memilih menempelkan hasilnya.

## Perbandingan keputusan (v0.8.0)

Pertanyaan "staff/driver saya **lebih bagus, lebih buruk, atau sama** dengan
yang ada di bursa transfer?" dijawab sebagai **verdict eksplisit** di dua tempat:

- **Command Center → Decision Compare** — panel yang membandingkan seluruh
  roster (driver + staff CD/TD/DR) dan supplier dengan pilihan di luar. Tombol
  _Ambil roster_ (tab iGP di halaman **Drivers & Staff**) dan _Ambil pasar_
  (tab iGP di halaman **Transfers**) mengisi snapshot; _Bandingkan sekarang_
  me-render ulang panel. Ringkasan di atas tabel menunjukkan berapa baris yang
  lebih bagus / lebih buruk / sama / tak terbaca.
- **Advisor in-page** — tanpa panel banding terpisah: rekomendasi hanya
  berupa peringkat `#n` + `★` pada teks asli dan verdict di `title`
  (dialog **Supply**: supplier aktif vs alternatif; **Transfers**: peringkat
  pasar per baris).

Cara verdict dihitung (semuanya transparan dan selalu berlabel
**estimasi — bukan rumus game**):

| Simbol        | Arti                                                         |
| ------------- | ------------------------------------------------------------ |
| ▲ lebih bagus | nilai Anda di atas pembanding (atau biaya Anda di bawahnya)  |
| ▼ lebih buruk | nilai Anda di bawah pembanding (atau biaya Anda di atasnya)  |
| ≈ sama        | selisih ≤ 2% (toleransi bisa diatur pemanggil)               |
| ? tak terbaca | salah satu sisi tidak menampilkan angka — **tidak dikarang** |

Dua sumbu dilaporkan terpisah: **rating** (pembanding = nilai tertinggi di
pasar; naik = lebih bagus) dan **biaya per balapan** (pembanding = termurah;
turun = lebih bagus). Verdict akhir memakai sumbu rating bila kedua sisi punya
angka, selainnya biaya. Peran dinormalisasi (`Chief Designer` ↔ `CD`) agar
roster halaman Teams sebanding dengan kode di halaman Transfers.

**Soal angkanya — jujur:** sisi rating memakai _indeks 12-stat_ (rata-rata 12
angka CSV pada kolom rating game). Bentuk angka ini identik di kedua halaman
sehingga bisa dibandingkan, **tetapi ini BUKAN overall game** — game
membulatkan tiap stat, jadi hasilnya beda tipis dari kolom _Overall/Fee_.
Kartu staff di halaman Teams hanya menampilkan bintang (tanpa CSV), sehingga
baris itu umumnya **"tak terbaca"** di sumbu rating dan verdict-nya jatuh ke
sumbu gaji — disebut terang-terangan di Decision Compare. Fee tanda tangan
ditampilkan sebagai info saja (tidak dinilai), karena biaya sekali bayar tidak
sebanding dengan gaji per balapan.

Semuanya tetap **read-only**: tidak ada klik/submit di elemen game, tidak ada
jaringan, dan tulisan advisor in-page **tidak menambah permintaan mailbox** —
ia hanya membaca DOM/snapshot yang sudah ada.

## Instal (dev)

1. Pasang Tampermonkey/Violentmonkey.
2. Dashboard → Create new script → tempel isi `src/igpas.user.js`.
3. Buka igpmanager.com — halaman Cars/Manufacturers/Staff/Transfers
   menampilkan rekomendasi **langsung pada teks & judul elemen asli**
   (tanpa panel/tombol); tab Setup/Strategy pra-balapan menampilkan
   ringkasan practice + fuel/pit/ban (div `#race` tak ditulis);
   halaman lain tetap senyap.
4. Buka <https://cnagnn.github.io/igpas/app/> — Command Center & alur capture.

## Pengembangan

```
src/igpas.user.js        userscript (tanpa build step)
test/core.test.js        unit test inti + heuristik advisor (Node)
test/advisor.test.js     advisor in-page vs fixture DOM nyata (jsdom)
test/snapshots.test.js   adapter akun+mobil+supply+manufacturers vs fixture DOM nyata (jsdom)
test/mailbox.test.js     semantik mailbox dual-tab (read-once, TTL, konsumsi)
test/gui.test.js         smoke GUI /app/ + alur autoload (jsdom + shell nyata)
test/fixtures/*.html     DOM halaman iGP yang disanitasi (tanpa data pribadi)
docs/ARCHITECTURE.md     blueprint + peta pola A.C.A.S → I.G.P.A.S
```

Jalankan verifikasi:

```bash
npm install        # dev deps (jsdom + eslint + prettier) — butuh Node >= 22.22.2
npm test           # core + snapshots + mailbox + gui + advisor
node --check src/igpas.user.js
```

> **Node ≥ 22.22.2** (lihat `.nvmrc`). `jsdom@30` menarik `undici@8` yang
> mensyaratkan Node ≥ 22.19 — di Node 20 test suite gagal saat `require`.

## Quality & CI

Satu perintah gate penuh:

```bash
npm run verify     # syntax + lint + format:check + versions:check + guards:check + npm test
```

| Gate                                     | Perintah                 | Catatan                                                      |
| ---------------------------------------- | ------------------------ | ------------------------------------------------------------ |
| Syntax                                   | `npm run syntax`         | `node --check src/igpas.user.js`                             |
| Lint                                     | `npm run lint`           | `eslint .` — fix: `npm run lint:fix`                         |
| Format                                   | `npm run format:check`   | `prettier --check .` — fix: `npm run format`                 |
| Version sync                             | `npm run versions:check` | cek `@version` + `const VERSION` vs `package.json`,          |
| `docs/index.html` & lockfile (hard-fail) |
| Guards                                   | `npm run guards:check`   | `@grant` lengkap + tanpa `fetch`/`XHR`/`eval`/`unsafeWindow` |
| Tests                                    | `npm test`               | 157 tests                                                    |

CI (`ci.yml`) menjalankan semua gate (`npm run verify`), termasuk guard userscript.

Pages (`pages.yml`) hanya deploy `docs/` setelah `verify` hijau.
Release (`release.yml`) terpicu pada tag `v*.*.*` dan memvalidasi tag vs `package.json`.

Husky opsional lokal:

```bash
npm run prepare   # aktifkan pre-commit (syntax + lint + versions)
```

Lihat `CONTRIBUTING.md` untuk workflow adapter baru & konvensi.

## Lisensi

GPL-3.0-or-later (SPDX).
