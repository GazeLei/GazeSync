# Synchronization and coordinate contract

Version 0.4.1 emits schema 2.1. Both implementations accept the same JSON records;
Python uses snake_case method names but preserves camelCase wire fields.

## Time and presentation

Canonical units are **monotonic milliseconds**, logical viewport pixels and
metres. Sensor timestamps retain their declared clock ID and epoch. Register
`{id, epoch, sourceOriginMs, sessionOriginMs, rate, uncertaintyMs,
driftUncertaintyPpm}`; conversion is `sessionOriginMs + rate *
(timeMs - sourceOriginMs)`. Measure these parameters outside the library.
Do not guess them from arrival time. A changed fit, reconnection or clock reset
needs a new epoch; mappings are immutable within an epoch.

For a source timestamp, the session selects the latest presentation of the same
surface at or before mapped capture time. Last submission wins an equal-time tie.
There is no interpolation across frames or discontinuities. Multiple input events
may contribute to one presentation through `causeIds`; input itself is not proof
of a visual change. Use an arbitrary affine `matrix` if the host renders
additional rotation, letterboxing or other transforms.

Record each rendered animation state. Use `presentationMode: 'per-frame'` with
`expectedPresentationHz` for frame-gap diagnostics, or `change-only` when an
unchanged state persists. Render-callback timestamps must keep that provenance.
`display-feedback` is for actual host timing feedback; even that does not remove
the need to characterize scanout and sensor exposure externally.

`flush(now)` declares a presentation watermark: all frames through `now` are
already recorded, and no later insertion at or before it is allowed. Submit
frames before flushing. Normal samples are held by the greater of
`reorderWindowMs` (default 60) and `maxClockUncertaintyMs` (8). Clock bounds that
straddle a visual change mark the result `ambiguous-presentation`. Future or
over-uncertain samples are quarantined on the next flush. `flush(now, {final:true})`
(TypeScript) / `flush(now, final=True)` (Python) drains at session end.

The defaults are software policies, not calibrated acceptance limits. Late
samples can still be used offline if their frame remains available. Live
feedback must additionally reject stale capture times and stop showing an older
valid sample after newer invalid data.

## Coordinates and identity

See [coordinate frames and camera geometry](COORDINATES.md) for the full origin
table, transform direction, projection equations and a numerical example.

`point` uses `viewport`, `normalized-viewport` or `normalized-display` space.
Full-display 3D planes also require `planeSpace: 'display'` and this layout.
The last requires `surface.display` dimensions and viewport offsets in one
consistent unit system. Device pixel ratio is metadata: do not multiply CSS
coordinates by it twice. Input coordinates must already be local to the viewport.
The selected content matrix maps content to viewport; the inverse maps gaze back.
Out-of-bounds points remain flagged, never silently clipped.

A `ray3d` needs origin in metres, a nonzero direction and an explicit frame ID.
Register a display plane with `topLeft`, orthonormal `right`/`down` axes, physical
width/height and the same frame ID. Moving planes need `poseTimeMs`; the default
pose-age gate is 50 ms. Extrinsics and phone poses must be measured by the host.
No world fixation depth or vergence is inferred. `direction3d` retains a direction
for later analysis but cannot yield screen coordinates by assuming an origin.

Each observation declares `eye: left | right | combined | unknown`. Identity
includes source, clock ID/epoch, eye, representation and sample ID. One capture
can therefore produce left/right and PoG/ray observations without collision.
For repeated records of the same observation use the same ID. Duplicate detection
is bounded by the retention budget; it is not a lifetime deduplication database.
Independent eyes retain their own times and validity. Confidence may be null when
a tracker reports validity alone. A scalar confidence is source-specific, not a
universally calibrated probability.

A layout/orientation replacement changes `surface.epoch`; content replacement
changes `contentId`; recalibration should change `calibrationId` and, for changed
source metadata, `sourceId`. A sample needs its exposure-time layout context;
taking the latest layout at network delivery creates an error the core cannot
repair. A missing or inactive surface, stale pose or mismatched epoch makes an
observation unusable for content attention while retaining its raw record.

## Storage, concurrency and replay

The core is synchronous and not thread-safe. Serialize callbacks on a single
queue in Python and use one owner for each session in browser/worker code.
Defaults retain 7,200 presentations, 100,000 raw/derived records and 4,096 pending
observations. Each active surface keeps its newest state. A new surface is
rejected when the frame budget cannot retain it. Raw retention loss is explicit;
a truncated recording cannot claim complete replay. Persist chunks before loss
or choose a measured memory budget for the host.

`export()` returns finite JSON with configuration, clocks, source descriptors,
raw records, quality-tagged alignments and diagnostic aggregates. Exact replay
requires complete consecutive records and the matching schema and implementation.
Schema 1.x and 2.0 logs require their original implementation; there is no silent upgrade.
Schema 2.1 records plane extent and a frame ID with every 3D hit.
Replay checks consistency, not signatures or authenticity. Applications remain
responsible for participant consent, storage access and retention policies.


## Moving from 0.3.0 to 0.4.0

Record `planeSpace: 'display'` for a plane covering the entire active display, or
`'viewport'` for the physical stimulus subrectangle. A recorded differing display
layout now requires that explicit choice. The hit's metric frame is available as
`rayHit.frameId`. Schema 2.0 logs can be read using implementation 0.3.0; do not
change their version fields to force replay. An old ambiguous plane extent needs
a documented interpretation from the original setup before any migration, with
the original recording retained. The original 0.3.0 code is commit `3afc151`.
