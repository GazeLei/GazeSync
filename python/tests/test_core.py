import json
import math
import pytest
from gazesync import (
    GazeSession,
    ClockRegistry,
    create_view,
    zoom_at,
    invert_affine,
    apply_affine,
    replay,
    pair_eyes,
    ZoomController,
)
from gazesync.experiments import (
    generate_experiment,
    execute_experiment,
    summarize_experiment,
)


def sample(eye, t, **extra):
    return dict(
        id=str(t),
        sourceId="device",
        eye=eye,
        clockId="session",
        clockEpoch="0",
        timeMs=t,
        surfaceId="screen",
        surfaceEpoch="1",
        type="pog2d",
        space="normalized-viewport",
        point={"x": 0.5, "y": 0.5},
        confidence=None,
        valid=True,
        **extra,
    )


def setup():
    s = GazeSession()
    s.present(
        t=0,
        view=create_view(800, 600, 1600, 1200),
        surface={"id": "screen", "epoch": "1"},
    )
    return s


def test_capture_time_and_replay():
    s = setup()
    s.present(
        t=100,
        view=zoom_at(create_view(800, 600, 1600, 1200), 2, {"x": 400, "y": 300}),
        surface={"id": "screen", "epoch": "1"},
    )
    s.gaze(sample("left", 90), 160)
    s.gaze(sample("right", 110), 170)
    rows = s.flush(250)
    assert [r["frameId"] for r in rows] == ["frame-1", "frame-2"]
    assert replay(json.loads(json.dumps(s.export()))).aligned == rows


def test_per_eye_identity_and_pairing():
    s = setup()
    s.gaze(sample("left", 20), 40)
    s.gaze(sample("right", 20), 40)
    rows = s.flush(100)
    assert len(rows) == 2 and all(r["usable"] for r in rows)
    pairs = pair_eyes(rows)
    assert len(pairs) == 1 and pairs[0]["skewMs"] == 0
    with pytest.raises(ValueError, match="Duplicate"):
        s.gaze(sample("left", 20), 120)


def test_pending_duplicates_survive_recent_id_rollover():
    s = GazeSession({"maxRecords": 2, "maxPending": 8})
    for identity in ("a", "b", "c"):
        s.gaze({**sample("left", 10), "id": identity}, 20)
    before = s.export()
    with pytest.raises(ValueError, match="Duplicate"):
        s.gaze({**sample("left", 10), "id": "a"}, 21)
    assert s.export() == before
    assert [a["sampleId"] for a in s.flush(100)] == ["a", "b", "c"]


def test_retained_records_remain_ordered_json_lists_and_detached_snapshots():
    s = GazeSession({"maxRecords": 3})
    for i in range(12):
        s.input({"id": str(i), "kind": "test", "t": i})
    rows = s.records
    assert isinstance(rows, list)
    assert [r["sequence"] for r in rows] == [10, 11, 12]
    rows[0]["payload"]["id"] = "changed-outside-session"
    recording = json.loads(json.dumps(s.export()))
    assert recording["records"][0]["payload"]["id"] == "9"
    assert recording["recordsDropped"] == 9
    with pytest.raises(ValueError, match="truncated"):
        replay(recording)


def test_gesture_interruption():
    c = ZoomController(create_view(400, 600, 800, 1200))
    c.zoom(2, 0)
    c.pointer_down(id=1, x=100, y=200, t=1)
    c.pointer_move(id=1, x=140, y=200, t=2)
    c.key("+", 3)
    changed = dict(c.view)
    c.pointer_move(id=1, x=150, y=200, t=4)
    assert c.view == changed


def test_affine_small_scale_and_singular():
    p = apply_affine(invert_affine([1e-8, 0, 0, 1e-8, 10, 20]), {"x": 110, "y": 220})
    assert p == pytest.approx({"x": 1e10, "y": 2e10})
    with pytest.raises(ValueError):
        invert_affine([1, 1, 1, 1, 0, 0])


def test_bad_json_and_future_time():
    s = setup()
    with pytest.raises(ValueError):
        s.gaze(sample("left", 20, metadata={"invalid": math.nan}), 40)
    s.gaze(sample("left", 1e12), 40)
    rows = s.flush(100)
    assert (
        len(rows) == 1
        and "future-capture" in rows[0]["flags"]
        and not rows[0]["usable"]
    )


def test_immutable_clock_epoch():
    c = ClockRegistry()
    c.register(
        {
            "id": "eye",
            "epoch": "boot",
            "sourceOriginMs": 1000,
            "sessionOriginMs": 0,
            "rate": 1.001,
        }
    )
    assert c.map("eye", "boot", 2000)["timeMs"] == pytest.approx(1001)
    with pytest.raises(ValueError):
        c.register(
            {"id": "eye", "epoch": "boot", "sourceOriginMs": 1000, "sessionOriginMs": 5}
        )


@pytest.mark.parametrize(
    "mode",
    ["monocular-left", "monocular-right", "binocular-independent", "binocular-fused"],
)
@pytest.mark.parametrize("rates", [(30, 60, 120), (144, 1000, 2000)])
def test_varied_sizes_rates_modes(mode, rates):
    display, input_hz, gaze = rates
    e = generate_experiment(
        {
            "width": 390,
            "height": 844,
            "displayHz": display,
            "inputHz": input_hz,
            "gazeHz": gaze,
            "rightGazeHz": 120,
            "mode": mode,
            "rotateMidway": True,
            "independentClocks": True,
        }
    )
    summary = summarize_experiment(e, execute_experiment(e))
    assert (
        summary["samples"] == summary["expectedSamples"]
        and summary["frameMismatches"] == 0
    )
    assert summary["maxReconstructionErrorPx"] < 1e-6 and summary["replayExact"]


def test_receipt_only_source_is_flagged():
    s = setup()
    s.register_source(
        dict(
            id="device",
            kind="custom",
            adapter="host-only",
            eyes=["left"],
            trackingMode="monocular",
            timestampKind="host-receipt",
        )
    )
    s.gaze(sample("left", 20), 20)
    row = s.flush(100)[0]
    assert not row["usable"] and "receipt-time-only" in row["flags"]
    assert any(
        x["code"] == "EXPOSURE_TIME_REQUIRED" for x in s.diagnostics.report()["issues"]
    )


def test_replay_rejects_missing_records():
    s = setup()
    s.gaze(sample("left", 20), 30)
    s.flush(100)
    log = s.export()
    log["records"].pop(1)
    with pytest.raises(ValueError):
        replay(log)


def test_uncertainty_crossing_a_view_change():
    s = setup()
    s.clocks.register(
        dict(
            id="sensor", epoch="a", sourceOriginMs=0, sessionOriginMs=0, uncertaintyMs=4
        )
    )
    s.present(
        t=100,
        view=zoom_at(create_view(800, 600, 1600, 1200), 2, {"x": 400, "y": 300}),
        surface={"id": "screen", "epoch": "1"},
    )
    p = sample("left", 99)
    p.update(clockId="sensor", clockEpoch="a")
    s.gaze(p, 130)
    row = s.flush(200)[0]
    assert not row["usable"] and "ambiguous-presentation" in row["flags"]


def test_source_registration_ignores_object_key_order_but_preserves_rates():
    s = setup()
    source = dict(
        id="device",
        kind="tracker",
        adapter="fixture",
        eyes=["left", "right"],
        trackingMode="binocular-independent",
        eyeRatesHz={"left": 120, "right": 60},
    )
    s.register_source(source)
    reordered = dict(reversed(list(source.items())))
    reordered["eyeRatesHz"] = {"right": 60, "left": 120}
    assert s.register_source(reordered) == source
    with pytest.raises(ValueError, match="immutable"):
        s.register_source({**source, "eyeRatesHz": {"left": 120, "right": 120}})


def test_content_rotation_movement_and_combined_touch():
    from gazesync import (
        InteractionController,
        rotate_at,
        pan_by,
        content_to_viewport,
        viewport_to_content,
        resize_view,
        reset_view,
    )

    base = create_view(800, 600, 400, 200, pan_bounds="none")
    rotated = rotate_at(base, math.pi / 2)
    assert content_to_viewport(rotated, {"x": 300, "y": 100}) == pytest.approx(
        {"x": 400, "y": 500}
    )
    moved = pan_by(rotated, -30, 50)
    assert viewport_to_content(moved, {"x": 370, "y": 550}) == pytest.approx(
        {"x": 300, "y": 100}
    )
    resized = resize_view(moved, 1200, 800)
    assert viewport_to_content(resized, {"x": 600, "y": 400}) == pytest.approx(
        viewport_to_content(moved, {"x": 400, "y": 300})
    )
    assert reset_view(resized) == create_view(1200, 800, 400, 200, pan_bounds="none")
    c = InteractionController(base)
    c.pointer_down(id=1, x=350, y=300, t=0, pointer_type="touch")
    c.pointer_down(id=2, x=450, y=300, t=1, pointer_type="touch")
    c.pointer_move(id=1, x=420, y=230, t=2)
    c.pointer_move(id=2, x=420, y=430, t=3)
    assert c.view["rotation"] == pytest.approx(math.pi / 2)
    assert c.view["scale"] == pytest.approx(4)
    assert content_to_viewport(c.view, {"x": 200, "y": 100}) == pytest.approx(
        {"x": 420, "y": 330}
    )
    c.pointer_up(id=2, x=420, y=430, t=4)
    previous = dict(c.view)
    c.pointer_move(id=1, x=430, y=240, t=5)
    assert c.view["tx"] == pytest.approx(previous["tx"] + 10)
    assert c.view["ty"] == pytest.approx(previous["ty"] + 10)
    c.rotate(0.2, 6)
    assert not c.pointers
    previous = dict(c.view)
    with pytest.raises(ValueError):
        c.rotate(math.inf, 7)
    assert c.view == previous
    c.key("Home", 8)
    assert c.view == base


def test_degenerate_twist_and_disabled_rotation():
    c = ZoomController(create_view(800, 600, 400, 200, pan_bounds="none"))
    c.pointer_down(id=1, x=400, y=300, t=0, pointer_type="touch")
    c.pointer_down(id=2, x=400, y=300, t=1, pointer_type="touch")
    previous = dict(c.view)
    c.pointer_move(id=2, x=440, y=300, t=2)
    assert c.view == previous
    c.pointer_move(id=2, x=450, y=300, t=3)
    assert c.view["scale"] == pytest.approx(2.5)
    fixed = ZoomController(c.view, enable_rotation=False)
    assert not fixed.key("]", 4)
    with pytest.raises(ValueError):
        fixed.set_mode("rotate")


@pytest.mark.parametrize("size", [(390, 844), (1920, 1080)])
@pytest.mark.parametrize(
    "mode",
    ["monocular-left", "monocular-right", "binocular-independent", "binocular-fused"],
)
def test_native_rotating_content_multirate_simulation(size, mode):
    e = generate_experiment(
        dict(
            width=size[0],
            height=size[1],
            displayHz=90,
            inputHz=125,
            gazeHz=600,
            rightGazeHz=120,
            mode=mode,
            contentMotion=True,
            rotateMidway=True,
            independentClocks=mode == "binocular-independent",
        )
    )
    r = summarize_experiment(e, execute_experiment(e))
    assert r["frameMismatches"] == 0 and r["replayExact"]
    assert r["mappedSamples"] > 0 and r["maxReconstructionErrorPx"] < 1e-8
    assert r["samples"] == r["expectedSamples"]


def test_integral_float_limits_are_canonical_and_flush_is_safe():
    s = GazeSession({"maxRecords": 2.0, "maxFrames": 2.0, "maxPending": 8.0})
    s.present(
        t=0,
        view=create_view(100, 100, 100, 100),
        surface={"id": "screen", "epoch": "1"},
    )
    for t in (1, 2, 3):
        s.gaze(sample("left", t), 10)
    assert len(s.flush(100)) == 3
    assert len(s.aligned) == 2 and not s.pending and s.aligned_dropped == 1
    assert all(
        type(s.config[k]) is int for k in ("maxRecords", "maxFrames", "maxPending")
    )


@pytest.mark.parametrize(
    "field,value", [("plane", {}), ("plane", []), ("display", {}), ("display", [])]
)
def test_malformed_optional_surface_metadata_is_rejected_atomically(field, value):
    s = setup()
    before = s.export()
    with pytest.raises((ValueError, TypeError)):
        s.present(
            t=1,
            view=create_view(100, 100, 100, 100),
            surface={"id": "screen", "epoch": "1", field: value},
        )
    assert s.export() == before


def test_extreme_time_arithmetic_cannot_make_nonfinite_recordings():
    s = setup()
    before = s.export()
    with pytest.raises(ValueError, match="latency"):
        s.gaze(sample("left", -1e308), 1e308)
    assert s.export() == before
    s.gaze(sample("left", 0), 10)
    s.gaze(sample("left", 1e-320), 10)
    assert s.diagnostics.report()["streams"][0]["observedHz"] is None
    s.flush(100)
    json.dumps(s.export(), allow_nan=False)


def test_pairing_separates_content_replacements():
    s = setup()
    s.present(
        t=10,
        view=create_view(800, 600, 1600, 1200),
        contentId="next-page",
        surface={"id": "screen", "epoch": "1"},
    )
    s.gaze(sample("left", 9), 20)
    s.gaze(sample("right", 11), 20)
    rows = s.flush(100)
    assert all(row["usable"] for row in rows)
    pairs = pair_eyes(rows)
    assert len(pairs) == 2
    assert all(p["left"] is None or p["right"] is None for p in pairs)


@pytest.mark.parametrize("command", ["zoom", "wheel", "key"])
def test_view_command_interrupts_double_tap(command):
    c = ZoomController(create_view(400, 600, 800, 1200))

    def tap(t):
        c.pointer_down(id=1, x=200, y=300, t=t, pointer_type="touch")
        c.pointer_up(id=1, x=200, y=300, t=t + 10)

    tap(0)
    if command == "zoom":
        c.zoom(1.25, 20)
    elif command == "wheel":
        c.wheel(x=200, y=300, delta_y=-80, t=20)
    else:
        c.key(key="ArrowLeft", t=20)
    before = dict(c.view)
    tap(40)
    assert c.view == before


def test_diagnostic_observer_failure_count():
    calls = []

    def observer(event):
        calls.append(event)
        raise RuntimeError("observer failed")

    s = GazeSession(on_diagnostic=observer)
    s.present(
        t=0,
        view=create_view(800, 600, 1600, 1200),
        surface={"id": "screen", "epoch": "1"},
    )
    s.gaze(sample("left", 20), 30)
    assert len(s.flush(100)) == 1
    failed = next(
        d for d in s.diagnostics.report()["issues"] if d["code"] == "CALLBACK_FAILED"
    )
    assert len(calls) > 1
    assert failed["count"] == len(calls)


def test_audit_source_rate_map_validation_is_transactional():
    s = GazeSession()
    source = dict(
        id="device",
        kind="tracker",
        adapter="fixture",
        trackingMode="monocular",
        eyes=["left"],
    )
    for value in (None, [], False, 0, "120"):
        with pytest.raises(ValueError, match="eyeRatesHz must be a mapping"):
            s.register_source({**source, "eyeRatesHz": value})
        assert s.export()["sources"] == []
    s.register_source({**source, "eyeRatesHz": {"left": 120}})
    s.gaze(sample("left", 1), 1)
    assert len(s.pending) == 1


@pytest.mark.parametrize("via_stdin", [False, True], ids=["file", "stdin"])
def test_audit_cli_preserves_unicode_under_non_utf8_locale(tmp_path, via_stdin):
    import os
    import subprocess
    import sys

    s = GazeSession()
    s.input({"id": "事件-1", "kind": "marker", "t": 0, "label": "rotation θ"})
    raw = json.dumps(s.export(), ensure_ascii=False).encode("utf-8")
    path = tmp_path / "recording.json"
    path.write_bytes(raw)
    env = {
        **os.environ,
        "LC_ALL": "C",
        "LANG": "C",
        "PYTHONCOERCECLOCALE": "0",
        "PYTHONUTF8": "0",
        "PYTHONIOENCODING": "ascii:surrogateescape",
    }
    result = subprocess.run(
        [
            sys.executable,
            "-X",
            "utf8=0",
            "-m",
            "gazesync",
            "replay",
            "-" if via_stdin else str(path),
            "--full",
        ],
        input=raw if via_stdin else None,
        capture_output=True,
        env=env,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["records"] == s.records


def test_audit_cli_reports_unreadable_files_without_a_traceback(tmp_path):
    import subprocess
    import sys

    result = subprocess.run(
        [sys.executable, "-m", "gazesync", "replay", str(tmp_path / "missing.json")],
        capture_output=True,
    )
    assert result.returncode == 2
    assert b"GazeSync input error:" in result.stderr
    assert b"Traceback" not in result.stderr


def test_audit_pen_box_gestures_zoom_while_touch_still_pans():
    from gazesync import zoom_level

    for mode, shift_key in (("box", False), ("pan", True)):
        c = ZoomController(create_view(100, 100, 100, 100, pan_bounds="none"))
        c.set_mode(mode)
        c.pointer_down(id=1, x=20, y=20, t=0, pointer_type="pen", shift_key=shift_key)
        c.pointer_move(id=1, x=80, y=80, t=1)
        assert c.selection == {"start": {"x": 20, "y": 20}, "end": {"x": 80, "y": 80}}
        c.pointer_up(id=1, x=80, y=80, t=2)
        assert zoom_level(c.view) == pytest.approx(5 / 3)
        assert c.selection is None
    touch = ZoomController(create_view(100, 100, 100, 100, pan_bounds="none"))
    touch.set_mode("box")
    touch.pointer_down(id=1, x=20, y=20, t=0, pointer_type="touch")
    touch.pointer_up(id=1, x=80, y=80, t=1)
    assert zoom_level(touch.view) == 1
    assert touch.view["tx"] == 60


def test_audit_cli_cross_language_tolerance_keeps_identity_and_time_exact(tmp_path):
    import copy
    import subprocess
    import sys

    s = setup()
    s.gaze(sample("left", 20), 21)
    s.flush(100)
    original = s.export()
    path = tmp_path / "session.json"

    def run(recording, *flags):
        path.write_text(json.dumps(recording), encoding="utf-8")
        return subprocess.run(
            [sys.executable, "-m", "gazesync", "replay", str(path), *flags],
            capture_output=True,
        )

    rounded = copy.deepcopy(original)
    rounded["aligned"][0]["contentPoint"]["x"] += 1e-10
    assert run(rounded).returncode == 2
    compatible = run(rounded, "--cross-language")
    assert compatible.returncode == 0, compatible.stderr
    report = json.loads(compatible.stdout)
    assert report["replayExact"] is False
    assert report["replayConformant"] is True
    row = original["aligned"][0]
    changes = [
        {"contentPoint": {**row["contentPoint"], "x": row["contentPoint"]["x"] + 1}},
        {"captureTimeMs": row["captureTimeMs"] + 1e-10},
        {"frameId": "different-frame"},
        {"usable": 1},
        {"flags": [*row["flags"], "off-content"]},
    ]
    for change in changes:
        altered = copy.deepcopy(original)
        altered["aligned"][0].update(change)
        assert run(altered, "--cross-language").returncode == 2
    raw_only = copy.deepcopy(original)
    del raw_only["aligned"]
    full = run(raw_only, "--full")
    assert full.returncode == 0, full.stderr
    assert json.loads(full.stdout)["aligned"] == original["aligned"]
