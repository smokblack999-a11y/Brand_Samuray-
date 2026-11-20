# Third-party notices

This file is the repository's notice index. The authoritative installed dependency
versions and declared SPDX/license metadata are recorded in `package-lock.json`.

## Generation and review

Run:

```sh
npm ci
npm run license:audit
```

The audit fails closed when a package has a declared GPL/AGPL/SSPL license or
missing license metadata. A passing result checks declared package metadata only;
it does not replace review of the actual license text, bundled files, source
headers, fonts, icons, datasets, or platform SDK terms.

## Key direct dependencies

- `teleproto`: MIT — Telegram MTProto client. Its own transitive dependency
  graph must be reviewed whenever its pinned version changes.
- `input`: MIT — interactive terminal prompts used by the existing login tool.
- `openai`: Apache-2.0.
- `express`: MIT.
- `ethers`: MIT.
- `cors`: MIT.
- `dotenv`: BSD-2-Clause.

## Product licensing boundary

The Core npm package is private and marked `UNLICENSED`. This is package
publication metadata, not a complete legal license for the repository or the
SAMURAI product. A repository-wide proprietary license must be issued only
after the rights holder, copyright notice, third-party exclusions, and customer
grant terms are confirmed.

## Reviewed metadata exception

- `rx-lite@3.1.2`: its npm lock entry omits a license field. The upstream
  package metadata identifies Apache-2.0; the audit script applies a
  version-specific reviewed override. Re-check the upstream license before
  changing this version.
