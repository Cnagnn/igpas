# Pull Request

## Summary

<!-- What was changed & why — one paragraph is enough -->

## Type of change

- [ ] fix (bug)
- [ ] feat (new feature — userscript / adapter / advisor)
- [ ] docs
- [ ] chore / ci / refactor

## Checklist

- [ ] `npm run verify` green locally (`syntax` + `lint` + `format:check` + `versions:check` + `npm test`)
- [ ] Versions in sync: `@version` + `const VERSION` + `package.json` + README badge
- [ ] No `fetch`/`XHR`/`GM_xmlhttpRequest`/`eval`/`unsafeWindow` added in `src/` (CI guard)
- [ ] If adapter/DOM touched: `test/fixtures/*.html` fixture + jsdom tests updated
- [ ] No web GUI/Pages, mailbox, or GM storage reintroduced
- [ ] If race page touched: `#race` (live) tab stays **zero-UI** & is not read/changed
- [ ] If game DOM touched: ToS risk understood and borne by the user (see docs/PRIVACY.md)

## Notes

<!-- Items needing reviewer attention / follow-up -->
