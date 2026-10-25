---
name: Feature request
about: Feature proposal / new page adapter
labels: [enhancement]
---

## Summary

<!-- What feature & why it is needed -->

## Scope & constraints

<!-- Example: study pages only, read-only, no live-race -->

## Compliance checklist

- [ ] Does not need `fetch`/`XHR`/`GM_xmlhttpRequest` to a game server
- [ ] No clicking/submitting game elements — only reads the visible DOM
- [ ] `#race` (live) tab stays zero-UI
- [ ] Ready to send sanitised DOM captures when selector mapping is needed (via userscript menu — PII redacted)
