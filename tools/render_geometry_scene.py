"""Build a wholly procedural, metric GazeSync scene with Blender 4.3+.

Run: blender --background --factory-startup --python tools/render_geometry_scene.py -- --draft
The artistic viewing cameras are distinct from the calibrated sensor object C.
Eye shells are schematic. Ray origins and screen/camera registration use the
independent numeric fixture; no private meshes or photographic assets are used.
"""

import argparse
import json
import math
from pathlib import Path
import sys
import bpy
from mathutils import Vector, Matrix
from bpy_extras.object_utils import world_to_camera_view

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "paper/figures/assets"
OUT.mkdir(parents=True, exist_ok=True)
SCENES = ROOT / "paper/scenes"
SCENES.mkdir(exist_ok=True)
p = argparse.ArgumentParser()
p.add_argument("--draft", action="store_true")
args = p.parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])
F = json.loads((ROOT / "contracts/geometry-fixtures.json").read_text())
BLUE = (0.0, 0.11, 0.28, 1)
ORANGE = (0.55, 0.07, 0.004, 1)
GREEN = (0.015, 0.34, 0.25, 1)


def material(name, color, rough=0.35, metal=0, emission=0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    node = m.node_tree.nodes.get("Principled BSDF")
    node.inputs["Base Color"].default_value = color
    node.inputs["Roughness"].default_value = rough
    node.inputs["Metallic"].default_value = metal
    if emission:
        node.inputs["Emission Color"].default_value = color
        node.inputs["Emission Strength"].default_value = emission
    return m


def smooth(obj, mat):
    obj.data.materials.append(mat)
    for f in obj.data.polygons:
        f.use_smooth = True
    return obj


def sphere(name, center, radius, mat, scale=None):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=64, ring_count=32, radius=radius, location=center
    )
    o = bpy.context.object
    o.name = name
    if scale:
        o.scale = scale
    return smooth(o, mat)


def block(name, center, dimensions, mat, bevel=0.002):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    o = bpy.context.object
    o.name = name
    o.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(mat)
    if bevel:
        mod = o.modifiers.new("Soft manufactured edges", "BEVEL")
        mod.width = bevel
        mod.segments = 5
        o.modifiers.new("Weighted corner normals", "WEIGHTED_NORMAL")
    return o


def curve(name, points, radius, mat):
    data = bpy.data.curves.new(name, "CURVE")
    data.dimensions = "3D"
    data.resolution_u = 2
    data.bevel_depth = radius
    data.bevel_resolution = 3
    s = data.splines.new("POLY")
    s.points.add(len(points) - 1)
    for p, co in zip(s.points, points):
        p.co = (*co, 1)
    o = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(mat)
    return o


def arrow(name, start, end, radius, mat):
    a, b = Vector(start), Vector(end)
    d = b - a
    length = d.length
    tip = min(0.009, length * 0.22)
    curve(name + " shaft", [a, b - d.normalized() * tip], radius, mat)
    bpy.ops.mesh.primitive_cone_add(
        vertices=32,
        radius1=radius * 3.5,
        radius2=0,
        depth=tip,
        location=b - d.normalized() * tip / 2,
    )
    o = bpy.context.object
    o.name = name + " tip"
    o.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    smooth(o, mat)


def disk(name, center, normal, radius, mat):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=96, radius=radius, depth=0.0005, location=center
    )
    o = bpy.context.object
    o.name = name
    o.rotation_euler = Vector(normal).to_track_quat("Z", "Y").to_euler()
    smooth(o, mat)
    return o


def mesh(name, vertices, faces, mat):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    o = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(o)
    smooth(o, mat)
    return o


def eye(name, origin, target, channel, cutaway=False):
    o = Vector(origin)
    d = (Vector(target) - o).normalized()
    right = Vector((0, 1, 0)).cross(d).normalized()
    up = d.cross(right).normalized()
    q = Matrix((right, up, d)).transposed().to_quaternion()
    radius = 0.012

    def world(v):
        return o + q @ Vector(v)

    sclera = material(name + " warm porcelain sclera", (0.79, 0.82, 0.79, 1), 0.24)
    # A half-shell section reveals the true centre in the detail scene.
    vertices = []
    faces = []
    nlat = 48
    nlon = 96
    for i in range(nlat + 1):
        theta = math.pi * i / nlat
        for j in range(nlon + 1):
            phi = 2 * math.pi * j / nlon
            vertices.append(
                world(
                    (
                        radius * math.sin(theta) * math.cos(phi),
                        radius * math.sin(theta) * math.sin(phi),
                        radius * math.cos(theta),
                    )
                )
            )
    for i in range(nlat):
        for j in range(nlon):
            phi = 2 * math.pi * (j + 0.5) / nlon
            if cutaway and math.sin(phi) > 0.05:
                continue
            k = i * (nlon + 1) + j
            faces.append((k, k + 1, k + nlon + 2, k + nlon + 1))
    mesh(name + " eye shell", vertices, faces, sclera)
    iris_mats = []
    for i in range(32):
        v = 0.55 + 0.24 * math.sin(i * 2.399) + 0.09 * math.sin(i * 7.73)
        iris_mats.append(
            material(
                name + f" iris fibre {i}", (0.035 * v, 0.14 * v, 0.18 * v, 1), 0.24
            )
        )
    vertices = []
    faces = []
    indices = []
    n = 320
    nr = 7
    for i in range(nr + 1):
        r = 0.0027 + (0.0061 - 0.0027) * i / nr
        for j in range(n + 1):
            a = j * 2 * math.pi / n
            vertices.append(
                world(
                    (
                        r * math.cos(a),
                        r * math.sin(a),
                        math.sqrt(radius * radius - r * r) + 0.00009,
                    )
                )
            )
    for i in range(nr):
        for j in range(n):
            a = (j + 0.5) * 2 * math.pi / n
            if cutaway and math.sin(a) > 0.05:
                continue
            k = i * (n + 1) + j
            faces.append((k, k + 1, k + n + 2, k + n + 1))
            indices.append((j * 13 + i * 7) % 32)
    iris = mesh(name + " radial iris", vertices, faces, iris_mats[0])
    for m in iris_mats[1:]:
        iris.data.materials.append(m)
    for f, idx in zip(iris.data.polygons, indices):
        f.material_index = idx
    dark = material(name + " pupil and limbus", (0.006, 0.012, 0.018, 1), 0.1)
    # Pupil hemisphere: use a shallow disc, cut with the same section plane.
    center = world((0, 0, radius + 0.00013))
    verts = [center]
    for i in range(n + 1):
        a = i * 2 * math.pi / n
        verts.append(
            world(
                (
                    0.0027 * math.cos(a),
                    0.0027 * math.sin(a),
                    math.sqrt(radius * radius - 0.0027**2) + 0.00012,
                )
            )
        )
    faces = [
        (0, j + 1, j + 2)
        for j in range(n)
        if not cutaway or math.sin((j + 0.5) * 2 * math.pi / n) <= 0.05
    ]
    mesh(name + " pupil", verts, faces, dark)
    if cutaway:
        section = [
            world(
                (
                    radius * math.cos(i * 2 * math.pi / 160),
                    0,
                    radius * math.sin(i * 2 * math.pi / 160),
                )
            )
            for i in range(161)
        ]
        curve(name + " section rim", section, 0.00028, channel)
        sphere(name + " measured origin", o, 0.0015, channel)
        arrow(name + " short independent ray", o, o + d * 0.045, 0.00045, channel)
    return o, d


def lighting(scene):
    w = bpy.data.worlds.new(scene.name + " white studio")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.88, 0.91, 0.94, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 0.65
    scene.world = w
    for name, pos, energy, size in [
        ("Key", (0.15, 0.7, 0.45), 8, 0.75),
        ("Fill", (-0.55, 0.25, 0.75), 4, 0.6),
        ("Rim", (0.2, 0.3, -0.3), 6, 0.5),
    ]:
        data = bpy.data.lights.new(scene.name + name, "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        obj = bpy.data.objects.new(data.name, data)
        scene.collection.objects.link(obj)
        obj.location = pos
        obj.rotation_euler = (
            (Vector((0, 0, 0.3)) - obj.location).to_track_quat("-Z", "Y").to_euler()
        )


def camera(scene, name, position, target, lens=48, ortho=None):
    data = bpy.data.cameras.new(name)
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = position
    forward = (Vector(target) - obj.location).normalized()
    right = forward.cross(Vector((0, 1, 0))).normalized()
    up = right.cross(forward).normalized()
    obj.rotation_euler = Matrix((right, up, -forward)).transposed().to_euler()
    data.lens = lens
    data.clip_start = 0.001
    data.clip_end = 10
    if ortho:
        data.type = "ORTHO"
        data.ortho_scale = ortho
    scene.camera = obj
    return obj


def settings(scene, size):
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1
    scene.gravity = (0, -9.81, 0)
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24 if args.draft else 128
    scene.cycles.use_denoising = True
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 8
    scene.render.resolution_x = size[0]
    scene.render.resolution_y = size[1]
    scene.render.resolution_percentage = 50 if args.draft else 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "AgX"
    scene.render.image_settings.color_depth = "8"
    lighting(scene)


bpy.ops.wm.read_factory_settings(use_empty=True)
world = bpy.context.scene
world.name = "Metric world geometry"
settings(world, (3600, 2400))
white = material("Studio matte", (0.91, 0.93, 0.94, 1), 0.8)
metal = material("Graphite anodised frame", (0.04, 0.055, 0.065, 1), 0.27, 0.55)
blue = material("Left channel", BLUE, 0.24, emission=0.18)
orange = material("Right channel", ORANGE, 0.24, emission=0.18)
teal = material("Screen reference", GREEN, 0.35)
ink = material("Neutral frame axes", (0.09, 0.12, 0.14, 1), 0.32)
soft = material("Head reference wire", (0.23, 0.32, 0.36, 1), 0.6)
floor = block("Studio ground", (0, -0.225, 0.30), (1.6, 0.008, 1.4), white, 0.006)
# Fine sparse metric reference grid, secondary to the rays.
grid = material("Metric grid", (0.75, 0.79, 0.80, 1), 0.85)
for x in [-0.5, -0.4, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4, 0.5]:
    curve("Floor X", [(x, -0.2205, -0.12), (x, -0.2205, 0.85)], 0.00022, grid)
for z in [-0.1, 0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]:
    curve("Floor Z", [(-0.5, -0.2205, z), (0.5, -0.2205, z)], 0.00022, grid)
block("Monitor body", (0, 0, -0.009), (0.548, 0.348, 0.016), metal, 0.006)
active = material("Active display soft ivory", (0.78, 0.86, 0.83, 1), 0.6)
block("Active physical display", (0, 0, -0.001), (0.53, 0.33, 0.002), active, 0.001)
# A restrained planar grid reveals the screen's metric orientation.
screen_grid = material("Display guide grid", (0.46, 0.62, 0.57, 1), 0.7)
for i in range(1, 8):
    x = -0.265 + i * 0.53 / 8
    curve(
        "Display vertical",
        [(x, -0.165, 0.0003), (x, 0.165, 0.0003)],
        0.00026,
        screen_grid,
    )
for j in range(1, 5):
    y = -0.165 + j * 0.33 / 5
    curve(
        "Display horizontal",
        [(-0.265, y, 0.0003), (0.265, y, 0.0003)],
        0.00026,
        screen_grid,
    )
curve(
    "Active panel perimeter",
    [
        (-0.265, 0.165, 0.0005),
        (0.265, 0.165, 0.0005),
        (0.265, -0.165, 0.0005),
        (-0.265, -0.165, 0.0005),
        (-0.265, 0.165, 0.0005),
    ],
    0.001,
    teal,
)
block("Display stand", (0, -0.19, -0.04), (0.045, 0.06, 0.035), metal, 0.004)
block("Display foot", (0, -0.217, -0.015), (0.19, 0.009, 0.13), metal, 0.004)
# The calibrated sensor is geometry in the scene; it is not the artistic render camera.
C = Vector(F["cameraCenterWorld"])
block(
    "Tracking camera housing",
    C - Vector((0, 0, 0.011)),
    (0.046, 0.024, 0.020),
    metal,
    0.005,
)
lens = material("Optical lens", (0.014, 0.048, 0.075, 1), 0.10, 0.35)
disk("Lens optical centre", C, (0, 0, 1), 0.0065, lens)
curve("Camera mount", [(0.04, 0.171, -0.004), (0.04, 0.183, -0.004)], 0.003, metal)
# Reference head as a subtle wire shell, with no identifying anatomy or source mesh.
hc = Vector((0, -0.015, 0.675))
radii = (0.083, 0.112, 0.082)
for i in range(1, 12):
    th = math.pi * i / 12
    pts = [
        hc
        + Vector(
            (
                radii[0] * math.sin(th) * math.cos(j * 2 * math.pi / 120),
                radii[1] * math.cos(th),
                radii[2] * math.sin(th) * math.sin(j * 2 * math.pi / 120),
            )
        )
        for j in range(121)
    ]
    curve("Head latitude", pts, 0.00023, soft)
for i in range(20):
    ph = i * 2 * math.pi / 20
    pts = [
        hc
        + Vector(
            (
                radii[0] * math.sin(j * math.pi / 100) * math.cos(ph),
                radii[1] * math.cos(j * math.pi / 100),
                radii[2] * math.sin(j * math.pi / 100) * math.sin(ph),
            )
        )
        for j in range(101)
    ]
    curve("Head meridian", pts, 0.00023, soft)
origins = []
for case, mat in zip(F["cases"][:2], [blue, orange]):
    o, d = eye(case["eye"], case["originWorld"], case["hitWorld"], mat)
    origins.append(o)
    curve(case["eye"] + " full gaze ray", [o, Vector(case["hitWorld"])], 0.00075, mat)
    # Arrowheads are in the gaze direction, never from the camera centre.
    arrow(case["eye"] + " gaze direction", o + d * 0.15, o + d * 0.23, 0.00078, mat)
# Intersections deliberately share a known target in this fixture, without fusing the eyes.
disk("Known screen target", (0, 0, 0), (0, 0, 1), 0.0065, teal)
sphere("Screen top-left datum", F["plane"]["topLeft"], 0.0022, teal)
for name, end in [
    ("x_W", (0.075, 0, 0)),
    ("y_W", (0, 0.075, 0)),
    ("z_W", (0, 0, 0.075)),
]:
    arrow(name, (0, 0, 0), end, 0.00055, ink)
for name, end in [("u", (-0.20, 0.165, 0)), ("v", (-0.265, 0.10, 0))]:
    arrow(name, (-0.265, 0.165, 0), end, 0.00055, teal)
# Editable coordinate-frame gizmos are distinct from the rendering cameras.
for name, origin, rotation in [
    ("Frame W - display-centred reference", [0, 0, 0], [1, 0, 0, 0, 1, 0, 0, 0, 1]),
    ("Frame C - optical sensor", F["cameraCenterWorld"], [-1, 0, 0, 0, -1, 0, 0, 0, 1]),
    (
        "Frame S - active display origin",
        F["plane"]["topLeft"],
        [1, 0, 0, 0, -1, 0, 0, 0, -1],
    ),
]:
    obj = bpy.data.objects.new(name, None)
    world.collection.objects.link(obj)
    obj.empty_display_type = "ARROWS"
    obj.empty_display_size = 0.05
    obj.location = origin
    obj.rotation_euler = Matrix(
        [rotation[0:3], rotation[3:6], rotation[6:9]]
    ).to_euler()
    obj["units"] = "metres"
    obj["definition"] = (
        "Named calibration frame; renderer cameras are illustrative viewpoints."
    )
for case in F["cases"][:2]:
    obj = bpy.data.objects.new(case["eye"] + " measured eye origin", None)
    world.collection.objects.link(obj)
    obj.location = case["originWorld"]
    obj.empty_display_type = "SPHERE"
    obj.empty_display_size = 0.002
    obj["frameId"] = "display-world"
    obj["eye"] = case["eye"]
cam = camera(
    world, "Illustrative world view", (0.72, 0.34, 0.45), (0, -0.015, 0.30), lens=35
)
world.view_settings.look = "AgX - Medium High Contrast"
bpy.context.view_layer.update()
# Fit the whole head and monitor; the floor intentionally extends beyond the image.
critical = [
    ob
    for ob in world.objects
    if ob.type in {"MESH", "CURVE"}
    and not ob.name.startswith(("Studio ground", "Floor "))
]
for _ in range(30):
    uv = [
        world_to_camera_view(world, cam, ob.matrix_world @ Vector(v))
        for ob in critical
        for v in ob.bound_box
    ]
    if all(0.055 <= p.x <= 0.945 and 0.055 <= p.y <= 0.945 for p in uv):
        break
    cam.data.lens *= 0.94

# Detail scene retains metric eye centres and separation; shells are sectioned to show their origins.
detail = bpy.data.scenes.new("Independent eye origins cutaway")
bpy.context.window.scene = detail
settings(detail, (2200, 1400))
for case, mat in zip(F["cases"][:2], [blue, orange]):
    eye(case["eye"] + " section", case["originWorld"], case["hitWorld"], mat, True)
dcam = camera(
    detail,
    "Illustrative eye detail",
    (0.08, 0.045, 0.475),
    (0, 0, 0.596),
    lens=52,
    ortho=0.106,
)

scenes = [(world, "geometry-world"), (detail, "geometry-eyes")]
projections = {}
for scene, name in scenes:
    bpy.context.window.scene = scene
    scene.render.filepath = str(OUT / (name + ".png"))
    bpy.ops.render.render(write_still=True)
    coords = {
        "O_L": F["cases"][0]["originWorld"],
        "O_R": F["cases"][1]["originWorld"],
        "C": list(C),
        "P": F["plane"]["topLeft"],
        "O_W": [0, 0, 0],
        "x_W": [0.075, 0, 0],
        "y_W": [0, 0.075, 0],
        "z_W": [0, 0, 0.075],
    }
    projections[name] = {
        key: list(world_to_camera_view(scene, scene.camera, Vector(value)))
        for key, value in coords.items()
    }
    projections[name]["width"] = (
        scene.render.resolution_x * scene.render.resolution_percentage // 100
    )
    projections[name]["height"] = (
        scene.render.resolution_y * scene.render.resolution_percentage // 100
    )
    scene.render.filepath = "//../figures/assets/" + name + ".png"
(OUT / "geometry-projections.json").write_text(
    json.dumps(
        {
            "blenderVersion": bpy.app.version_string,
            "draft": args.draft,
            "projectionConvention": "image x/y in [0,1], origin bottom-left; depth is camera-space view depth",
            "originsMeters": {c["eye"]: c["originWorld"] for c in F["cases"][:2]},
            "cameraCenterWorldMeters": F["cameraCenterWorld"],
            "separationMeters": (origins[1] - origins[0]).length,
            "views": projections,
        },
        indent=2,
    )
    + "\n"
)
bpy.context.window.scene = world
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == "VIEW_3D":
            area.spaces.active.region_3d.view_perspective = "CAMERA"
assert abs((origins[1] - origins[0]).length - 0.064) < 1e-6
bpy.ops.wm.save_as_mainfile(
    filepath=str(SCENES / "gazesync-geometry.blend"), compress=True
)
print("GazeSync procedural 3D scene, images and projected annotation anchors saved.")
