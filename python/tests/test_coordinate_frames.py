"""Analytic camera/display oracles; no simulator-generated expected coordinates."""

import json
import math
from pathlib import Path
import pytest
from gazesync import (
    GazeSession,
    create_view,
    project_ray,
    transform_ray,
    transform_plane,
    transform_point_3d,
    transform_direction_3d,
    invert_rigid_transform,
    validate_rigid_transform,
    replay,
    TobiiProAdapter,
)

F = json.loads((Path(__file__).parent / "fixtures/geometry-fixtures.json").read_text())
BASE = dict(
    id="capture",
    sourceId="fixture",
    eye="left",
    clockId="session",
    clockEpoch="0",
    timeMs=20,
    surfaceId="screen",
    surfaceEpoch="1",
    valid=True,
    confidence=1,
)


def frame(space="display"):
    surface = dict(
        id="screen",
        epoch="1",
        plane=F["plane"],
        display=F["display"],
        devicePixelRatio=2,
    )
    if space is not None:
        surface["planeSpace"] = space
    return dict(t=0, view=create_view(1000, 600, 2000, 1200), surface=surface)


@pytest.mark.parametrize("case", F["cases"], ids=lambda c: c["name"])
def test_camera_origin_eye_origin_and_projection(case):
    inverse = invert_rigid_transform(F["worldToCamera"])
    assert inverse["translation"] == pytest.approx(F["cameraCenterWorld"])
    assert transform_point_3d(
        F["cameraCenterWorld"], F["worldToCamera"]
    ) == pytest.approx([0, 0, 0])
    ray = transform_ray(case["rayCamera"], inverse)
    assert ray["origin"] == pytest.approx(case["originWorld"])
    assert ray["direction"] == pytest.approx(case["directionWorld"])
    plane_camera = transform_plane(F["plane"], F["worldToCamera"])
    a = project_ray(ray, F["plane"], 1920, 1080)
    b = project_ray(case["rayCamera"], plane_camera, 1920, 1080)
    assert a["hit"] == pytest.approx(case["hitWorld"], abs=1e-12)
    assert a["point"] == pytest.approx(
        {
            k: v * (1920 if k == "x" else 1080)
            for k, v in case["normalizedDisplay"].items()
        },
        abs=1e-9,
    )
    assert a["point"] == pytest.approx(b["point"], abs=1e-9)
    assert a["distanceMeters"] == pytest.approx(math.hypot(*case["directionWorld"]))
    s = GazeSession()
    s.present(**frame())
    s.gaze(
        {**BASE, "id": case["name"], "eye": case["eye"], "type": "ray3d", "ray": ray},
        30,
    )
    s.gaze(
        {
            **BASE,
            "id": case["name"],
            "eye": case["eye"],
            "type": "pog2d",
            "space": "normalized-display",
            "point": case["normalizedDisplay"],
        },
        30,
    )
    rows = s.flush(100)
    for row in rows:
        assert row["viewportPoint"] == pytest.approx(case["viewportPoint"], abs=1e-9)
    assert rows[0]["rayHit"]["frameId"] == "display-world"
    assert replay(s.export()).aligned == rows


def test_camera_centre_cannot_replace_a_measured_eye_origin():
    c = F["cases"][0]
    plane = transform_plane(F["plane"], F["worldToCamera"])
    wrong = project_ray({**c["rayCamera"], "origin": [0, 0, 0]}, plane, 1920, 1080)[
        "point"
    ]
    assert math.hypot(wrong["x"] - 960, wrong["y"] - 540) > 500


def test_quarter_turn_and_untranslated_direction():
    q = F["quarterTurn"]
    ray = transform_ray(q["ray"], q["transform"])
    assert ray["origin"] == pytest.approx(q["expectedOrigin"])
    assert ray["direction"] == pytest.approx(q["expectedDirection"])
    assert transform_direction_3d([0, 0, 2], q["transform"]) == pytest.approx([2, 0, 0])
    for scale in [1e-200, 1, 1e200]:
        h = project_ray(
            {**ray, "direction": [v * scale for v in ray["direction"]]},
            q["plane"],
            1000,
            1000,
        )
        assert h["hit"] == pytest.approx(q["expectedHit"])
        assert h["point"] == pytest.approx(q["expectedPoint"])
        assert h["distanceMeters"] == pytest.approx(q["expectedDistance"])


def test_invalid_extrinsics_and_dynamic_plane_provenance():
    for rotation in [
        [-1, 0, 0, 0, 1, 0, 0, 0, 1],
        [1, 0.1, 0, 0, 1, 0, 0, 0, 1],
        [2, 0, 0, 0, 1, 0, 0, 0, 1],
    ]:
        with pytest.raises(ValueError, match="rotation"):
            validate_rigid_transform({**F["worldToCamera"], "rotation": rotation})
    with pytest.raises(ValueError, match="frameId"):
        transform_ray(F["cases"][0]["rayCamera"], F["worldToCamera"])
    plane = transform_plane(F["plane"], {**F["worldToCamera"], "static": False})
    assert not plane["static"]
    f = frame()
    f["surface"]["plane"] = plane
    with pytest.raises(ValueError, match="poseTimeMs"):
        GazeSession().present(**f)


def test_ambiguous_plane_extent_rejected_and_viewport_subrectangle_supported():
    s = GazeSession()
    with pytest.raises(ValueError, match="planeSpace"):
        s.present(**frame(None))
    assert not s.export()["records"]
    f = frame("viewport")
    f["surface"]["plane"] = {
        **F["plane"],
        "topLeft": [-0.265 + 0.53 * 100 / 1920, 0.165 - 0.33 * 80 / 1080, 0],
        "widthMeters": 0.53 * 1000 / 1920,
        "heightMeters": 0.33 * 600 / 1080,
    }
    s.present(**f)
    ray = transform_ray(
        F["cases"][0]["rayCamera"], invert_rigid_transform(F["worldToCamera"])
    )
    s.gaze({**BASE, "type": "ray3d", "ray": ray}, 30)
    assert s.flush(100)[0]["viewportPoint"] == pytest.approx({"x": 860, "y": 460})
    f = frame()
    del f["surface"]["display"]
    with pytest.raises(ValueError, match="display layout"):
        GazeSession().present(**f)


def test_plane_extent_change_is_a_clock_uncertainty_boundary():
    s = GazeSession()
    s.clocks.register(
        dict(
            id="sensor", epoch="a", sourceOriginMs=0, sessionOriginMs=0, uncertaintyMs=2
        )
    )
    s.present(**frame("viewport"))
    f = frame()
    f["t"] = 100
    s.present(**f)
    ray = transform_ray(
        F["cases"][0]["rayCamera"], invert_rigid_transform(F["worldToCamera"])
    )
    s.gaze(
        {
            **BASE,
            "clockId": "sensor",
            "clockEpoch": "a",
            "timeMs": 99,
            "type": "ray3d",
            "ray": ray,
        },
        130,
    )
    assert "ambiguous-presentation" in s.flush(200)[0]["flags"]


def test_physical_display_bounds_remain_visible_when_window_extends_offscreen():
    s = GazeSession()
    f = frame()
    f["view"] = create_view(3000, 2000, 3000, 2000)
    f["surface"]["display"] = {**F["display"], "left": 0, "top": 0}
    s.present(**f)
    s.gaze(
        {
            **BASE,
            "type": "ray3d",
            "ray": {
                "frameId": "display-world",
                "origin": [0, 0, 0.6],
                "direction": [0.3975, 0, -0.6],
            },
        },
        30,
    )
    s.gaze(
        {
            **BASE,
            "type": "pog2d",
            "space": "normalized-display",
            "point": {"x": 1.25, "y": 0.5},
        },
        30,
    )
    s.gaze(
        {
            **BASE,
            "id": "viewport-source",
            "type": "pog2d",
            "space": "normalized-viewport",
            "point": {"x": 0.8, "y": 0.27},
        },
        30,
    )
    for row in s.flush(100):
        assert (
            "off-display" in row["flags"]
            and "off-viewport" not in row["flags"]
            and not row["usable"]
        )


def test_tobii_ucs_is_not_a_camera_or_display_centre_origin():
    s = GazeSession()
    a = TobiiProAdapter(
        dict(
            sourceId="fixture",
            clockId="session",
            clockEpoch="0",
            surfaceId="screen",
            surfaceEpoch="1",
            includeRay=True,
            frameId="tobii-ucs",
        )
    )
    s.register_source(a.source)
    f = frame()
    f["surface"]["plane"] = {
        **F["plane"],
        "frameId": "tobii-ucs",
        "topLeft": [-0.265, 0.35, 0.02],
    }
    s.present(**f)
    packet = {"device_time_stamp": 20000}
    for eye, x in [("left", -32), ("right", 32)]:
        packet.update(
            {
                f"{eye}_gaze_point_on_display_area": [0.5, 0.5],
                f"{eye}_gaze_point_validity": True,
                f"{eye}_gaze_origin_validity": True,
                f"{eye}_gaze_origin_in_user_coordinate_system": [x, 170, 650],
                f"{eye}_gaze_point_in_user_coordinate_system": [0, 185, 20],
            }
        )
    for row in a.adapt(packet)["samples"]:
        s.gaze(row, 30)
    for row in s.flush(100):
        assert row["viewportPoint"] == pytest.approx({"x": 860, "y": 460})
        if row["type"] == "ray3d":
            assert row["rayHit"]["pointMeters"] == pytest.approx([0, 0.185, 0.02])


def test_orientation_retains_measured_physical_panel_size():
    from gazesync.experiments import generate_experiment

    c = dict(
        width=390,
        height=844,
        displayHz=60,
        inputHz=120,
        gazeHz=120,
        mode="monocular-left",
        rotateMidway=True,
        physicalWidthMeters=0.072,
        physicalHeightMeters=0.156,
    )
    e = generate_experiment(c)
    frames = [x["payload"] for x in e["events"] if x["type"] == "frame"]
    assert frames[0]["surface"]["plane"]["widthMeters"] == 0.072
    assert frames[-1]["surface"]["plane"]["widthMeters"] == 0.156
    assert frames[-1]["surface"]["plane"]["heightMeters"] == 0.072
    for invalid in (0, None, math.nan, False):
        with pytest.raises(ValueError, match="physicalWidthMeters"):
            generate_experiment({**c, "physicalWidthMeters": invalid})


def test_edge_roundoff_is_not_clipped_or_mistaken_for_an_offscreen_measurement():
    s = GazeSession()
    f = frame()
    f["view"] = create_view(1920, 1080, 1920, 1080)
    f["surface"]["display"] = dict(width=1920, height=1080, left=0, top=0)
    s.present(**f)
    for name, x in [("roundoff", -math.ulp(1.0)), ("outside", -1e-7)]:
        s.gaze(
            {
                **BASE,
                "id": name,
                "type": "pog2d",
                "space": "normalized-display",
                "point": {"x": x, "y": 0.5},
            },
            30,
        )
    rows = s.flush(100)
    assert rows[0]["usable"] and rows[0]["viewportPoint"]["x"] < 0
    assert "off-display" in rows[1]["flags"] and not rows[1]["usable"]


def test_arbitrary_rotations_preserve_hit_and_roundtrip_points_and_directions():
    for i in range(100):
        a, b = i * 0.137, i * 0.091
        ca, sa, cb, sb = math.cos(a), math.sin(a), math.cos(b), math.sin(b)
        t = dict(
            fromFrameId="display-world",
            toFrameId="audit-frame",
            rotation=[cb * ca, -cb * sa, sb, sa, ca, 0, -sb * ca, sb * sa, cb],
            translation=[0.3 * math.sin(i), -0.2 * math.cos(i), 0.1 + i * 0.001],
            static=True,
        )
        ray = dict(
            frameId="display-world", origin=[-0.032, 0, 0.6], direction=[0.032, 0, -0.6]
        )
        moved = transform_ray(ray, t)
        p = transform_plane(F["plane"], t)
        hit = project_ray(moved, p, 1920, 1080)
        assert hit["point"] == pytest.approx({"x": 960, "y": 540}, abs=1e-9)
        assert transform_point_3d(
            hit["hit"], invert_rigid_transform(t)
        ) == pytest.approx([0, 0, 0], abs=1e-9)
        restored = transform_ray(moved, invert_rigid_transform(t))
        assert restored["origin"] == pytest.approx(ray["origin"], abs=1e-9)
        assert restored["direction"] == pytest.approx(ray["direction"], abs=1e-9)
