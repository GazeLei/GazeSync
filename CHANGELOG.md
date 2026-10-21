# Changelog

## 0.5.4 - 2026-10-21 (development, not published)

- Drain large configured TypeScript pending batches without exceeding the
  JavaScript function-argument limit or losing pending observations.
- Validate custom per-eye rate maps consistently in Python and TypeScript.
- Honor box-selection mode and Shift-drag for pen input in both controllers.
- Reject invalid adapter context before Pupil deduplication commits; preserve
  defaults for omitted TypeScript context properties.
- Decode Python CLI JSON files and piped input independently of the host locale;
  report file access errors without a traceback.
- Add explicit cross-language CLI replay comparison with geometry tolerance;
  retain exact timestamps, identifiers and quality flags and report exactness separately.
- Retain schema 2.1 and closed registry publishing gates.

## Unreleased repository maintenance - 2026-10-21

- Keep the compiled manuscript PDF in the software repository; move LaTeX,
  figure assets, paper data and manuscript tools to GazeSync-paper.
- Move author-finalization and optional preprint metadata into release.json.
  Preserve publication gates and keep existing release packages unchanged.

## 0.5.3 - 2026-10-18 (GitHub research preview)

- Ignore superseded equal-time snapshots when checking temporal ambiguity.
- Reject misspelled Tobii clock choices and non-boolean ray options.
- Detach geometry callback views from rendered snapshots; diagnose aligned-observer failures without stopping frame recording.
- Add independent geometry/transform/timeline oracles and passing Windows/macOS CI jobs.
- Invoke npm consumer checks through its JS CLI on Windows to avoid executable-resolution failures.
- Retain schema 2.1, require original implementations for prior recordings, and disable uploads for this new candidate.

## 0.5.2 - 2026-10-18 (TestPyPI validation release)

- Keep binocular pairs within one content identity.
- Reject degenerate Pupil homographies and preserve projective scale invariance.
- Break double-tap sequences when another view command intervenes.
- Reject competing DOM owners even when they use distinct sessions.
- Accumulate diagnostic observer failures instead of overwriting their counts.
- Require actual boolean publication/author flags.
- Add a virtual-time retention check and revise the manuscript as a technical report.
- Retain schema 2.1 and disabled publication; use the original implementation for older recordings.

### First-release setup - 2026-10-18

- Allow software publication before the implementation preprint receives an arXiv ID; retain author and registry gates.
- Add an accessible README overview and content-surface screenshot, with both assets included in the npm archive.
- Document verified GitHub environment protection and the separate PyPI, TestPyPI and npm bootstrap routes.
- Keep registry publication disabled until the first uploads are approved.

### Unpublished 0.5.1 npm distribution preparation - 2026-10-18

- Include the integration guides and Canvas example; repair installed documentation links.
- Verify actual npm tarball bytes, exports, source maps and local documentation targets.
- Add isolated installed-consumer ESM/CommonJS-dynamic-import and TypeScript resolution checks.
- Declare the registry explicitly and constrain publishing to one tested tarball without lifecycle scripts.
- Keep implementation/schema versions and all runtime modules unchanged; publication remains disabled.

## 0.5.1 - 2026-10-18 (development, not published)

- Canonicalize Python integral buffer limits and reject malformed optional display/plane mappings before state mutation.
- Validate model units and field paths at construction; snapshot adapter configuration and expose detached source descriptors.
- Commit Pupil per-eye deduplication only after the complete packet validates; include clock ID in its identity.
- Reject overflowing latency before ingestion and keep unresolved cadence estimates null rather than non-finite.
- Keep the browser helper's current clock tick open, enforce one helper owner per session and restore styles/listeners after failed setup or teardown.
- Verify wheel/sdist inventories and payload bytes against the reviewed sources, including the rebuilt wheel.
- Check PyPI and npm publication gates independently while leaving publication disabled.

## 0.5.0 - 2026-10-18 (development, not published)

- Add anchored clockwise content rotation and combined pinch/twist/midpoint transforms in Python and TypeScript.
- Add free movement at fit, rotated bounding boxes, rotation drag/shortcuts, and stable contact rebasing. Arrow keys now move content in the named direction.
- Add the InteractionController alias and explicit move/rotate methods; legacy views default to zero rotation.
- Add createGazeSurface for image/text/DOM layers with rendered-state recording, lifecycle handling and cleanup; supply a runnable content example.
- Correct browser input offsets for bordered, axis-aligned scaled frames.
- Expand synthetic coverage with eight content-motion cases; preserve the established 78-case baseline separately.
- Retain schema 2.1 (affine matrices already carry rotation) and disabled publication. Exact replay still requires the recorded implementation version.

## 0.4.0 - 2026-10-15 (development, not published)

- Audit camera/eye/display/viewport origins; add named proper rigid-transform helpers in both languages.
- Fix full-display 3D mapping into offset viewports; require an explicit plane extent for ambiguous layouts.
- Preserve the metric frame ID with 3D hits; schema 2.1 rejects earlier replay implementations.
- Keep physical panel dimensions stable through simulated orientation changes; expose explicit metric sizes.
- Classify active-display bounds for all coordinate inputs and retain arithmetic edge residuals without clipping.
- Add analytic camera/tracker fixtures, 100 rigid-frame checks per language and an expanded geometry manuscript/figure.
- Keep package builds in version-specific output directories so earlier artifacts remain available.


## 0.2.0 - 15 October 2026 (unpublished)

- Fix view-history lookup for simultaneous surfaces and gesture interruption by
  keyboard/button zoom.
- Normalize affine conditioning by scale, cache frame inverses and normalize
  nonzero 3D directions without depending on their magnitude.
- Validate JSON records, flags and presentation metadata before state mutation;
  quarantine invalid future timestamps and commit flushes atomically.
- Record schema 1.1, implementation version and total record count; reject
  incomplete, reordered or incompatible exact replay.
- Scope browser listeners to the owning document, preserve embedded form controls,
  ignore cancellation from untracked pointers and record hidden-tab boundaries.
- Add typed simulation exports, standalone CI, a public-file manifest, guarded
  demo serving and explicit source export.
- Remove parent-project branding/dependencies from distributable files.

Version 0.1.0 recordings remain inputs for the original implementation. The current
exact-replay API rejects them. A future migration must retain the raw original and
record which version produced any recomputed alignments.

## 0.3.0 - 2026-10-15 (development, not published)

- Strict TypeScript source and generated declarations; independent Python core.
- Schema 2.0 eye identity, source descriptors, nullable confidence and direction-only data.
- Generic model, Tobii Pro, EyeLink bridge and Pupil Core record adapters.
- Per-eye cadence diagnostics, receipt-time quality gate and explicit binocular pairing.
- Shared fixture conformance and 78 rate/size/eye configurations.
- GPL-3.0-only metadata, isolated npm/wheel/sdist builds and disabled OIDC release workflow.
- Rewritten implementation paper with reproducible vector figures and synthetic evidence.
