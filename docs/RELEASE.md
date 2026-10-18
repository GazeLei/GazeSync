# Release preparation

The independent public repository is `GazeLei/GazeSync`. The code license is
**GPL-3.0-only**, selected by the maintainer. Covered distributed modifications
must comply with GPL source-sharing obligations; the license does not require
upstream patch submission or academic citation. Citation is requested separately.
The manuscript remains an author-review draft with its own rights notice.
[SPDX's GPL-3.0-only entry](https://spdx.org/licenses/GPL-3.0-only.html) identifies
the exact license. Review compatibility before combining a proprietary vendor
SDK into a distributed application; the shipped normalizers bundle no SDK.

## What can be built now

```sh
npm ci --ignore-scripts
python3 -m venv .venv
.venv/bin/python -m pip install './python[test]' build "twine>=7,<8"
npm test
npm run test:types
.venv/bin/python -m pytest python/tests
npm run test:conformance
.venv/bin/python tools/package_smoke.py
```

The packaging utility requires Python 3.12+; the library supports Python 3.10+.
It creates an npm tarball, a wheel and a source distribution under
`artifacts/release/<version>/`, checks metadata with Twine, installs both packages outside
the checkout and rebuilds the wheel from the sdist. These are local artifacts.
`npm pack` works while `private:true` blocks `npm publish`.

`public-files.json` is an explicit reviewed repository inventory and browser
allowlist. `npm run export -- --out /new/directory` exports only that inventory,
including paper source/figures and SHA-256 hashes. Build outputs are reconstructed
from source. No parent checkout, Git history, credentials or raw participant data
are copied. Re-review the inventory when adding a source file.

## Gates before any registry upload

Software publication does **not** require an arXiv identifier. The maintainer
explicitly chose to add it after submission. Keep `paper/metadata.json.arxivId`
null and the implementation citation labelled as a draft until a real identifier
exists; then update the paper and citation files together. A supplied identifier
is checked for format, not independently authenticated by the release tool.

The release workflow runs only by manual dispatch on a version tag in a public
repository. `release.json` still has `publicationEnabled:false`, and npm still has
`private:true`. Author metadata must be finalized. TestPyPI uploads are public too.

1. Review the exact release commit, package contents, copyright and name
   availability. The four implementation authors are finalized. Manuscript and
   figure rights remain described separately in `NOTICE`.
2. Complete the registry account/publisher setup below. Confirm that all three
   GitHub environments have the maintainer reviewer and `v*` **tag** restriction.
3. After upload approval, set `publicationEnabled:true`; set npm `private:false`
   only when preparing the npm release. Python publication can keep npm private.
   Keep versions consistent, rebuild and rerun verification. Update README status
   to reflect only the registries actually published.
4. Commit the verified metadata and create the matching `v0.5.1` tag. Dispatch
   `release.yml` for `testpypi` first, approve its environment deployment, then
   install from that index in a clean environment. Approve `pypi` separately.
   Use the npm bootstrap below for its first upload.
5. Verify registry metadata and a clean installation after each upload. Record
   the released commit, artifact hashes and URLs; do not replace a published
   version with different contents.

## GitHub release environments

`testpypi`, `pypi` and `npm` each require review by `GazeLei` and accept tags
matching `v*`. The workflow additionally requires the exact tag `v${version}`.
Self-review is allowed so the sole maintainer can approve a manually dispatched
release. This is a deliberate approval step, not independent two-person review;
GitHub's administrator bypass remains available.

The repository was made public by the maintainer on 18 October 2026. Required
reviewers could not be configured under the previous private-repository plan;
they were successfully added after the visibility change. See
[GitHub environment availability](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

The workflow requests `id-token:write` only in the publishing jobs. It consumes
already-built artifacts, pins third-party actions and does not need a PyPI API
token or an npm token for subsequent trusted releases. Do not add permanent
registry credentials to repository secrets for this route.

## Official Python route

Sign in separately to [PyPI](https://pypi.org/manage/account/publishing/) and
[TestPyPI](https://test.pypi.org/manage/account/publishing/). Verify each account's
email and enable 2FA; retain recovery codes outside the repository. Configure a
pending publisher on each site with these exact values:

| Field | PyPI | TestPyPI |
| --- | --- | --- |
| Project name | `gazesync` | `gazesync` |
| Owner | `GazeLei` | `GazeLei` |
| Repository | `GazeSync` | `GazeSync` |
| Workflow filename | `release.yml` | `release.yml` |
| Environment | `pypi` | `testpypi` |

Adding a publisher grants this workflow publishing authority. It does not upload
an artifact or reserve the name. Review the repository, workflow and environment
before submitting. Pending publishers can establish a new project on first
upload. The workflow builds first and publishes the inspected
wheel/sdist through PyPA's action using OIDC and attestations. TestPyPI and PyPI
are separate services. See [PyPA's official workflow guide](https://packaging.python.org/en/latest/guides/publishing-package-distribution-releases-using-github-actions-ci-cd-workflows/).

## Official npm route and first release

A new npm package must exist before a trusted publisher can be configured.
Perform the initial upload only when publication is authorized, from a
maintainer-authenticated npm session with the required 2FA. Inspect and publish
the tested tarball, then configure its trusted publisher for **GazeLei/GazeSync**,
workflow **release.yml**, environment **npm**, explicitly allowing `npm publish`.
New website configurations default to stage publishing, so this permission must
match our direct-publish workflow. Later releases use OIDC; npm needs
version 11.5.1+ and Node 22.14+. The `npm trust` CLI configuration command itself
requires npm 11.15.0+; the website can also configure a publisher. Provenance requires a public repository and
package. Configure a publisher close to its first use because an unused new
publisher expires after two days under the current policy.

Do not use npm staged publishing to reserve a name while this project is private:
staging a new package creates a public placeholder. See the official
[npm trust command](https://github.com/npm/cli/blob/latest/docs/lib/content/commands/npm-trust.md),
[trusted publishing guide](https://docs.npmjs.com/trusted-publishers/) and
[first-package guide](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/).

## Evidence still needed

The adapters have protocol-fixture evidence, not physical-device certification.
Before making hardware or latency claims, measure exposure/clock uncertainty,
display onset, extrinsics, independent targets, dropout and motion on the actual
SDK/firmware/browser/OS matrix. No participant-data release is included. The
in-memory recorder needs external persistence and measured backpressure for long
sessions. These limitations do not prevent source distribution with accurate
scope and documentation.

## Current preparation status: 18 October 2026

| Item | Verified state / next action |
| --- | --- |
| Source visibility | Public, changed by the maintainer. |
| GitHub environments | All three exist with `GazeLei` review and `v*` tag restrictions. |
| PyPI account | Maintainer logged in; email verified and TOTP enabled. |
| PyPI pending publisher | Added for `gazesync`, `GazeLei/GazeSync`, `release.yml`, `pypi`. |
| TestPyPI account and publisher | Setup in progress; must be verified separately. |
| npm account and 2FA | Setup pending. CLI authentication must also be checked before bootstrap. |
| npm trusted publisher | Requires the package to exist; configure after the approved first upload. |
| arXiv | Optional for software release; retain the honest draft citation until submission. |
| Package uploads | None. `publicationEnabled:false` and npm `private:true` remain set. |

The 0.5.1 audit passed the Node and Python suites, TypeScript consumer checks,
86 cross-language configurations, wheel/sdist rebuilds and isolated npm installs.
Actual archive inventories and file bytes are checked against the source, along
with exported modules, declaration files, source-map targets and Markdown links.
The browser content example was exercised from an installed tarball. See the
[audit record](AUDIT.md) for the concrete findings and limits of that evidence.
README assets are included in the npm inventory so its local image links resolve.

A registry lookup returning 404 is an availability observation, not a reservation
or an ownership check. Recheck immediately before the first upload.

## First npm upload

Complete the npm website account setup with a verified email and 2FA. Then use
`npm login` in a local terminal and complete its browser authentication yourself;
website login alone does not authenticate the CLI. `npm whoami` must identify the
intended maintainer before publication. Passwords, tokens, OTPs and recovery codes
must stay out of Git and chat.

Only after explicit upload approval and rebuilding the enabled release:

```sh
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm publish ./artifacts/release/0.5.1/npm/gazesync-0.5.1.tgz \
  --access public --ignore-scripts --registry=https://registry.npmjs.org/
```

This local bootstrap does not claim CI provenance. After it establishes the
package, configure the npm trusted publisher with the exact repository, workflow
and environment above and **Allow npm publish**. Later workflow releases use
`--provenance`; adding that flag to an ordinary local terminal does not supply
the required CI identity. The publish job accepts exactly one inspected tarball
and does not rebuild it or run package lifecycle scripts.

The Overleaf ZIP is a separate manuscript artifact, not an npm or Python package.
