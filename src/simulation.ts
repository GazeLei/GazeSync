import type {
  Device,
  GazeSample,
  InputEventRecord,
  Plane,
  Point,
  PointerInput,
  Ray,
  Scenario,
  SimulationConfig,
  SimulationFrame,
  SimulationOptions,
  SimulationPhase,
  SimulationSummary,
  SimulationTruth,
  Vector3,
  View,
} from "./types.js";
export type {
  Device,
  Scenario,
  SimulationOptions,
  SimulationSummary,
} from "./types.js";
export {
  generateExperiment,
  executeExperiment,
  summarizeExperiment,
} from "./experiments.js";
export type {
  Experiment,
  ExperimentConfig,
  ExperimentSummary,
} from "./experiments.js";
import {
  createView,
  contentToViewport,
  viewportToContent,
  zoomLevel,
} from "./geometry.js";
import { ZoomController } from "./controller.js";
import { GazeSession, replay } from "./session.js";

/** All behavior parameters below are test assumptions, not a fitted human model. */
export const simulationDefaults = Object.freeze({
  durationMs: 9000,
  gazeHz: 120,
  displayHz: 60,
  noiseSdPx: 0.45,
  latencyMs: 28,
  jitterMs: 35,
  clockRate: 1.00012,
  clockOffsetMs: 84000,
});
const ease = (x: number) => {
  const u = Math.max(0, Math.min(1, x));
  return u * u * u * (10 + u * (-15 + u * 6));
};
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const at = <T extends { t: number }>(list: T[], t: number): T => {
  let lo = 0,
    hi = list.length;
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    if (list[m].t <= t) lo = m + 1;
    else hi = m;
  }
  return list[Math.max(0, lo - 1)];
};

export function randomGenerator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let n = state;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

export function simulatedPlane(
  device: Device,
  landscape = false,
  timeMs = 0,
  moving = false,
  viewport?: Pick<View, "width" | "height">,
): Plane {
  // Synthetic full panels have square logical pixels. Desktop resize crops a
  // top-left-anchored viewport; phone rotation swaps the same physical panel.
  const fullWidth = device === "mobile" ? (landscape ? 700 : 390) : 1080;
  const fullHeight = device === "mobile" ? (landscape ? 390 : 700) : 680;
  const metresPerPixel = device === "mobile" ? 0.072 / 390 : 0.53 / 1080;
  const fullWidthMeters = fullWidth * metresPerPixel,
    fullHeightMeters = fullHeight * metresPerPixel;
  const widthMeters = (viewport?.width ?? fullWidth) * metresPerPixel;
  const heightMeters = (viewport?.height ?? fullHeight) * metresPerPixel;
  if (
    !Number.isFinite(widthMeters) ||
    widthMeters <= 0 ||
    !Number.isFinite(heightMeters) ||
    heightMeters <= 0
  )
    throw new TypeError(
      "Synthetic viewport dimensions must be positive and finite",
    );
  const yaw = moving ? 0.06 * Math.sin(timeMs / 1400) : 0;
  const roll = moving ? 0.025 * Math.cos(timeMs / 1700) : 0;
  const cy = Math.cos(yaw),
    sy = Math.sin(yaw),
    cr = Math.cos(roll),
    sr = Math.sin(roll);
  const right: Vector3 = [cy * cr, sr, -sy * cr],
    down: Vector3 = [cy * sr, -cr, -sy * sr];
  const center = moving
    ? [
        0.004 * Math.sin(timeMs / 1300),
        0.003 * Math.cos(timeMs / 1900),
        0.008 * Math.sin(timeMs / 1800),
      ]
    : [0, 0, 0];
  const topLeft = center.map(
    (n, i) =>
      n - (right[i] * fullWidthMeters) / 2 - (down[i] * fullHeightMeters) / 2,
  );
  // Pose is held between display samples in this fixture. Real pose error needs a physical check.
  return {
    frameId: "simulated-world",
    topLeft: topLeft as Vector3,
    right,
    down,
    widthMeters,
    heightMeters,
    static: !moving,
  };
}

export function rayForPoint(p: Point, view: View, plane: Plane, t = 0): Ray {
  const origin: Vector3 = [
    0.012 * Math.sin(t / 1400),
    0.008 * Math.cos(t / 1700),
    0.6,
  ];
  const hit = plane.topLeft.map(
    (n, i) =>
      n +
      ((plane.right[i] * p.x) / view.width) * plane.widthMeters +
      ((plane.down[i] * p.y) / view.height) * plane.heightMeters,
  );
  return {
    origin,
    direction: hit.map((n, i) => n - origin[i]) as Vector3,
    frameId: plane.frameId,
  };
}

type ActionMethod =
  | "pointerDown"
  | "pointerMove"
  | "pointerUp"
  | "wheel"
  | "key"
  | "cancel"
  | "reset"
  | "resize";
type Action = {
  t: number;
  method: ActionMethod;
  data: Record<string, unknown>;
};
function buildActions(device: Device): Action[] {
  const actions: Action[] = [];
  const add = (
    t: number,
    method: ActionMethod,
    data: Record<string, unknown> = {},
  ) => actions.push({ t, method, data });
  const pointer = (
    t: number,
    method: ActionMethod,
    id: number,
    x: number,
    y: number,
    extra: Record<string, unknown> = {},
  ) =>
    add(t, method, {
      id,
      x,
      y,
      pointerType: device === "mobile" ? "touch" : "mouse",
      ...extra,
    });
  const drag = (
    start: number,
    end: number,
    id: number,
    a: [number, number],
    b: [number, number],
    extra: Record<string, unknown> = {},
  ) => {
    pointer(start, "pointerDown", id, ...a, extra);
    for (let t = start + 16; t < end; t += 16) {
      const u = ease((t - start) / (end - start));
      pointer(t, "pointerMove", id, lerp(a[0], b[0], u), lerp(a[1], b[1], u));
    }
    pointer(end, "pointerUp", id, ...b);
  };
  if (device === "desktop") {
    for (let i = 0; i < 9; i++)
      add(800 + i * 70, "wheel", { x: 680, y: 310, deltaY: -65 });
    drag(2050, 2650, 1, [600, 360], [420, 430]);
    for (let i = 0; i < 6; i++)
      add(3050 + i * 60, "wheel", { x: 590, y: 350, deltaY: 45, deltaMode: 0 });
    drag(3850, 4450, 2, [370, 180], [720, 460], { shiftKey: true });
    pointer(4820, "pointerDown", 3, 300, 200, { shiftKey: true });
    pointer(4900, "pointerMove", 3, 700, 520);
    add(4950, "key", { key: "Escape" });
    add(5500, "key", { key: "0", ctrlKey: true });
    add(5750, "key", { key: "]" });
    add(5950, "key", { key: "]" });
    add(6200, "wheel", { x: 500, y: 300, deltaY: -4, deltaMode: 1 });
    add(6900, "resize", { width: 900, height: 600 });
    add(8400, "key", { key: "Home" });
  } else {
    // Ballistic-shaped pinch with a moving midpoint; then lift one finger and continue panning.
    pointer(800, "pointerDown", 1, 130, 320);
    pointer(810, "pointerDown", 2, 250, 380);
    for (let t = 830; t <= 1650; t += 20) {
      const u = ease((t - 830) / 820);
      pointer(t, "pointerMove", 1, lerp(130, 60, u), lerp(320, 235, u));
      pointer(t + 1, "pointerMove", 2, lerp(250, 345, u), lerp(380, 475, u));
    }
    pointer(1700, "pointerUp", 2, 345, 475);
    for (let t = 1720; t < 2180; t += 20) {
      const u = ease((t - 1720) / 460);
      pointer(t, "pointerMove", 1, lerp(60, 145, u), lerp(235, 315, u));
    }
    pointer(2200, "pointerUp", 1, 145, 315);
    // Pinch inward to regain context.
    pointer(3000, "pointerDown", 1, 70, 250);
    pointer(3010, "pointerDown", 2, 330, 440);
    for (let t = 3030; t <= 3550; t += 20) {
      const u = ease((t - 3030) / 520);
      pointer(t, "pointerMove", 1, lerp(70, 130, u), lerp(250, 300, u));
      pointer(t + 1, "pointerMove", 2, lerp(330, 270, u), lerp(440, 395, u));
    }
    pointer(3580, "pointerUp", 2, 270, 395);
    pointer(3590, "pointerUp", 1, 130, 300);
    for (const t of [4150, 4350]) {
      pointer(t, "pointerDown", 3, 195, 310);
      pointer(t + 40, "pointerUp", 3, 195, 310);
    }
    pointer(5100, "pointerDown", 1, 100, 300);
    pointer(5120, "pointerDown", 2, 280, 400);
    pointer(5200, "pointerMove", 2, 350, 450);
    add(5300, "cancel", { reason: "pointer-cancel" });
    add(6100, "resize", { width: 700, height: 390 });
    // Twist the content within the landscape viewport; the physical plane is unchanged.
    pointer(6300, "pointerDown", 4, 290, 195);
    pointer(6310, "pointerDown", 5, 410, 195);
    for (let t = 6330; t <= 6800; t += 20) {
      const u = ease((t - 6330) / 470),
        angle = (u * Math.PI) / 3;
      pointer(
        t,
        "pointerMove",
        4,
        350 - 60 * Math.cos(angle),
        195 - 60 * Math.sin(angle),
      );
      pointer(
        t + 1,
        "pointerMove",
        5,
        350 + 60 * Math.cos(angle),
        195 + 60 * Math.sin(angle),
      );
    }
    pointer(6850, "pointerUp", 5, 380, 195 + 30 * Math.sqrt(3));
    pointer(6860, "pointerUp", 4, 320, 195 - 30 * Math.sqrt(3));
    add(7300, "cancel", { reason: "background" });
    add(8500, "reset");
  }
  return actions.sort((a, b) => a.t - b.t);
}

/** A reference screen renderer produces presentation history before asynchronous gaze delivery. */
export function buildScenario(
  device: Device,
  options: SimulationOptions = {},
): Scenario {
  if (!["desktop", "mobile"].includes(device))
    throw new TypeError("Unknown simulation device");
  const config: SimulationConfig = { ...simulationDefaults, ...options };
  for (const [key, value] of Object.entries(config)) {
    if (key !== "seed" && !(key in simulationDefaults))
      throw new TypeError(`Unknown simulation option: ${key}`);
    if (!Number.isFinite(value)) throw new TypeError(`${key} must be finite`);
  }
  for (const key of ["noiseSdPx", "latencyMs", "jitterMs"] as const)
    if (config[key] < 0) throw new RangeError(`${key} cannot be negative`);
  for (const k of ["durationMs", "gazeHz", "displayHz", "clockRate"] as const)
    if (!(config[k] > 0)) throw new RangeError(`${k} must be positive`);
  const seed = options.seed ?? 41;
  if (!Number.isSafeInteger(seed))
    throw new TypeError("seed must be a safe integer");
  if (
    (config.durationMs * Math.max(config.gazeHz, config.displayHz)) / 1000 >
    1e6
  )
    throw new RangeError("Simulation exceeds one million time steps");
  const random = randomGenerator(seed);
  const gaussian = () =>
    Math.sqrt(-2 * Math.log(Math.max(1e-12, random()))) *
    Math.cos(2 * Math.PI * random());
  const inputs: InputEventRecord[] = [],
    frames: SimulationFrame[] = [];
  const controller = new ZoomController(
    createView({
      width: device === "mobile" ? 390 : 1080,
      height: device === "mobile" ? 700 : 680,
      contentWidth: 1600,
      contentHeight: 1100,
      panBounds: "none",
    }),
    { onInput: (e) => inputs.push(e) },
  );
  const actions = buildActions(device);
  let index = 0,
    epoch = "1",
    causes: string[] = [];
  for (
    let i = 0;
    i <= Math.floor((config.durationMs * config.displayHz) / 1000);
    i++
  ) {
    const t = (i * 1000) / config.displayHz;
    const beforeInputs = inputs.length;
    while (index < actions.length && actions[index].t <= t) {
      const a = actions[index++];
      if (a.method === "resize") {
        controller.resize(a.data.width as number, a.data.height as number, a.t);
        epoch = "2";
      } else if (a.method === "cancel")
        controller.cancel(a.t, a.data.reason as string);
      else if (a.method === "reset") controller.reset(a.t);
      else if (a.method === "wheel")
        controller.wheel({ ...a.data, t: a.t } as Point & {
          deltaY: number;
          t: number;
        });
      else if (a.method === "key")
        controller.key({ ...a.data, t: a.t } as {
          key: string;
          t: number;
          ctrlKey?: boolean;
        });
      else controller[a.method]({ ...a.data, t: a.t } as PointerInput);
    }
    causes = inputs.slice(beforeInputs).map((e) => e.id);
    frames.push({
      t,
      contentId: "synthetic-meridian-v1",
      view: { ...controller.view },
      selection: structuredClone(controller.selection),
      pointers: [...controller.pointers.values()].map((p) => ({
        x: p.x,
        y: p.y,
      })),
      causeIds: causes,
      surface: {
        id: device,
        epoch,
        active: !(device === "mobile" && t >= 7300 && t < 7800),
        plane: simulatedPlane(
          device,
          epoch === "2",
          t,
          device === "mobile",
          controller.view,
        ),
        planeSpace: "viewport",
        display: {
          width: device === "mobile" ? (epoch === "2" ? 700 : 390) : 1080,
          height: device === "mobile" ? (epoch === "2" ? 390 : 700) : 680,
          left: 0,
          top: 0,
        },
        ...(device === "mobile" ? { poseTimeMs: t } : {}),
      },
      timing: "synthetic",
    });
  }
  const deliveries: { t: number; sample: GazeSample }[] = [],
    truth = new Map<string, SimulationTruth>();
  // Preserve a content landmark across scales; another mode holds screen location while panning.
  const phases: SimulationPhase[] = [
    {
      t: 0,
      mode: "landmark",
      x: 0.63,
      y: 0.46,
      label: "Find a stable landmark",
    },
    {
      t: 700,
      mode: "zoom-in",
      x: 0.63,
      y: 0.46,
      label: "Focus near the zoom pivot",
    },
    {
      t: 1900,
      mode: "screen",
      x: 0.54,
      y: 0.47,
      label: "Hold screen fixation during pan",
    },
    {
      t: 2900,
      mode: "zoom-out",
      x: 0.54,
      y: 0.5,
      label: "Scan context around the pivot",
    },
    {
      t: 3750,
      mode: "landmark",
      x: 0.52,
      y: 0.45,
      label: "Reacquire a content landmark",
    },
    {
      t: 5700,
      mode: "reading",
      x: 0.3,
      y: 0.4,
      label: "Read with fixation and saccade steps",
    },
    {
      t: 6800,
      mode: "screen",
      x: 0.6,
      y: 0.5,
      label: "Recover from a layout change",
    },
    {
      t: 8000,
      mode: "landmark",
      x: 0.5,
      y: 0.5,
      label: "Return to the overview",
    },
  ];
  for (const phase of phases) {
    const f = at(frames, phase.t);
    phase.content = viewportToContent(f.view, {
      x: phase.x * f.view.width,
      y: phase.y * f.view.height,
    });
  }
  let previous = {
    x: frames[0].view.width * 0.63,
    y: frames[0].view.height * 0.46,
  };
  for (let i = 1; i < (config.durationMs * config.gazeHz) / 1000; i++) {
    // Sensor and display clocks are independently phased. Avoid artificial exact float ties
    // after affine clock conversion; exact transition and uncertainty cases have unit tests.
    const t = (i * 1000) / config.gazeHz + 2;
    const f = at(frames, t);
    if (!f.surface.active) continue; // A suspended camera produces a gap, never synthetic interpolation.
    const phase = at(phases, t);
    let ideal: Point;
    if (phase.mode === "landmark")
      ideal = contentToViewport(f.view, phase.content!);
    else if (phase.mode === "reading") {
      const step = Math.floor((t - phase.t) / 240);
      ideal = {
        x: f.view.width * (0.28 + (step % 4) * 0.13),
        y: f.view.height * (0.4 + Math.floor(step / 4) * 0.07),
      };
    } else if (phase.mode === "zoom-out") {
      const step = Math.floor((t - phase.t) / 210);
      ideal = {
        x: f.view.width * (phase.x + 0.09 * Math.cos(step * 2.4)),
        y: f.view.height * (phase.y + 0.08 * Math.sin(step * 2.4)),
      };
    } else ideal = { x: f.view.width * phase.x, y: f.view.height * phase.y };
    // Configurable synthetic pursuit/settling, distinct from the cursor/fingers.
    const saccade = phase.mode === "reading" || phase.mode === "zoom-out";
    const u = saccade
      ? ease(((t - phase.t) % (phase.mode === "reading" ? 240 : 210)) / 35)
      : 0.4;
    previous = {
      x: lerp(previous.x, ideal.x, u),
      y: lerp(previous.y, ideal.y, u),
    };
    const screenTruth = {
      x: previous.x + 0.18 * Math.sin(t / 37),
      y: previous.y + 0.18 * Math.cos(t / 43),
    };
    const noisy = {
      x: screenTruth.x + gaussian() * config.noiseSdPx,
      y: screenTruth.y + gaussian() * config.noiseSdPx,
    };
    const blink = t % 2600 >= 2320 && t % 2600 < 2420;
    const lowConfidence = t >= 6700 && t < 6800;
    const arrival =
      t +
      config.latencyMs +
      random() * config.jitterMs +
      (i % 113 === 0 ? 170 : 0);
    const rawTime = (t - config.clockOffsetMs) / config.clockRate;
    for (const type of ["pog2d", "ray3d"] as const) {
      const id = `${type}-${i}`;
      const sample = {
        id,
        type,
        sourceId: `sim-${type}`,
        eye: "unknown",
        clockId: "tracker",
        clockEpoch: "boot-1",
        timeMs: rawTime,
        surfaceId: f.surface.id,
        surfaceEpoch: f.surface.epoch,
        confidence: lowConfidence ? 0.2 : 0.99,
        valid: !blink,
        blink,
        calibrationId: "synthetic-high-accuracy-v1",
        ...(type === "pog2d"
          ? {
              space: "normalized-viewport",
              point: { x: noisy.x / f.view.width, y: noisy.y / f.view.height },
            }
          : { ray: rayForPoint(noisy, f.view, f.surface.plane!, t) }),
      };
      deliveries.push({ t: arrival, sample: sample as GazeSample });
      // Oracle uses the known renderer coefficients, not the synchronization library's inverse.
      truth.set(id, {
        captureTimeMs: t,
        screenTruth,
        noisy,
        frameTimeMs: f.t,
        epoch: f.surface.epoch,
        content: {
          x:
            (Math.cos(f.view.rotation ?? 0) * (noisy.x - f.view.tx) +
              Math.sin(f.view.rotation ?? 0) * (noisy.y - f.view.ty)) /
            f.view.scale,
          y:
            (-Math.sin(f.view.rotation ?? 0) * (noisy.x - f.view.tx) +
              Math.cos(f.view.rotation ?? 0) * (noisy.y - f.view.ty)) /
            f.view.scale,
        },
        behavior: phase.mode,
      });
    }
  }
  return {
    device,
    seed,
    config,
    frames,
    inputs,
    deliveries: deliveries.sort((a, b) => a.t - b.t),
    truth,
    phases,
  };
}

export function runScenario(device: Device, options: SimulationOptions = {}) {
  const scenario = buildScenario(device, options);
  const session = new GazeSession();
  for (const type of ["pog2d", "ray3d"])
    session.registerSource({
      id: `sim-${type}`,
      kind: "simulated",
      adapter: "reference-simulator",
      eyes: ["unknown"],
      trackingMode: "unspecified",
      expectedHz: scenario.config.gazeHz,
      timestampKind: "exposure",
    });
  session.clocks.register({
    id: "tracker",
    epoch: "boot-1",
    sourceOriginMs: -scenario.config.clockOffsetMs / scenario.config.clockRate,
    sessionOriginMs: 0,
    rate: scenario.config.clockRate,
    uncertaintyMs: 0,
  });
  const events = [
    ...scenario.frames.map((f) => ({
      t: f.t,
      priority: 1,
      type: "frame" as const,
      data: f,
    })),
    ...scenario.inputs.map((e) => ({
      t: e.t,
      priority: 0,
      type: "input" as const,
      data: e,
    })),
    ...scenario.deliveries.map((e) => ({
      t: e.t,
      priority: 2,
      type: "gaze" as const,
      data: e,
    })),
  ].sort((a, b) => a.t - b.t || a.priority - b.priority);
  for (const e of events) {
    if (e.type === "frame") {
      session.present(e.data);
      session.flush(e.t);
    } else if (e.type === "input") session.input(e.data);
    else session.gaze(e.data.sample, e.t);
  }
  const finish =
    Math.max(scenario.config.durationMs, scenario.deliveries.at(-1)?.t ?? 0) +
    100;
  session.flush(finish, { final: true });
  const errors = [],
    naiveErrors = [],
    noise = [],
    flagCounts: Record<string, number> = {};
  let mismatchedFrames = 0,
    pairedMaxPx = 0,
    pairedSamples = 0;
  const pairs = new Map<string, Point>();
  for (const a of session.aligned) {
    a.flags.forEach((flag) => {
      flagCounts[flag] = (flagCounts[flag] ?? 0) + 1;
    });
    const target = scenario.truth.get(a.sampleId)!;
    if (
      !Number.isFinite(a.presentationTimeMs) ||
      Math.abs(a.presentationTimeMs! - target.frameTimeMs) > 1e-6
    )
      mismatchedFrames++;
    if (!a.contentPoint || !a.viewportPoint) continue;
    const frame = at(scenario.frames, target.captureTimeMs);
    const error =
      Math.hypot(
        a.contentPoint.x - target.content.x,
        a.contentPoint.y - target.content.y,
      ) * frame.view.scale;
    errors.push(error);
    noise.push(
      Math.hypot(
        a.viewportPoint.x - target.screenTruth.x,
        a.viewportPoint.y - target.screenTruth.y,
      ),
    );
    const current = at(scenario.frames, a.receivedTimeMs).view;
    const wrong = {
      x:
        (Math.cos(current.rotation ?? 0) * (target.noisy.x - current.tx) +
          Math.sin(current.rotation ?? 0) * (target.noisy.y - current.ty)) /
        current.scale,
      y:
        (-Math.sin(current.rotation ?? 0) * (target.noisy.x - current.tx) +
          Math.cos(current.rotation ?? 0) * (target.noisy.y - current.ty)) /
        current.scale,
    };
    naiveErrors.push(
      Math.hypot(wrong.x - target.content.x, wrong.y - target.content.y) *
        frame.view.scale,
    );
    const pairKey = a.sampleId.split("-").at(-1)!;
    if (pairs.has(pairKey)) {
      pairedSamples++;
      pairedMaxPx = Math.max(
        pairedMaxPx,
        Math.hypot(
          a.viewportPoint.x - pairs.get(pairKey)!.x,
          a.viewportPoint.y - pairs.get(pairKey)!.y,
        ),
      );
    } else pairs.set(pairKey, a.viewportPoint);
  }
  const mean = (values: number[]) =>
    values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  const percentile = (values: number[], p: number) =>
    [...values].sort((a, b) => a - b)[
      Math.min(values.length - 1, Math.floor(values.length * p))
    ] ?? 0;
  const recording = session.export();
  const replayed = replay(recording);
  const replayExact =
    JSON.stringify(replayed.aligned) === JSON.stringify(session.aligned);
  const summary: SimulationSummary = {
    device,
    seed: scenario.seed,
    gazeSamples: session.aligned.length,
    expectedSamples: scenario.deliveries.length,
    mappedSamples: errors.length,
    pairedSamples,
    usableSamples: session.aligned.filter((a) => a.usable).length,
    presentationFrames: scenario.frames.length,
    pendingSamples: session.pending.length,
    frameMismatches: mismatchedFrames,
    maxReconstructionErrorPx: errors.length
      ? errors.reduce((max, value) => Math.max(max, value), 0)
      : null,
    paired2D3DMaxDifferencePx: pairedMaxPx,
    meanInjectedGazeErrorPx: mean(noise),
    p95InjectedGazeErrorPx: percentile(noise, 0.95),
    naiveArrivalMappingMeanErrorPx: mean(naiveErrors),
    naiveArrivalMappingP95ErrorPx: percentile(naiveErrors, 0.95),
    finalZoom: zoomLevel(scenario.frames.at(-1)!.view),
    replayExact,
    flagCounts,
    assumptions:
      "Synthetic high-accuracy signals; reconstruction error is software error, not measured human gaze accuracy.",
  };
  return { scenario, session, recording, summary };
}

export function isScenarioPassing(summary: SimulationSummary) {
  return (
    summary.gazeSamples > 0 &&
    summary.gazeSamples === summary.expectedSamples &&
    summary.mappedSamples > 0 &&
    summary.pairedSamples > 0 &&
    summary.usableSamples > 0 &&
    summary.frameMismatches === 0 &&
    Number.isFinite(summary.maxReconstructionErrorPx) &&
    summary.maxReconstructionErrorPx! < 1e-6 &&
    Number.isFinite(summary.paired2D3DMaxDifferencePx) &&
    summary.paired2D3DMaxDifferencePx < 1e-6 &&
    summary.replayExact === true &&
    summary.pendingSamples === 0 &&
    Math.abs(summary.finalZoom - 1) < 1e-8
  );
}
