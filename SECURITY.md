# Security Policy

## Supported versions

| Version         | Supported |
| --------------- | --------- |
| `main` (latest) | ✅        |
| last `v*` tag   | ✅        |

The userscript has no backend — update = reinstall `src/igpas.user.js` from `main` / the latest
release tag.

## Reporting a vulnerability

Do not open a public issue for sensitive reports.

- Email / DM the maintainer (see the GitHub profile `Cnagnn`) with details + reproduction steps +
  impact.
- Or open a [Security advisory](https://github.com/Cnagnn/igpas/security/advisories/new) (private).

We will confirm within **48 hours** and release a fix + advisory once the patch is ready.

## Scope & guards

- `src/igpas.user.js` **must not** contain `fetch`/`XHR`/`GM_xmlhttpRequest`/`eval`/`unsafeWindow`
  — guarded by `ci.yml`. If you find a violation, report it immediately.
- The userscript reads the displayed DOM and only writes temporary text/`title`/colour on original
  elements — no clicks/submits, no local storage (`GM_*`), no exfiltration.

## Hardening for contributors

- Do not commit secrets / tokens / PII to fixtures (`test/fixtures/*.html` is already sanitised).
- Dependabot is active (npm + GitHub Actions) — review `deps` PRs via `npm run verify`.
