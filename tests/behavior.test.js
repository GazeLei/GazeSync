import test from "node:test";
import assert from "node:assert/strict";
import {
  GazeSession,
  createView,
  projectRay,
  transformAt,
  resizeView,
  contentToViewport,
  ClockRegistry,
  replay,
} from "../dist/index.js";
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function random(seed = 20261018) {
  let n = seed;
  return () => (n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296;
}

test("behavior: 500 tilted-plane rays meet independently constructed targets", () => {
  const rnd = random();
  for (let i = 0; i < 500; i++) {
    const yaw = rnd() * 6 - 3,
      pitch = rnd() * 2 - 1;
    const u = [Math.cos(yaw), Math.sin(yaw), 0];
    const v = [
      -Math.sin(yaw) * Math.cos(pitch),
      Math.cos(yaw) * Math.cos(pitch),
      Math.sin(pitch),
    ];
    const n = [
      Math.sin(yaw) * Math.sin(pitch),
      -Math.cos(yaw) * Math.sin(pitch),
      Math.cos(pitch),
    ];
    const P = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5],
      w = 0.05 + rnd(),
      h = 0.05 + rnd();
    const a = rnd() * 1.4 - 0.2,
      b = rnd() * 1.4 - 0.2;
    const Q = P.map((p, k) => p + a * w * u[k] + b * h * v[k]);
    const O = Q.map((p, k) => p + (0.2 + i / 1000) * n[k] + 0.03 * u[k]);
    const scale = 10 ** [-150, 0, 150][i % 3];
    const ray = {
      frameId: "world",
      origin: O,
      direction: Q.map((p, k) => (p - O[k]) * scale),
    };
    const plane = {
      frameId: "world",
      topLeft: P,
      right: u,
      down: v,
      widthMeters: w,
      heightMeters: h,
      static: true,
    };
    const W = 320 + i * 7,
      H = 240 + i * 3;
    const hit = projectRay(ray, plane, W, H);
    assert.equal(hit.reason, undefined);
    near(hit.point.x, a * W);
    near(hit.point.y, b * H);
    Q.forEach((q, k) => near(hit.hit[k], q));
    assert.equal(
      projectRay(
        { ...ray, direction: ray.direction.map((x) => -x) },
        plane,
        W,
        H,
      ).reason,
      "ray-behind-plane",
    );
    assert.equal(
      projectRay({ ...ray, direction: u }, plane, W, H).reason,
      "parallel-ray",
    );
  }
});

test("behavior: 500 anchored transforms and resizes preserve analytic landmarks", () => {
  const rnd = random(71);
  for (let i = 0; i < 500; i++) {
    const width = 320 + rnd() * 3000,
      height = 240 + rnd() * 2000,
      cw = 300 + rnd() * 4000,
      ch = 200 + rnd() * 2000;
    const base = {
      ...createView({
        width,
        height,
        contentWidth: cw,
        contentHeight: ch,
        panBounds: "none",
        maxZoom: 32,
      }),
      rotation: rnd() * 6 - 3,
      tx: rnd() * 100 - 50,
      ty: rnd() * 100 - 50,
    };
    const q = { x: rnd() * cw, y: rnd() * ch },
      r = base.rotation,
      s = base.scale;
    const anchor = {
      x: s * (Math.cos(r) * q.x - Math.sin(r) * q.y) + base.tx,
      y: s * (Math.sin(r) * q.x + Math.cos(r) * q.y) + base.ty,
    };
    const dest = { x: rnd() * width, y: rnd() * height },
      factor = 1 + rnd() * 8,
      delta = rnd() * 2 - 1;
    const next = transformAt(base, factor, delta, anchor, dest),
      mapped = contentToViewport(next, q);
    near(mapped.x, dest.x);
    near(mapped.y, dest.y);
    const centre = {
      x:
        (Math.cos(next.rotation) * (width / 2 - next.tx) +
          Math.sin(next.rotation) * (height / 2 - next.ty)) /
        next.scale,
      y:
        (-Math.sin(next.rotation) * (width / 2 - next.tx) +
          Math.cos(next.rotation) * (height / 2 - next.ty)) /
        next.scale,
    };
    const resized = resizeView(next, width * 1.2, height * 0.8),
      point = contentToViewport(resized, centre);
    near(point.x, resized.width / 2);
    near(point.y, resized.height / 2);
  }
});

test("behavior: linear timeline oracle handles ties, surfaces, uncertainty and delayed delivery", () => {
  const rnd = random(83);
  for (let run = 0; run < 40; run++) {
    const session = new GazeSession(),
      effective = { A: new Map(), B: new Map() };
    const uncertainty = run % 3;
    session.clocks.register({
      id: "test",
      epoch: "1",
      sourceOriginMs: 0,
      sessionOriginMs: 0,
      uncertaintyMs: uncertainty,
    });
    const view = createView({
      width: 500,
      height: 400,
      contentWidth: 1000,
      contentHeight: 800,
    });
    for (let t = 0; t <= 200; t += 10)
      for (const surfaceId of ["A", "B"]) {
        const tx = -(Math.floor(rnd() * 3) * 10);
        // Zero-duration intermediate states are superseded by the last snapshot at t.
        if (t > 0)
          session.present({
            t,
            view,
            matrix: [0.5, 0, 0, 0.5, 99, 0],
            surface: { id: surfaceId, epoch: "1" },
          });
        const f = session.present({
          t,
          view,
          matrix: [0.5, 0, 0, 0.5, tx, 0],
          surface: { id: surfaceId, epoch: "1" },
        });
        effective[surfaceId].set(t, f);
      }
    const expected = [];
    for (let i = 0; i < 80; i++) {
      const t = 5 + ((i * 23) % 190),
        surfaceId = i % 2 ? "A" : "B",
        history = [...effective[surfaceId].values()];
      const at = (x) => history.filter((f) => f.t <= x).at(-1);
      const f = at(t),
        start = at(t - uncertainty);
      const ambiguous = history.some(
        (f) =>
          f.t > t - uncertainty &&
          f.t <= t + uncertainty &&
          f.matrix[4] !== start.matrix[4],
      );
      expected.push({ id: String(i), f, ambiguous });
      session.gaze(
        {
          id: String(i),
          sourceId: "test",
          eye: "left",
          clockId: "test",
          clockEpoch: "1",
          timeMs: t,
          surfaceId,
          surfaceEpoch: "1",
          type: "pog2d",
          space: "viewport",
          point: { x: 250, y: 200 },
          valid: true,
          confidence: 1,
        },
        210 + i,
      );
    }
    const rows = session.flush(400),
      byId = new Map(rows.map((r) => [r.sampleId, r]));
    for (const e of expected) {
      const r = byId.get(e.id);
      assert.equal(r.frameId, e.f.id);
      assert.equal(r.flags.includes("ambiguous-presentation"), e.ambiguous);
      assert.equal(r.usable, !e.ambiguous);
      near(r.contentPoint.x, (250 - e.f.matrix[4]) / 0.5);
    }
    assert.deepEqual(replay(session.export()).aligned, session.aligned);
  }
});

test("behavior: affine clocks retain measured error bounds at large absolute origins", () => {
  for (const sourceOriginMs of [0, 1e9, 1.7e12])
    for (const rate of [0.9999, 1, 1.0001]) {
      const registry = new ClockRegistry();
      registry.register({
        id: "device",
        epoch: "1",
        sourceOriginMs,
        sessionOriginMs: 50,
        rate,
        uncertaintyMs: 0.01,
        driftUncertaintyPpm: 20,
      });
      for (const delta of [-1000, -0.1, 0, 0.1, 1000]) {
        const result = registry.map("device", "1", sourceOriginMs + delta);
        assert.ok(
          Math.abs(result.timeMs - (50 + rate * delta)) <= result.uncertaintyMs,
        );
        assert.ok(result.uncertaintyMs >= 0.01);
      }
    }
});

test("audit: large configured flushes preserve every pending observation", () => {
  const count = 130000;
  const s = new GazeSession({
    reorderWindowMs: 0,
    maxClockUncertaintyMs: 0,
    maxPending: count,
    maxRecords: count + 2,
  });
  s.registerSource({
    id: "bulk",
    adapter: "fixture",
    kind: "custom",
    trackingMode: "monocular",
    eyes: ["left"],
  });
  s.present({
    t: 0,
    view: createView({
      width: 100,
      height: 100,
      contentWidth: 100,
      contentHeight: 100,
    }),
    surface: { id: "screen", epoch: "1" },
  });
  for (let i = 0; i < count; i++) {
    const timeMs = i / 2;
    s.gaze(
      {
        id: String(i),
        sourceId: "bulk",
        clockId: "session",
        clockEpoch: "0",
        surfaceId: "screen",
        surfaceEpoch: "1",
        eye: "left",
        type: "pog2d",
        space: "viewport",
        point: { x: 50, y: 50 },
        timeMs,
        confidence: 1,
        valid: true,
      },
      timeMs,
    );
  }
  const rows = s.flush(count, { final: true });
  assert.equal(rows.length, count);
  assert.equal(s.pending.length, 0);
  assert.equal(s.aligned.length, count);
  assert.equal(s.alignedDropped, 0);
  assert.equal(s.records.at(-1).type, "flush");
  assert.ok(rows.every((row, i) => row.usable && row.sampleId === String(i)));
});
