import {
  createView,
  GazeSession,
  ZoomController,
  type GazeSample,
  type Recording,
} from "gazesync";
import { attachBrowserControls } from "gazesync/browser";
import { runScenario, type SimulationSummary } from "gazesync/simulation";
const session = new GazeSession();
const controller = new ZoomController(
  createView({
    width: 800,
    height: 600,
    contentWidth: 1600,
    contentHeight: 1200,
  }),
  { inputPrefix: "surface-A", onInput: (event) => session.input(event) },
);
const base = {
  id: "sample",
  sourceId: "eye",
  eye: "unknown" as const,
  clockId: "session",
  clockEpoch: "0",
  timeMs: 10,
  surfaceId: "A",
  surfaceEpoch: "1",
  confidence: 1,
};
const sample: GazeSample = {
  ...base,
  type: "pog2d",
  valid: true,
  point: { x: 0.5, y: 0.5 },
  space: "normalized-viewport",
};
session.gaze(sample, 20);
const dropout: GazeSample = { ...base, type: "ray3d", valid: false };
session.gaze(dropout, 20);
// @ts-expect-error valid PoG needs point and coordinate space
const missing: GazeSample = { ...base, type: "pog2d", valid: true };
const wrongRay: GazeSample = {
  ...base,
  type: "ray3d",
  valid: true,
  // @ts-expect-error ray origin needs exactly three components
  ray: { origin: [0, 0], direction: [0, 0, -1], frameId: "world" },
};
const recording: Recording = session.export();
const summary: SimulationSummary = runScenario("desktop").summary;
declare const element: HTMLCanvasElement;
attachBrowserControls(element, controller).dispose();
void [recording, summary, missing, wrongRay];

import {
  transformRay,
  invertRigidTransform,
  transformPlane,
  type RigidTransform,
  type Ray,
  type Surface,
} from "gazesync";
const worldToCamera: RigidTransform = {
  fromFrameId: "world",
  toFrameId: "camera",
  rotation: [-1, 0, 0, 0, -1, 0, 0, 0, 1],
  translation: [0.04, 0.19, -0.015],
  static: true,
};
const cameraRay: Ray = {
  frameId: "camera",
  origin: [0.072, 0.19, 0.585],
  direction: [-0.032, 0, -0.6],
};
const worldRay: Ray = transformRay(
  cameraRay,
  invertRigidTransform(worldToCamera),
);
const registered: Surface = {
  id: "screen",
  epoch: "1",
  planeSpace: "display",
  display: { width: 1920, height: 1080, left: 100, top: 80 },
  plane: {
    frameId: "world",
    topLeft: [-0.265, 0.165, 0],
    right: [1, 0, 0],
    down: [0, -1, 0],
    widthMeters: 0.53,
    heightMeters: 0.33,
    static: true,
  },
};
const cameraPlane = transformPlane(registered.plane!, worldToCamera);
// @ts-expect-error a rigid rotation needs nine row-major coefficients
const badTransform: RigidTransform = { ...worldToCamera, rotation: [1, 0, 0] };
void [worldRay, cameraPlane, badTransform];
