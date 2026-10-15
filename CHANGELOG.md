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
