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
di **Command Center** (v0.3.0: userscript tidak lagi menampilkan panel apapun
di igpmanager.com — tab permainan = sensor senyap).

**Autoload akun, mobil & supply (v0.4.0 → v0.6.0)** — snapshot dimuat **otomatis
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
mana pun. **Capture manufacturers (v0.6.0)**: buka halaman
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
> manufacturers engine/chassis (v0.6.0) bisa di-**autoload/ capture** dari
> halaman iGP (read-only, satu permintaan per aksi GUI). Data Lab juga menerima
> input manual/JSON. Tidak ada selector fiktif — semua selektor dipetakan dari
> capture DOM halaman nyata (`test/fixtures/`).

Semua angka berasal dari **input Anda sendiri** — tidak ada asumsi data game.

## Instal (dev)

1. Pasang Tampermonkey/Violentmonkey.
2. Dashboard → Create new script → tempel isi `src/igpas.user.js`.
3. Buka igpmanager.com — **tidak ada UI yang muncul** (sensor senyap).
4. Buka <https://cnagnn.github.io/igpas/app/> — seluruh antarmuka ada di sini.

## Pengembangan

```
src/igpas.user.js        userscript (tanpa build step)
test/core.test.js        unit test inti (Node)
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
