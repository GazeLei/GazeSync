"""Synthetic multirate experiments and language-neutral event execution."""

from __future__ import annotations
import json
import math
from typing import Any, Mapping
from .geometry import create_view, constrain, view_matrix
from .session import GazeSession, replay


def _key(sample: Mapping[str, Any]) -> str:
    return (
        f"{sample['eye']}/{sample['type']}/{sample.get('id', sample.get('sampleId'))}"
    )


def _last_at(frames: list[dict[str, Any]], t: float) -> dict[str, Any]:
    lo, hi = 0, len(frames)
    while lo < hi:
        mid = (lo + hi) // 2
        if frames[mid]["t"] <= t:
            lo = mid + 1
        else:
            hi = mid
    return frames[max(0, lo - 1)]


def generate_experiment(options: Mapping[str, Any]) -> dict[str, Any]:
    c = {
        "durationMs": 800,
        "devicePixelRatio": 1,
        "latencyMs": 28,
        "jitterMs": 35,
        "noisePx": 0.35,
        "seed": 41,
        "rotateMidway": False,
        "independentClocks": False,
        "name": "experiment",
        **options,
        "rightGazeHz": options.get("rightGazeHz", options.get("gazeHz")),
    }
    for key in (
        "width",
        "height",
        "displayHz",
        "inputHz",
        "gazeHz",
        "rightGazeHz",
        "durationMs",
        "devicePixelRatio",
    ):
        if (
            not isinstance(c.get(key), (int, float))
            or not math.isfinite(c[key])
            or c[key] <= 0
        ):
            raise ValueError(f"{key} must be positive and finite")
    for key in ("latencyMs", "jitterMs", "noisePx"):
        if not math.isfinite(c[key]) or c[key] < 0:
            raise ValueError(f"{key} must be nonnegative and finite")
    if c.get("mode") not in (
        "monocular-left",
        "monocular-right",
        "binocular-independent",
        "binocular-fused",
    ):
        raise ValueError("Unknown eye mode")
    if (
        c["durationMs"]
        * max(c[k] for k in ("gazeHz", "rightGazeHz", "displayHz", "inputHz"))
        / 1000
        > 100000
    ):
        raise ValueError("Experiment exceeds 100000 time steps")
    state = c["seed"] & 0xFFFFFFFF

    def random():
        nonlocal state
        state = (1664525 * state + 1013904223) & 0xFFFFFFFF
        return state / 4294967296

    eyes = (
        ["left"]
        if c["mode"] == "monocular-left"
        else ["right"]
        if c["mode"] == "monocular-right"
        else ["combined"]
        if c["mode"] == "binocular-fused"
        else ["left", "right"]
    )
    sources = [
        {
            "id": "synthetic-tracker",
            "kind": "simulated",
            "adapter": "multirate-reference-v1",
            "eyes": eyes,
            "trackingMode": c["mode"]
            if c["mode"].startswith("binocular")
            else "monocular",
            "expectedHz": c["gazeHz"],
            "eyeRatesHz": {
                e: c["rightGazeHz"] if e == "right" else c["gazeHz"] for e in eyes
            },
            "timestampKind": "exposure",
        }
    ]
    clocks = (
        [
            {
                "id": f"device-{eye}",
                "epoch": "boot",
                "sourceOriginMs": 1e6 + i * 54321,
                "sessionOriginMs": 0,
                "rate": 1.00008 - i * 0.00013,
                "uncertaintyMs": 0,
            }
            for i, eye in enumerate(eyes)
        ]
        if c["independentClocks"]
        else [
            {
                "id": "device",
                "epoch": "boot",
                "sourceOriginMs": 1e6,
                "sessionOriginMs": 0,
                "rate": 1.00008,
                "uncertaintyMs": 0,
            }
        ]
    )
    inputs, events, frames = [], [], []
    for i in range(math.floor(c["durationMs"] * c["inputHz"] / 1000) + 1):
        t = i * 1000 / c["inputHz"]
        event = {"id": f"intent-{i}", "kind": "view-intent", "t": t, "phase": "update"}
        inputs.append(event)
        events.append({"time": t, "order": 0, "type": "input", "payload": event})
    used = 0
    for i in range(math.floor(c["durationMs"] * c["displayHz"] / 1000) + 1):
        t = i * 1000 / c["displayHz"]
        landscape = c["rotateMidway"] and t >= c["durationMs"] / 2
        width, height = (
            (c["height"], c["width"]) if landscape else (c["width"], c["height"])
        )
        u = _last_at(inputs, t)["t"] / c["durationMs"]
        base = create_view(width, height, 1600, 1100)
        scale = base["scale"] * (1 + 0.8 * math.sin(math.pi * u) ** 2)
        view = constrain(
            {
                **base,
                "scale": scale,
                "tx": width / 2
                - 800 * scale
                + width * 0.08 * math.sin(u * 2 * math.pi),
                "ty": height / 2
                - 550 * scale
                + height * 0.05 * math.sin(u * 4 * math.pi),
            }
        )
        cause_ids = []
        while used < len(inputs) and inputs[used]["t"] <= t:
            cause_ids.append(inputs[used]["id"])
            used += 1
        width_m = 0.072 if width < 700 else 0.53
        height_m = width_m * height / width
        plane = {
            "frameId": "world",
            "topLeft": [-width_m / 2, height_m / 2, 0],
            "right": [1, 0, 0],
            "down": [0, -1, 0],
            "widthMeters": width_m,
            "heightMeters": height_m,
            "static": True,
        }
        frame = {
            "t": t,
            "view": view,
            "matrix": view_matrix(view),
            "contentId": "synthetic-target",
            "causeIds": cause_ids,
            "timing": "synthetic",
            "surface": {
                "id": "display",
                "epoch": "2" if landscape else "1",
                "devicePixelRatio": c["devicePixelRatio"],
                "expectedPresentationHz": c["displayHz"],
                "presentationMode": "per-frame",
                "display": {"width": width, "height": height, "left": 0, "top": 0},
                "plane": plane,
            },
        }
        frames.append(frame)
        events.extend(
            [
                {"time": t, "order": 1, "type": "frame", "payload": frame},
                {
                    "time": t,
                    "order": 3,
                    "type": "flush",
                    "payload": {"now": t, "final": False},
                },
            ]
        )
    truth = {}
    for eye_index, eye in enumerate(eyes):
        hz = c["rightGazeHz"] if eye == "right" else c["gazeHz"]
        phase = 3.125 if eye == "right" else 2.375
        clock = clocks[eye_index] if c["independentClocks"] else clocks[0]
        i = 0
        while True:
            t = phase + i * 1000 / hz
            if t >= c["durationMs"]:
                break
            frame = _last_at(frames, t)
            v = frame["view"]
            content = {
                "x": 800 + 40 * math.sin(t / 180),
                "y": 550 + 30 * math.cos(t / 210),
            }
            p = {
                "x": content["x"] * v["scale"]
                + v["tx"]
                + (random() - 0.5) * 2 * c["noisePx"],
                "y": content["y"] * v["scale"]
                + v["ty"]
                + (random() - 0.5) * 2 * c["noisePx"],
            }
            origin = [
                -0.032 if eye == "left" else 0.032 if eye == "right" else 0,
                0,
                0.6,
            ]
            plane = frame["surface"]["plane"]
            hit = [
                n
                + plane["right"][j] * p["x"] / v["width"] * plane["widthMeters"]
                + plane["down"][j] * p["y"] / v["height"] * plane["heightMeters"]
                for j, n in enumerate(plane["topLeft"])
            ]
            raw_time = clock["sourceOriginMs"] + t / clock["rate"]
            arrival = (
                t
                + c["latencyMs"]
                + random() * c["jitterMs"]
                + (120 if i % 97 == 0 else 0)
            )
            valid = not c["durationMs"] * 0.46 < t < c["durationMs"] * 0.50
            for kind in ("pog2d", "ray3d"):
                sample = {
                    "id": f"sample-{i}",
                    "captureId": f"capture-{i}",
                    "sourceId": "synthetic-tracker",
                    "eye": eye,
                    "type": kind,
                    "clockId": clock["id"],
                    "clockEpoch": clock["epoch"],
                    "timeMs": raw_time,
                    "surfaceId": "display",
                    "surfaceEpoch": frame["surface"]["epoch"],
                    "confidence": 0.98,
                    "valid": valid,
                    "blink": not valid,
                    **(
                        {
                            "space": "normalized-viewport",
                            "point": {
                                "x": p["x"] / v["width"],
                                "y": p["y"] / v["height"],
                            },
                        }
                        if kind == "pog2d"
                        else {
                            "ray": {
                                "origin": origin,
                                "direction": [n - origin[j] for j, n in enumerate(hit)],
                                "frameId": "world",
                            }
                        }
                    ),
                }
                events.append(
                    {
                        "time": arrival,
                        "order": 2,
                        "type": "gaze",
                        "payload": {"sample": sample, "receivedTimeMs": arrival},
                    }
                )
                truth[_key(sample)] = {
                    "frameTimeMs": frame["t"],
                    "content": {
                        "x": (p["x"] - v["tx"]) / v["scale"],
                        "y": (p["y"] - v["ty"]) / v["scale"],
                    },
                    "viewport": p,
                    "scale": v["scale"],
                }
            i += 1
    events.sort(key=lambda e: (e["time"], e["order"]))
    finish = events[-1]["time"] + 100
    events.append(
        {
            "time": finish,
            "order": 3,
            "type": "flush",
            "payload": {"now": finish, "final": True},
        }
    )
    return {
        "config": c,
        "clocks": clocks,
        "sources": sources,
        "events": events,
        "truth": truth,
    }


def execute_experiment(experiment: Mapping[str, Any]) -> GazeSession:
    session = GazeSession()
    for source in experiment["sources"]:
        session.register_source(source)
    for clock in experiment["clocks"]:
        session.clocks.register(clock)
    for event in experiment["events"]:
        p = event["payload"]
        if event["type"] == "frame":
            session.present(**p)
        elif event["type"] == "input":
            session.input(p)
        elif event["type"] == "gaze":
            session.gaze(p["sample"], p["receivedTimeMs"])
        elif event["type"] == "flush":
            session.flush(p["now"], final=p["final"])
        else:
            raise ValueError("Unknown experiment event")
    return session


def summarize_experiment(
    experiment: Mapping[str, Any], session: GazeSession
) -> dict[str, Any]:
    c = experiment["config"]
    errors = []
    arrival_errors = []
    mismatches = 0
    frames = [e["payload"] for e in experiment["events"] if e["type"] == "frame"]
    aligned = session.aligned
    for a in aligned:
        expected = experiment["truth"][_key(a)]
        if (
            a.get("presentationTimeMs") is None
            or abs(a["presentationTimeMs"] - expected["frameTimeMs"]) > 1e-6
        ):
            mismatches += 1
        if a["contentPoint"] is None:
            continue
        errors.append(
            math.hypot(
                a["contentPoint"]["x"] - expected["content"]["x"],
                a["contentPoint"]["y"] - expected["content"]["y"],
            )
            * expected["scale"]
        )
        current = _last_at(frames, a["receivedTimeMs"])["view"]
        arrival_errors.append(
            math.hypot(
                (expected["viewport"]["x"] - current["tx"]) / current["scale"]
                - expected["content"]["x"],
                (expected["viewport"]["y"] - current["ty"]) / current["scale"]
                - expected["content"]["y"],
            )
            * expected["scale"]
        )
    arrival_errors.sort()
    restored = replay(json.loads(json.dumps(session.export(), allow_nan=False)))
    return {
        **{
            k: c[k]
            for k in (
                "name",
                "width",
                "height",
                "devicePixelRatio",
                "displayHz",
                "inputHz",
                "gazeHz",
                "rightGazeHz",
                "mode",
                "durationMs",
                "seed",
                "rotateMidway",
                "independentClocks",
            )
        },
        "samples": len(aligned),
        "expectedSamples": len(experiment["truth"]),
        "usableSamples": sum(a["usable"] for a in aligned),
        "frameMismatches": mismatches,
        "mappedSamples": len(errors),
        "maxReconstructionErrorPx": max(errors, default=0),
        "arrivalBaselineMeanPx": sum(arrival_errors) / max(1, len(arrival_errors)),
        "arrivalBaselineP95Px": arrival_errors[math.floor(len(arrival_errors) * 0.95)]
        if arrival_errors
        else 0,
        "replayExact": restored.aligned == aligned,
        "pendingSamples": len(session.pending),
    }
