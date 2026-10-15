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
