# Dependency security updates

The current dependency audit flagged legacy parser/driver/validation versions. Express is pinned to 4.22.3 (same major), mysql2 to 3.24.6 (same major), and Zod to 4.6.7. Both workspace packages use the same parser/validation versions. API request sizes remain bounded and structured validation issue responses are preserved. Re-run the included tests after updating dependencies; do not use an automatic force-update on a money-handling application.

Sources checked 14 November 2026:
- https://github.com/advisories/GHSA-mrhx-c7xc-m3w5 — Zod before 4.6.6 affected.
- https://github.com/advisories/GHSA-3f6p-5ww8-9rcr — mysql2 plaintext-auth downgrade, patched in 3.22.0; later driver advisories require the newer pinned release.
- https://expressjs.com/en/blog/2026-07-31-security-releases/ — body-parser limit enforcement guidance.
- Local npm audit provides the installed-tree advisory resolution. The audit is point-in-time evidence, not a guarantee against future vulnerabilities.
