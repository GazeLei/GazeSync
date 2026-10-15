# Coordinate frames, camera extrinsics and display projection

Every 3D vector needs a named frame and declared units. `frameId` is an identity
check, not a calibration: assigning the same string to unrelated coordinates
cannot make them geometrically compatible. The core accepts right-handed metric
frames; the camera convention below is an explicit integration example.

## Origins that must remain distinct

| Frame / quantity | Origin and axes | Units |
| --- | --- | --- |
| Camera optical `C` | Optical centre; example convention +x image right, +y image down, +z camera forward, before preview mirroring | Metres |
| Eye ray origin `O_L`, `O_R` | Measured eye centre expressed **in C or another declared frame**; generally not `[0,0,0]` | Metres |
| Optional eye-local `E_L`, `E_R` | Its own eye centre; a zero origin is valid here only with a measured eye-to-camera/world transform | Metres |
| Reference `W` | Chosen and documented by the host; examples use the active display's centre at the reference pose | Metres |
| Screen-local `S` | Top-left of the active illuminated rectangle, excluding bezel; +x right, +y down, +z = right × down | Metres |
| Display `D` | Top-left of the complete active display in its current orientation | Logical pixels |
| Viewport `V` | Top-left of the application stimulus region; at `(left,top)` in D | Logical pixels |
| Content `I` | Intrinsic content origin before the host's affine rendering transform | Content units |
| Camera image | Pixel coordinate origin specified by the calibration/model; the principal point is an intrinsic parameter, not the 3D camera centre | Image pixels |

`left` and `right` refer to the tracked person's anatomical eyes, not image-side
position. A mirrored selfie preview does not exchange eye IDs. Pupil Core eye
IDs and eye-camera orientations must follow its SDK; raw pupil coordinates are
not already in the scene-camera frame. Tobii UCS has its origin at the tracker
front-surface centre and uses user-right/up/toward-user axes in mm. It is not a
camera-centred or display-centred frame. The adapter converts mm to m and retains
that frame identity. See [Tobii's definition](https://developer.tobiipro.com/commonconcepts/coordinatesystems.html)
and [Pupil's coordinate definitions](https://docs.pupil-labs.com/core/terminology/).

## Rigid transforms and the camera position

`RigidTransform` contains `fromFrameId`, `toFrameId`, a **row-major** nine-element
`rotation`, and a three-element `translation` in metres. Vectors are column
vectors, so the contract is `p_target = R p_source + t`. Translation is the source
origin expressed in the target frame. The helpers reject reflections, scaling,
shear, non-finite values and mismatched frame IDs.

For a ray, `O_target = R O_source + t` but `D_target = R D_source`. A direction
has homogeneous coordinate zero: never add translation or a display offset to
it. Inversion gives `R_inverse = transpose(R)` and `t_inverse = -transpose(R)t`.
In particular, OpenCV's world-to-camera extrinsics describe `p_C = R_CW p_W +
t_CW`; the camera's world position is **`C_W = -transpose(R_CW)t_CW`**, not `t_CW`.
See [OpenCV calibration documentation](https://docs.opencv.org/4.x/d9/d0c/group__calib3d.html).

```ts
import { invertRigidTransform, transformRay, type RigidTransform } from 'gazesync'

// ANALYTIC FIXTURE ONLY: replace this with measured extrinsics, in metres.
const worldToCamera: RigidTransform = {
  fromFrameId: 'display-world', toFrameId: 'camera-optical',
  rotation: [-1,0,0, 0,-1,0, 0,0,1],
  translation: [.04,.19,-.015], static: true,
}
const cameraToWorld = invertRigidTransform(worldToCamera)
const originalRay = {
  frameId: 'camera-optical',
  origin: [.072,.19,.585] as [number,number,number], // measured left eye in C
  direction: [-.032,0,-.6] as [number,number,number],
}
const ray = transformRay(originalRay, cameraToWorld)
// ray.origin = [-.032,0,.6]; ray.direction = [.032,0,-.6]
// Retain {originalRay, transform:cameraToWorld, calibrationId, poseTimeMs}
// in sample.metadata when ingesting a transformed observation.
```

Python exports `invert_rigid_transform`, `transform_ray`, `transform_plane`,
`transform_point_3d` and `transform_direction_3d` with the same wire keys.
The camera can see the eye at positive camera Z while that eye's gaze points
back toward the display with a **negative direction Z**. This is valid. A ray's
origin is not replaced with the camera centre. Model yaw/pitch signs and output
frames are model-specific; convert them according to that model's documented
convention before using these helpers.

`transform_plane` moves the top-left point with R and t, and moves right/down
axes with R alone. It only preserves `static:true` if both the source plane and
transform explicitly declare themselves static. Otherwise the host supplies
`surface.poseTimeMs`. Dynamic ray extrinsics and screen pose must refer to the
capture time; the library does not estimate missing motion or calibrate R/t.

If a camera pose is estimated from a marker board, its origin may be the marker
centre, not the active panel corner. Survey the fixed marker-to-screen transform:
`T_CS = T_CM * T_MS`. Alternatively apply the two named transforms sequentially.
Fit a rigid pose to known rectangular geometry and supply measured active-panel
dimensions; noisy corner differences should not be treated as exactly orthogonal
axes. For an eye-local ray, `O_C = t_CE` and `D_C = R_CE D_E` independently for each
eye. Retain the measured eye-to-camera registration, not a shared zero origin.

## Intersection and finite screen bounds

Let P be the plane's top-left in the ray's frame, u/v its unit right/down axes,
and w/h its physical dimensions. Normalize the nonzero gaze direction d, then:

```
n = u × v
lambda = dot(P - O, n) / dot(d, n)
Q = O + lambda * d
alpha = dot(Q - P, u) / w
beta  = dot(Q - P, v) / h
```

The intersection operation is two-sided. For an opaque panel, a declared
front-facing right/down basis additionally places the eye in front when
`dot(O-P, u×v) < 0`. The host must establish front-facing/occlusion visibility
before interpreting an aligned hit as attention to visible content; an inactive
surface is recorded through `surface.active:false`. Geometry alone does not
establish an unobstructed line of sight.

The crossing must have `lambda > 0`. Reversing n changes both numerator and
denominator, leaving lambda unchanged; a negative denominator alone is not an
error. `abs(dot(d,n)) < 1e-9` is treated as parallel. The returned distance is the
Euclidean distance from the **eye**, not camera depth. Plane axes and proper
rotations are validated to `1e-6` numerical orthonormality tolerance; this is not
a physical calibration tolerance. The active rectangle requires alpha/beta in
[0,1]. The low-level `projectRay` / `project_ray` retains outside intersections;
the session applies visibility flags without clipping them.

For user-right/up/toward-user W, u=(1,0,0), v=(0,-1,0), hence n=(0,0,-1).
The screen-local right/down basis is right-handed with +z behind the front face.
Do not flip the ray to force a desired normal sign.

## Full display versus a cropped viewport

Declare `surface.planeSpace`:

- **`display`**: P and physical width/height describe the full active display.
  Supply `surface.display = {width, height, left, top}` in logical pixels.
  The result is `p_V = (alpha*display.width-left, beta*display.height-top)`.
- **`viewport`**: P and physical dimensions describe exactly the stimulus
  viewport's physical subrectangle. The result is
  `p_V = (alpha*view.width, beta*view.height)`. Do not subtract the offset again.

These offset formulas assume parallel viewport/display axes. Resolve arbitrary
outer-container transforms in the host before supplying viewport coordinates.
A full-display plane and viewport dimensions are interchangeable only when both
rectangles coincide. Omitted `planeSpace` retains viewport semantics for an
otherwise unambiguous setup; a differing recorded display layout requires an
explicit choice. Invalid metadata is rejected before the frame mutates state.
The low-level `projectRay(ray, plane, width, height)` maps to the plane rectangle
of the given logical dimensions; it does not know or apply viewport offsets.

For a cropped viewport with offset l/t and size Wv/Hv within Wd/Hd, a
viewport-specific physical plane can be constructed from a full-display plane:

```
P_V = P_D + u * (l/Wd) * w_D + v * (t/Hd) * h_D
w_V = (Wv/Wd) * w_D
h_V = (Hv/Hd) * h_D
```

With a 0.53 × 0.33 m panel, 1920 × 1080 logical display, viewport 1000 × 600 at
(100,80), and a hit at the panel centre, D=(960,540) and **V=(860,460)**. Directly
scaling the full plane to the viewport would incorrectly give (500,300). The
fixture checks both eyes, both coordinate frames and both representations.
If `M = [.5,0,0,.5,0,0]` maps content to viewport, content gaze is (1720,920).

UI coordinates use continuous rectangle edges: (0,0) to (W,H), not integer
array indices 0 to W-1. Convert pixel-centre/index conventions once in the source
adapter when necessary; do not add a half-pixel offset to every vendor PoG.
`devicePixelRatio` is metadata. Normalize device-pixel input by its actual device
resolution first, then map to logical coordinates; do not apply DPR twice.
Small boundary residuals are classified using 64 machine epsilons scaled by the
coordinate extent, while the raw coordinates are preserved. Genuine off-display
hits remain unusable even if an oversized window contains them.

## Intrinsics, cropping and preview mirroring

K maps camera-frame geometry to camera-image pixels; it does not map a measured
gaze ray to a display plane. A pupil image pixel back-projects to a camera viewing
ray, not automatically to the person's visual axis. An eye model and calibration
must supply the gaze origin/direction. If camera images are resized or cropped,
update the calibrated image mapping consistently (for an affine image transform
H, K' = H K) and handle lens distortion in the calibrated image convention.
Undo a preview mirror or record it explicitly; a single-axis mirror is not a
proper 3D rotation. Display zoom belongs in M, not in camera intrinsics.

On orientation change, update layout epoch, viewport dimensions, the measured
plane pose and the relevant camera extrinsics. Rotating a physical panel swaps
its width and height; it must not change device size based on new logical pixels.
The nine-second interaction lab uses declared synthetic square-pixel panels
(72 mm wide at 390 logical pixels for a phone; 530 mm at 1080 logical pixels for
a desktop). Its desktop resize crops a top-left-anchored viewport while the full
panel and metric pixel pitch stay fixed. The phone swaps the same panel on
rotation. The demo's `simulated-world` origin is a display-centred reference at
rest; its moving eye origin is not a camera-centre setting. The separate analytic
fixture supplies an explicit camera pose to test that conversion.
The rate-matrix simulation accepts `physicalWidthMeters` and `physicalHeightMeters` (Python
CLI: `--physical-width-m`, `--physical-height-m`). Defaults are synthetic
assumptions recorded in each experiment, never device measurements.

Before collecting research data, measure a set of display-corner/centre targets
independent of calibration, check per-eye residuals and direction signs, and
retain calibration ID, units, original ray and transform provenance. Synthetic
round trips verify equations; they cannot certify an unmeasured real setup.
