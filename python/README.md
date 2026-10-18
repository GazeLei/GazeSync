# GazeSync for Python

Capture-time synchronization of desktop/mobile view events and independent or
combined eye-tracking measurements. The core uses only the Python standard
library and has the same schema 2.1 contract as the TypeScript implementation.

Install the research preview from GitHub:

```sh
python -m pip install https://github.com/GazeLei/GazeSync/releases/download/v0.5.3/gazesync-0.5.3-py3-none-any.whl
gazesync simulate --width 390 --height 844 --display-hz 120 --gaze-hz 600 --right-gaze-hz 120 --mode binocular-independent
```

For development, clone the repository and run `pip install -e ./python` from its
root. PyPI publication is deferred; GitHub is the initial distribution channel.

```python
from gazesync import GazeSession, create_view, logging_observer

session = GazeSession(on_diagnostic=logging_observer())
session.register_source({"id": "model", "kind": "model", "adapter": "my-model-v1",
                         "eyes": ["left", "right"], "trackingMode": "binocular-independent",
                         "eyeRatesHz": {"left": 120, "right": 60}, "timestampKind": "exposure"})
session.present(t=0, view=create_view(1000, 600, 2000, 1200),
                surface={"id": "screen", "epoch": "1"})
session.gaze({"id": "frame-1", "sourceId": "model", "eye": "left",
              "clockId": "session", "clockEpoch": "0", "timeMs": 20,
              "surfaceId": "screen", "surfaceEpoch": "1", "type": "pog2d",
              "space": "normalized-viewport", "point": {"x": .5, "y": .5},
              "valid": True, "confidence": .95}, received_time_ms=40)
aligned = session.flush(100)
```

`ModelAdapter`, `TobiiProAdapter`, `EyeLinkAdapter` and `PupilCoreAdapter` normalize
documented records without bundling hardware SDKs. Register `adapter.source`
before ingesting its samples. Invalid eyes remain explicit; no binocular average
is substituted for an independent eye. `pair_eyes` is an optional offline,
chronological, one-to-one pairing helper with an explicit skew bound.

Hardware drivers remain user-installed and hardware behavior is not claimed from
synthetic fixtures. Pupil scene coordinates require a registered surface or
explicit calibration. Source clocks, screen geometry and confidence provenance
must be supplied by the host. Serialize session calls through one host queue when
SDK callbacks and rendering run in different threads.

Code license: **GPL-3.0-only**. See https://github.com/GazeLei/GazeSync for both citations, diagnostic
codes, package-release instructions and the academic implementation manuscript.
The release page includes the tested wheel, source archive and SHA-256 hashes.
Downloaded wheels can also be installed from a local file path.

The default recorder retains 100,000 raw records. At high rates this is a short
buffer, not a complete long-session archive. Keep `logging_observer()` enabled,
check `recordsDropped` when exporting, and arrange host persistence before
rollover. Exact replay refuses truncated logs. Hardware callbacks and presentation
logging must use a single session owner; the package is synchronous.

## Rotate and move arbitrary content

```python
from gazesync import InteractionController, create_view, view_matrix
controller = InteractionController(create_view(800, 600, 720, 600, pan_bounds="none"))
controller.rotate(0.25, 120.0)  # clockwise radians; monotonic milliseconds
controller.move(40, 20, 140.0) # viewport logical pixels
# Apply view_matrix(controller.view) in your GUI renderer, then call session.present.
```

One content layer can contain an image, a fixed-layout text page, or a group.
`rotate_at` and `transform_at` are pure geometry helpers. `pan_bounds="none"`
permits free movement at fit; the default `"content"` bounds the rotated rectangle's
axis-aligned envelope. Home/reset restores original fit, centre and orientation.
Native hosts supply GUI callbacks; the package does not read the operating system.
See the repository's `docs/INTERACTION.md` for touch, clipping and timing details.
