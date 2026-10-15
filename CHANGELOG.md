# Changelog

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
