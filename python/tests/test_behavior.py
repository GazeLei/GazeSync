"""Independent geometric and timeline oracles, including superseded equal-time states."""

import math
from gazesync import (
    GazeSession,
    create_view,
    project_ray,
    transform_at,
    resize_view,
    content_to_viewport,
    ClockRegistry,
    replay,
)


def random(seed=20261018):
    value = seed

    def draw():
        nonlocal value
        value = (value * 1664525 + 1013904223) & 0xFFFFFFFF
        return value / 4294967296

    return draw


def near(a, b):
    assert abs(a - b) < 1e-8, (a, b)


def test_500_independently_constructed_tilted_ray_targets():
    rnd = random()
    for i in range(500):
        yaw, pitch = rnd() * 6 - 3, rnd() * 2 - 1
        u = [math.cos(yaw), math.sin(yaw), 0]
        v = [
            -math.sin(yaw) * math.cos(pitch),
            math.cos(yaw) * math.cos(pitch),
            math.sin(pitch),
        ]
        n = [
            math.sin(yaw) * math.sin(pitch),
            -math.cos(yaw) * math.sin(pitch),
            math.cos(pitch),
        ]
        P, w, h = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], 0.05 + rnd(), 0.05 + rnd()
        a, b = rnd() * 1.4 - 0.2, rnd() * 1.4 - 0.2
        Q = [p + a * w * u[k] + b * h * v[k] for k, p in enumerate(P)]
        O = [p + (0.2 + i / 1000) * n[k] + 0.03 * u[k] for k, p in enumerate(Q)]
        scale = 10 ** [-150, 0, 150][i % 3]
        ray = dict(
            frameId="world",
            origin=O,
            direction=[(p - O[k]) * scale for k, p in enumerate(Q)],
        )
        plane = dict(
            frameId="world",
            topLeft=P,
            right=u,
            down=v,
            widthMeters=w,
            heightMeters=h,
            static=True,
        )
        W, H = 320 + i * 7, 240 + i * 3
        hit = project_ray(ray, plane, W, H)
        assert "reason" not in hit
        near(hit["point"]["x"], a * W)
        near(hit["point"]["y"], b * H)
        for x, y in zip(hit["hit"], Q):
            near(x, y)
        assert (
            project_ray(
                {**ray, "direction": [-x for x in ray["direction"]]}, plane, W, H
            )["reason"]
            == "ray-behind-plane"
        )
        assert (
            project_ray({**ray, "direction": u}, plane, W, H)["reason"]
            == "parallel-ray"
        )


def test_500_analytic_landmarks_under_anchored_transform_and_resize():
    rnd = random(71)
    for _ in range(500):
        width, height, cw, ch = (
            320 + rnd() * 3000,
            240 + rnd() * 2000,
            300 + rnd() * 4000,
            200 + rnd() * 2000,
        )
        base = {
            **create_view(width, height, cw, ch, pan_bounds="none", max_zoom=32),
            "rotation": rnd() * 6 - 3,
            "tx": rnd() * 100 - 50,
            "ty": rnd() * 100 - 50,
        }
        q = {"x": rnd() * cw, "y": rnd() * ch}
        r, s = base["rotation"], base["scale"]
        anchor = {
            "x": s * (math.cos(r) * q["x"] - math.sin(r) * q["y"]) + base["tx"],
            "y": s * (math.sin(r) * q["x"] + math.cos(r) * q["y"]) + base["ty"],
        }
        dest = {"x": rnd() * width, "y": rnd() * height}
        factor, delta = 1 + rnd() * 8, rnd() * 2 - 1
        next_view = transform_at(base, factor, delta, anchor, dest)
        mapped = content_to_viewport(next_view, q)
        near(mapped["x"], dest["x"])
        near(mapped["y"], dest["y"])
        r, s = next_view["rotation"], next_view["scale"]
        x, y = width / 2 - next_view["tx"], height / 2 - next_view["ty"]
        centre = {
            "x": (math.cos(r) * x + math.sin(r) * y) / s,
            "y": (-math.sin(r) * x + math.cos(r) * y) / s,
        }
        resized = resize_view(next_view, width * 1.2, height * 0.8)
        mapped = content_to_viewport(resized, centre)
        near(mapped["x"], resized["width"] / 2)
        near(mapped["y"], resized["height"] / 2)


def test_linear_timeline_oracle_with_ties_uncertainty_and_two_surfaces():
    rnd = random(83)
    for run in range(40):
        session = GazeSession()
        effective = {"A": {}, "B": {}}
        uncertainty = run % 3
        session.clocks.register(
            dict(
                id="test",
                epoch="1",
                sourceOriginMs=0,
                sessionOriginMs=0,
                uncertaintyMs=uncertainty,
            )
        )
        view = create_view(500, 400, 1000, 800)
        for t in range(0, 201, 10):
            for surface in ("A", "B"):
                tx = -math.floor(rnd() * 3) * 10
                if t > 0:
                    session.present(
                        t=t,
                        view=view,
                        matrix=[0.5, 0, 0, 0.5, 99, 0],
                        surface={"id": surface, "epoch": "1"},
                    )
                effective[surface][t] = session.present(
                    t=t,
                    view=view,
                    matrix=[0.5, 0, 0, 0.5, tx, 0],
                    surface={"id": surface, "epoch": "1"},
                )
        expected = []
        for i in range(80):
            t, surface = 5 + (i * 23) % 190, "A" if i % 2 else "B"
            history = list(effective[surface].values())

            def at(x):
                return [f for f in history if f["t"] <= x][-1]

            f, start = at(t), at(t - uncertainty)
            ambiguous = any(
                t - uncertainty < f["t"] <= t + uncertainty
                and f["matrix"][4] != start["matrix"][4]
                for f in history
            )
            expected.append((str(i), f, ambiguous))
            session.gaze(
                dict(
                    id=str(i),
                    sourceId="test",
                    eye="left",
                    clockId="test",
                    clockEpoch="1",
                    timeMs=t,
                    surfaceId=surface,
                    surfaceEpoch="1",
                    type="pog2d",
                    space="viewport",
                    point={"x": 250, "y": 200},
                    valid=True,
                    confidence=1,
                ),
                210 + i,
            )
        rows = {r["sampleId"]: r for r in session.flush(400)}
        for identity, f, ambiguous in expected:
            r = rows[identity]
            assert r["frameId"] == f["id"]
            assert ("ambiguous-presentation" in r["flags"]) == ambiguous
            assert r["usable"] == (not ambiguous)
            near(r["contentPoint"]["x"], (250 - f["matrix"][4]) / 0.5)
        assert replay(session.export()).aligned == session.aligned


def test_clock_error_bound_at_large_absolute_origins():
    for origin in (0, 1e9, 1.7e12):
        for rate in (0.9999, 1, 1.0001):
            registry = ClockRegistry()
            registry.register(
                dict(
                    id="device",
                    epoch="1",
                    sourceOriginMs=origin,
                    sessionOriginMs=50,
                    rate=rate,
                    uncertaintyMs=0.01,
                    driftUncertaintyPpm=20,
                )
            )
            for delta in (-1000, -0.1, 0, 0.1, 1000):
                result = registry.map("device", "1", origin + delta)
                assert (
                    abs(result["timeMs"] - (50 + rate * delta))
                    <= result["uncertaintyMs"]
                )
                assert result["uncertaintyMs"] >= 0.01
