# COMPLIANCE — I.G.P.A.S vs iGP Manager ToS

Sumber: https://igpmanager.com/terms (terakhir diperbarui **18 September 2026**),
dibaca 17 Oktober 2026. Tolong ingat: dokumen ini adalah **penilaian our-project**,
bukan nasihat hukum, dan ToS dapat berubah (§ VII) — cek ulang sebelum Fase 3.
EULA (/eula) juga terincorporate via ToS § I — direktur saat menyentuh "the Software".

## Matriks klausul ↔ fitur

| Klausul ToS | Isi inti | Our v0.2.1 | Penilaian |
|---|---|---|---|
| § V.J | Larang *third-party programs: mods, hacks, cheats, **scripts**, bots, automation* yang *berinteraksi dengan Software, intercept komunikasi, read Game memory* | Userscript hanya meng-inject panel mandiri + mailbox lokal; **0** intercept jaringan, **0** baca memory proses, **0** aksi/otomasi, **0** baca DOM game | ⚠ **Letter-risiko sisa**: makna literal "scripts that interact with the Software" bisa dibaca luas. Purposive reading (daftar: mods/hacks/bots + tujuan intercept/read-memory) menunjuk pada program yang memengaruhi gameplay — panel pasif tidak, tapi **tidak bisa di-nol-kan secara legal**. Risiko praktis: rendah; risiko literal: nonzero |
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
2. **Dual-tab study (v0.2.1)** — risiko praktis rendah: panel pasif, tanpa aksi/tanpa
   jaringan/tanpa membaca DOM game. Menyisakan risiko *letter* § V.J (tak terhindarkan
   bagi *semua* userscript). Keputusan gunakan/tidak = milik user.
3. **Selama balapan live** — DILARANG secara kebijakan proyek ini (di luar ToS eksplisit
   juga: § V.H unfair advantage). Jangan pernah aktifkan di race view saat sesi berjalan.
4. **Fase 3 (adapter data otomatis)** — area GRAY terbesar:
   - Wajib: data *yang memang ditampilkan* ke user biasa di halaman studi (bukan
     tersembunyi/undocumented); *read-on-request* manual (tanpa polling latar di
     halaman game); tanpa distribusi ulang data orang lain.
   - Bukan: backgroud polling halaman game, capture saat race live, server-side
     scraping.
   - SEBELUM implement: tanyakan iGP Support (routes § XIV) bila ingin kepastian
     tertulis.

## Fakta teknis pendukung (bukti audit internal)

- `grep -cE 'fetch\(|XMLHttpRequest'` src → **0**; `GM_xmlhttpRequest` **0**; `eval` **0**;
  `@require` **0**; `unsafeWindow` **0** (`node test`, `node --check`, audit 2026-10-17).
- Mailbox polling hanya membaca **GM storage kita sendiri** (`igpas:mb:*`) di browser
  user — bukan trafik/menuju server iGP.
- Version: landing/etika disclaimer ditambahkan commit terkait; userscript tak berubah.

## Rekomendasi yang belum dilakukan (kembali ke user)

- [ ] Pertimbangkan rename netral (mengandalkan "iGP" di nama = area abu-abu del §IV.A;
      disclaimer sudah menutup sebagian besar).
- [ ] Opsional: kirim pertanyaan tertulis ke iGP Support untuk *whitelist membaca
      halaman studi* sebelum Fase 3.
