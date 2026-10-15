# Reproducible 3D geometry

Open `gazesync-geometry.blend` in Blender. It contains two scenes:

- **Metric world geometry:** the reference head wire, separate eyes and gaze rays,
  active display, tracking camera and coordinate-frame gizmos.
- **Independent eye origins cutaway:** a magnified, sectioned view of both eyes.

The renderer uses the explicit synthetic reference in
`contracts/geometry-fixtures.json`: a 0.53 × 0.33 m active panel, eye origins at
(-0.032, 0, 0.6) and (0.032, 0, 0.6) m, and a tracking-camera centre at
(0.04, 0.19, 0.015) m. The two rays intersect the same known target while retaining
separate origins. Blender's mesh coordinates use single precision; the numerical
software validation remains the independent double-precision test suite.

The world convention is **Y up**, with +Z toward the viewer at the reference
pose. Inspect the named W, C and S frame objects and the measured eye-origin
objects. The two artistic viewing cameras determine the illustrations' framing;
they are distinct from the tracking camera labelled C. Eye surfaces, iris detail,
head shell and monitor housing are procedural illustrations, not anatomical or
hardware-accuracy evidence. No private meshes, textures, photographs or HDRIs are
included.

Rebuild from the repository root (tested with Blender 4.3.2):

```sh
blender --background --factory-startup --python tools/render_geometry_scene.py
.venv/bin/python tools/paper_figures.py --only geometry
```

On this macOS installation, the Blender executable is
`/Applications/Blender.app/Contents/MacOS/Blender` if it is not on PATH.
`-- --draft` after the script enables a faster preview. Use the command without
that option for the final assets; `geometry-projections.json` records the mode.

The final render uses Cycles, 128 samples, denoising and eight CPU threads.
The world image is 3600 × 2400 px; the eye detail is 2200 × 1400 px. Projected
annotation anchors are exported alongside the images, so the vector leaders and
origin markers in the paper follow the actual 3D scene. Rendered imagery is
composed at 600 dpi in PDF/SVG, with vector text and axes. PNG figure previews are
400 dpi. Render output paths in the saved scene are relative to this directory.

The source renderer is GPL-3.0-only; manuscript figure publication rights follow
the root NOTICE. The core Python/TypeScript packages do not depend on Blender.
