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
