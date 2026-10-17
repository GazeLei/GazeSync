# Release preparation

The independent repository is `GazeLei/GazeSync`. The code license is
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

## Gates before any public upload

The workflow runs only by manual dispatch on a version tag in a **public**
repository. `release.json` currently has `publicationEnabled:false` and npm has
`private:true`. The public release check also requires finalized author metadata
and a real implementation arXiv identifier. TestPyPI is public too.

1. Finalize authors, manuscript rights and the arXiv submission; update
   `paper/metadata.json`, `CITATION.cff`, `CITATION.bib` and manuscript metadata.
   Citation metadata must be reviewed together; the gate checks existence and
   format, not the correctness of a newly supplied identifier.
2. Review contributor copyright, generated assets and all source/export files.
   The maintainer changes GitHub visibility when ready. Recheck package name
   availability; `gazesync` was unclaimed at the 15 October 2026 preparation check,
   which does not reserve either registry name.
3. Set `publicationEnabled:true`, change npm `private` to false, synchronize
   versions in both packages, release.json and implementation constants, and
   regenerate package-lock.json. Rebuild and run the complete verification.
4. Configure GitHub environments `testpypi`, `pypi`, and `npm` with required
   maintainer review and tag restrictions. Protect the default branch and release
   tags. Configure the corresponding registry publisher identities below.
5. Commit reviewed metadata, push a matching `vX.Y.Z` tag and manually dispatch
   `release.yml` for the intended destination. Uploads and GitHub visibility changes
   have not been performed during package preparation.

## Official Python route

Create PyPI and TestPyPI accounts and configure pending trusted publishers for
owner **GazeLei**, repository **GazeSync**, workflow **release.yml**, with the
matching environment **pypi** or **testpypi**. Pending publishers can establish a
new project on first upload. The workflow builds first and publishes the inspected
wheel/sdist through PyPA's action using OIDC and attestations. TestPyPI and PyPI
are separate services. See [PyPA's official workflow guide](https://packaging.python.org/en/latest/guides/publishing-package-distribution-releases-using-github-actions-ci-cd-workflows/).

## Official npm route and first release

A new npm package must exist before a trusted publisher can be configured.
Perform the initial upload only when publication is authorized, from a
maintainer-authenticated npm session with the required 2FA. Inspect and publish
the tested tarball, then configure its trusted publisher for **GazeLei/GazeSync**,
workflow **release.yml**, environment **npm**. Later releases use OIDC; npm needs
version 11.5.1+ and Node 22.14+. Provenance requires a public repository and
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

## Preparation status on 17 October 2026

Version 0.4.1 passes the test/type/conformance checks and isolated wheel, sdist
and npm-tarball installation checks. Both registries returned HTTP 404 for
`gazesync` on this date; this is an availability observation, not a reservation.
GitHub reports the source repository as private and no release environments
configured. No PyPI/npm account settings or publisher identities were verified.

The remaining steps are concrete:

| Item | State / next action |
| --- | --- |
| Source and package contents | Reviewed inventory; build and installation checks pass. |
| Four manuscript authors | Finalized in the local metadata. |
| Implementation preprint | Real arXiv ID remains unset; update citations after submission. |
| Manuscript/figure publication rights | Maintainer/author approval still required under NOTICE. |
| Repository visibility | Maintainer changes the private repository to public when ready. |
| Registry ownership | Recheck the name and sign in to the intended maintainer accounts with 2FA. |
| Python trusted publishers | Configure pending publishers separately on TestPyPI and PyPI for `GazeLei/GazeSync`, `release.yml`, and their matching environment names. |
| npm first upload | Publish the reviewed tarball from the maintainer's authenticated session; then configure the package's trusted publisher. |
| GitHub release environments | Create `testpypi`, `pypi`, `npm`, reviewer requirements and release-tag restrictions; currently absent. |
| Enable and tag | Deliberately enable publication, update all versions/citations, rebuild, tag the exact verified commit, then dispatch the chosen destination. |

First npm upload, only after the earlier gates and explicit publication approval:

```sh
npm login
npm publish artifacts/release/0.4.1/npm/gazesync-0.4.1.tgz --access public
```

The local bootstrap upload does not claim CI provenance. Subsequent trusted
publishes use `--provenance` in the supported GitHub Actions environment; adding
that flag to an ordinary local terminal does not supply the required CI identity.

An account token, OAuth grant, package-name claim, public upload and repository
visibility change are not performed by the preparation tools. The Overleaf ZIP
is a separate manuscript artifact and is not an npm or Python package.
