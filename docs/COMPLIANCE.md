# COMPLIANCE — I.G.P.A.S vs iGP Manager ToS

Sumber: https://igpmanager.com/terms (terakhir diperbarui **18 September 2026**),
dibaca 17 Oktober 2026. Tolong ingat: dokumen ini adalah **penilaian our-project**,
bukan nasihat hukum, dan ToS dapat berubah (§ VII) — cek ulang sebelum Fase 3.
EULA (/eula) juga terincorporate via ToS § I — direktur saat menyentuh "the Software".

## Matriks klausul ↔ fitur

| Klausul ToS | Isi inti | Our v0.2.1 | Penilaian |
|---|---|---|---|
| § V.J | Larang *third-party programs: mods, hacks, cheats, **scripts**, bots, automation* yang *berinteraksi dengan Software, intercept komunikasi, read Game memory* | 0 UI di situs game (v0.3.0+); adapter baca-saja hanya saat permintaan eksplisit (read-once, tanpa polling); **0** intercept jaringan, **0** baca memory proses, **0** aksi/otomasi | ⚠ **Letter-risiko sisa**: makna literal "scripts that interact with the Software" bisa dibaca luas. Purposive reading (daftar: mods/hacks/bots + tujuan intercept/read-memory) menunjuk pada program yang memengaruhi gameplay — panel pasif tidak, tapi **tidak bisa di-nol-kan secara legal**. Risiko praktis: rendah; risiko literal: nonzero |
| § V.F | Larang "transmitting … **scrapers** or other harmful code" | 0 request keluar; tidak men-*transmit* apa pun ke situs | ✅ Non-transmisi; klantenya soal menyebarkan kode ke lingkungan iGP |
| § V.H | Larang *exploit undocumented aspect for unfair advantage* | Semua angka = input manual; tidak ada aspek tersembunyi yang dieksploitasi | ✅ (jaga begitu di Fase 3: hanya data yang sama-tampaknya dilihat user biasa) |
| § I & § IV.A | Non-komersial; larang *derive/copy/distribute* materi game; larang pakai *trademark/trade dress* tanpa lisensi | 0 aset/kode/art iGP di repo kita (arisita original); pixel "iGP" hanya referensi deskriptif | ⚠ Gunakan disclaimer non-afiliasi (sudah ditambahkan di landing); hindari logo/aset mereka |
| § VIII | Aturan posting link ke situs eksternal (tidak dalam frame, tak mengesankan afiliasi) | GF/GitHub deskripsi jujur, tidak frame situs iGP | ✅ |
| § III.C–D | Larang share/buy/sell account | Tidak relevan; tool tak menyentuh kredensial | ✅ |
| § V.A/B/C/I/L | Impersonasi, doxxing, harassmen, scam, nama game | Tidak relevan | ✅ |

## Mode penggunaan & tingkat risiko

1. **GUI-only (nama kepatuhan) — RISIKO ~0**: Command Center berfungsi 100% tanpa
   userscript aktif di tab iGP (kalkulator, Data Lab, rekomendasi semua di tab GUI).
   User yang mau kepatuhan mutlak: cukup *disable* userscript saat membuka igpmanager.com.
2. **Dual-tab study (v0.2.1, diperbarui v0.7.0)** — risiko praktis rendah dengan satu
   perubahan penting: sejak v0.7.0 userscript menambahkan **Advisor in-page** di halaman
   studi iGP (Cars + dialog Supply, Manufacturers) — **elemen milik sendiri** yang
   dilekatkan (bukan modifikasi elemen game), read-only, tanpa klik/submit/jaringan,
   tanpa request mailbox (gate `#pageId`). Pembacaan DOM game tetap hanya saat ada
   permintaan eksplisit (read-once, tanpa polling). Rekomendasi berlabel
   *estimasi — bukan rumus game*. **Pembatasan scope v0.7.3**: atas permintaan
   eksplisit user (dengan capture halamannya), panel estimasi read-only juga
   melekat di halaman **pra-balapan** — HANYA di tab Setup & Strategy, TANPA
   pernah menyentuh tab Race live (`#race` tetap 100% bersih, diverifikasi test
   snapshot innerHTML pre/post boot), tanpa klik/submit elemen game, dan toggle
   advisor sendiri pun tidak muncul bila wadah tab tidak ada. Tetap menyisakan
   risiko *letter* § V.J (tak terhindarkan bagi *semua* userscript).
   Keputusan gunakan/tidak = milik user; kepatuhan mutlak tetap bisa via mode 1.
   Catatan v0.7.1: menu **capture DOM** hanya entri menu userscript (bukan UI
   halaman), 100% dipicu user, hasil disalin ke clipboard dengan redaksi PII
   (nama/saldo/token/rank) — tanpa jaringan, tanpa pengiriman otomatis.
3. **Selama balapan live** — DILARANG secara kebijakan proyek ini (di luar ToS eksplisit
   juga: § V.H unfair advantage). Jangan pernah aktifkan di race view saat sesi berjalan.
   Catatan v0.7.0: gate `#pageId` membuat advisor in-page tidak merender apa pun di
   halaman balapan/strategi (diverifikasi test jsdom). **Catatan v0.7.3**: scope
   diperluas atas permintaan user ke tab Setup/Strategy halaman PRA-BALAPAN saja —
   tab Race live tetap tidak merender apa pun (test snapshot innerHTML + test
   halaman race tanpa wadah tab = zero UI termasuk toggle). Catatan v0.5.1: autoload membaca
   halaman yang sedang terbuka di tab iGP; tidak ada adapter untuk data race
   (lap/posisi/fuel race), jadi paling banyak hanya header akun global (sama di semua
   halaman). Untuk kepatuhan ketat: jangan buka Command Center selama sesi.
4. **Fase 3 (adapter data otomatis, v0.4.0–v0.6.2 TERLAKSANA)** — desain kepatuhan:
    - Hanya membaca data *yang memang ditampilkan* ke user biasa di halaman studi
      (Cars, Manufacturers, Drivers & Staff, Transfers, header akun) - bukan
      tersembunyi/undocumented.
    - **Read-on-request**: adapter hanya berjalan saat ada permintaan dari Command
      Center — saat halaman GUI dibuka (autoload v0.5.1), saat kembali ke tab (jeda
      ≥30 dtk), atau saat user klik *Capture*; sekali per permintaan, tanpa polling
      latar di halaman game.
    - **pageId gate**: adapter mobil hanya aktif di halaman Cars - tak ada jalur baca
      ke halaman balapan/strategi.
    - **v0.5.0 - dialog Supply**: hanya membaca dialog Supply yang **sudah dibuka user
      sendiri** (engine/fuel/tyre: supplier aktif + alternatif — bonus stat & biaya per
      balapan). Adapter tidak pernah membuka dialog atau mengklik tile game; gate
      `.supplyDialog` yang sudah ada di DOM user-driven oleh user.
    - **v0.5.1 - autoload**: snapshot dimuat otomatis saat Command Center dibuka
      (satu permintaan read-once per pembukaan; auto-refresh saat kembali ke tab,
      jeda ≥30 dtk). Bukan loop latar: DOM game hanya dibaca saat ada permintaan;
      mailbox hanya memindahkan permintaan/hasil antar-tab via storage lokal kita.
    - **v0.6.0/v0.6.2 - halaman Manufacturers & mailbox**: hanya membaca tabel yang memang
      ditampilkan di halaman Manufacturers (engine + chassis; kedua tabel ada di
      DOM, tab aktif hanya soal display) pada halaman yang dibuka user sendiri —
      read-once dari tombol *Capture manufacturers*, tanpa klik apa pun (termasuk
      kontrol “Show hidden stats” dibiarkan apa adanya), tanpa membuka dialog.
      Deteksi murni DOM (`#pageId`) — bukan URL matching; semua varian URL tab
      (`…&tab=engines`/`…&tab=chassis`) diterima setara.
    - **v0.7.2 - advisor staff & driver**: panel tim aktif di halaman Drivers &
      Staff dan panel pasar di Transfers — semuanya read-only pada baris/atribut
      yang memang dirender game (`data-overall`, `data-sort`, `data-append`,
      bar health). Panel TIDAK mengarang angka: kartu staff tanpa angka rating
      tetap tanpa angka; pasar ditandai sebagai snapshot yang bisa berubah sendiri
      (refresh lelang game). Tanpa klik/submit/apapun pada tabel pasar — bid tidak
      dibuat, dibaca, atau dipicu userscript.
    - **v0.7.3 - estimasi pra-balapan (permintaan user)**: panel read-only di tab
      Setup/Strategy halaman pra-balapan. Sumber data hanya field yang dirender
      game untuk user biasa: slider + **bar ideal milik game** (stylenya — bar
      penuh = ideal belum dipelajari, dinyatakan jujur, bukan dikarang), kondisi
      health/condition/engine, JSON strategi yang game tulis sendiri di blok data
      inerten `#dN-StrategyJson` (data JSON murni, tidak dieksekusi), `#raceLaps`,
      `#dN-FuelPrediction`, bensin opsi lanjutan `#dN-AdvancedFuel`, aturan liga
      span `#rules`. Perhitungan = aritmetika tampil (laps × fuel/lap, buffer,
      cek dua-compound) berlabel estimasi. **Wadah `#race` (tab Race live) tidak
      dibaca, tidak ditulis, tidak diubah**; tidak ada klik/submit pada slider,
      stint, tombol save, ataupun elemen game mana pun.
    - **v0.7.4 - konsumsi data practice nyata (capture live user)**: fixture
      `race.html` diganti total dengan rekonstruksi tersanitasi capture DOM
      sesudah 1 lap practice (csrf, nama/ID manajer & pihak lain, id balapan,
      atribut pelacak, semua script eksekutabel dibuang; blok data JSON game
      dipertahankan karena inerten). Konsumsi anchor HANYA yang dirender game:
      kelas arah label slider (`decrease`/`increase` — muncul otomatis setelah
      practice), baris practice terakhir (waktu/pemakaian), umur ban
      `#dN-TyreLife` (JSON game), push level `select[name=pushLevel]`. Tanpa
      aritmetika baru di luar model v0.7.3; disiplin read-only & tab Race live
      bersih dijaga test yang sama.
    - **v0.8.0 - panel perbandingan keputusan (permintaan user)**: advisor &
      Command Center kini menampilkan verdict **lebih bagus / lebih buruk /
      sama** roster & supplier aktif terhadap pilihan di luar (pasar Transfers,
      alternatif dialog Supply). Sumber angka **hanya kolom/atribut yang
      memang dirender game** (`data-overall`, `data-sort` fee/wage, CSV
      `data-driver`/`data-staff` pada kolom rating); sisi yang tidak
      menampilkan angka ditulis **"tak terbaca"** — tidak pernah dikarang agar
      verdict bisa keluar. Panel roster-vs-pasar membaca **snapshot yang sudah
      ada** (hasil tombol Capture CLI user) — advisor in-page tidak menambah
      permintaan mailbox apa pun. Indeks 12-stat dari CSV adalah **heuristik
      eksplisit** (CSV dibulatkan per stat oleh game, jadi angkanya beda tipis
      dari kolom Overall/Fee) dan selalu dilabeli "bukan overall game"; seluruh
      verdict tetap **estimasi — bukan rumus game**, keputusan transfer milik user.
    - Tanpa distribusi ulang data orang lain; snapshot hanya di storage browser user.
    - Bukan: background polling halaman game, server-side scraping, atau pembacaan
      data race LIVE (lap/posisi/fuel saat sesi berjalan, kapan pun) — panel race
      v0.7.3–0.7.4 hanya membaca tab pra-balapan yang statis.
    - SEBELUM perluas cakupan (mis. halaman Supply/Chassis): tanyakan iGP Support
      (routes S-XIV) bila ingin kepastian tertulis.

## Fakta teknis pendukung (bukti audit internal)

- `grep -cE 'fetch\(|XMLHttpRequest'` src → **0**; `GM_xmlhttpRequest` **0**; `eval` **0**;
  `@require` **0**; `unsafeWindow` **0** (`node test`, `node --check`, audit 2026-10-17).
- Mailbox polling hanya membaca **GM storage kita sendiri** (`igpas:mb:*`) di browser
  user — bukan trafik/menuju server iGP.
- Adapter v0.4.0–v0.8.0: `querySelectorAll`/`textContent`/`getAttribute` saja — tanpa klik,
  tanpa `fetch`, tanpa XHR, tanpa akses `unsafeWindow`. Fixture pengujian dari DOM
  halaman nyata yang disanitasi (`test/fixtures/*.html`); suite: 63 core + 24 snapshot
  (akun, mobil, supply, manufacturers, staff, transfers, race setup/strategy) +
  6 mailbox + 14 GUI + 19 advisor (jsdom) = **126**.
- Version: userscript kini 0.8.0 (panel perbandingan keputusan roster/supplier vs
  pasar: verdict lebih bagus / lebih buruk / sama dari angka DOM yang benar-benar
  tampil; angka yang tidak tampil ditulis "tak terbaca", tidak dikarang; seluruh
  verdict berlabel estimasi — bukan rumus game; tab Race live tetap tanpa UI;
  zero automation & network); landing/etika disclaimer diperbarui pada commit terkait.

## Rekomendasi yang belum dilakukan (kembali ke user)

- [ ] Pertimbangkan rename netral (mengandalkan "iGP" di nama = area abu-abu del §IV.A;
      disclaimer sudah menutup sebagian besar).
- [ ] Opsional: kirim pertanyaan tertulis ke iGP Support untuk *whitelist membaca
      halaman studi* sebelum Fase 3.
