# Integrating models and trackers

Adapters translate records; they do not install SDKs, connect devices, calibrate
screens or measure clock offsets. All shipped adapters are tested against
synthetic fixtures, with `hardwareValidated: false`. Both languages implement the
same contract and return `{samples, warnings}`. Register the adapter's `source`
once before ingesting records. Retain both adapter warnings and session diagnostics.

| Source | Accepted contract | Preserved distinction |
| --- | --- | --- |
| Generic model | Configurable nested field paths; seconds/ms/us/ns; 2D point, direction or eye-origin ray | Model version, explicit eye, source time, confidence and coordinate frame |
| Tobii Pro | SDK gaze-data dictionary, device or system microsecond timestamp | Left/right validity, normalized display points, optional UCS ray in metres |
| EyeLink | Serialized bridge packet with `timeMs`, independent `left`/`right` gaze and pupil data | Device time in ms, missing-data sentinel, independent validity |
| Pupil Core | Gaze datum and its per-eye `base_data`; registered-surface datum or explicit scene homography | Original per-eye timestamp, scene-camera frame, right=0 / left=1; no implicit scene-to-screen map |

## Generic model example

```python
from gazesync import ModelAdapter, GazeSession
adapter = ModelAdapter({
    'sourceId': 'model-v1-left', 'eye': 'left', 'type': 'pog2d',
    'timestampUnit': 'us', 'pointUnits': 'normalized-viewport',
    'clockId': 'camera', 'clockEpoch': 'boot-1',
    'surfaceId': 'screen', 'surfaceEpoch': 'portrait-1',
    'timestampKind': 'exposure',
    'fields': {'timestamp': 'capture_us', 'point': 'prediction.xy'},
})
session = GazeSession()
session.register_source(adapter.source)
result = adapter.adapt({'id': 'capture-42', 'capture_us': 42000,
                        'prediction': {'xy': [.3, .6]}, 'confidence': .9})
# Before session.gaze: register the measured camera-clock mapping and
# record the actual presentation history. Pass each result sample with
# its separately measured monotonic receipt time.
```

TypeScript uses the same options in `new ModelAdapter(...)` from
`gazesync/adapters`. For 3D set `type: 'ray3d'`, `originUnits: 'm'` or `'mm'`,
and `frameId`. Use `direction3d` when only pitch/yaw-derived direction is known;
convert angular convention to an explicit vector in your adapter. A zero origin
must not be invented. Convert NumPy arrays to lists using `.tolist()` and GPU
tensors explicitly to CPU numeric records before calling the Python normalizer.

For camera-to-screen extrinsics, retain the original ray and measured transform
in sample metadata. Use [the coordinate-frame guide](COORDINATES.md); changing a
frame ID alone is not a coordinate conversion.

## Hardware bridges

Tobii options accept `timestamp: 'device'` (default) or `'system'`. Either clock
still needs an explicit mapping to the session. Set `includeRay: true` and
`frameId` only with measured UCS display geometry. That ray is defined from the
vendor eye origin to its reported display point; it is not an independent
measurement validating the vendor PoG. SDK boolean/1 validity is retained and
confidence remains null. See [Tobii coordinates](https://developer.tobiipro.com/commonconcepts/coordinatesystems.html)
and [the Python guide](https://www.developer.tobiipro.com/python/python-step-by-step-guide.html).

For EyeLink provide `displayPixels: {width, height}` and feed a bridge packet:
`{id, timeMs, left: {gaze: [x,y], pupilSize, valid}, right: {...}}`.
Python's `EyeLinkAdapter.packet_from_pylink(sample, sample_id)` extracts that
contract from a newly received PyLink sample. Do not poll and resubmit the same
SDK sample with new IDs. Missing sentinel values (default -32768) and nonpositive
pupil sizes mark the eye invalid. The host installs and licenses its own SDK;
start with [SR Research's Python guide](https://www.sr-research.com/support/thread-48-post-47.html).

Pupil Core eye centres are converted from mm to metres, directions stay in the
explicit world-camera frame, and reused `base_data` samples are deduplicated
within a bounded window. Base timestamps are preserved instead of replacing them
with the binocular average. Ordinary scene `norm_pos` is not a screen point.
Provide a calibrated `sceneToSurface` 3x3 homography and `mappingId`, or use
`adaptSurface` / `adapt_surface` with registered surface data. Coordinates with
bottom-left origin are flipped deliberately. Excessive mapping timestamp skew
marks the mapped sample invalid. See [Pupil's data contract](https://docs.pupil-labs.com/core/developer/)
and [coordinate terminology](https://docs.pupil-labs.com/core/terminology/).

## Add another source

Implement a small pure normalizer using the [JSON schema](../contracts/gaze.schema.json).
Declare IDs, capture-time units, eye conventions, validity, confidence semantics,
coordinate frame and measurement provenance. Preserve one record per physical
observation, including loss/blinks. Return actionable warnings for missing
geometry. Provide synthetic fixtures for units, both eyes, one-eye dropout,
clock reset, malformed input and layout transitions. Run the same serialized
fixtures through Python and TypeScript. Validate SDK behavior on actual hardware
before changing `hardwareValidated`; record SDK/firmware, clock measurements,
geometry procedure and held-out targets in the integration's own evidence.
