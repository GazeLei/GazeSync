# Diagnostics for researchers

TypeScript: pass `{onDiagnostic: event => ...}` as the second `GazeSession`
argument. Python: use `GazeSession(on_diagnostic=logging_observer())` to integrate
with the standard `logging` module. Call `session.diagnostics.report()` for
aggregated counts and rate summaries. Callback exceptions are recorded as
`CALLBACK_FAILED` and do not interrupt acquisition. No warning is uploaded.

Callbacks fire on the first occurrence of each code/source/eye/surface context;
counts and last occurrence times continue accumulating. Cadence estimates use at
most 2,048 unique capture times within a two-second window, separated by source,
eye, representation and clock ID/epoch. Expected rate is metadata, never a
resampling instruction. Short streams may lack enough span for a rate warning.

| Code family | What to inspect |
| --- | --- |
| `SOURCE_UNREGISTERED`, `EYE_UNSPECIFIED` | Register provenance and explicit eye identity before capture. |
| `SOURCE_RATE_DEVIATION`, `SOURCE_GAP`, `OUT_OF_ORDER` | Sampling profile, dropped data, timestamp units and transport buffering. |
| `PRESENTATION_GAP`, `HISTORY_EXPIRED` | Per-frame logging, watermark order and retention budget. |
| `CLOCK_UNCERTAIN`, `FUTURE_CAPTURE` | Clock origin, measured drift and units. |
| `EXPOSURE_TIME_REQUIRED` | Receipt-only samples cannot support capture-time reconstruction. |
| `GEOMETRY_UNAVAILABLE`, `SURFACE_REGISTRATION_REQUIRED`, `DISPLAY_LAYOUT_REQUIRED` | Screen registration, eye origin, frame convention, pose age or display offsets. |
| `BINOCULAR_PARTIAL`, `CONFIDENCE_UNAVAILABLE` | Keep separate eye validity and null confidence. Do not impute a second eye. |
| `RECORDING_TRUNCATED` | Persist the source log before rollover; exact replay requires completeness. |

[The complete catalog](../contracts/diagnostics.json) specifies severity, message
and remedy. Adapter warnings are returned by `adapt` independently of session
callbacks; collect both. An aligned record's `usable` and `flags` are the primary
per-observation quality contract. Informational warnings do not necessarily make
a sample unusable. Conversely, a structural flag such as `ambiguous-presentation`
can make a sample unusable even without a distinct aggregate diagnostic code.
Expected Hz, uncertainty limits and confidence thresholds must be justified for
the study. A quiet log does not establish device accuracy.


Geometry setup rejects ambiguous `planeSpace` and invalid rigid transforms before
changing session state. `off-display` identifies a hit outside the complete active
display, even if it is within a larger viewport. `rayHit.frameId` identifies the
metric origin/basis of its 3D coordinates. These flags cannot diagnose an unknown
physical calibration merely from a well-formed frame name.


`CALLBACK_FAILED.count` counts observer invocations that raised an exception,
across diagnostic contexts. Its first occurrence time is preserved and its most
recent time is monotonic. Repeated occurrences of the same original diagnostic
are aggregated without invoking the first-occurrence observer again.
