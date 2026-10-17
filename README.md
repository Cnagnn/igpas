# I.G.P.A.S — iGP Analytics & Study System

Kalkulator **analisis & studi strategi** untuk [iGP Manager](https://igpmanager.com),
sebagai userscript. Terinspirasi arsitektur [A.C.A.S](https://psyyke.github.io/A.C.A.S/)
(studi reverse-engineering via REA, lihat `docs/ARCHITECTURE.md`).

> ⚠️ **Alat studi — bukan alat balapan.** Tidak ada otomasi, tidak ada aksi ke
> situs, tidak membantu kendali saat balapan live. Gunakan untuk analisis,
> latihan berpikir strategi, dan evaluasi post-race. Patuhi ToS iGP Manager.

## Fitur (v0.1)

| Kalkulator | Input | Output |
|---|---|---|
| Fuel planner | laps remaining, fuel/lap, fuel kini, reserve, kapasitas tangki | total butuh, fuel tambah, laps left on fuel, over-tank |
| Tire projection | wear kini, wear/lap, horizon lap | tabel proyeksi wear per lap |
| Tire life | wear kini, wear/lap, threshold | laps sampai threshold |
| Pit window | fuel-laps left, reserve, tire-laps, margin | latest pit lap, rekomendasi, faktor pembatas |
| Stint splitter | total laps, tire life, pit loss | jumlah stop, distribusi stint, biaya waktu |

Profil setup per sirkuit disimpan lokal (GM storage), hotkey **Alt+I** untuk
buka/tutup panel.

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

GPL-3.0.
