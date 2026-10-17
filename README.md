# I.G.P.A.S — iGP Analytics & Study System

Kalkulator **analisis & studi strategi** untuk [iGP Manager](https://igpmanager.com),
sebagai userscript. Terinspirasi arsitektur [A.C.A.S](https://psyyke.github.io/A.C.A.S/)
(studi reverse-engineering via REA, lihat `docs/ARCHITECTURE.md`).

> ⚠️ **Alat studi — bukan alat balapan.** Tidak ada otomasi, tidak ada aksi ke
> situs, tidak membantu kendali saat balapan live. Gunakan untuk analisis,
> latihan berpikir strategi, dan evaluasi post-race. Patuhi ToS iGP Manager.

## Fitur (v0.2)

| Kalkulator | Input | Output |
|---|---|---|
| Fuel planner | laps remaining, fuel/lap, fuel kini, reserve, kapasitas tangki | total butuh, fuel tambah, laps left on fuel, over-tank |
| Tire projection | wear kini, wear/lap, horizon lap | tabel proyeksi wear per lap |
| Tire life | wear kini, wear/lap, threshold | laps sampai threshold |
| Pit window | fuel-laps left, reserve, tire-laps, margin | latest pit lap, rekomendasi, faktor pembatas |
| Stint splitter | total laps, tire life, pit loss | jumlah stop, distribusi stint, biaya waktu |
| **Strategy recommendation** (v0.2) | fuel-laps, tyre-laps, reserve, pit loss, margin | keputusan pit (plan/pit-soon/pit-now) + alasan |
| **Ranking mobil/manufaktur** (v0.2) | item + rating kriteria 0–10 + bobot | skor & juara, transparan Σ(rating×bobot)/Σbobot |

Profil setup per sirkuit tersimpan lokal (GM storage) dan dirender langsung
di **Command Center**. Sejak v0.7.0, tab iGP **tidak lagi 100% senyap**:
userscript menambahkan **Advisor in-page** di halaman studi (lihat di bawah)
— elemen milik sendiri, melekat di halaman, tanpa menyentuh elemen game.

**Autoload akun, mobil & supply (v0.4.0 → v0.6.2)** — snapshot dimuat **otomatis
setiap Command Center dibuka** (dan saat kembali ke tab itu dengan jeda ≥30 dtk):
satu permintaan **baca-saja per aktivasi** ke tab iGP — bukan polling halaman
game. Seksi **Account & Car Snapshot**: klik *Capture now* untuk menyegarkan
kapan pun (header akun = semua halaman; atribut mobil = halaman *Cars* saja):
nama/level/rank/saldo/token, 8 atribut mobil, design points, bonus supplier, id
supplier engine/fuel/tyre. **Capture supply (v0.5.0)**: buka dialog Supply di
halaman *Cars* (klik tile Engines/Fuel/Tyres — Anda yang membukanya) lalu klik
*Capture supply* → snapshot supplier aktif + semua alternatif (bonus stat &
biaya per balapan, id gambar + eId) untuk engine, fuel, dan tyres — tersimpan
per tipe (merge). Gate-nya **dialog terbuka** (`.supplyDialog`), bukan URL —
asal dialog Supply tampil di tab iGP, capture bekerja dari halaman/varian URL
mana pun. **Capture manufacturers (v0.6.2)**: buka halaman
*Manufacturers* (`p=manufacturers`) di tab iGP — tab **engines** atau
**chassis**, keduanya selalu terbaca karena kedua tabel ada di DOM — lalu klik
*Capture manufacturers* → snapshot daftar engine (name, rating, biaya/balapan,
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
   **autoload** saat halaman dibuka (v0.5.1); **Capture now** / *Request data
   from tabs* tetap tersedia untuk menyegarkan manual.

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

## Advisor in-page (v0.7.0, diperluas v0.7.3)

Userscript kini menempel **panel rekomendasi langsung di halaman iGP** yang
Anda buka — hanya di halaman **studi** (`#pageId` `cars`, `manufacturers`,
`staff`, dan `transfers`, termasuk dialog Supply terbuka), plus — sejak
v0.7.3, atas permintaan user — halaman **pra-balapan** (`#pageId` `race`) tapi
**hanya di tab Setup & Strategy**. Tab **Race live tidak pernah** mendapat UI
apa pun (diverifikasi test snapshot innerHTML), dan halaman lain juga tidak.
Sifatnya:

- **Supply (dialog Engine/Fuel/Tyres terbuka)** — membandingkan supplier aktif
  dengan alternatif di dialog: Σ bonus stat, biaya per balapan, dan
  nilai/biaya (bonus per 1jt). Supplier terbaik nilai & termurah ditandai.
- **Manufacturers** — ranking engine (rating, biaya, rating per 1jt) dan
  chassis (rating) dari baris yang tampil di pager halaman itu.
- **Design points (halaman Cars)** — prioritas alokasi DP per atribut: gap
  nilai atribut Anda terhadap **max rival liga** (`leagueDesignData`), dengan
  usulan % porsi DP proporsional gap terbesar.
- **Drivers & Staff (v0.7.2)** — kondisi tim aktif: ability/mental/health
  tiap driver (+ estimasi pemulihan per jam; health <30% ditandai), gaji &
  kontrak staff aktif, dan status pit crew (mis. terkunci sampai level 5).
  Kartu staff di halaman ini hanya menampilkan bintang — panel **tidak
  mengarang angka rating**; angka kandidat lengkap ada di halaman Transfers.
- **Transfers (v0.7.2)** — pasar yang tampil di tabel: driver terbaik
  (overall, fee, **overall per 1jt fee**, special ability) dan staff pasar
  per peran **CD/TD/DR** (top-2 per peran dengan trait hijau = penguat
  atribut / merah = kelemahan dari tooltip game). Pasar bisa berubah sendiri
  (refresh lelang) — panel diberi catatan dan di-render ulang saat Anda
  berinteraksi.
- **Setup & Strategy pra-balapan (v0.7.3)** — di tab **Setup**: nilai slider
  vs **bar ideal milik game** (titik tengah bar sebagai estimasi; bar setebal
  track = ideal belum dipelajari — ditulis jujur, bukan dikarang), kondisi
  mobil (health/condition/engine; health <30% ditandai "kritis — repair
  dulu"), cuaca, jumlah lap practice, dan kutipan komentar engineer game.
  Di tab **Strategy**: ringkasan alokasi per driver — total lap stint vs laps
  balapan, bensin tersedia vs kebutuhan (laps × fuel/lap game, sisa buffer
  dalam liter & ekuivalen lap), susunan ban per stint + cek aturan
  dua-compound liga (span `#rules`), jumlah pit & risk level game. Panel
  bersifat **snapshot** saat dimuat — kalau Anda mengubah stint/slider,
  buka ulang tab agar perhitungan ikut baru.

Semua panel berlabel **"estimasi — bukan rumus game"**: heuristik transparan
atas angka yang memang tampil, bukan kepastian performa. Ada tombol
**I.G.P.A.S advisor** di kiri-bawah untuk menyembunyikan/menampilkan panel
(preferensi tersimpan lokal; tombol hanya muncul saat ada panel yang
terpasang). Advisor hanya **membaca** DOM yang tampak: tanpa klik, tanpa
submit, tanpa jaringan, tanpa request mailbox, dan elemen game tidak pernah
diubah — di tab Race live bahkan satu node pun tidak ditambahkan
(diverifikasi test snapshot innerHTML).

**Menu capture fixture (v0.7.1):** lewat menu userscript
("I.G.P.A.S: salin capture DOM halaman ini") Anda bisa menyalin DOM halaman
yang sedang dibuka — **dengan PII otomatis teredaksi** (nama manager, saldo,
token, rank) — untuk dikirim agar halaman yang belum terpetakan (mis.
Develop/Design) bisa didukung advisor. Tidak ada UI yang ditambahkan ke
halaman oleh fitur ini dan tidak ada pengiriman otomatis; Anda yang
memilih menempelkan hasilnya.

## Instal (dev)

1. Pasang Tampermonkey/Violentmonkey.
2. Dashboard → Create new script → tempel isi `src/igpas.user.js`.
3. Buka igpmanager.com — halaman Cars/Manufacturers/Team (Overview &
   Transfers) menampilkan panel **I.G.P.A.S advisor** (bisa disembunyikan);
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
npm install        # dev deps (jsdom)
npm test           # core + snapshots + mailbox + gui
node --check src/igpas.user.js
```

## Lisensi

GPL-3.0-or-later (SPDX).
