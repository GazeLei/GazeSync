# Move, zoom and rotate content

Use one intrinsic coordinate system for an image, text page, SVG, video, or a
fixed-layout group. The viewport clips this content. Transforming the content
changes its matrix, not its identity or the calibrated physical display plane.

## Browser: start with a content surface

```html
<div id="frame" style="width:100%;height:500px;padding:0;border:1px solid #ccd">
  <article id="content"><h1>My stimulus</h1><p>Text or images here.</p></article>
</div>
```

```ts
import { createGazeSurface } from 'gazesync/browser'
const frame = document.getElementById('frame')!
const content = document.getElementById('content')!

const app = createGazeSurface(frame, content, {
  contentWidth: 720, contentHeight: 600,
  contentId: 'stimulus-01', panBounds: 'none',
  onAligned: rows => saveOrInspect(rows),
})
app.controller.rotate(Math.PI / 12, performance.now()) // clockwise 15 degrees
app.controller.move(40, 20, performance.now())          // right 40, down 20 logical px
app.controller.reset(performance.now())
```

After building from source, open `/examples/content-surface.html` on the local
server for a complete runnable version with buttons, text, an image and export.
During development import from `./dist/browser.js`; the package import above is
for a locally installed package. Public registry publication is still disabled.

The helper owns pointer/keyboard input, CSS transforms, clipping, resize,
hidden-tab boundaries, rendered-state records, flushing and teardown. It fixes
the content's outer size to the declared intrinsic dimensions. Layout inside the
content must stay stable during a recording; reflow or replacement requires a
new content identity and a new host-managed presentation history. It does not
identify independently moving children or infer occlusion between objects.
Use the lower-level `GazeSession.present({matrix, ...})` for custom scene graphs.

The content must be a direct child. The frame must have zero padding and a
positive initial size. Put padding on an outer wrapper. Borders and axis-aligned
CSS scaling are supported; rotated, skewed or perspective-transformed **frames
or ancestors** need explicit host coordinate conversion. Rotate the content
using the controller. Existing content CSS animation and transition are disabled
while attached so the recorded matrix matches the applied style. `dispose()`
removes listeners, restores the styles it owns and returns the recording.

## Inputs

| Action | Desktop / pen | Touch |
| --- | --- | --- |
| Move | Drag; arrow keys move content in the named direction | One finger |
| Zoom | Wheel at pointer; `+` / `-` | Pinch |
| Rotate | `[` / `]` by 15 degrees; `setMode('rotate')` then drag around frame centre | Two-finger twist, combined with pinch and midpoint movement |
| Select and zoom | Shift-drag or `setMode('box')` | Host can call `zoomToBox` |
| Restore | Home, Ctrl/Cmd+0, or Reset button | Host Reset button; double tap toggles zoom/restore |
| Cancel contacts | Escape, lost capture, blur | Contact cancellation or interruption |

`enableRotation: false` preserves pinch-and-pan without twist. Mode changes rebase
active contacts. Near-coincident fingers suspend rotation and scale until a new
stable baseline is available. Lifting one finger rebases to pan without jumping.
A viewport-centred rotate drag has a dead zone of `dragThreshold` logical pixels
at its centre. Touch always uses two fingers for rotation, regardless of mode.

`panBounds: 'none'` allows movement even at fit scale; blank space is expected.
`'content'` clamps the **axis-aligned bounding box of the rotated content** and
centres axes on which that box is smaller than the viewport. It does not guarantee
that a rotated rectangle covers every viewport corner. The pure controller keeps
`'content'` as its default; `createGazeSurface` defaults to `'none'`. Change this
with `controller.setPanBounds('none', timeMs)`.

Reset restores zero rotation, the original fit scale and the centred content,
while retaining the chosen movement policy. Relative zoom is always measured
against the original unrotated fit, so rotating does not redefine 1× zoom.

## Gaze input

Use a distinct `surfaceId` for each helper when sharing a session.
The helper never invents eye samples. Register sources and measured external
clock mappings through `app.session`. Save `app.captureContext` **at exposure**,
and keep it with the eventual inference or hardware record:

```ts
const context = app.captureContext // when the frame / eye image is captured
// Later, after inference or tracker delivery:
app.pushGaze({ ...normalizedSample, ...context }, performance.now())
```

The content and viewport coordinates use logical pixels. Source IDs, anatomical
eye identity, capture timestamps, validity and source clocks follow the
[adapter contract](ADAPTERS.md). For 3D rays, pass a measured geometry callback:
`getGeometry: () => ({plane: measuredPlane, planeSpace: 'viewport', poseTimeMs: measuredPoseTimeMs})`.
The callback must return the actual calibrated plane and its actual pose timestamp;
do not substitute callback time for a stale pose. A static calibrated plane uses
`plane.static = true`. See [coordinate conventions](COORDINATES.md).

Each frame saves the same six coefficients applied to the content. Reconstruct
using the presentation selected by capture time, even if the content has rotated
or moved again before delivery. Border and outside-content flags remain visible;
looking at exposed blank space is not silently assigned to the nearest text or
image edge. Render callbacks estimate presentation and do not measure photons.

## Python / native hosts

```python
from gazesync import InteractionController, GazeSession, create_view, view_matrix

session = GazeSession()
controller = InteractionController(
    create_view(800, 600, 720, 600, pan_bounds='none'),
    on_input=session.input,
)
controller.rotate(0.25, 120.0)     # radians and monotonic milliseconds
controller.move(40, 20, 140.0)
# In the GUI render callback, draw using view_matrix(controller.view), then:
session.present(t=150.0, view=controller.view, contentId='stimulus-01',
                surface={'id': 'window', 'epoch': '1'})
```

`InteractionController` is an alias of `ZoomController`; existing integrations
continue to work. Helpers are `rotateAt` / `rotate_at`, `panBy` / `pan_by`, and
`transformAt` / `transform_at`. They return a new view. The combined transform
applies scale, rotation and midpoint movement before constraining once, avoiding
sequential clamping that would move the intended pinch pivot.

For custom Canvas drawing, use `ctx.transform(...viewMatrix(view))` inside a
saved context (after the device-pixel-ratio transform). For CSS use
`transform-origin: 0 0` and `matrix(a,b,c,d,e,f)`. Do not apply a second CSS-centred
origin or rotate the physical screen plane when only the content rotates.


## Reproduce the content-motion checks

```sh
npm run test:conformance   # 78 baseline and 8 additional content-motion cases
python -m gazesync simulate --width 390 --height 844 --content-motion \
  --display-hz 90 --input-hz 125 --gaze-hz 600 --right-gaze-hz 120
```

The eight-case report is `artifacts/validation/interaction-conformance.json`.
It compares both languages on identical rendered events; independent Python
simulation tests also exercise its own generator.
