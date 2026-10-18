/** Ten virtual minutes of mixed 2D/3D capture, two surfaces, delayed delivery and retention rollover.
 * This deterministic check is not a wall-clock endurance or hardware performance study. */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  GazeSession,
  createView,
  replay,
  IMPLEMENTATION_VERSION,
} from "../dist/index.js";
const started = performance.now();
const s = new GazeSession({ maxRecords: 2048, maxFrames: 90, maxPending: 256 });
s.registerSource({
  id: "soak",
  kind: "simulated",
  adapter: "independent-target",
  eyes: ["left", "right"],
  trackingMode: "binocular-independent",
  eyeRatesHz: { left: 240, right: 120 },
  timestampKind: "exposure",
});
const desktop = createView({
  width: 800,
  height: 600,
  contentWidth: 1600,
  contentHeight: 1200,
});
const mobile = createView({
  width: 390,
  height: 844,
  contentWidth: 800,
  contentHeight: 1200,
});
const plane = {
  frameId: "world",
  static: true,
  topLeft: [-0.265, 0.165, 0],
  right: [1, 0, 0],
  down: [0, -1, 0],
  widthMeters: 0.53,
  heightMeters: 0.33,
};
const deliveries = new Map();
const ticks = 600 * 240;
let expected = 0,
  received = 0,
  usable = 0,
  invalid = 0,
  maxPending = 0,
  maxResidual = 0;
function collect(rows) {
  for (const row of rows) {
    received++;
    if (row.usable) {
      usable++;
      const x = row.eye === "left" ? 800 : 400,
        y = 600;
      maxResidual = Math.max(
        maxResidual,
        Math.hypot(row.contentPoint.x - x, row.contentPoint.y - y) *
          (row.eye === "left" ? desktop.scale : mobile.scale),
      );
    } else {
      invalid++;
      assert.deepEqual(
        row.flags.filter((f) => !["late-arrival", "high-latency"].includes(f)),
        ["invalid-measurement"],
      );
    }
  }
}
for (let i = 0; i < ticks + 120; i++) {
  const t = (i * 1000) / 240;
  if (i % 4 === 0) {
    s.present({ t, view: desktop, surface: { id: "desktop", epoch: "1" } });
    s.present({
      t,
      view: mobile,
      surface: { id: "mobile", epoch: "1", plane },
    });
  }
  if (i < ticks) {
    for (const eye of i % 2 === 0 ? ["left", "right"] : ["left"]) {
      const valid = !(i % 4800 >= 120 && i % 4800 < 144);
      const sample = {
        id: `${eye}-${i}`,
        sourceId: "soak",
        eye,
        clockId: "session",
        clockEpoch: "0",
        timeMs: t,
        surfaceId: eye === "left" ? "desktop" : "mobile",
        surfaceEpoch: "1",
        valid,
        confidence: 1,
        ...(eye === "left"
          ? {
              type: "pog2d",
              space: "normalized-viewport",
              point: { x: 0.5, y: 0.5 },
            }
          : {
              type: "ray3d",
              ray: {
                frameId: "world",
                origin: [0.032, 0, 0.6],
                direction: [-0.032, 0, -0.6],
              },
            }),
      };
      const due = i + (i % 997 === 0 ? 84 : 8);
      if (!deliveries.has(due)) deliveries.set(due, []);
      deliveries.get(due).push(sample);
      expected++;
    }
  }
  for (const sample of deliveries.get(i) ?? []) s.gaze(sample, t);
  deliveries.delete(i);
  maxPending = Math.max(maxPending, s.pending.length);
  if (i % 4 === 0) collect(s.flush(t));
  assert.ok(
    s.frames.length <= 90 &&
      s.records.length <= 2048 &&
      s.pending.length <= 256,
  );
}
collect(s.flush(((ticks + 120) * 1000) / 240, { final: true }));
assert.equal(received, expected);
assert.equal(deliveries.size, 0);
assert.equal(s.pending.length, 0);
assert.equal(invalid, 1080);
assert.equal(usable, expected - invalid);
assert.ok(maxResidual < 1e-8);
const recording = s.export();
assert.equal(
  recording.recordsDropped,
  recording.recordCount - recording.records.length,
);
assert.equal(recording.alignedDropped, received - recording.aligned.length);
assert.throws(() => replay(recording), /truncated/);
const result = {
  implementationVersion: IMPLEMENTATION_VERSION,
  retentionLimits: { maxRecords: 2048, maxFrames: 90, maxPending: 256 },
  simulatedDurationSeconds: 600,
  displayHz: 60,
  leftGazeHz: 240,
  rightGazeHz: 120,
  surfaces: 2,
  expected,
  received,
  usable,
  invalid,
  maxPending,
  maxReconstructionResidual: maxResidual,
  recordsDropped: s.recordsDropped,
  alignedDropped: s.alignedDropped,
  elapsedSeconds: (performance.now() - started) / 1000,
  realTimeOrHardwareStudy: false,
};
const output = new URL(
  "../artifacts/validation/retention.json",
  import.meta.url,
);
mkdirSync(new URL(".", output), { recursive: true });
writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
