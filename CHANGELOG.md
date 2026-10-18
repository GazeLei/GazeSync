# Changelog

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
