# I.G.P.A.S — Arsitektur (userscript-only)

Penasihat studi **read-only** untuk iGP Manager dalam satu file userscript,
tanpa build step, tanpa web GUI, tanpa jaringan, dan tanpa penyimpanan.

Versi saat ini 0.9.5.

## 1. Ruang lingkup

- ✅ Rekomendasi in-page pada halaman **studi** iGP (Cars, Manufacturers,
  Supply, Drivers & Staff, Transfers) dan tab **Setup/Strategy pra-balapan**.
- ✅ Menu capture DOM dengan redaksi PII untuk pemetaan fixture.
- ✅ Supply **switch-aware**: efisiensi = Σ bonus per 1jt biaya. Peringkat menggabungkan supplier aktif + alternatif (seri dimenangkan aktif), judul menulis `TERBAIK: AKTIF` atau `TERBAIK: ALTERNATIF #1`; `★`/`ganti dianjurkan` hanya bila alternatif ≥5% lebih efisien — mencegah loop ganti supplier.
- ✅ Cars **Repair**: tombol `Fix`/`Replace` diwarnai dari kondisi yang tampil + rekomendasi — merah ≤50% (ganti), amber 50–60% (siap-siap), abu-abu >60% (tunda). Judul kartu tidak diubah; biaya/stok/restock/ambang di `title`; tidak mengklik tombol.
- ❌ Tidak ada Command Center / web GUI / GitHub Pages.
- ❌ Tidak ada mailbox antar-tab, GM storage, profil, atau snapshot.
- ❌ Tidak scrape/automasi saat balapan live; `#race` tidak pernah ditulis.
- ❌ Tidak ada klik/submit/fetch/XHR.

## 2. Komponen

| Komponen | Peran |
| --- | --- |
| `Utils` | Helper murni: parsing angka/uang, `numOrNull`, `statIndex`, `roleCode`, format |
| `IGPCore` | Mesin heuristik murni & teruji: `designPriority`, `repairAdvice`, `rankSuppliers`, `compareSuppliers`, `rankManufacturerItems`, `describeTrack`, `summarizePracticeLaps`, `recommendRaceFuel`, `practiceTyreLife`, `summarizeStrategy`, `stintSplit`, `parseLapTime`, dll. |
| `IgpCarsAdapter` | Parser read-only halaman Cars → `{ attrs, best, designPoints, suppliers, … }`; tab Repair dibaca langsung oleh `Advisor.mountRepair` (kondisi, biaya tombol, stok) dan diwarnai in-place |
| `IgpSupplyAdapter` | Parser read-only dialog Supply → `{ type, current, alternatives }` |
| `IgpManufacturersAdapter` | Parser read-only tabel engine + chassis |
| `IgpStaffAdapter` | Parser read-only Drivers & Staff (driver, staff, pit crew) |
| `IgpTransfersAdapter` | Parser read-only pasar Transfers (driver + staff) |
| `IgpRaceSetupAdapter` | Parser read-only tab Setup (slider, kondisi, riwayat practice) |
| `IgpRaceStrategyAdapter` | Parser read-only tab Strategy (fuel, stint, ban, aturan) |
| `IgpTrackAdapter` | Parser read-only `.raceInfoTable` di div `#race` (tanpa menulis) |
| `Advisor` | Menulis rekomendasi ke teks/`title` elemen asli + restore otomatis |
| `PageCapture` | Menu userscript: salin DOM teredaksi ke clipboard |
| `boot()` | Gate host `igpmanager.com`, pasang Advisor + menu capture |

Adapter adalah **parser murni atas `document`** (tidak menyimpan, tidak
mengirim). Advisor memanggilnya secara langsung saat merender.

## 3. Alur data

```
DOM halaman iGP (read-only)
        │
        ├─ Igp*Adapter.captures(document)  → data terstruktur
        │
        ├─ IGPCore.* (heuristik murni)     → peringkat / estimasi / verdict
        │
        └─ Advisor: tulis teks + title pada node ASLI
                      │
                      └─ restore otomatis (data-igpas-orig / data-igpas-written)

Menu capture → PageCapture.buildCapture(document) → redaksi → clipboard
```

Tidak ada langkah jaringan, storage, atau sinkronisasi antar-tab.

## 4. Disiplin DOM

1. **Gate `#pageId`** — setiap adapter hanya aktif di halaman yang cocok
   (`cars`, `manufacturers`, `staff`, `transfers`, `race` + wadah
   `#setup`/`#strategy`; Supply via dialog `.supplyDialog`).
2. **`#race` live tidak pernah ditulis** — hanya dibaca `IgpTrackAdapter`.
3. **In-place** — tidak ada elemen baru; hanya text node, atribut `title`, dan
   style sementara pada elemen milik game (warna tombol Repair).
4. **Restore-pertama** — sebelum setiap pembacaan, tulisan advisor
   dikembalikan agar adapter selalu membaca data game murni. Setiap tulisan
   menyimpan `data-igpas-orig` + `data-igpas-written` (atau pasangan
   `data-igpas-orig-style` + `data-igpas-written-style`); restore tidak menimpa
   teks/style yang sudah diganti game.
5. **Gagal jujur** — data tak terbaca → tidak ada tulisan/angka karangan,
   bukan `0`.
6. **Render instan** — MutationObserver bereaksi saat game commit DOM; tanpa
   polling halaman game.

## 5. Boot & guard

- `@match` hanya `https://igpmanager.com/*` dan
  `https://*.igpmanager.com/*`.
- `boot()` memeriksa `location.hostname` sebelum memasang apa pun.
- `@grant` hanya `GM_registerMenuCommand`, `GM_setClipboard`,
  `GM_notification`.
- `scripts/check-guards.mjs` menolak `@match` di luar allowlist, `@require`/
  `@connect`/`@updateURL`, serta `fetch`/XHR/`sendBeacon`/socket/`import()`/
  `eval`/`unsafeWindow`/`document.write`.

## 6. Testing

- `test/core.test.js` — 85 test murni untuk `IGPCore`/`Utils`.
- `test/capture.test.js` — 8 test redaksi `PageCapture` (jsdom).
- `test/advisor.test.js` — 31 test advisor vs fixture DOM nyata (jsdom):
  in-place, restore, idempoten, `#race` zero-UI, menu capture.
- `test/fixtures/*.html` — capture DOM tersanitasi (PII/script dibuang).

Total **124 test**; dijalankan oleh `npm test` dan `npm run verify` (CI Node
22/24).

## 7. Sejarah singkat

- Arsitektur awal terinspirasi [A.C.A.S](https://psyyke.github.io/A.C.A.S/)
  (studi reverse-engineering, satu file userscript, adapter per page-type,
  guard data basi, read-only). Kode A.C.A.S tidak disalin.
- v0.2–v0.8.x memakai Command Center web (dual-tab + mailbox GM storage +
  snapshot). **v0.9.0 menghapus seluruh jalur itu** — GUI web, GitHub Pages,
  mailbox, adapter registry, dan GM storage — dan mempertahankan Advisor
  in-page + capture. Implementasi lama tetap tersedia di riwayat git
  (tag `v0.8.6`).
- Input manual/kalkulator mandiri tidak lagi disediakan sebagai UI; estimasi
  yang relevan ditampilkan in-page pada halaman Setup/Strategy.

## 8. Etika & batasan

Userscript menulis ulang **teks pada elemen asli game** (tanpa elemen baru).
Risiko interpretasi ToS sepenuhnya ditanggung user; rincian data dan redaksi
ada di [PRIVACY.md](PRIVACY.md). Tab Race live tidak pernah ditulis dan tidak
ada otomasi klik/submit.
