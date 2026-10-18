import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ModelAdapter,
  TobiiProAdapter,
  EyeLinkAdapter,
  PupilCoreAdapter,
} from "../dist/adapters.js";
const fixture = JSON.parse(
  readFileSync(
    new URL("../contracts/adapter-fixtures.json", import.meta.url),
    "utf8",
  ),
);
const classes = {
  model: ModelAdapter,
  tobii: TobiiProAdapter,
  eyelink: EyeLinkAdapter,
  pupil: PupilCoreAdapter,
};
for (const c of fixture.cases)
  test(`adapter contract: ${c.name}`, () => {
    const adapter = new classes[c.adapter]({ ...fixture.base, ...c.options });
    const results = c.packets.map((p) =>
      c.method === "surface" ? adapter.adaptSurface(p) : adapter.adapt(p),
    );
    assert.deepEqual(
      results.map((r) => r.samples.length),
      c.expectedCounts,
    );
    const samples = results.flatMap((r) => r.samples);
    if (c.expectedValid)
      assert.deepEqual(
        samples.map((s) => s.valid),
        c.expectedValid,
      );
    if (c.expectedTimeMs !== undefined)
      assert.equal(samples[0].timeMs, c.expectedTimeMs);
    if (c.expectedOrigin)
      assert.deepEqual(samples[0].ray.origin, c.expectedOrigin);
    if (c.expectedPoint) {
      const p = samples.find((s) => s.type === "pog2d" && s.valid).point;
      assert.ok(
        Math.hypot(p.x - c.expectedPoint.x, p.y - c.expectedPoint.y) < 1e-12,
      );
    }
    if (c.requiredWarning)
      assert.ok(
        results
          .flatMap((r) => r.warnings)
          .some((w) => w.code === c.requiredWarning),
      );
    assert.equal(adapter.source.hardwareValidated, false);
  });
test("Pupil scene gaze never silently becomes a screen point", () => {
  const adapter = new PupilCoreAdapter({ ...fixture.base, frameId: "camera" });
  const result = adapter.adapt({
    topic: "gaze.3d.01.",
    timestamp: 1,
    norm_pos: [0.5, 0.5],
    confidence: 0.9,
  });
  assert.equal(result.samples.length, 0);
  assert.ok(
    result.warnings.some((w) => w.code === "SURFACE_REGISTRATION_REQUIRED"),
  );
});

test("model options reject unknown units and remain detached from caller mutations", () => {
  const options = {
    sourceId: "model",
    clockId: "session",
    clockEpoch: "0",
    surfaceId: "screen",
    surfaceEpoch: "1",
    type: "pog2d",
    eye: "left",
    timestampUnit: "ms",
    pointUnits: "display-pixels",
    displayPixels: { width: 1000, height: 1000 },
  };
  for (const changes of [
    { originUnits: "cm" },
    { yOrigin: "sideways" },
    { type: "3d" },
    { pointUnits: "pixels" },
    { timestampUnit: "seconds" },
    { fields: { point: "" } },
    { eyes: ["left", "left"] },
  ])
    assert.throws(() => new ModelAdapter({ ...options, ...changes }));
  const adapter = new ModelAdapter(options);
  options.displayPixels.width = 1;
  options.sourceId = "changed";
  adapter.source.eyes.length = 0;
  const row = adapter.adapt({ timestamp: 1, point: [500, 500] }).samples[0];
  assert.deepEqual(row.point, { x: 0.5, y: 0.5 });
  assert.equal(row.sourceId, "model");
  assert.deepEqual(adapter.source.eyes, ["left"]);
});

test("Pupil validates a complete packet before committing per-eye deduplication", () => {
  const a = new PupilCoreAdapter({
    sourceId: "pupil",
    clockId: "eye-clock",
    clockEpoch: "0",
    surfaceId: "screen",
    surfaceEpoch: "1",
    frameId: "camera",
  });
  const packet = {
    topic: "gaze.3d.01.",
    timestamp: 1,
    confidence: 0.9,
    eye_centers_3d: { 0: [30, 0, 600], 1: [-30, 0, 600] },
    gaze_normals_3d: { 0: [0, 0, -1], 1: [0, 0, -1] },
    base_data: [
      { id: 0, timestamp: 1, confidence: 0.9 },
      { id: 1, timestamp: 1, confidence: 2 },
    ],
  };
  assert.throws(() => a.adapt(packet), /Confidence/);
  packet.base_data[1].confidence = 0.9;
  assert.equal(a.adapt(packet).samples.length, 2);
  assert.equal(a.adapt(packet).samples.length, 0);
  assert.equal(a.adapt(packet, { clockId: "other-clock" }).samples.length, 2);
  packet.base_data[0].confidence = null;
  packet.base_data[0].timestamp = null;
  const unknown = a
    .adapt(packet, { clockId: "third-clock" })
    .samples.find((s) => s.eye === "right");
  assert.equal(unknown.confidence, null); // Never borrow the fused packet's confidence for this eye.
  assert.equal(unknown.timeMs, 1000);
});

test("Pupil homographies reject rank loss and preserve projective scale", () => {
  const options = {
    ...fixture.base,
    eyes: ["right"],
    mappingId: "calibration",
  };
  const packet = {
    topic: "gaze.2d.0.",
    timestamp: 1,
    norm_pos: [0.25, 0.75],
    confidence: 0.9,
  };
  for (const scale of [1, 1e-150, -1e-150, 1e150]) {
    const adapter = new PupilCoreAdapter({
      ...options,
      sceneToSurface: [scale, 0, 0, 0, scale, 0, 0, 0, scale],
    });
    const row = adapter.adapt(packet).samples[0];
    assert.equal(row.valid, true);
    assert.deepEqual(row.point, { x: 0.25, y: 0.25 });
  }
  for (const h of [
    [0, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 2, 0, 0, 0, 0, 1],
    Array(9).fill(0),
  ])
    assert.throws(
      () => new PupilCoreAdapter({ ...options, sceneToSurface: h }),
      /homography/i,
    );
});
