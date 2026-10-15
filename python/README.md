# GazeSync for Python

Capture-time synchronization of desktop/mobile view events and independent or
combined eye-tracking measurements. The core uses only the Python standard
library and has the same schema 2.1 contract as the TypeScript implementation.

```sh
pip install -e ./python
gazesync simulate --width 390 --height 844 --display-hz 120 --gaze-hz 600 --right-gaze-hz 120 --mode binocular-independent
```

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
This development version has not yet been published to PyPI.
