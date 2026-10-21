import test from "node:test";
import assert from "node:assert/strict";
import { GazeSession, createView, pairEyes } from "../dist/index.js";
import {
  generateExperiment,
  executeExperiment,
  summarizeExperiment,
} from "../dist/experiments.js";
const setup = () => {
  const s = new GazeSession();
  s.present({
    t: 0,
    view: createView({
      width: 800,
      height: 600,
      contentWidth: 1600,
      contentHeight: 1200,
    }),
    surface: { id: "screen", epoch: "1" },
  });
  return s;
};
const sample = (eye, timeMs, extra = {}) => ({
  id: String(timeMs),
  sourceId: "device",
  eye,
  clockId: "session",
  clockEpoch: "0",
  timeMs,
  surfaceId: "screen",
  surfaceEpoch: "1",
  type: "pog2d",
  space: "normalized-viewport",
  point: { x: 0.5, y: 0.5 },
  confidence: null,
  valid: true,
  ...extra,
});
test("left/right/type are part of observation identity; missing confidence is not invented", () => {
  const s = setup();
  s.gaze(sample("left", 20), 40);
  s.gaze(sample("right", 20), 40);
  const rows = s.flush(100);
  assert.equal(rows.length, 2);
  assert.ok(
    rows.every((a) => a.usable && a.flags.includes("confidence-unavailable")),
  );
  assert.equal(pairEyes(rows).length, 1);
  assert.equal(pairEyes(rows)[0].skewMs, 0);
  assert.throws(() => s.gaze(sample("left", 20), 101), /Duplicate/);
});
test("direction-only model signal is retained but never projected with a manufactured origin", () => {
  const s = setup();
  const p = sample("unknown", 20, {
    type: "direction3d",
    direction: [0, 0, -1],
    frameId: "head",
  });
  delete p.point;
  delete p.space;
  s.gaze(p, 40);
  const a = s.flush(100)[0];
  assert.equal(a.usable, false);
  assert.equal(a.contentPoint, null);
  assert.ok(a.flags.includes("direction-only"));
  assert.ok(
    s.diagnostics
      .report()
      .issues.some((d) => d.code === "GEOMETRY_UNAVAILABLE"),
  );
});
test("rate and presentation warnings distinguish sampled frames from change-only logging", () => {
  const s = setup();
  s.registerSource({
    id: "device",
    kind: "tracker",
    adapter: "fixture",
    eyes: ["left"],
    trackingMode: "monocular",
    expectedHz: 120,
  });
  for (let i = 0; i < 80; i++) s.gaze(sample("left", i * 20 + 10), i * 20 + 20);
  s.flush(1800);
  assert.ok(
    s.diagnostics
      .report()
      .issues.some((d) => d.code === "SOURCE_RATE_DEVIATION"),
  );
  const quiet = setup();
  quiet.present({
    t: 5000,
    view: createView({
      width: 800,
      height: 600,
      contentWidth: 1600,
      contentHeight: 1200,
    }),
    surface: {
      id: "screen",
      epoch: "1",
      expectedPresentationHz: 60,
      presentationMode: "change-only",
    },
  });
  assert.equal(
    quiet.diagnostics
      .report()
      .issues.some((d) => d.code === "PRESENTATION_GAP"),
    false,
  );
});
test("diagnostic callback failures are counted without interrupting capture", () => {
  let calls = 0;
  const s = new GazeSession(
    {},
    {
      onDiagnostic() {
        calls++;
        throw new Error("observer failed");
      },
    },
  );
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
  s.gaze(sample("left", 20), 30);
  assert.equal(s.flush(100).length, 1);
  const failed = s.diagnostics
    .report()
    .issues.find((d) => d.code === "CALLBACK_FAILED");
  assert.ok(calls > 1);
  assert.equal(failed.count, calls);
});
test("unequal per-eye rates and independent clocks survive orientation and high event rates", () => {
  const experiment = generateExperiment({
    name: "asynchronous-eyes",
    width: 390,
    height: 844,
    displayHz: 144,
    inputHz: 1000,
    gazeHz: 600,
    rightGazeHz: 120,
    mode: "binocular-independent",
    independentClocks: true,
    rotateMidway: true,
  });
  const s = executeExperiment(experiment),
    summary = summarizeExperiment(experiment, s);
  assert.equal(summary.frameMismatches, 0);
  assert.ok(summary.maxReconstructionErrorPx < 1e-6);
  assert.equal(summary.replayExact, true);
  assert.ok(
    s.aligned.filter((a) => a.eye === "left").length >
      s.aligned.filter((a) => a.eye === "right").length,
  );
  assert.ok(
    pairEyes(s.aligned).every(
      (pair) => pair.left === null || pair.right === null,
    ),
    "Different clock epochs/IDs are not implicitly fused",
  );
});

test("receipt-only clocks cannot establish capture alignment", () => {
  const s = setup();
  s.registerSource({
    id: "device",
    kind: "custom",
    adapter: "host-only",
    eyes: ["left"],
    trackingMode: "monocular",
    timestampKind: "host-receipt",
  });
  s.gaze(sample("left", 20), 20);
  const a = s.flush(100)[0];
  assert.equal(a.usable, false);
  assert.ok(a.flags.includes("receipt-time-only"));
  assert.ok(
    s.diagnostics
      .report()
      .issues.some((d) => d.code === "EXPOSURE_TIME_REQUIRED"),
  );
});

test("source registration is insensitive to JSON object key order but rejects changed rates", () => {
  const s = setup();
  const source = {
    id: "device",
    kind: "tracker",
    adapter: "fixture",
    eyes: ["left", "right"],
    trackingMode: "binocular-independent",
    eyeRatesHz: { left: 120, right: 60 },
  };
  s.registerSource(source);
  const reordered = Object.fromEntries(Object.entries(source).reverse());
  reordered.eyeRatesHz = { right: 60, left: 120 };
  assert.deepEqual(s.registerSource(reordered), source);
  assert.throws(
    () =>
      s.registerSource({ ...source, eyeRatesHz: { left: 120, right: 120 } }),
    /immutable/,
  );
});

test("binocular pairing separates content replacements within a layout epoch", () => {
  const s = setup();
  s.present({
    t: 10,
    view: s.frames[0].view,
    contentId: "next-page",
    surface: { id: "screen", epoch: "1" },
  });
  s.gaze(sample("left", 9), 20);
  s.gaze(sample("right", 11), 20);
  const rows = s.flush(100);
  assert.ok(rows.every((row) => row.usable));
  const pairs = pairEyes(rows);
  assert.equal(pairs.length, 2);
  assert.ok(pairs.every((pair) => pair.left === null || pair.right === null));
});

test("audit: malformed per-eye rate maps reject before source registration", () => {
  const s = new GazeSession();
  const source = {
    id: "device",
    kind: "tracker",
    adapter: "fixture",
    trackingMode: "monocular",
    eyes: ["left"],
  };
  for (const eyeRatesHz of [null, [], false, 0, "120"]) {
    assert.throws(
      () => s.registerSource({ ...source, eyeRatesHz }),
      /eyeRatesHz must be a mapping/,
    );
    assert.deepEqual(s.export().sources, []);
  }
  s.registerSource({ ...source, eyeRatesHz: { left: 120 } });
  s.gaze(sample("left", 1), 1);
  assert.equal(s.pending.length, 1);
});
