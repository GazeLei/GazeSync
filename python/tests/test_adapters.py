import json
from pathlib import Path
import pytest
from jsonschema import Draft202012Validator

SCHEMA = json.loads((Path(__file__).parent / "fixtures/gaze.schema.json").read_text())
from gazesync import ModelAdapter, TobiiProAdapter, EyeLinkAdapter, PupilCoreAdapter

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures/adapter-fixtures.json").read_text()
)
CLASSES = {
    "model": ModelAdapter,
    "tobii": TobiiProAdapter,
    "eyelink": EyeLinkAdapter,
    "pupil": PupilCoreAdapter,
}


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda c: c["name"])
def test_adapter_contract(case):
    adapter = CLASSES[case["adapter"]]({**FIXTURE["base"], **case["options"]})
    results = [
        adapter.adapt_surface(p)
        if case.get("method") == "surface"
        else adapter.adapt(p)
        for p in case["packets"]
    ]
    assert [len(r["samples"]) for r in results] == case["expectedCounts"]
    samples = [s for r in results for s in r["samples"]]
    if "expectedValid" in case:
        assert [s["valid"] for s in samples] == case["expectedValid"]
    if "expectedTimeMs" in case:
        assert samples[0]["timeMs"] == case["expectedTimeMs"]
    if "expectedOrigin" in case:
        assert samples[0]["ray"]["origin"] == case["expectedOrigin"]
    if "expectedPoint" in case:
        point = next(s for s in samples if s["type"] == "pog2d" and s["valid"])["point"]
        assert point == pytest.approx(case["expectedPoint"])
    if "requiredWarning" in case:
        assert any(
            w["code"] == case["requiredWarning"] for r in results for w in r["warnings"]
        )
    assert adapter.source["hardwareValidated"] is False
    for sample in samples:
        Draft202012Validator(SCHEMA).validate(sample)


def test_pylink_bridge_uses_each_eye_and_source_time():
    class Eye:
        def getGaze(self):
            return (120, 240)

        def getPupilSize(self):
            return 30

    class Sample:
        def getTime(self):
            return 42

        def isLeftSample(self):
            return 1

        def isRightSample(self):
            return 0

        def getLeftEye(self):
            return Eye()

        def getRightEye(self):
            raise AssertionError("Missing eye must not be read")

    assert EyeLinkAdapter.packet_from_pylink(Sample(), "physical-frame-1") == {
        "id": "physical-frame-1",
        "timeMs": 42,
        "left": {"gaze": [120, 240], "pupilSize": 30},
    }


def test_model_configuration_is_validated_and_detached_from_caller():
    import pytest
    from gazesync import ModelAdapter

    opts = dict(
        sourceId="model",
        clockId="session",
        clockEpoch="0",
        surfaceId="screen",
        surfaceEpoch="1",
        type="pog2d",
        eye="left",
        timestampUnit="ms",
        pointUnits="display-pixels",
        displayPixels={"width": 1000, "height": 1000},
    )
    for changes in (
        {"originUnits": "cm"},
        {"yOrigin": "sideways"},
        {"type": "3d"},
        {"pointUnits": "pixels"},
        {"timestampUnit": "seconds"},
        {"fields": {"point": ""}},
        {"eyes": ["left", "left"]},
    ):
        with pytest.raises((ValueError, TypeError)):
            ModelAdapter({**opts, **changes})
    a = ModelAdapter(opts)
    opts["displayPixels"]["width"] = 1
    opts["sourceId"] = "changed"
    descriptor = a.source
    descriptor["eyes"].clear()
    row = a.adapt({"timestamp": 1, "point": [500, 500]})["samples"][0]
    assert row["point"] == {"x": 0.5, "y": 0.5} and row["sourceId"] == "model"
    assert a.source["eyes"] == ["left"]


def test_pupil_rejected_packet_does_not_consume_either_eye_and_clocks_are_distinct():
    import pytest
    from gazesync import PupilCoreAdapter

    opts = dict(
        sourceId="pupil",
        clockId="eye-clock",
        clockEpoch="0",
        surfaceId="screen",
        surfaceEpoch="1",
        frameId="camera",
    )
    a = PupilCoreAdapter(opts)
    packet = dict(
        topic="gaze.3d.01.",
        timestamp=1,
        confidence=0.9,
        eye_centers_3d={"0": [30, 0, 600], "1": [-30, 0, 600]},
        gaze_normals_3d={"0": [0, 0, -1], "1": [0, 0, -1]},
        base_data=[
            {"id": 0, "timestamp": 1, "confidence": 0.9},
            {"id": 1, "timestamp": 1, "confidence": 2},
        ],
    )
    with pytest.raises(ValueError):
        a.adapt(packet)
    packet["base_data"][1]["confidence"] = 0.9
    assert len(a.adapt(packet)["samples"]) == 2
    assert len(a.adapt(packet)["samples"]) == 0
    assert len(a.adapt(packet, {"clockId": "other-clock"})["samples"]) == 2
    packet["base_data"][0].update(confidence=None, timestamp=None)
    unknown = next(
        s
        for s in a.adapt(packet, {"clockId": "third-clock"})["samples"]
        if s["eye"] == "right"
    )
    assert unknown["confidence"] is None and unknown["timeMs"] == 1000


def test_pupil_homography_is_invertible_and_scale_invariant():
    options = {**FIXTURE["base"], "eyes": ["right"], "mappingId": "calibration"}
    packet = {
        "topic": "gaze.2d.0.",
        "timestamp": 1,
        "norm_pos": [0.25, 0.75],
        "confidence": 0.9,
    }
    for scale in (1, 1e-150, -1e-150, 1e150):
        adapter = PupilCoreAdapter(
            {**options, "sceneToSurface": [scale, 0, 0, 0, scale, 0, 0, 0, scale]}
        )
        row = adapter.adapt(packet)["samples"][0]
        assert row["valid"] is True
        assert row["point"] == {"x": 0.25, "y": 0.25}
    for h in ([0, 0, 0, 0, 0, 0, 0, 0, 1], [1, 0, 0, 2, 0, 0, 0, 0, 1], [0] * 9):
        with pytest.raises(ValueError, match="[Hh]omography"):
            PupilCoreAdapter({**options, "sceneToSurface": h})


def test_tobii_timestamp_and_boolean_configuration_reject_typos():
    for change in (
        {"timestamp": "sysem"},
        {"timestamp": None},
        {"includeRay": "false"},
        {"includeRay": 1},
    ):
        with pytest.raises(ValueError, match="timestamp|includeRay"):
            TobiiProAdapter({**FIXTURE["base"], "frameId": "ucs", **change})
    packet = dict(
        device_time_stamp=1000000,
        system_time_stamp=9000000,
        left_gaze_point_on_display_area=[0.5, 0.5],
        left_gaze_point_validity=True,
    )
    assert (
        TobiiProAdapter({**FIXTURE["base"], "timestamp": "system"}).adapt(packet)[
            "samples"
        ][0]["timeMs"]
        == 9000
    )
    assert (
        TobiiProAdapter({**FIXTURE["base"], "timestamp": "device"}).adapt(packet)[
            "samples"
        ][0]["timeMs"]
        == 1000
    )
