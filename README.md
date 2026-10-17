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

Profil setup per sirkuit tersimpan lokal (GM storage), hotkey **Alt+I** untuk
buka/tutup panel.

## Dual-Tab Command Center (v0.2)

Struktur ala A.C.A.S: **tab 1** GUI Command Center (ter-host GitHub Pages),
**tab 2** igpmanager.com (sensor), tersambung via **mailbox GM-storage**
(polling, read-once — pola CommLink).

1. Buka **tab 1**: <https://cnagnn.github.io/igpas/> (landing) → klik
   **Open Command Center** (atau langsung <https://cnagnn.github.io/igpas/app/>)
   → badge "● live (userscript aktif)" (butuh userscript terpasang).
2. Buka **tab 2**: igpmanager.com → panel floating menampilkan status
   `GUI: ● terhubung`.
3. Di GUI: **Request data from tabs** → menerima laporan adapter/profil dari
   tab igpmanager; panel **Strategy Recommendations** dan **Data Lab**
   (ranking mobil & manufaktur) siap dipakai.

Fallback dev lokal (opsional):
```bash
python3 -m http.server 8787 -d docs   # lalu buka http://localhost:8787/ (landing) atau /app/
```

> Sumber data v0.2 tetap **manual**. Adapter DOM (mobil/manufaktur otomatis)
> berstatus `selectors-tbd` — framework siap, pemetaan halaman nyata belum
> dilakukan (lihat `docs/ARCHITECTURE.md` § Fase 3). Tidak ada selector fiktif.

Semua angka berasal dari **input Anda sendiri** — tidak ada asumsi data game.

## Instal (dev)

1. Pasang Tampermonkey/Violentmonkey.
2. Dashboard → Create new script → tempel isi `src/igpas.user.js`.
3. Buka igpmanager.com → klik tombol **📊 IGPAS** kanan-bawah.

## Pengembangan

```
src/igpas.user.js   userscript (tanpa build step)
test/core.test.js   unit test inti (Node)
docs/ARCHITECTURE.md blueprint + peta pola A.C.A.S → I.G.P.A.S
```

Jalankan verifikasi:

```bash
node --check src/igpas.user.js
node test/core.test.js
```

## Lisensi

GPL-3.0-or-later (SPDX).
