# Security

## Toolchain

- Node `24.15.0` (see `.node-version`)
- pnpm `10.4.1` (`packageManager` in `package.json`)
- Production audit: `pnpm audit --prod --json`. `high` and `critical` must be 0.
- Every remaining `moderate` or `low` finding must be listed below with a direct dependency path, available fixed version, owner, review/expiry date, and acceptance reason. `scripts/verify-audit-report.mjs` rejects an unadjudicated item.

## Adjudicated audit findings

None as of 2026-08-31. If `pnpm audit --prod` later reports a moderate/low item, add a row here before a release candidate is approved:

| Advisory | Severity | Direct path | Fixed version | Owner | Review by | Reason |
|---|---|---|---|---|---|---|

## Gitleaks v8.30.1

Install only from the official GitHub release after verifying the platform asset SHA-256.

| Asset | SHA-256 |
|---|---|
| `gitleaks_8.30.1_linux_x64.tar.gz` | `061476c21adaf5441516f96f185c1a4706a83cd6329b9b38762271b3d4a52fae` |
| `gitleaks_8.30.1_windows_x64.zip` | `d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e` |

CI downloads the Linux asset, checks the digest, then runs the CLI. The pinned `gitleaks/gitleaks-action` commit is a separate full-history defense-in-depth gate. Reports must use `--redact` and must never store matched secret values.

## Release hygiene

Credential rotation, remote Git history, old ZIP/source archives, and historical release-asset cleanup are owner gates. A clean current tree or RC does not prove those locations are clean.
