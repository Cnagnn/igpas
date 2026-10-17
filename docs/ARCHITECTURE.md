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
│ UI       HANYA di Command Center (peran gui):       │
│          kalkulator + snapshot akun/mobil +         │
│          strategy + data lab                        │
│ v0.3.0: tab igpmanager = sensor senyap              │
│ v0.4.0: adapter read-only + snapshot mailbox        │
│ v0.5.0: + supply-data (dialog Supply engine/fuel/   │
│          tyre — merge per tipe)                     │
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
| v0.3.0 | Panel floating dihapus — tab iGP sensor senyap; kalkulator+profil pindah ke Command Center; landing & GUI neobrutalism semi-rounded | ✅ |
| v0.4.0 | Fase 3 (relaunch): adapter **account-data** (header global) & **car-data** (halaman Cars) read-only, read-once per klik Capture dari GUI; snapshot tersimpan lokal; fixture DOM nyata + jsdom | ✅ |
| v0.5.0 | Adapter **supply-data** (dialog Supply: engine/fuel/tyre) — supplier aktif + alternatif (bonus stat, cost/race, eId); merge per tipe di snapshot; fixture DOM nyata + test jsdom | ✅ |
| — | manufacturer-data (halaman Manufacturers/Chassis): menunggu capture; race-strategy: sengaja manual selamanya | ⏳ |
| v0.3 | (Opsional, disetujui dulu) adapter DOM read-only — halaman **studi**, bukan race; probe multi-selector + timeout dengan pesan jelas saat situs berubah. **Prasyarat: sesi mapping halaman nyata + REA `analyze_web_bundle`** | ✅ (v0.4.0–v0.5.0 — account + cars + supply) |
| v0.4 | Kalibrasi lap-time dari catatan user (tabel input sendiri, bukan scrape) | 🔜 |

## 4b. Fase 3 (v0.4.0) — Adapter DOM read-only (TERLAKSANA)

Pemetaan selektor berasal dari **live DOM halaman iGP asli** (capture `document
.documentElement.outerHTML` oleh pengguna, disanitasi lalu dijadikan fixture
`test/fixtures/*.html`). Adapter aktif:

| Adapter | Sumber | Selektor kunci |
|---|---|---|
| `account-data` | header global (semua halaman login) | `#myProfileName`, `#managerRankValue`, `#managerRankIcon[src*=rank]`, `#balanceText`, `#tokens-total`, `.myProfileStatsStack .teal` |
| `car-data` | halaman Cars (`#pageId=cars`) | `#carAttributes[data-dmax]`, `#carAttributesDisplay .attribute-row` (`#wrap-{key}`, `.ratingVal`), `#carsDesignPoints[data-dp]`, `#carAttributesBonuses .tooltip[data-tip]`, `#leagueDesignData` (JSON best rival), `.carsSuppliers .c-wrap img[src*=/supply/]` |
| `supply-data` | dialog Supply di halaman Cars (dibuka user sendiri) | `.supplyDialog` (gate: dialog terbuka), `.dialog-subhead-content h2` (tipe engine/fuel/tyre), `.dialog-subhead img[src*=/supply/]` (supplier aktif), `.tooltip[data-tip]` (bonus stat), `a[data-tip*=supplyType]` → `eId`, kartu `.inline-block` (id gambar, cost/race) |

Aturan main adapter (bake-in, bukan kebijakan terpisah):

1. **Baca-saja total** — tidak pernah klik/submit/tulis apa pun di halaman game.
2. **Read-once per klik** — berjalan hanya saat GUI mengirim `collect-request`
   lewat mailbox; sensor menjawab `collect-result` lalu selesai. Tanpa polling.
3. **pageId gate** — adapter mobil menolak halaman selain Cars; tidak ada jalur
   baca ke halaman balapan/strategi.
4. **Kegagalan jujur** — halaman tak cocok → `collect-result {ok:false,error}`,
   ditampilkan di Command Center, bukan angka salah.
5. **dialog gate (supply)** — adapter supply hanya aktif bila dialog Supply
   sedang terbuka (dibuka user sendiri); adapter tidak pernah membuka dialog,
   mengklik tile, atau menyentuh elemen game.

Menunggu capture: halaman **Manufacturers/Chassis** (pilihan chassis supplier,
route `p=manufacturers&tab=chassis`) → adapter `manufacturer-data`. Selektor di
atas dapat berubah bila iGP meredesign — jika capture gagal, pesan error muncul
jelas di GUI. Fixture supply: `supply-engine/fuel/tyre.html` (17 test jsdom total).

## 5. Etika & batasan

- Peringatan ToS iGP Manager tetap berlaku untuk *fitur apapun yang aktif saat
  balapan*. Kerangka ini dengan sengaja dibuat tidak mampu berinteraksi
  dengan elemen game saat balapan.
- Lisensi GPL-3.0-or-later mengikuti semangat A.C.A.S; kode dari A.C.A.S **tidak
  disalin** — hanya pola arsitektur (dari analisis, bukan dari copy kode).
