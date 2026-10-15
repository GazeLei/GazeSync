# Standalone release preparation

The maintainer chose to decide the license later. Keep `private: true` and
`license: UNLICENSED`. No npm publish action or public deployment is configured.
The package name `gazesync` is a working identifier; ownership/availability and
repository URL must be finalized before release.

## Export a repository without unrelated content

From the package root:

```sh
npm ci --ignore-scripts
npm test
npm run test:types
npm run simulate -- --out artifacts/verification
npm run release:check
npm run export -- --out /path/to/new-gazesync-directory
```

The destination must not already exist. Export copies only `repositoryFiles` from
`public-files.json`, rejects symlinks, verifies static import containment and writes
an inventory with SHA-256 hashes. It copies no Git history, remote configuration,
ignored recordings, parent directories or unlisted paper/reference material.
The optional `--paper /path/to/report-folder` copies only that folder's reviewed
`main.tex` and `README.md` into `paper/`. The report must be self-contained.

Initialize the eventual new GitHub repository from this export. Run the same
checks in the exported directory before the first commit. Its root CI workflow
checks Node 22, 24 and 26. The npm `files` list is narrower than the source export
and excludes tests, original manuscripts and unrelated materials. `npm pack
--dry-run --json` is tested against that exact allowlist.

An allowlist establishes which files are copied; it does not replace reviewing
their contents. Review the export inventory and search the resulting files for
personal paths, private URLs, credentials and accidentally retained identifiers.
Adding a distributable file requires an explicit manifest review. Do not copy
the parent checkout's `.git` directory into the new project.

## Before changing the publication gate

1. Choose the code license, copyright holder and contributor attribution. Review
   the report's license separately. The previous publication's rights statement
   is not automatically a license for this new software or report.
2. Confirm the package name/scope and repository URL. Update package metadata,
   citation metadata and maintainer contact. Reserve the software DOI only when
   a versioned release actually exists; the original paper DOI identifies the
   previous publication.
3. Review the standalone source archive and its hashes. Keep participant data,
   commercial SDK binaries, model weights and reference-source archives outside
   the release unless explicitly cleared and needed.
4. Run independent browser/device tests: Chrome, Safari and Firefox on desktop;
   iOS Safari and Android Chrome; touch cancellation, resize/orientation, device
   pixel ratio, background/resume and page zoom. Record measured results and
   unknowns. The automated gesture tests do not substitute for this matrix.
5. Connect a real tracker adapter and measure capture/display latency, clock drift,
   pose age and held-out spatial error. Keep software reconstruction error and
   measured gaze accuracy as separate outcomes.
6. Review a schema migration policy and release notes, then deliberately update
   `release:check`, the license field and `private` for the chosen publication route.

## Useful next optimizations

Prioritize a host-facing streaming recorder and circular retention buffers for
long sessions. Measure allocations and latency before moving ingestion to a
worker or introducing binary transport. Preserve raw timestamps and quality
flags through any optimization. Add adapter contract fixtures for native hosts,
property-based geometry tests, and performance budgets based on actual supported
devices. Publish measured cross-version replay/migration fixtures and a concise
API reference when the public API stabilizes.
