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


## Camera and coordinate audit: 0.4.0

Scope: both geometry cores, source adapters, display/viewport mapping, the
synthetic physical settings and manuscript equations. The ray-plane formula was
correct for a common metric frame. Its surrounding coordinate contract had
several gaps that the earlier coextensive-view simulations could not expose.

| Finding | Repair and evidence |
| --- | --- |
| A full active-display plane was projected using viewport dimensions, ignoring a window's offset. | `planeSpace` distinguishes full display from physical viewport. Independent fixtures reproduce (500,300) versus the correct (860,460). Both languages now agree with normalized-display PoG. |
| The rectangle represented by a plane was ambiguous when display and viewport differed. | Explicit extent required for differing recorded layout; invalid setup is rejected before mutation. The two regressions failed before repair. |
| Camera/eye origins and extrinsic direction were implicit integration responsibilities. | Named rigid helpers validate proper rotations; points get R and t, directions R only, inverse translation is -R^T t. Four camera/eye fixtures, a quarter-turn fixture and 100 arbitrary-frame checks per language verify them independently of the gaze simulator. |
| A derived metric hit had no frame ID in its own result. | `rayHit.frameId` is retained. Schema 2.1 / implementation 0.4.0 prevent silent replay under changed projection semantics. |
| Phone orientation inferred a new physical width from rotated logical pixels. | The same measured panel dimensions are swapped; explicit physical dimensions are configurable. |
| The interaction lab's viewport registration did not retain a fixed square-pixel metric scale during desktop resize. | A fixed synthetic active panel and top-left-anchored crop now retain metric pixel pitch; phone width/height swap without resizing the panel. |
| Full-display visibility could be lost when a larger viewport contained an off-panel hit. | Bounds are checked in both display and viewport spaces for all input representations; raw points stay unclipped. Arithmetic edge residuals receive a small numerical tolerance. |

The audit also checks mm-to-m conversion in a non-camera Tobii UCS fixture,
independent left/right origins, mirrored/scaled/sheared rotation rejection,
positive forward distance, dynamic-pose provenance, direction magnitude extremes,
and equal projection in camera and world frames. The camera fixture is explicitly
synthetic: its centre is (0.04,0.19,0.015) m in a display-centred reference frame.
No actual camera calibration is inferred from the demo or from a frame label.

Validation: 78 Node tests, 43 Python tests, strict consumer types, five native
geometry fixture comparisons, ten adapter fixtures and the existing 78-case,
107,070-observation matrix. The full matrix retains zero frame mismatches and
numerical-scale reconstruction residuals. The manuscript's Section 5 now gives
the origins, equations, numerical example and independent physical checks needed
for real deployment. [The setup guide](COORDINATES.md) includes the host contract.

## Follow-up audit: 0.4.1, 17 October 2026

The baseline passed 78 Node and 43 Python tests. A new regression nevertheless
reproduced duplicate pending observations in both languages: with `maxRecords=2`
and `maxPending=8`, `a,b,c,a` was accepted before any flush. Eviction from the
recent-ID cache must not remove protection for an observation still in the reorder
buffer. A separate pending-ID set now covers that lifetime, and rejected duplicate
ingestion leaves the session unchanged. Recent completed-ID history remains
bounded; IDs older than both windows can be accepted again.

Python raw-record retention used `list.pop(0)` for every insertion beyond the
limit. It now uses `deque.popleft`, while `records` and JSON exports remain ordered,
detached lists. An alternating same-process microbenchmark (Python 3.12.14,
macOS arm64, five repeats, 160,000 small input records) measured median ingestion
times of 1.084 s before and 0.366 s after at the default 100,000-record cap.
At a 4,096-record cap the medians were 0.433 s and 0.382 s. These measurements
exclude alignment, export, rendering, transport and storage; they are not a device
latency claim. Local results are retained in `artifacts/review-20261017/`.
TypeScript arrays and presentation histories still incur front-removal costs.
Replacing those requires profiling and care with the currently public array API.

The release gate now checks Python runtime constants, both schema constants,
paper schema metadata and npm lock versions. TypeScript's recording type derives
its literal versions from the exported constants. Publication remains disabled;
schema remains 2.1 and implementation version is 0.4.1. Earlier recordings still
require their original implementation for exact replay.

The Overleaf helper builds a small source ZIP and supports explicit import/export
with a local checkout. It previews by default, rejects conflicting receiving-side
edits and symlinks, and never deletes files, pushes Git or handles credentials.
Its regression verifies both directions and that a conflict preserves local text.

Validation: 81 Node tests, 45 Python tests, consumer types, the full 78-case
conformance matrix and clean Python/npm package installations pass. The matrix
still receives 107,070 observations with zero frame mismatches.

Concrete remaining work: define a persistence callback/storage contract before
claiming long-session recording; bound source/clock/diagnostic context counts for
dynamically created source IDs; profile TypeScript array rollover before changing
the array API; strengthen Python static input types if parity with TypeScript's
validity-dependent union is required. Runtime validation remains decisive.
Paper-specific findings and proposed small experiments are in
[the review](../paper/reviewer-notes.txt); those experiments are not completed results.


## Content manipulation audit: 0.5.0, 18 October 2026

The similarity view now uses clockwise radians and top-left content origins in
both languages. Rotation, zoom and a moving pinch midpoint are composed before
bounds are applied once. Free movement is explicit; the default core bounds use
all four rotated corners. Reset/resize, angle wraparound, contact collapse,
interruption and rotation-disabled behavior have regression tests.

A DOM convenience layer applies and records the same matrix, retains rendered
state through lifecycle changes, handles bordered/CSS-scaled frames, and restores
owned styles/listeners. An image-plus-text example exercised real browser drag,
rotation buttons, zoom, keyboard movement and Home restoration; its exported raw
input/presentation recording replayed exactly. This UI check supplied no eye data.

Validation: 89 Node tests, 55 Python tests, strict consumer types and the existing
78-case baseline pass. Eight extra content-motion cases (6,516 observations) pass
cross-language alignment, diagnostic comparison and replay, with zero capture-frame
mismatches and maximum reconstruction residual 8.4934e-13 logical pixels. Separate
Python-native tests exercise the same eight combinations with its own generator.
The source geometry is synthetic; no empirical usability claim is made.


## PyPI release audit: 0.5.1, 18 October 2026

The audit examined Python ingestion and alignment, adapter state, clock/numeric
boundaries, the matching TypeScript paths, DOM lifecycle ownership and actual
distribution contents. Seven Python regressions failed before the fixes; the
browser repeated-clock regression also failed on 0.5.0. Reproductions and logs
are kept in ignored `artifacts/audit-pypi-20261018/`.

| Finding | Concrete trigger and repair |
| --- | --- |
| P1: Python buffer limits could fail after partial flush mutation. | `maxRecords=2.0` passed validation but became a floating-point slice bound after three alignments. Integral capacities are normalized once at construction. |
| P1: malformed optional geometry could poison a session. | `plane={}` was accepted and failed later during ray alignment. Presentations now reject empty/incorrect plane/display mappings before adding history. |
| P1: model-unit typos and externally mutated options could change coordinates. | `originUnits="cm"` was silently treated as metres; changing `displayPixels.width` after construction changed normalization. Units/field paths are validated and configuration is snapshotted once. Source descriptors are detached snapshots. |
| P1: failed Pupil packets consumed eye observations. | A bad confidence on the second eye left both dedup keys committed; a repaired retry returned no rays. At most two keys are staged and committed after the complete packet validates. Keys include clock ID and epoch. Explicit null per-eye confidence is preserved rather than replaced with a fused packet score. |
| P2: derived temporal numbers could escape finite JSON. | Extreme finite times could overflow latency or cadence. Latency is checked before ingestion; unresolved rate estimates are null. |
| P2: DOM lifecycle and clock ownership could stop recording. | A repeated `performance.now()` tick caused a presentation-after-flush exception. The helper now keeps the current tick open, rejects a competing helper owner on the same session, and restores styles/listeners after setup or teardown errors. |
| Release gap: Python archive contents were not allowlisted like npm contents. | The build checks now compare every actual wheel/sdist file and source byte against the reviewed inventory, including the rebuilt wheel. Synthetic unreviewed-file/link and changed-byte cases are rejected. |

The patch reuses the existing adapter base with one typed configuration snapshot
per adapter. It avoids copying the 4,096-entry Pupil dedup cache per packet;
only the current packet's eye keys are staged. No runtime dependency, storage
subsystem, generic validation framework or new synchronization abstraction was
added. PyPI's publication gate is checked independently of npm's private flag.

Validation: 94 Node tests, 63 Python tests, two isolated archive-boundary tests
(invoked by the Node release suite), strict consumer types and the 78 baseline
plus eight content-motion conformance cases. Clean wheel/sdist/npm installations
and the new byte-level package checks also pass.
The ordinary synthetic fixtures retain their numerical results; these checks do
not establish physical tracker accuracy or provide a proof that all bugs are absent.

Remaining scoped limitations: the recorder is bounded and in-memory; the host
must persist long trials before raw-record rollover. Source/clock/diagnostic
contexts assume stable IDs rather than a new source ID for every sample.
Metadata should contain small measurement provenance, not camera frames or
model tensors. Hardware SDK behavior and actual exposure/display calibration
still need device measurements. These limits should be stated for an initial
research release; they do not call for speculative core refactoring.


## npm distribution audit: 18 October 2026

This is a packaging audit of the unchanged 0.5.1 implementation. Source runtime
modules and recording semantics are unchanged; no additional build format or
runtime dependency was introduced.

| Finding | Action and evidence |
| --- | --- |
| P2: installed README linked to ten absent files. | Ship the four missing integration guides and Canvas example, use GitHub links for repository-only material, and make the HTML example link to its packaged README. Every relative Markdown target is now checked in the actual tarball. |
| Verification gap: source-tree type tests did not test installed resolution. | Add a real tarball consumer with four ESM imports, CommonJS dynamic import, NodeNext core without DOM, NodeNext browser and Bundler browser type checks. The runtime asserts that its resolved module is the isolated installed copy. |
| Verification gap: npm contents were checked only through pack-list output. | Apply the same reviewed-byte inventory principle as the Python audit to actual npm tarballs. Validate export targets and source-map paths/content; reject extra files, changed payloads, duplicates and unresolved references. |
| Release ambiguity: the destination depended on command/config defaults. | Declare public npm registry/access metadata, check it in the release gate, and publish exactly one approved tarball with explicit registry and lifecycle scripts disabled. Publication stays disabled. |
| Test maintenance: pack checks rebuilt dist while other Node tests could read it. | Pack tests now reuse the pretest build with `--ignore-scripts`; the separate package build still tests the real prepack lifecycle. |
| Setup gap: direct publishing needs an explicit Trusted Publisher permission. | Update the maintainer checklist with the `npm publish` action, first-upload prerequisite, CLI version requirements and verified account/environment status. |

Local checks include 95 Node tests; three archive-boundary tests run inside the
release suite. The isolated installed-package checks use TypeScript 7.0.2. npm
11.21.0 pack and publish dry run succeed without uploading. The in-app browser
loaded the installed tarball's example and verified rotation, zoom, keyboard
movement and reset. Raw logs, package manifests, account-status summary and the
UI screenshot are under ignored `artifacts/audit-npm-20261018/`.

No public package, registry placeholder, trusted-publisher grant, login or
repository visibility change was created. Authenticated upload and provenance
remain external verification steps after the maintainer completes setup.
