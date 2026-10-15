/** Reproducible software experiments. All geometry and source measurements are synthetic. */
import { createView, constrain, viewMatrix } from "./geometry.js";
import { GazeSession, replay } from "./session.js";
import type {
  AlignedGaze,
  ClockMapping,
  Eye,
  GazeSample,
  InputEventRecord,
  Plane,
  Point,
  Presentation,
  Recording,
  SourceDescriptor,
  View,
} from "./types.js";

export interface ExperimentConfig {
  name?: string;
  width: number;
  height: number;
  displayHz: number;
  inputHz: number;
  gazeHz: number;
  rightGazeHz?: number;
  mode:
    | "monocular-left"
    | "monocular-right"
    | "binocular-independent"
    | "binocular-fused";
  durationMs?: number;
  devicePixelRatio?: number;
  physicalWidthMeters?: number;
  physicalHeightMeters?: number;
  latencyMs?: number;
  jitterMs?: number;
  noisePx?: number;
  seed?: number;
  rotateMidway?: boolean;
  independentClocks?: boolean;
}
export type ExperimentEvent = { time: number; order: number } & (
  | { type: "frame"; payload: Presentation }
  | { type: "input"; payload: InputEventRecord }
  | { type: "gaze"; payload: { sample: GazeSample; receivedTimeMs: number } }
  | { type: "flush"; payload: { now: number; final: boolean } }
);
export interface ExperimentTruth {
  frameTimeMs: number;
  content: Point;
  viewport: Point;
  scale: number;
}
export interface Experiment {
  config: Required<ExperimentConfig>;
  clocks: ClockMapping[];
  sources: SourceDescriptor[];
  events: ExperimentEvent[];
  truth: Record<string, ExperimentTruth>;
}
export interface ExperimentSummary {
  name: string;
  width: number;
  height: number;
  devicePixelRatio: number;
  physicalWidthMeters: number;
  physicalHeightMeters: number;
  displayHz: number;
  inputHz: number;
  gazeHz: number;
  rightGazeHz: number;
  mode: ExperimentConfig["mode"];
  durationMs: number;
  seed: number;
  rotateMidway: boolean;
  independentClocks: boolean;
  samples: number;
  expectedSamples: number;
  usableSamples: number;
  frameMismatches: number;
  mappedSamples: number;
  maxReconstructionErrorPx: number;
  arrivalBaselineMeanPx: number;
  arrivalBaselineP95Px: number;
  replayExact: boolean;
  pendingSamples: number;
}
const sampleKey = (s: {
  id?: string;
  sampleId?: string;
  eye: Eye;
  type: string;
}) => `${s.eye}/${s.type}/${s.id ?? s.sampleId}`;
const lastAt = <T extends { t: number }>(frames: T[], t: number): T => {
  let l = 0,
    r = frames.length;
  while (l < r) {
    const m = (l + r) >>> 1;
    if (frames[m].t <= t) l = m + 1;
    else r = m;
  }
  return frames[Math.max(0, l - 1)];
};

export function generateExperiment(options: ExperimentConfig): Experiment {
  const c = {
    durationMs: 800,
    devicePixelRatio: 1,
    latencyMs: 28,
    jitterMs: 35,
    noisePx: 0.35,
    seed: 41,
    rotateMidway: false,
    independentClocks: false,
    name: "experiment",
    ...options,
    rightGazeHz: options.rightGazeHz ?? options.gazeHz,
    physicalWidthMeters:
      options.physicalWidthMeters === undefined
        ? options.width < 700
          ? 0.072
          : 0.53
        : options.physicalWidthMeters,
    physicalHeightMeters:
      options.physicalHeightMeters === undefined
        ? ((options.physicalWidthMeters === undefined
            ? options.width < 700
              ? 0.072
              : 0.53
            : options.physicalWidthMeters) *
            options.height) /
          options.width
        : options.physicalHeightMeters,
  };
  for (const key of [
    "width",
    "height",
    "displayHz",
    "inputHz",
    "gazeHz",
    "rightGazeHz",
    "durationMs",
    "devicePixelRatio",
    "physicalWidthMeters",
    "physicalHeightMeters",
  ] as const)
    if (!Number.isFinite(c[key]) || c[key] <= 0)
      throw new TypeError(`${key} must be positive and finite`);
  for (const key of ["latencyMs", "jitterMs", "noisePx"] as const)
    if (!Number.isFinite(c[key]) || c[key] < 0)
      throw new TypeError(`${key} must be nonnegative and finite`);
  if (
    ![
      "monocular-left",
      "monocular-right",
      "binocular-independent",
      "binocular-fused",
    ].includes(c.mode)
  )
    throw new TypeError("Unknown eye mode");
  if (
    (c.durationMs * Math.max(c.gazeHz, c.rightGazeHz, c.displayHz, c.inputHz)) /
      1000 >
    100000
  )
    throw new RangeError("Experiment exceeds 100000 time steps");
  let rng = c.seed >>> 0;
  const random = () => {
    rng = (Math.imul(1664525, rng) + 1013904223) >>> 0;
    return rng / 4294967296;
  };
  const eyes: Eye[] =
    c.mode === "monocular-left"
      ? ["left"]
      : c.mode === "monocular-right"
        ? ["right"]
        : c.mode === "binocular-fused"
          ? ["combined"]
          : ["left", "right"];
  const sources: SourceDescriptor[] = [
    {
      id: "synthetic-tracker",
      kind: "simulated",
      adapter: "multirate-reference-v1",
      eyes,
      trackingMode:
        c.mode === "binocular-independent"
          ? "binocular-independent"
          : c.mode === "binocular-fused"
            ? "binocular-fused"
            : "monocular",
      expectedHz: c.gazeHz,
      eyeRatesHz: { left: c.gazeHz, right: c.rightGazeHz, combined: c.gazeHz },
      timestampKind: "exposure",
    },
  ];
  sources[0].eyeRatesHz = Object.fromEntries(
    eyes.map((e) => [e, e === "right" ? c.rightGazeHz : c.gazeHz]),
  );
  const clocks: ClockMapping[] = c.independentClocks
    ? eyes.map((eye, i) => ({
        id: `device-${eye}`,
        epoch: "boot",
        sourceOriginMs: 1e6 + i * 54321,
        sessionOriginMs: 0,
        rate: 1.00008 - i * 0.00013,
        uncertaintyMs: 0,
      }))
    : [
        {
          id: "device",
          epoch: "boot",
          sourceOriginMs: 1e6,
          sessionOriginMs: 0,
          rate: 1.00008,
          uncertaintyMs: 0,
        },
      ];
  const inputs: InputEventRecord[] = [],
    events: ExperimentEvent[] = [],
    frames: (Presentation & { matrix: ReturnType<typeof viewMatrix> })[] = [];
  for (let i = 0; i <= Math.floor((c.durationMs * c.inputHz) / 1000); i++) {
    const t = (i * 1000) / c.inputHz,
      event = { id: `intent-${i}`, kind: "view-intent", t, phase: "update" };
    inputs.push(event);
    events.push({ time: t, order: 0, type: "input", payload: event });
  }
  let usedInputs = 0;
  for (let i = 0; i <= Math.floor((c.durationMs * c.displayHz) / 1000); i++) {
    const t = (i * 1000) / c.displayHz,
      landscape = c.rotateMidway && t >= c.durationMs / 2;
    const width = landscape ? c.height : c.width,
      height = landscape ? c.width : c.height;
    const intent = lastAt(inputs, t),
      u = intent.t / c.durationMs,
      base = createView({
        width,
        height,
        contentWidth: 1600,
        contentHeight: 1100,
      });
    const scale = base.scale * (1 + 0.8 * Math.sin(Math.PI * u) ** 2);
    const view = constrain({
      ...base,
      scale,
      tx: width / 2 - 800 * scale + width * 0.08 * Math.sin(u * 2 * Math.PI),
      ty: height / 2 - 550 * scale + height * 0.05 * Math.sin(u * 4 * Math.PI),
    });
    const causeIds: string[] = [];
    while (usedInputs < inputs.length && inputs[usedInputs].t <= t)
      causeIds.push(inputs[usedInputs++].id);
    // Rotate one physical panel; do not infer a different device from the new pixel width.
    const widthMeters = landscape
        ? c.physicalHeightMeters
        : c.physicalWidthMeters,
      heightMeters = landscape ? c.physicalWidthMeters : c.physicalHeightMeters;
    const plane: Plane = {
      frameId: "world",
      topLeft: [-widthMeters / 2, heightMeters / 2, 0],
      right: [1, 0, 0],
      down: [0, -1, 0],
      widthMeters,
      heightMeters,
      static: true,
    };
    const frame: Presentation & { matrix: ReturnType<typeof viewMatrix> } = {
      t,
      view,
      matrix: viewMatrix(view),
      contentId: "synthetic-target",
      causeIds,
      timing: "synthetic",
      surface: {
        id: "display",
        epoch: landscape ? "2" : "1",
        devicePixelRatio: c.devicePixelRatio,
        expectedPresentationHz: c.displayHz,
        presentationMode: "per-frame",
        display: { width, height, left: 0, top: 0 },
        plane,
        planeSpace: "display",
      },
    };
    frames.push(frame);
    events.push(
      { time: t, order: 1, type: "frame", payload: frame },
      { time: t, order: 3, type: "flush", payload: { now: t, final: false } },
    );
  }
  const truth: Record<string, ExperimentTruth> = {};
  for (let eyeIndex = 0; eyeIndex < eyes.length; eyeIndex++) {
    const eye = eyes[eyeIndex],
      hz = eye === "right" ? c.rightGazeHz : c.gazeHz,
      phase = eye === "right" ? 3.125 : 2.375,
      clock = c.independentClocks ? clocks[eyeIndex] : clocks[0];
    for (let i = 0; ; i++) {
      const t = phase + (i * 1000) / hz;
      if (t >= c.durationMs) break;
      const frame = lastAt(frames, t),
        v = frame.view,
        content = {
          x: 800 + 40 * Math.sin(t / 180),
          y: 550 + 30 * Math.cos(t / 210),
        };
      const p = {
        x: content.x * v.scale + v.tx + (random() - 0.5) * 2 * c.noisePx,
        y: content.y * v.scale + v.ty + (random() - 0.5) * 2 * c.noisePx,
      };
      const origin: [number, number, number] = [
        eye === "left" ? -0.032 : eye === "right" ? 0.032 : 0,
        0,
        0.6,
      ];
      const plane = frame.surface.plane!,
        hit = plane.topLeft.map(
          (n, j) =>
            n +
            ((plane.right[j] * p.x) / v.width) * plane.widthMeters +
            ((plane.down[j] * p.y) / v.height) * plane.heightMeters,
        );
      const rawTime = clock.sourceOriginMs + t / clock.rate!,
        arrival =
          t + c.latencyMs + random() * c.jitterMs + (i % 97 === 0 ? 120 : 0);
      const valid = !(t > c.durationMs * 0.46 && t < c.durationMs * 0.5);
      for (const type of ["pog2d", "ray3d"] as const) {
        const sample = {
          id: `sample-${i}`,
          captureId: `capture-${i}`,
          sourceId: "synthetic-tracker",
          eye,
          type,
          clockId: clock.id,
          clockEpoch: clock.epoch,
          timeMs: rawTime,
          surfaceId: "display",
          surfaceEpoch: frame.surface.epoch,
          confidence: 0.98,
          valid,
          blink: !valid,
          ...(type === "pog2d"
            ? {
                space: "normalized-viewport",
                point: { x: p.x / v.width, y: p.y / v.height },
              }
            : {
                ray: {
                  origin,
                  direction: hit.map((n, j) => n - origin[j]),
                  frameId: "world",
                },
              }),
        } as GazeSample;
        events.push({
          time: arrival,
          order: 2,
          type: "gaze",
          payload: { sample, receivedTimeMs: arrival },
        });
        truth[sampleKey(sample)] = {
          frameTimeMs: frame.t,
          content: { x: (p.x - v.tx) / v.scale, y: (p.y - v.ty) / v.scale },
          viewport: p,
          scale: v.scale,
        };
      }
    }
  }
  events.sort((a, b) => a.time - b.time || a.order - b.order);
  const finish = (events.at(-1)?.time ?? c.durationMs) + 100;
  events.push({
    time: finish,
    order: 3,
    type: "flush",
    payload: { now: finish, final: true },
  });
  return { config: c, clocks, sources, events, truth };
}

export function executeExperiment(experiment: Experiment): GazeSession {
  const session = new GazeSession();
  for (const source of experiment.sources) session.registerSource(source);
  for (const clock of experiment.clocks) session.clocks.register(clock);
  for (const event of experiment.events) {
    if (event.type === "frame") session.present(event.payload);
    else if (event.type === "input") session.input(event.payload);
    else if (event.type === "gaze")
      session.gaze(event.payload.sample, event.payload.receivedTimeMs);
    else session.flush(event.payload.now, { final: event.payload.final });
  }
  return session;
}

export function summarizeExperiment(
  experiment: Experiment,
  session: GazeSession,
): ExperimentSummary {
  const c = experiment.config,
    errors: number[] = [],
    arrivalErrors: number[] = [];
  const frames = experiment.events
    .filter(
      (e): e is Extract<ExperimentEvent, { type: "frame" }> =>
        e.type === "frame",
    )
    .map((e) => e.payload);
  let mismatches = 0;
  for (const a of session.aligned) {
    const expected = experiment.truth[sampleKey(a)];
    if (
      a.presentationTimeMs === undefined ||
      Math.abs(a.presentationTimeMs - expected.frameTimeMs) > 1e-6
    )
      mismatches++;
    if (!a.contentPoint) continue;
    errors.push(
      Math.hypot(
        a.contentPoint.x - expected.content.x,
        a.contentPoint.y - expected.content.y,
      ) * expected.scale,
    );
    const current = lastAt(frames, a.receivedTimeMs).view;
    arrivalErrors.push(
      Math.hypot(
        (expected.viewport.x - current.tx) / current.scale - expected.content.x,
        (expected.viewport.y - current.ty) / current.scale - expected.content.y,
      ) * expected.scale,
    );
  }
  arrivalErrors.sort((a, b) => a - b);
  const restored = replay(
    JSON.parse(JSON.stringify(session.export())) as Recording,
  );
  return {
    name: c.name,
    width: c.width,
    height: c.height,
    devicePixelRatio: c.devicePixelRatio,
    physicalWidthMeters: c.physicalWidthMeters,
    physicalHeightMeters: c.physicalHeightMeters,
    displayHz: c.displayHz,
    inputHz: c.inputHz,
    gazeHz: c.gazeHz,
    rightGazeHz: c.rightGazeHz,
    mode: c.mode,
    durationMs: c.durationMs,
    seed: c.seed,
    rotateMidway: c.rotateMidway,
    independentClocks: c.independentClocks,
    samples: session.aligned.length,
    expectedSamples: Object.keys(experiment.truth).length,
    usableSamples: session.aligned.filter((a) => a.usable).length,
    frameMismatches: mismatches,
    mappedSamples: errors.length,
    maxReconstructionErrorPx: errors.reduce((a, b) => Math.max(a, b), 0),
    arrivalBaselineMeanPx:
      arrivalErrors.reduce((a, b) => a + b, 0) /
      Math.max(1, arrivalErrors.length),
    arrivalBaselineP95Px:
      arrivalErrors[Math.floor(arrivalErrors.length * 0.95)] ?? 0,
    replayExact:
      JSON.stringify(restored.aligned) === JSON.stringify(session.aligned),
    pendingSamples: session.pending.length,
  };
}
