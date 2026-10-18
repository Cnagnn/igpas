# Pull Request

## Ringkasan

<!-- Apa yang diubah & kenapa — satu paragraf cukup -->

## Jenis perubahan

- [ ] fix (bug)
- [ ] feat (fitur baru — userscript / Command Center / adapter)
- [ ] docs
- [ ] chore / ci / refactor

## Checklist

- [ ] `npm run verify` hijau lokal (`syntax` + `lint` + `format:check` + `versions:check` + `npm test`)
- [ ] Versi sinkron: `@version` + `const VERSION` + `package.json` (+ badge docs bila relevan)
- [ ] Tidak menambah `fetch`/`XHR`/`GM_xmlhttpRequest`/`eval`/`unsafeWindow` di `src/` (guard CI)
- [ ] Jika menyentuh adapter/DOM: fixture `test/fixtures/*.html` + test jsdom diperbarui
- [ ] Jika menyentuh halaman race: tab `#race` (live) tetap **zero-UI** & tidak dibaca/diubah
- [ ] `docs/COMPLIANCE.md` diperbarui bila ada perubahan risiko/kebijakan

## Catatan

<!-- Hal yang butuh perhatian reviewer / follow-up -->
