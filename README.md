# GazeSync

Synchronize eye-tracking measurements with the screen state a person was viewing
while zooming, panning or selecting content. The Python and TypeScript packages
share a versioned recording contract and reproducible conformance tests.

**Development release 0.4.0 · schema 2.1 · GPL-3.0-only.** This repository is
currently private. Neither package has been published to a public registry.

## What is implemented

- Desktop wheel zoom at the pointer, drag to pan, Shift-drag to zoom a box,
  keyboard zoom/reset/cancel; mobile pinch with a moving midpoint, pan,
  pinch-to-pan transitions, double tap and contact cancellation.
- Arbitrary positive viewport dimensions, logical pixels and explicit device
  pixel ratio; independent input, presentation and gaze cadences. No 60 Hz or
  equal-eye-rate assumption. Host-provided affine matrices support rotation.
- 2D PoG, 3D eye-origin rays and retained direction-only measurements; independent
  left/right, monocular, explicitly combined and unknown-eye records.
- Source-clock conversion with immutable epochs, presentation history per
  surface, bounded reordering, quality flags, structured diagnostics and replay.
- Generic model, Tobii Pro dictionary, EyeLink/PyLink bridge and Pupil Core
  normalizers. **These adapters are fixture-tested; physical devices have not
  been validated with this release.** Hardware SDKs and inference models are not
  bundled. Measured calibration and timing remain host responsibilities.

## Start from source

Requires Node.js 22+ for development and Python 3.10+. The browser bundle uses
standard ES modules; Python has no runtime dependencies.

```sh
npm ci --ignore-scripts
npm test
npm run test:types
npm start                    # http://127.0.0.1:5194/demo/
python3 -m venv .venv
.venv/bin/python -m pip install -e './python[test]'
.venv/bin/python -m pytest python/tests
npm run test:conformance      # both languages; 78 synthetic configurations
```

The interaction lab includes deterministic desktop/mobile replay and a manual
canvas. The full frequency/size/eye matrix runs through the CLI. Use
`GAZESYNC_PORT=5195 npm start` if the default port is occupied.

## TypeScript integration

```ts
import { GazeSession, createView } from 'gazesync'

const session = new GazeSession({}, {
  onDiagnostic: d => console.warn(d.code, d.message, d.remedy),
})
session.registerSource({
  id: 'my-model', kind: 'model', adapter: 'my-adapter-v1',
  eyes: ['left', 'right'], trackingMode: 'binocular-independent',
  eyeRatesHz: { left: 120, right: 60 }, timestampKind: 'exposure',
})
session.present({
  t: 0, view: createView({ width: 1000, height: 600,
                         contentWidth: 2000, contentHeight: 1200 }),
  surface: { id: 'screen', epoch: '1' }, timing: 'render-callback',
})
session.gaze({
  id: 'capture-1', sourceId: 'my-model', eye: 'left',
  clockId: 'session', clockEpoch: '0', timeMs: 20,
  surfaceId: 'screen', surfaceEpoch: '1',
  type: 'pog2d', space: 'normalized-viewport', point: { x: .5, y: .5 },
  valid: true, confidence: .95,
}, 40) // receipt time; it does not replace capture time
const rows = session.flush(100)
```

These are illustrative session-clock times. For a real source, register a measured
clock mapping and preserve the original capture timestamp. `flush(100)` promises
that every presentation through time 100 has already been submitted. Register
frames before advancing that watermark. A render callback is an estimate of
presentation, not measured light emission. See [the protocol](docs/PROTOCOL.md).

For Python, the equivalent API is `GazeSession`, `create_view`,
`register_source`, `present(t=..., view=..., surface=...)`, `gaze(sample, receipt)`
and `flush(time)`. See [the Python quick start](python/README.md).

Attach browser input with `attachBrowserControls` from `gazesync/browser`; the
[canvas integration](examples/canvas-integration.js) shows resize, hidden-tab
boundaries, render snapshots and teardown. Native Python hosts can feed
`ZoomController` from their GUI callbacks and record the resulting display state.
The library does not hook the OS or record unrelated applications.

## Camera and screen geometry

Use [the coordinate-frame guide](docs/COORDINATES.md) to distinguish camera, eye,
active display, viewport and content origins. It includes measured-extrinsic
conversion, named rigid-transform helpers and the full-display/cropped-viewport
contract. Ray hits retain their metric frame ID. Version 0.4.0 uses schema 2.1;
older recordings require their original implementation.

## Adapt a source and investigate warnings

Use [the adapter guide](docs/ADAPTERS.md) for timestamps, units, eye conventions,
SDK bridges and models. Register `adapter.source` before the first sample;
ingest each normalized sample separately and retain adapter warnings. The
[diagnostics guide](docs/DIAGNOSTICS.md) explains first-occurrence callbacks,
aggregated counts, rate estimates and corrective actions.

`pairEyes` / `pair_eyes` is an optional offline, chronological, one-to-one pairing
operation with a maximum skew. It never averages eyes or silently substitutes a
combined measurement. Streams with different clock identities, epochs or
calibrations remain separate. Direction-only data stay available for downstream
analysis but cannot be projected without a measured eye origin.

## Reproduce the evidence

```sh
npm run simulate -- --out artifacts/scenarios
npm run test:conformance
.venv/bin/python -m gazesync simulate --width 390 --height 844 \
  --display-hz 120 --input-hz 1000 --gaze-hz 600 --right-gaze-hz 120 \
  --mode binocular-independent
npm run release:check
npm run bench
```

The recorded validation covers 78 configurations and 107,070 observations,
including 30–240 Hz displays and 30–2,000 Hz gaze. All capture-frame selections
match the synthetic reference. This measures software consistency, not human
behavioral validity or hardware accuracy. Configuration, result data and figure
sources are included in [the implementation paper](paper/README.md).

## Citation, licensing and release

Please cite the original [GazeSync CHI EA paper](https://doi.org/10.1145/3772363.3798725)
and the implementation report when using this framework. [CITATION.bib](CITATION.bib)
contains both entries. The implementation arXiv identifier is pending and is
explicitly unset in [paper metadata](paper/metadata.json); the draft is cited by
repository URL until that identifier exists.

The code is **GPL-3.0-only**. [LICENSE](LICENSE) contains the terms;
[NOTICE](NOTICE) distinguishes manuscript rights and separately licensed SDKs.
Citation is a scholarly request, not an additional software-license restriction.
See [release preparation](docs/RELEASE.md) for npm/PyPI artifacts, trusted
publishing, the initial npm bootstrap and the disabled publication gates.

This is a standalone repository with no imports, datasets, checkpoints or Git
history from the private parent project. Contributions start with
[CONTRIBUTING.md](CONTRIBUTING.md); the audit record is in [docs/AUDIT.md](docs/AUDIT.md).
