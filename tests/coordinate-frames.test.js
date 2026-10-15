import test from "node:test";
import assert from "node:assert/strict";
import { GazeSession, createView } from "../dist/index.js";

const plane = {
  frameId: "display-world",
  topLeft: [-0.265, 0.165, 0],
  right: [1, 0, 0],
  down: [0, -1, 0],
  widthMeters: 0.53,
  heightMeters: 0.33,
  static: true,
};
const observation = {
  id: "c1",
  sourceId: "fixture",
  eye: "left",
  clockId: "session",
  clockEpoch: "0",
  timeMs: 20,
  surfaceId: "screen",
  surfaceEpoch: "1",
  valid: true,
  confidence: 1,
};
const frame = (planeSpace) => ({
  t: 0,
  view: createView({
    width: 1000,
    height: 600,
    contentWidth: 2000,
    contentHeight: 1200,
  }),
  surface: {
    id: "screen",
    epoch: "1",
    plane,
    planeSpace,
    display: { width: 1920, height: 1080, left: 100, top: 80 },
    devicePixelRatio: 2,
  },
});

test("full-display ray and PoG agree at an offset viewport; DPR is applied exactly once by the host", () => {
  const s = new GazeSession();
  s.present(frame("display"));
  s.gaze(
    {
      ...observation,
      type: "ray3d",
      ray: {
        frameId: "display-world",
        origin: [-0.032, 0, 0.6],
        direction: [0.032, 0, -0.6],
      },
    },
    30,
  );
  s.gaze(
    {
      ...observation,
      type: "pog2d",
      space: "normalized-display",
      point: { x: 0.5, y: 0.5 },
    },
    30,
  );
  const [a, b] = s.flush(100);
  assert.ok(
    Math.abs(a.viewportPoint.x - 860) < 1e-9,
    JSON.stringify(a.viewportPoint),
  );
  assert.ok(Math.abs(a.viewportPoint.y - 460) < 1e-9);
  assert.deepEqual(b.viewportPoint, { x: 860, y: 460 });
  assert.ok(Math.abs(a.contentPoint.x - 1720) < 1e-9);
});

test("cropped layout requires the registered plane extent to be declared", () => {
  const s = new GazeSession();
  assert.throws(() => s.present(frame(undefined)), /planeSpace/);
  assert.equal(s.frames.length, 0);
});

import { readFileSync } from "node:fs";
import {
  transformRay,
  transformPlane,
  transformPoint3D,
  transformDirection3D,
  invertRigidTransform,
  validateRigidTransform,
  projectRay,
  replay,
} from "../dist/index.js";
const fixture = JSON.parse(
  readFileSync(
    new URL("../contracts/geometry-fixtures.json", import.meta.url),
    "utf8",
  ),
);
const near = (a, b, tol = 1e-9) =>
  assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const vec = (a, b) => a.forEach((n, i) => near(n, b[i]));
const pt = (a, b) => {
  near(a.x, b.x);
  near(a.y, b.y);
};

test("off-axis camera extrinsics preserve independent eye origins and work in either reference frame", () => {
  const inverse = invertRigidTransform(fixture.worldToCamera);
  vec(inverse.translation, fixture.cameraCenterWorld);
  vec(
    transformPoint3D(fixture.cameraCenterWorld, fixture.worldToCamera),
    [0, 0, 0],
  );
  const cameraPlane = transformPlane(fixture.plane, fixture.worldToCamera);
  vec(cameraPlane.topLeft, [0.305, 0.025, -0.015]);
  vec(cameraPlane.right, [-1, 0, 0]);
  vec(cameraPlane.down, [0, 1, 0]);
  for (const c of fixture.cases) {
    const ray = transformRay(c.rayCamera, inverse);
    vec(ray.origin, c.originWorld);
    vec(ray.direction, c.directionWorld);
    const worldHit = projectRay(ray, fixture.plane, 1920, 1080),
      cameraHit = projectRay(c.rayCamera, cameraPlane, 1920, 1080);
    vec(worldHit.hit, c.hitWorld);
    pt(worldHit.point, {
      x: c.normalizedDisplay.x * 1920,
      y: c.normalizedDisplay.y * 1080,
    });
    pt(worldHit.point, cameraHit.point);
    vec(transformPoint3D(cameraHit.hit, inverse), c.hitWorld);
    near(worldHit.distanceMeters, Math.hypot(...c.directionWorld));
    const back = transformRay(ray, fixture.worldToCamera);
    vec(back.origin, c.rayCamera.origin);
    vec(back.direction, c.rayCamera.direction);
    const s = new GazeSession();
    s.present(frame("display"));
    s.gaze({ ...observation, id: c.name, eye: c.eye, type: "ray3d", ray }, 30);
    const row = s.flush(100)[0];
    pt(row.viewportPoint, c.viewportPoint);
    assert.equal(row.rayHit.frameId, "display-world");
    assert.deepEqual(replay(s.export()).aligned, s.aligned);
  }
});

test("camera origin is not an eye origin, and direction translation is never applied", () => {
  const c = fixture.cases[0],
    cameraPlane = transformPlane(fixture.plane, fixture.worldToCamera);
  const wrong = projectRay(
    { ...c.rayCamera, origin: [0, 0, 0] },
    cameraPlane,
    1920,
    1080,
  );
  assert.ok(Math.hypot(wrong.point.x - 960, wrong.point.y - 540) > 500);
  const q = fixture.quarterTurn,
    ray = transformRay(q.ray, q.transform);
  vec(ray.origin, q.expectedOrigin);
  vec(ray.direction, q.expectedDirection);
  const hit = projectRay(ray, q.plane, 1000, 1000);
  vec(hit.hit, q.expectedHit);
  pt(hit.point, q.expectedPoint);
  near(hit.distanceMeters, q.expectedDistance);
  for (const scale of [1e-200, 1, 1e200])
    pt(
      projectRay(
        { ...ray, direction: ray.direction.map((x) => x * scale) },
        q.plane,
        1000,
        1000,
      ).point,
      q.expectedPoint,
    );
});

test("rigid validation rejects a reflection, shear, scaling and a mislabeled frame", () => {
  for (const rotation of [
    [-1, 0, 0, 0, 1, 0, 0, 0, 1],
    [1, 0.1, 0, 0, 1, 0, 0, 0, 1],
    [2, 0, 0, 0, 1, 0, 0, 0, 1],
  ])
    assert.throws(
      () => validateRigidTransform({ ...fixture.worldToCamera, rotation }),
      /rotation/,
    );
  assert.throws(
    () => transformRay(fixture.cases[0].rayCamera, fixture.worldToCamera),
    /frameId/,
  );
  assert.throws(
    () =>
      transformPlane(
        fixture.plane,
        invertRigidTransform(fixture.worldToCamera),
      ),
    /frameId/,
  );
  assert.equal(
    transformPlane(fixture.plane, { ...fixture.worldToCamera, static: false })
      .static,
    false,
  );
  const noTime = { ...fixture.worldToCamera };
  delete noTime.static;
  assert.equal(transformPlane(fixture.plane, noTime).static, false);
  assert.throws(
    () =>
      new GazeSession().present({
        t: 0,
        view: frame("display").view,
        surface: {
          id: "s",
          epoch: "e",
          plane: transformPlane(fixture.plane, noTime),
        },
      }),
    /poseTimeMs/,
  );
});

test("explicit viewport planes use their physical subrectangle and need no second offset", () => {
  const p = {
    ...plane,
    topLeft: [-0.265 + (0.53 * 100) / 1920, 0.165 - (0.33 * 80) / 1080, 0],
    widthMeters: (0.53 * 1000) / 1920,
    heightMeters: (0.33 * 600) / 1080,
  };
  const s = new GazeSession(),
    f = frame("viewport");
  f.surface.plane = p;
  s.present(f);
  const ray = transformRay(
    fixture.cases[0].rayCamera,
    invertRigidTransform(fixture.worldToCamera),
  );
  s.gaze({ ...observation, type: "ray3d", ray }, 30);
  pt(s.flush(100)[0].viewportPoint, { x: 860, y: 460 });
  const missing = frame("display");
  delete missing.surface.display;
  assert.throws(() => new GazeSession().present(missing), /display layout/);
});

test("changing the plane extent is a visual boundary under uncertain clocks", () => {
  const s = new GazeSession();
  s.clocks.register({
    id: "device",
    epoch: "boot",
    sourceOriginMs: 0,
    sessionOriginMs: 0,
    uncertaintyMs: 2,
  });
  const a = frame("viewport");
  s.present(a);
  s.present({ ...frame("display"), t: 100 });
  const ray = transformRay(
    fixture.cases[0].rayCamera,
    invertRigidTransform(fixture.worldToCamera),
  );
  s.gaze(
    {
      ...observation,
      clockId: "device",
      clockEpoch: "boot",
      timeMs: 99,
      type: "ray3d",
      ray,
    },
    130,
  );
  assert.ok(s.flush(200)[0].flags.includes("ambiguous-presentation"));
});

test("finite display bounds exclude hits outside the active panel even inside a larger window", () => {
  const s = new GazeSession(),
    f = frame("display");
  f.view = createView({
    width: 3000,
    height: 2000,
    contentWidth: 3000,
    contentHeight: 2000,
  });
  f.surface.display = { ...f.surface.display, left: 0, top: 0 };
  s.present(f);
  s.gaze(
    {
      ...observation,
      type: "ray3d",
      ray: {
        frameId: "display-world",
        origin: [0, 0, 0.6],
        direction: [0.3975, 0, -0.6],
      },
    },
    30,
  );
  s.gaze(
    {
      ...observation,
      type: "pog2d",
      space: "normalized-display",
      point: { x: 1.25, y: 0.5 },
    },
    30,
  );
  s.gaze(
    {
      ...observation,
      id: "viewport-source",
      type: "pog2d",
      space: "normalized-viewport",
      point: { x: 0.8, y: 0.27 },
    },
    30,
  );
  for (const row of s.flush(100)) {
    assert.ok(row.flags.includes("off-display"));
    assert.ok(!row.flags.includes("off-viewport"));
    assert.equal(row.usable, false);
  }
});

import { TobiiProAdapter } from "../dist/adapters.js";
test("Tobii UCS origin remains the tracker origin, distinct from camera and display centre", () => {
  const s = new GazeSession(),
    adapter = new TobiiProAdapter({
      sourceId: "fixture",
      clockId: "session",
      clockEpoch: "0",
      surfaceId: "screen",
      surfaceEpoch: "1",
      includeRay: true,
      frameId: "tobii-ucs",
    });
  s.registerSource(adapter.source);
  const f = frame("display");
  f.surface.plane = {
    ...plane,
    frameId: "tobii-ucs",
    topLeft: [-0.265, 0.35, 0.02],
  };
  s.present(f);
  const packet = { device_time_stamp: 20000 };
  for (const [eye, x] of [
    ["left", -32],
    ["right", 32],
  ])
    Object.assign(packet, {
      [`${eye}_gaze_point_on_display_area`]: [0.5, 0.5],
      [`${eye}_gaze_point_validity`]: true,
      [`${eye}_gaze_origin_validity`]: true,
      [`${eye}_gaze_origin_in_user_coordinate_system`]: [x, 170, 650],
      [`${eye}_gaze_point_in_user_coordinate_system`]: [0, 185, 20],
    });
  for (const row of adapter.adapt(packet).samples) s.gaze(row, 30);
  for (const row of s.flush(100)) {
    pt(row.viewportPoint, { x: 860, y: 460 });
    if (row.type === "ray3d") vec(row.rayHit.pointMeters, [0, 0.185, 0.02]);
  }
});

import { generateExperiment } from "../dist/experiments.js";
test("orientation swaps one measured physical panel without changing its size", () => {
  const e = generateExperiment({
    width: 390,
    height: 844,
    displayHz: 60,
    inputHz: 120,
    gazeHz: 120,
    mode: "monocular-left",
    rotateMidway: true,
    physicalWidthMeters: 0.072,
    physicalHeightMeters: 0.156,
  });
  const frames = e.events
    .filter((x) => x.type === "frame")
    .map((x) => x.payload);
  assert.equal(frames[0].surface.plane.widthMeters, 0.072);
  assert.equal(frames.at(-1).surface.plane.widthMeters, 0.156);
  assert.equal(frames.at(-1).surface.plane.heightMeters, 0.072);
  for (const invalid of [0, null, NaN, false])
    assert.throws(
      () => generateExperiment({ ...e.config, physicalWidthMeters: invalid }),
      /physicalWidthMeters/,
    );
});

test("edge classification tolerates arithmetic roundoff, retaining original coordinates", () => {
  const s = new GazeSession(),
    f = frame("display");
  f.view = createView({
    width: 1920,
    height: 1080,
    contentWidth: 1920,
    contentHeight: 1080,
  });
  f.surface.display = { width: 1920, height: 1080, left: 0, top: 0 };
  s.present(f);
  for (const [id, x] of [
    ["roundoff", -Number.EPSILON],
    ["outside", -1e-7],
  ])
    s.gaze(
      {
        ...observation,
        id,
        type: "pog2d",
        space: "normalized-display",
        point: { x, y: 0.5 },
      },
      30,
    );
  const rows = s.flush(100);
  assert.equal(rows[0].usable, true);
  assert.ok(rows[0].viewportPoint.x < 0);
  assert.ok(rows[1].flags.includes("off-display"));
});

test("arbitrary rigid changes of frame preserve the display crossing and invert points and directions", () => {
  for (let i = 0; i < 100; i++) {
    const a = i * 0.137,
      b = i * 0.091,
      ca = Math.cos(a),
      sa = Math.sin(a),
      cb = Math.cos(b),
      sb = Math.sin(b);
    const t = {
      fromFrameId: "display-world",
      toFrameId: "audit-frame",
      rotation: [cb * ca, -cb * sa, sb, sa, ca, 0, -sb * ca, sb * sa, cb],
      translation: [0.3 * Math.sin(i), -0.2 * Math.cos(i), 0.1 + i * 0.001],
      static: true,
    };
    const ray = {
      frameId: "display-world",
      origin: [-0.032, 0, 0.6],
      direction: [0.032, 0, -0.6],
    };
    const moved = transformRay(ray, t),
      p = transformPlane(plane, t),
      hit = projectRay(moved, p, 1920, 1080);
    pt(hit.point, { x: 960, y: 540 });
    vec(transformPoint3D(hit.hit, invertRigidTransform(t)), [0, 0, 0]);
    const restored = transformRay(moved, invertRigidTransform(t));
    vec(restored.origin, ray.origin);
    vec(restored.direction, ray.direction);
  }
});

import { simulatedPlane } from "../dist/simulation.js";
test("the interaction lab keeps panel origin and metric pixel pitch fixed during desktop resize", () => {
  const before = simulatedPlane("desktop", false, 0, false, {
    width: 1080,
    height: 680,
  });
  const after = simulatedPlane("desktop", true, 0, false, {
    width: 900,
    height: 600,
  });
  vec(before.topLeft, after.topLeft);
  near(before.widthMeters / 1080, after.widthMeters / 900);
  near(before.heightMeters / 680, after.heightMeters / 600);
  const portrait = simulatedPlane("mobile"),
    landscape = simulatedPlane("mobile", true);
  near(portrait.widthMeters, landscape.heightMeters);
  near(portrait.heightMeters, landscape.widthMeters);
});
