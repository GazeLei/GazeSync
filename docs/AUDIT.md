# Code audit - 15 October 2026

Scope: the original 0.1.0 framework, browser adapter, canvas example, simulations,
recording/replay and package boundaries. The audit combined source inspection,
adversarial fixtures, package inspection and isolated execution. It is a focused
software review, not an external security certification or a human accuracy study.

## Findings and fixes

| Priority | Reproduced issue in 0.1.0                                                                                                                                                        | Change in 0.2.0                                                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | `npm pack --dry-run` included an adjacent manuscript archive, figures and template files; the package had no shipping allowlist.                                                 | Explicit npm file list and a separately reviewed repository-export manifest. Unknown files are excluded.                                                              |
| P1       | The local server served arbitrary package files and followed symlinks.                                                                                                           | Serve only approved demo assets; verify real paths and reject symlinks, non-GET/HEAD methods and unlisted documents.                                                  |
| P2       | A keyboard/button zoom during an active drag was overwritten by the next drag movement's old baseline.                                                                           | Cancel the active gesture when an external view command takes over.                                                                                                   |
| P2       | A global frame lookup could select a different surface's presentation.                                                                                                           | Per-surface binary-search indexes, including retention and uncertainty-window checks.                                                                                 |
| P2       | The absolute determinant threshold rejected well-conditioned small scales; determinant overflow could evade the singularity test.                                                | Scale-normalized conditioning and finite inverse checks. Normalize nonzero ray directions by magnitude before taking their norm.                                      |
| P2       | Invalid cause-ID metadata could fail in `flush` after pending samples had been removed. Boolean-like strings and non-JSON metadata could be silently misinterpreted.             | Validate before mutation, normalize optional fields, reject non-JSON values and commit a flush only after alignment succeeds.                                         |
| P2       | Far-future capture timestamps stayed pending until that future time, so their promised quality flag could never arrive promptly.                                                 | Quarantine impossible future/over-uncertain samples on the next flush.                                                                                                |
| P2       | Replay ignored sequence gaps and implementation version.                                                                                                                         | Versioned schema 1.1, implementation 0.2.0, total-record count and consecutive-sequence checks. These are consistency checks, not a cryptographic authenticity claim. |
| P2       | Browser listeners used the global document, canceled gestures for unrelated contacts and intercepted embedded form keys. The canvas example relied on rAF for hidden-tab status. | Use the owning document/clock, ignore interactive descendants/untracked cancellations and record the inactive boundary immediately.                                   |
| P2       | The simulation subpath had no declarations; valid samples could omit required payloads in TypeScript.                                                                            | Typed simulation exports, validity-dependent sample types and a strict package-consumer type check.                                                                   |
| P2       | Empty/unmapped simulation results could appear to have zero reconstruction error; the demo displayed hard-coded pass labels.                                                     | Explicit mapped/paired/expected counts and a shared pass predicate that rejects empty or non-finite results.                                                          |
| P3       | Late samples could make the timeline draw backwards; the 3D inspector could show a pending ray from a different capture time.                                                    | Sort plotted samples by capture time and display the raw ray associated with the aligned sample.                                                                      |

Seven focused audit regressions were run against the original implementation and
failed before repair: gesture interruption, independent surfaces, small affine
scales, cause IDs, validity/JSON input, future timestamps and replay gaps. They pass
after repair. Additional tests cover browser ownership/cancellation, hidden-tab
capture, package contents, HTTP serving, simulation pass criteria and declarations.
See [tests](../tests/) for executable cases. Recorded outputs in `artifacts/` are
local verification evidence and are excluded from distribution.

## Optimizations implemented

- Cache each immutable frame's inverse transform rather than invert it for every
  gaze sample. Keep timestamp lookup indexed independently for each surface.
- Resize the canvas backing store only when its dimensions actually change.
- Keep runtime dependencies at zero and ship a deliberate file set. Development
  checks and the optional report can travel in a separate source export.
- Provide `npm run bench`, a bounded in-process ingestion/alignment benchmark with
  retention rollover. It reports measured throughput and batch time without making
  a device real-time guarantee.

## Remaining limits

Real exposure/display timing, measured camera-to-screen geometry and tracker
calibration remain integration measurements. Render callbacks do not establish
photon onset. The moving-phone fixture holds geometry between display samples and
cannot validate sub-frame pose accuracy. Synthetic PoG/ray pairs share the same
noisy target; their agreement is a projection consistency check.

The recording backend is bounded in-memory storage. Long sessions should persist
raw records before rollover; ring buffers and a streaming sink are useful next
optimizations after a concrete host/storage contract is selected. The current
arrays still incur front-removal work at their retention limits. Worker transport,
native bindings and multi-device clock fitting are extension work, not shipped
capabilities. A public release still needs final citation metadata and contributor review.
Hardware claims require the physical/browser test matrix described in
[release preparation](RELEASE.md).


## Extension audit: 0.3.0

The independent Python implementation and strict TypeScript migration were
reviewed together against schema 2.0. Concrete repairs made during integration:

| Issue | Resolution and evidence |
| --- | --- |
| Same capture ID for independent eyes or PoG/ray records collided. | Identity now includes eye and representation, clock ID and epoch. Per-eye identity regressions pass. |
| Python and JavaScript float-to-string conversion generated different vendor sample IDs. | IDs use an IEEE-754 byte encoding; shared fixtures agree exactly. |
| Geometry comparison depended on object-key ordering and omitted versus explicit active state. | Compare canonical geometry fields; identical states do not create timing ambiguity. |
| Re-registering identical source JSON with reordered keys failed in TypeScript but passed in Python. | Canonical finite-JSON comparison; a failing regression now passes and changed rates still reject. |
| Source cadence summaries omitted the clock ID despite tracking it internally. | Both implementations now expose the ID and epoch for each rate stream. |
| Receipt-only sources could look suitable for exposure-time attention. | A blocking quality flag and actionable diagnostic preserve the distinction. |
| Python sdist tests referenced a parent repository fixture. | Fixtures are packaged with the tests and checked against the shared contract. |
| The full conformance harness could block on large subprocess pipes. | File-backed temporary transport, bounded subprocess timeout and cleanup. |
| The inherited benchmark sample omitted the schema 2.0 eye field. | Explicit monocular source/eye metadata; simulation, replay and benchmark CLI smoke checks now run in CI. |
| Twine 6.2 rejected the builder's metadata 2.5. | Packaging checks require Twine 7; wheel and sdist metadata pass. |

Validation after these repairs: 65 Node tests, strict TypeScript consumer checks,
29 Python tests, ten cross-language adapter fixtures and 78 cross-language
experiment configurations with 107,070 observations. All matrix cases select the
reference capture frame, drain pending data and reproduce aligned records on
replay. The maximum viewport difference between languages is 4.55e-13 logical
pixels. Synthetic source perturbation is kept separate from reconstruction
residuals. These checks do not establish real tracker accuracy.

Source ownership is isolated in GazeLei/GazeSync. The npm package contains the
compiled ES modules, declarations and corresponding TypeScript source; the
Python package contains its own standard-library core and attribution files.
No hardware SDK or private parent-project history is imported. The release check
also verifies GPL text, versions, shared fixtures and an explicit export list.
Public release remains deliberately disabled.
