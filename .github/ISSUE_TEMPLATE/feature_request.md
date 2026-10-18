---
name: Feature request
about: Usulan fitur / adapter halaman baru
labels: [enhancement]
---

## Ringkasan

<!-- Fitur apa & kenapa dibutuhkan -->

## Scope & batasan

<!-- Contoh: hanya halaman studi, read-only, tanpa live-race -->

## Checklist kepatuhan

- [ ] Tidak butuh `fetch`/`XHR`/`GM_xmlhttpRequest` ke server game
- [ ] Tidak klik/submit elemen game — hanya baca DOM yang tampak
- [ ] Tab `#race` (live) tetap zero-UI
- [ ] Siap kirim capture DOM tersanitasi bila butuh mapping selector (via menu userscript — PII teredaksi)
