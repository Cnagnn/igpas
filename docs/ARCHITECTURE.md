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
│          key 'igpas:mb:*', polling 400ms, read-once │
│          oleh penerima saja (v0.5.1); TTL 30s;      │
│          heartbeat 'igpas:gui:*')                   │
├─────────────────────────────────────────────────────┤
│ UI       Command Center (peran gui): kalkulator +   │
│          snapshot akun/mobil + strategy + data lab  │
│          + ADVISOR IN-PAGE di halaman studi iGP     │
│          (v0.7.0: dialog Cars/Manufacturers/Supply; │
│          v0.7.3: + tab Setup/Strategy pra-balapan;  │
│          tab Race live tetap tanpa UI)              │
│ v0.3.0: tab igpmanager = sensor senyap              │
│ v0.4.0: adapter read-only + snapshot mailbox        │
│ v0.5.0: + supply-data (dialog Supply engine/fuel/   │
│          tyre — merge per tipe)                     │
│ v0.5.1: autoload saat /app/ dibuka + deteksi       │
│          sensor (fix race mailbox)                 │
│ v0.6.0: + manufacturer-data (halaman               │
│          Manufacturers engine+chassis)              │
│ v0.7.0: + advisor in-page (prioritas DP, supply,    │
│          ranking manufacturer) + helper heuristik   │
│ v0.7.1: + menu capture DOM teredaksi-PII (fixture)  │
│ v0.7.2: + advisor staff/driver (Team) + pasar        │
│          Transfers (driver & staff CD/TD/DR)          │
│ v0.7.3: + estimasi setup/strategi pra-balapan        │
│          (tab Setup/Strategy; tab Race live bersih)  │
├─────────────────────────────────────────────────────┤
│ AdapterRegistry (account/car/supply/manufacturers/   │
│   staff/transfers/race-setup/race-strategy-data      │
│   ':ready'; race-strategy ':menunggu-map' — sengaja  │
│   manual, tanpa selector fiktif)                     │
│          | Boot (mount sesuai peran ROLE)           │
└─────────────────────────────────────────────────────┘
```

### Protokol Mailbox (v0.2)

| Paket | Arah | Payload |
|---|---|---|
| heartbeat (key `igpas:gui:heartbeat`) | gui → semua | timestamp (praktik: 1 key overwriten per 2s) |
| `report-request` | gui → * | {} (broadcast) |
| `report` | sensor → gui | {label, url, adapters, profiles} |
| `collect-request` | gui → * | {kinds:[account-data, car-data, supply-data, manufacturer-data], reqId} (v0.4.0–v0.6.2) |
| `collect-result` | sensor → gui | {reqId, kind, ok, data, error, pageUrl} (v0.4.0–v0.6.2) |

Prinsip (menurun dari pola A.C.A.S): read-once delete **hanya setelah
dikonsumsi penerima** (pengirim tidak menghapus pesannya sendiri — fix race
v0.5.1), TTL anti-dead-mail, ignore-self, peran pakai `@match`
localhost/github.io vs igpmanager.com.

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
| v0.5.1 | **Autoload** snapshot saat Command Center dibuka (+ auto-refresh kembali ke tab, jeda ≥30 dtk); deteksi sensor + pesan jujur bila tak ada respons; fix race mailbox (pesan dihapus hanya setelah dikonsumsi penerima) | ✅ |
| v0.6.0 | Adapter **manufacturer-data** (halaman Manufacturers — tabel engine + chassis selalu di DOM; read-once dari tombol Capture) + fixture DOM nyata kedua tab + panel snapshot GUI | ✅ |
| v0.6.1 | Deteksi varian URL dipastikan **berbasis DOM, bukan URL** (…`&tab=engines`/`&tab=chassis` sama-sama lolos utk manufacturers; supply via dialog) + pesan gagal menyebut halaman aktif + test regresi (24 snapshot) | ✅ |
| v0.6.2 | Hardening korelasi hasil mailbox: hanya request aktif/kind diminta; hasil sukses pertama mengklaim sensor, error tidak mengunci sensor; stale/duplikat/legacy tidak menimpa data + regresi GUI (8 test GUI) | ✅ |
| v0.7.0 | **Advisor in-page** di tab iGP (arah baru dari user): panel rekomendasi read-only melekat di halaman studi — dialog Supply (Σ bonus, biaya, nilai/1M, tanda terbaik/termurah), Manufacturers (ranking engine/chassis dari pager aktif), Cars (prioritas alokasi DP = gap vs max rival liga `leagueDesignData`, usulan % porsi). Semua heuristik berlabel "estimasi — bukan rumus game". Gate ketat `#pageId` cars/manufacturers — race pages tanpa UI (test). Hanya elemen sendiri (`igpas-adv-*`), game untouched, tanpa mailbox request; toggle tersimpan lokal. Helper murni: designPriority, rankSuppliers, rankManufacturerItems + 11 test core; 6 test advisor jsdom | ✅ |
| v0.7.1 | **Menu capture DOM** (GM_registerMenuCommand): salin `documentElement` teredaksi PII (nama/saldo/token/rank) ke clipboard via GM_setClipboard — tanpa UI halaman (race pages tetap bersih), dipicu user sepenuhnya, untuk pemetaan fixture halaman baru (mis. Develop/Design). Test: PageCapture redaksi end-to-end + panel supply fuel/tyre (9 test advisor) | ✅ |
| v0.7.2 | **Advisor staff & driver** (permintaan user): halaman **Drivers & Staff** (`#pageId=staff`) — panel kondisi tim (ability/mental/health driver + estimasi pemulihan per jam, gaji/kontrak staff aktif, catatan pit crew terkunci; **tanpa angka rating fiktif** karena kartu staff hanya bintang). Halaman **Transfers** (`#pageId=transfers`) — panel pasar driver (overall/fee dari `data-overall`/`data-sort` kolom tabel, Overall/1M, special ability) + panel pasar staff per peran CD/TD/DR (top-2, trait hijau/merah dari `data-append`, nilai = overall per 1M fee). Helper murni `parseTraits` (block-green/block-red/specialA*); fixture `staff.html` + `transfers.html` dari capture DOM; 3 test advisor baru + test `parseTraits` (44 core, 12 advisor) | ✅ |
| v0.7.3 | **Estimasi setup & strategi pra-balapan** (permintaan user, capture tab `p=race` Race/Setup/Strategy): halaman pra-balapan (`#pageId=race`) kini mendapat panel READ-ONLY **hanya** di tab **Setup** (slider vs bar ideal game `setupSlider-idealRange` — bar penuh = ideal belum dipelajari, ditulis jujur; kondisi health/condition/engine `<30%` ditandai; cuaca; lap practice; kutipan komentar engineer) dan tab **Strategy** (ringkasan per driver: total lap stint vs `#raceLaps`, bensin `#dN-AdvancedFuel` vs kebutuhan laps × `#dN-FuelPrediction` + buffer liter/lap, ban per stint dari blok data JSON `#dN-StrategyJson` + cek dua-compound aturan `#rules`, pit & risk_level). **Tab Race live (`#race`) tetap 100% bersih** — test snapshot innerHTML pre/post boot + gate tanpa wadah tab. Helper murni `parseSliderIdeal`, `setupAdvice`, `summarizeStrategy` (guards `Number(null)===0`); adapter `race-setup-data`/`race-strategy-data` + fixture sanitasi `race.html`; toggle hanya muncul saat ada panel (26 test snapshot, 16 test advisor) | ✅ |
| — | race-strategy: sengaja manual selamanya | ⏳ |
| v0.3 | (Opsional, disetujui dulu) adapter DOM read-only — halaman **studi**, bukan race; probe multi-selector + timeout dengan pesan jelas saat situs berubah. **Prasyarat: sesi mapping halaman nyata + REA `analyze_web_bundle`** | ✅ (v0.4.0–v0.6.2 — account + cars + supply + manufacturers + autoload) |
| v0.4 | Kalibrasi lap-time dari catatan user (tabel input sendiri, bukan scrape) | 🔜 |

## 4b. Fase 3 (v0.4.0–v0.6.2) — Adapter DOM read-only (TERLAKSANA)

Pemetaan selektor berasal dari **live DOM halaman iGP asli** (capture `document
.documentElement.outerHTML` oleh pengguna, disanitasi lalu dijadikan fixture
`test/fixtures/*.html`). Adapter aktif:

| Adapter | Sumber | Selektor kunci |
|---|---|---|
| `account-data` | header global (semua halaman login) | `#myProfileName`, `#managerRankValue`, `#managerRankIcon[src*=rank]`, `#balanceText`, `#tokens-total`, `.myProfileStatsStack .teal` |
| `car-data` | halaman Cars (`#pageId=cars`) | `#carAttributes[data-dmax]`, `#carAttributesDisplay .attribute-row` (`#wrap-{key}`, `.ratingVal`), `#carsDesignPoints[data-dp]`, `#carAttributesBonuses .tooltip[data-tip]`, `#leagueDesignData` (JSON best rival), `.carsSuppliers .c-wrap img[src*=/supply/]` |
| `supply-data` | dialog Supply di halaman Cars (dibuka user sendiri) | `.supplyDialog` (gate: dialog terbuka), `.dialog-subhead-content h2` (tipe engine/fuel/tyre), `.dialog-subhead img[src*=/supply/]` (supplier aktif), `.tooltip[data-tip]` (bonus stat), `a[data-tip*=supplyType]` → `eId`, kartu `.inline-block` (id gambar, cost/race) |
| `manufacturer-data` | halaman Manufacturers (`#pageId=manufacturers`) — kedua tabel selalu di DOM, tab aktif hanya display | `#engine-table` / `#chassis-table` → `tbody tr[data-nationality]`; nama: teks sel-1 (link `a[href*=id=]`, `<img>` flag tanpa teks); rating: sel-2 `.tooltip[data-tip="Rating: N%"]`; cost: `td.currency` ('500k'/'1m'); stats: `use[href$=#ios-eye]` (terlihat) vs `#ios-eye-off` (disembunyikan); customers: sel terakhir; total halaman: `.pager-last[rel]` |
| `staff-data` | halaman Drivers & Staff (`#pageId=staff`) | driver: `#d1Pic`/`#d2Pic` `.driverName` (`<br>`→spasi) + href `id=definition`; `#driverStatsTable` per baris label (`Ability`/`Mental`/`Contract`/`Salary`) → kolom td per driver; health: `.trainingPreviewValue[data-val]` + `.trainingPreviewRate` (estimasi pemulihan/jam); CSV `data-driver` di `.hoverData`; staff aktif: `#staff .c-wrap` (`.c-head` peran, `.driverName` nama, gaji = angka pertama kartu, kontrak `span[id^=nStaffC]`); pit crew: `.pc-main-div[data-tip]` (terkunci); reserve: `#reserveStaff tbody tr` (hitung) |
| `transfers-data` | halaman Transfers (`#pageId=transfers`) — kedua tabel selalu di DOM (tab aktif hanya display), isi bisa refresh otomatis (lelang) | `#driver-table`/`#staff-table` → `tbody tr[id*=_]`; nama `data-name`; overall `data-overall`; age/role: `td[2] data-sort` (angka / kode CD-TD-DR); fee/wage: `td[4]`/`td[5] data-sort`; trait: `td.hoverData[data-append]` (block-green/block-red utk staff, specialA* utk driver); countdown: `#cdTransfersRefresh` |
| `race-setup-data` | tab Setup halaman pra-balapan (`#pageId=race` + wadah `#setup`; v0.7.3) | badge cuaca `.raceWeatherBadge` (`.waterLevelText` hujan + regex `°C`), slider: `.setupSliderWrap[id^=dN]` → label `.setupSlider-label`, value `input[type=range][value]`, bar ideal `.setupSlider-idealRange` via **atribut style** (`calc(X% ± Npx)` → `parseSliderIdeal`); nama `.driverName` (`<br>`→spasi); kondisi: `#dN-SetupComments span[id$=HealthVal/ConditionVal/EngineVal]`; engineer: `.shrinkText`; lap practice: `#dN-Laps tbody tr` ≥4 td |
| `race-strategy-data` | tab Strategy halaman pra-balapan (`#pageId=race` + wadah `#strategy`; v0.7.3) | `#raceLaps`; aturan liga: span `#rules` (JSON `refuelling`/`two_tyres`); strategi per driver: blok data **inerten** `script[type=application/json]#dN-StrategyJson` (stint/tyre/laps + `stints`=jumlah aktif, `pits`, `risk_level`); bensin: `#dN-FuelPrediction` (L/lap) + input `#dN-AdvancedFuel` (atribut value); total versi game `#dN-TotalLaps`. Rekap punya game `#dN-SetupImpactHistory` masih kosong pra-practice — TIDAK dipakai v0.7.3 |

Aturan main adapter (bake-in, bukan kebijakan terpisah):

1. **Baca-saja total** — tidak pernah klik/submit/tulis apa pun di halaman game.
2. **Read-once per permintaan** — GUI mengirim satu `collect-request` saat
   halaman dibuka (autoload v0.5.1), saat kembali ke tab (jeda ≥30 dtk), atau
   saat tombol Capture diklik; sensor menjawab `collect-result` lalu selesai.
   Polling hanya pada mailbox GM-storage lokal (400 ms); DOM halaman game
   dibaca hanya saat ada permintaan. Tanpa polling halaman game.
3. **pageId gate** — adapter mobil hanya aktif di halaman Cars; adapter
   manufacturers hanya aktif di halaman Manufacturers (`#pageId=manufacturers`);
   adapter race-setup/race-strategy hanya aktif di halaman pra-balapan
   (`#pageId=race`) dan hanya membaca wadah tab `#setup`/`#strategy` — wadah
   `#race` (tab Race live) tidak pernah dibaca/diolah, dan halaman tanpa
   wadah tersebut benar-benar tanpa jejak.
4. **Kegagalan jujur** — halaman tak cocok → `collect-result {ok:false,error}`,
   ditampilkan di Command Center, bukan angka salah.
5. **dialog gate (supply)** — adapter supply hanya aktif bila dialog Supply
   sedang terbuka (dibuka user sendiri); adapter tidak pernah membuka dialog,
   mengklik tile, atau menyentuh elemen game.
6. **Deteksi berbasis DOM, bukan URL** — manufacturers dicek via
   `#pageId=manufacturers` (semua varian URL: `…/p=manufacturers`,
   `…&tab=engines`, `…&tab=chassis` — kedua fixture manufacturers adalah dua
   varian tab tersebut); supply via `.supplyDialog` (halaman/varian URL apa pun
   asal dialog terbuka). Pesan gagal menyebut halaman aktif
   (mis. `halaman aktif: cars`) — diagnostik jujur, tetap tanpa URL matching.

Semua halaman yang direncanakan sudah dipetakan (v0.6.2): **Manufacturers**
(`p=manufacturers` — deteksi `#pageId`, semua varian `&tab=engines`/
`&tab=chassis` bekerja; fixture `manufacturers-engines.html` &
`manufacturers-chassis.html`) kini terpasang sebagai adapter
`manufacturer-data`; **Supply** via gate dialog (juga URL-independent). Selektor
di atas dapat berubah bila iGP meredesign — jika capture gagal, pesan error
muncul jelas di GUI. Fixture: `supply-*.html`, `manufacturers-*.html`,
`staff.html`, `transfers.html`, `race.html` (24 test jsdom snapshot). Input
strategi tetap **manual selalu** — advisor race v0.7.3 hanya MENAMBAHKAN
panel estimasi read-only di tab Setup/Strategy pra-balapan, tidak pernah
mengubah strategi/tabrakan dengan input game.

## 5. Etika & batasan

- Peringatan ToS iGP Manager tetap berlaku untuk *fitur apapun yang aktif saat
  balapan*. Kerangka ini dengan sengaja dibuat tidak mampu berinteraksi
  dengan elemen game saat balapan.
- Lisensi GPL-3.0-or-later mengikuti semangat A.C.A.S; kode dari A.C.A.S **tidak
  disalin** — hanya pola arsitektur (dari analisis, bukan dari copy kode).
