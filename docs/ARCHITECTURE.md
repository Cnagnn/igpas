# I.G.P.A.S — iGP Analytics & Study System (Blueprint v1)

> Kerangka kerja alat **analisis & studi** untuk iGP Manager, dimodelkan dari
> arsitektur A.C.A.S yang dipelajari via REA. Bukan alat bantu saat balapan;
> tidak melakukan otomasi klik/aksi di situs.

## 1. Ruang lingkup (diputus user)
- ✅ Kalkulator strategi berbasis **input manual** (fuel, ban, pit window, stint).
- ✅ Profil setup per sirkuit tersimpan lokal (GM storage).
- ✅ Mode studi post-race / latihan.
- ❌ Tidak scrape/automasi apa pun selama balapan live berjalan.
- ❌ Tidak ada auto-move/auto-click.
- 🟡 Fase lanjut (opsional, butuh persetujuan user): adapter DOM *read-only*
  untuk halaman studi/telemetri — TIDAK untuk race view saat sedanang balapan.

## 2. Peta pola A.C.A.S → I.G.P.A.S (dari studi REA)

Bukti sumber: REA Evidence `ev_920ef33f25550b35c61d1c652de5313c8c7b2511955ad3a3e0f1777e073f4964`
(arusut `acas.user.js` v2.5.2, sha256 `8cb8ced9…`), CommLink.js (GreasyFork 470418),
pembacaan langsung artefak.

| Pola di A.C.A.S | Lokasi bukti (acas.user.js) | Keputusan I.G.P.A.S |
|---|---|---|
| Userscript tunggal tanpa build step | 1 file, 145 KB, IIFE per-bagian | ✅ disalin: satu file `src/igpas.user.js` |
| Adapter situs (`addSupportedChessSite` → map handler, l.1824) | map `domain → handler` | 🟡 fokus satu situs; adapter per *page-type* + probe multi-selector, siap fase 3 |
| Sensor papan (MutationObserver → FEN, l.1893–2811) | DOM diff → model | 🔜 fase 3, read-only, halaman studi; v0.1 pakai input manual |
| Engine di backend terpisah (REA: `request` family = 0 relasi) | kalkulasi di tab GUI | ♻️ tidak perlu: solver deterministik jalan lokal di tab sama |
| CommLink mailbox GM-storage antar tab (polling `GM_listValues`) | CommLink.js l.104–161 | ❌ dihindari: single-tab overlay, tanpa sinkronisasi antar-tab |
| Overlay render (UniversalBoardDrawer + `renderStuffToBoard`, l.1056) | panah di papan | ✅ jadi panel studi floating (tanpa menggambar di atas elemen game saat live) |
| Profil config global/per-domain (`GM_getValue`, l.741–796) | profil | ✅ jadi profil per-sirkuit |
| Guard data basi (`feedbackFen !== current → skip`, l.828) | stale-guard | ✅ prinsip diterapkan pada semua output kalkulator (rounding & validity flag) |
| Conceal/hotkey (`createInputListener`, l.895) | UX | ✅ hotkey `Alt+I`, panel bisa disembunyikan |
| `@run-at document-start` + wait elemen (l.4340) | boot | 🔧 `document-idle` cukup (tidak perlu intersep awal) |

## 3. Struktur komponen (v0.1 — sekarang)

```
┌─────────────────────────────────────────────────────┐
│ IGPCore  (pure, teruji): calcFuel, projectTireWear, │
│          lapsToThreshold, pitWindow, stintSplit,    │
│          strategyRecommendation, rankOptions        │
├─────────────────────────────────────────────────────┤
│ Storage  (GM_getValue/GM_setValue + fallback memori │
│          agar bisa dites di Node)                   │
├─────────────────────────────────────────────────────┤
│ Mailbox  (v0.2: bridge antar-tab pola CommLink —    │
│          key 'igpas:mb:*', polling 400ms, read-once,│
│          packet TTL 30s; heartbeat 'igpas:gui:*')   │
├─────────────────────────────────────────────────────┤
│ UI       Panel floating (semua tab) + GuiMaster     │
│          (peran gui: status, strategy, data lab)    │
├─────────────────────────────────────────────────────┤
│ AdapterRegistry (mobil/manufaktur/strategi — status │
│          jujur 'selectors-tbd', tanpa selector      │
│          fiktif) | Boot (mount sesuai peran ROLE)   │
└─────────────────────────────────────────────────────┘
```

### Protokol Mailbox (v0.2)

| Paket | Arah | Payload |
|---|---|---|
| heartbeat (key `igpas:gui:heartbeat`) | gui → semua | timestamp (praktik: 1 key overwriten per 2s) |
| `report-request` | gui → * | {} (broadcast) |
| `report` | sensor → gui | {label, url, adapters, profiles} |

Prinsip (menurun dari pola A.C.A.S): read-once delete, TTL anti-dead-mail,
ignore-self, peran pakai `@match` localhost/github.io vs igpmanager.com.

Prinsip: **kalkulator = aritmetika murni atas input user**. Tidak ada data game
yang diandaikan (wear rate, konsumsi fuel, dll. semuanya diisi pengguna).
Ini meniadakan risiko "invented data" dan membuat inti bisa di-unit-test.

## 4. Roadmap

| Versi | Isi | Status |
|---|---|---|
| v0.1 | Kerangka + 4 kalkulator + profil + UI | ✅ |
| v0.2 | Dual-tab GUI (mailbox bridge) + engine rekomendasi (strategyRecommendation, rankOptions) + data lab + AdapterRegistry 'selectors-tbd' | ✅ |
| v0.3 | (Opsional, disetujui dulu) adapter DOM read-only — halaman **studi**, bukan race; probe multi-selector + timeout dengan pesan jelas saat situs berubah. **Prasyarat: sesi mapping halaman nyata + REA `analyze_web_bundle`** | 🔜 |
| v0.4 | Kalibrasi lap-time dari catatan user (tabel input sendiri, bukan scrape) | 🔜 |

## 4b. Rencana Fase 3 — Adapter DOM (detail penerapan pola A.C.A.S)

Mengikuti jejak `getSiteData`/`addSupportedChessSite` A.C.A.S, adapter v0.3
harus: (1) daftar page-type → daftar kandidat selector, (2) `probe()` dengan
`MutationObserver` + timeout, (3) kegagalan dinyatakan eksplisit di panel
(bukan diam-diam menampilkan angka salah), (4) tidak pernah membaca saat flag
"live race" aktif. Pemetaan DOM nyata nantinya divalidasi lewat
`analyze_web_bundle` (REA) pada halaman yang dibuka user — lihat laporan
studi sebelumnya.

## 5. Etika & batasan

- Peringatan ToS iGP Manager tetap berlaku untuk *fitur apapun yang aktif saat
  balapan*. Kerangka ini dengan sengaja dibuat tidak mampu berinteraksi
  dengan elemen game saat balapan.
- Lisensi GPL-3.0-or-later mengikuti semangat A.C.A.S; kode dari A.C.A.S **tidak
  disalin** — hanya pola arsitektur (dari analisis, bukan dari copy kode).
