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
