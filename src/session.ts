import type {
  Affine,
  AlignedGaze,
  GazeSample,
  GazeType,
  InputEventRecord,
  InternalFrame,
  PendingGaze,
  Point,
  Presentation,
  PresentationRecord,
  RawRecord,
  Recording,
  SessionConfig,
  SessionObservers,
  SourceDescriptor,
  Surface,
  View,
} from "./types.js";
import { Diagnostics } from "./diagnostics.js";
import { ClockRegistry } from "./clocks.js";
import { jsonRecord, jsonKey } from "./records.js";
import { IMPLEMENTATION_VERSION, SCHEMA_VERSION } from "./version.js";
import {
  applyAffine,
  finite,
  invertAffine,
  point,
  positive,
  projectRay,
  validateMatrix,
  validatePlane,
  vector,
  viewMatrix,
} from "./geometry.js";

const clone = <T>(v: T): T => structuredClone(v);
const observationKey = (s: GazeSample) =>
  JSON.stringify([s.sourceId, s.clockId, s.clockEpoch, s.eye, s.type, s.id]);
const inside = (p: Point, w: number, h: number) => {
  if (![p.x, p.y, w, h].every(Number.isFinite)) return false;
  const tolerance =
    64 * Number.EPSILON * Math.max(1, w, h, Math.abs(p.x), Math.abs(p.y));
  return (
    p.x >= -tolerance &&
    p.y >= -tolerance &&
    p.x <= w + tolerance &&
    p.y <= h + tolerance
  );
};
const geometryKey = (f: PresentationRecord, type: GazeType) =>
  JSON.stringify([
    f.matrix,
    f.contentId,
    f.view.width,
    f.view.height,
    f.view.contentWidth,
    f.view.contentHeight,
    f.surface.id,
    f.surface.epoch,
    f.surface.active ?? true,
    f.surface.display
      ? [
          f.surface.display.width,
          f.surface.display.height,
          f.surface.display.left,
          f.surface.display.top,
        ]
      : null,
    type === "ray3d" && f.surface.plane
      ? [
          f.surface.plane.frameId,
          f.surface.plane.topLeft,
          f.surface.plane.right,
          f.surface.plane.down,
          f.surface.plane.widthMeters,
          f.surface.plane.heightMeters,
          f.surface.plane.static ?? false,
          f.surface.planeSpace ?? "viewport",
        ]
      : null,
  ]);
const freeze = <T>(value: T): T => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

function validateSurface(s: Surface, view: View) {
  if (
    typeof s?.id !== "string" ||
    !s.id ||
    typeof s.epoch !== "string" ||
    !s.epoch
  )
    throw new TypeError("Surface id and epoch are required strings");
  if (s.active !== undefined && typeof s.active !== "boolean")
    throw new TypeError("surface.active must be boolean");
  if (s.devicePixelRatio !== undefined)
    positive(s.devicePixelRatio, "devicePixelRatio");
  if (s.expectedPresentationHz !== undefined)
    positive(s.expectedPresentationHz, "expectedPresentationHz");
  if (
    s.presentationMode !== undefined &&
    !["per-frame", "change-only"].includes(s.presentationMode)
  )
    throw new TypeError("Unknown presentationMode");
  if (s.display) {
    positive(s.display.width, "display.width");
    positive(s.display.height, "display.height");
    finite(s.display.left, "display.left");
    finite(s.display.top, "display.top");
  }
  if (
    s.planeSpace !== undefined &&
    !["viewport", "display"].includes(s.planeSpace)
  )
    throw new TypeError("planeSpace must be viewport or display");
  if (s.planeSpace === "display" && !s.display)
    throw new TypeError("planeSpace display requires the full display layout");
  if (s.plane) {
    if (
      s.planeSpace === undefined &&
      s.display &&
      (s.display.left !== 0 ||
        s.display.top !== 0 ||
        s.display.width !== view.width ||
        s.display.height !== view.height)
    )
      throw new TypeError(
        "Declare planeSpace explicitly when the viewport differs from the full display",
      );
    validatePlane(s.plane);
    if (s.plane.static !== true)
      finite(s.poseTimeMs!, "dynamic plane poseTimeMs");
  }
  for (const k of ["width", "height", "contentWidth", "contentHeight"] as const)
    positive(view[k], k);
}

function validateGaze(s: GazeSample) {
  for (const k of [
    "id",
    "sourceId",
    "clockId",
    "clockEpoch",
    "surfaceId",
    "surfaceEpoch",
  ] as const) {
    if (typeof s?.[k] !== "string" || !s[k])
      throw new TypeError(`Gaze ${k} is required`);
  }
  finite(s.timeMs, "gaze source time");
  for (const key of ["captureId", "calibrationId"] as const)
    if (s[key] !== undefined && (typeof s[key] !== "string" || !s[key]))
      throw new TypeError(`${key} must be a nonempty string`);
  if (s.confidence !== null) finite(s.confidence, "confidence");
  if (s.confidence !== null && (s.confidence < 0 || s.confidence > 1))
    throw new RangeError("Confidence must be in [0,1]");
  if (typeof s.valid !== "boolean")
    throw new TypeError("Gaze valid must be explicit");
  if (s.blink !== undefined && typeof s.blink !== "boolean")
    throw new TypeError("Gaze blink must be boolean");
  if (!["pog2d", "ray3d", "direction3d"].includes(s.type))
    throw new TypeError("Unknown gaze type");
  if (!["left", "right", "combined", "unknown"].includes(s.eye))
    throw new TypeError("Explicit eye identity is required");
  // Optional dropout payloads must still be JSON-safe finite measurements.
  if ("point" in s && s.point !== undefined) point(s.point);
  if ("ray" in s && s.ray !== undefined) {
    vector(s.ray.origin, "ray.origin");
    vector(s.ray.direction, "ray.direction");
  }
  if (!s.valid || s.blink) return; // Missing measurements retain their place in the time series.
  if (s.type === "pog2d") {
    point(s.point);
    if (
      !["viewport", "normalized-viewport", "normalized-display"].includes(
        s.space,
      )
    )
      throw new TypeError("Unknown PoG coordinate space");
  } else if (s.type === "ray3d") {
    vector(s.ray?.origin, "ray.origin");
    vector(s.ray?.direction, "ray.direction");
    if (typeof s.ray.frameId !== "string" || !s.ray.frameId)
      throw new TypeError("Ray frameId is required");
  } else {
    vector(s.direction, "direction");
    if (typeof s.frameId !== "string" || !s.frameId)
      throw new TypeError("frameId is required");
  }
}

/**
 * Join capture timestamps to the latest presentation at or before capture.
 * flush(now) is the host's watermark: all presentation records <= now
 * must already be submitted. A finalized presentation cannot be revised later.
 */
export class GazeSession {
  readonly config: Readonly<Required<SessionConfig>>;
  readonly clocks: ClockRegistry;
  frames: InternalFrame[] = [];
  surfaceFrames = new Map<string, InternalFrame[]>();
  pending: PendingGaze[] = [];
  records: RawRecord[] = [];
  aligned: AlignedGaze[] = [];
  recordsDropped = 0;
  alignedDropped = 0;
  finalizedThrough = -Infinity;
  lastFlush = -Infinity;
  frameSequence = 0;
  recordSequence = 0;
  seenSamples = new Map<string, boolean>();
  private pendingKeys = new Set<string>();
  sources = new Map<string, SourceDescriptor>();
  seenSources = new Set<string>();
  diagnostics: Diagnostics;
  constructor(config: SessionConfig = {}, observers: SessionObservers = {}) {
    this.diagnostics = new Diagnostics(observers.onDiagnostic);
    const defaults = {
      reorderWindowMs: 60,
      maxClockUncertaintyMs: 8,
      minConfidence: 0.6,
      maxPoseAgeMs: 50,
      maxLatencyMs: 250,
      maxFrames: 7200,
      maxRecords: 100000,
      maxPending: 4096,
    };
    for (const key of Object.keys(config))
      if (!Object.hasOwn(defaults, key))
        throw new TypeError(`Unknown session option: ${key}`);
    this.config = { ...defaults, ...config };
    for (const [k, n] of Object.entries(this.config)) {
      finite(n, k);
      if (n < 0) throw new RangeError(`${k} cannot be negative`);
    }
    if (this.config.minConfidence > 1)
      throw new RangeError("minConfidence must be in [0,1]");
    for (const k of ["maxFrames", "maxRecords", "maxPending"] as const) {
      if (!Number.isInteger(this.config[k]) || this.config[k] < 2)
        throw new RangeError(`${k} must be an integer >= 2`);
    }
    Object.freeze(this.config);
    this.clocks = new ClockRegistry();
    this.frames = [];
    this.pending = [];
    this.records = [];
    this.aligned = [];
    this.recordsDropped = 0;
    this.alignedDropped = 0;
    this.finalizedThrough = -Infinity;
    this.lastFlush = -Infinity;
    this.frameSequence = 0;
    this.recordSequence = 0;
  }

  registerSource(source: SourceDescriptor): SourceDescriptor {
    if (
      !source.id ||
      typeof source.id !== "string" ||
      !source.adapter ||
      typeof source.adapter !== "string"
    )
      throw new TypeError("Source id and adapter are required");
    if (!["model", "tracker", "simulated", "custom"].includes(source.kind))
      throw new TypeError("Unknown source kind");
    if (
      ![
        "monocular",
        "binocular-independent",
        "binocular-fused",
        "mixed",
        "unspecified",
      ].includes(source.trackingMode)
    )
      throw new TypeError("Unknown trackingMode");
    if (
      !Array.isArray(source.eyes) ||
      !source.eyes.length ||
      new Set(source.eyes).size !== source.eyes.length ||
      source.eyes.some(
        (eye) => !["left", "right", "combined", "unknown"].includes(eye),
      )
    )
      throw new TypeError("Unique source eyes are required");
    if (
      source.timestampKind !== undefined &&
      !["exposure", "vendor-estimate", "host-receipt"].includes(
        source.timestampKind,
      )
    )
      throw new TypeError("Unknown timestampKind");
    if (
      source.hardwareValidated !== undefined &&
      typeof source.hardwareValidated !== "boolean"
    )
      throw new TypeError("hardwareValidated must be boolean");
    if (source.expectedHz !== undefined)
      positive(source.expectedHz, "expectedHz");
    if (source.eyeRatesHz)
      for (const [eye, hz] of Object.entries(source.eyeRatesHz)) {
        if (!source.eyes.includes(eye as import("./types.js").Eye))
          throw new TypeError("eyeRatesHz must describe declared eyes");
        positive(hz, "eyeRatesHz");
      }
    const value = freeze(jsonRecord(source));
    const existing = this.sources.get(source.id);
    if (existing && jsonKey(existing) !== jsonKey(value))
      throw new Error("Source descriptor is immutable; use a new source ID");
    if (!existing && this.seenSources.has(source.id))
      throw new Error("Register source metadata before its first sample");
    this.sources.set(source.id, value);
    return clone(value);
  }

  record<T extends RawRecord["type"]>(
    type: T,
    payload: Extract<RawRecord, { type: T }>["payload"],
  ): void {
    this.records.push({
      sequence: ++this.recordSequence,
      type,
      payload: clone(payload),
    } as RawRecord);
    if (this.records.length > this.config.maxRecords) {
      this.records.shift();
      this.recordsDropped++;
      this.diagnostics.emit(
        "RECORDING_TRUNCATED",
        Number.isFinite(this.lastFlush) ? this.lastFlush : 0,
      );
    }
  }

  input(event: InputEventRecord) {
    finite(event.t, "input time");
    for (const key of ["id", "kind"])
      if (typeof event[key] !== "string" || !event[key])
        throw new TypeError(`Input ${key} must be a nonempty string`);
    this.record("input", jsonRecord(event));
  }

  present({
    t,
    view,
    surface,
    contentId = "content",
    matrix = viewMatrix(view),
    causeIds = [],
    timing = "render-callback",
  }: Presentation): PresentationRecord {
    finite(t, "presentation time");
    if (t <= this.lastFlush)
      throw new RangeError("Presentation is behind the finalized watermark");
    if (this.frames.length && t < this.frames.at(-1)!.t)
      throw new RangeError("Presentation time regressed");
    validateMatrix(matrix);
    validateSurface(surface, view);
    if (
      !Array.isArray(causeIds) ||
      causeIds.some((id) => typeof id !== "string" || !id)
    )
      throw new TypeError("causeIds must be an array of nonempty strings");
    if (typeof contentId !== "string" || !contentId)
      throw new TypeError("contentId must be a nonempty string");
    if (!["render-callback", "display-feedback", "synthetic"].includes(timing))
      throw new TypeError("Unknown presentation timing quality");
    if (
      !this.surfaceFrames.has(surface.id) &&
      this.surfaceFrames.size >= this.config.maxFrames
    ) {
      throw new RangeError(
        "maxFrames cannot retain another surface; increase the budget or use another session",
      );
    }
    const inverseMatrix = invertAffine(matrix);
    const baseFrame: PresentationRecord = jsonRecord({
      id: `frame-${this.frameSequence + 1}`,
      t,
      view,
      surface,
      contentId,
      matrix,
      causeIds,
      timing,
    });
    this.frameSequence++;
    const frame: InternalFrame = {
      ...baseFrame,
      inverseMatrix,
      geometryKeys: {
        pog2d: geometryKey(baseFrame, "pog2d"),
        ray3d: geometryKey(baseFrame, "ray3d"),
        direction3d: geometryKey(baseFrame, "direction3d"),
      },
    };
    this.frames.push(freeze(frame));
    if (!this.surfaceFrames.has(surface.id))
      this.surfaceFrames.set(surface.id, []);
    this.surfaceFrames.get(surface.id)!.push(frame);
    if (this.frames.length > this.config.maxFrames) {
      // Keep each surface's last known state even if only another surface keeps rendering.
      const index = this.frames.findIndex(
        (candidate) => this.surfaceFrames.get(candidate.surface.id)!.length > 1,
      );
      const [removed] = this.frames.splice(index, 1);
      const history = this.surfaceFrames.get(removed.surface.id)!;
      history.shift();
      if (!history.length) this.surfaceFrames.delete(removed.surface.id);
    }
    const { geometryKeys: _keys, inverseMatrix: _inverse, ...payload } = frame;
    this.record("frame", payload);
    this.diagnostics.presentation(payload);
    return clone(payload);
  }

  gaze(sample: GazeSample, receivedTimeMs: number) {
    validateGaze(sample);
    finite(receivedTimeMs, "received time");
    if (this.pending.length >= this.config.maxPending)
      throw new RangeError(
        "Gaze reorder buffer full; flush or apply source backpressure",
      );
    const mapped = this.clocks.map(
      sample.clockId,
      sample.clockEpoch,
      sample.timeMs,
    );
    const key = observationKey(sample);
    if (this.seenSamples.has(key) || this.pendingKeys.has(key))
      throw new Error(`Duplicate gaze sample: ${sample.id}`);
    const raw = jsonRecord(sample);
    this.seenSamples.set(key, true);
    if (this.seenSamples.size > this.config.maxRecords)
      this.seenSamples.delete(this.seenSamples.keys().next().value!);
    const item = {
      sample: raw,
      receivedTimeMs,
      captureTimeMs: mapped.timeMs,
      uncertaintyMs: mapped.uncertaintyMs,
      late: mapped.timeMs <= this.finalizedThrough,
      sequence: this.recordSequence + 1,
      quarantined:
        mapped.timeMs > receivedTimeMs + mapped.uncertaintyMs ||
        mapped.uncertaintyMs > this.config.maxClockUncertaintyMs,
    };
    this.pending.push(item);
    this.pendingKeys.add(key);
    this.record("gaze", { sample: raw, receivedTimeMs });
    this.seenSources.add(sample.sourceId);
    if (!item.quarantined)
      this.diagnostics.gaze(
        raw,
        mapped.timeMs,
        this.sources.get(sample.sourceId),
      );
  }

  frameIndexAt(t: number, surfaceId?: string): number {
    const history =
      surfaceId === undefined
        ? this.frames
        : (this.surfaceFrames.get(surfaceId) ?? []);
    let left = 0,
      right = history.length;
    while (left < right) {
      const mid = (left + right) >>> 1;
      if (history[mid].t <= t) left = mid + 1;
      else right = mid;
    }
    return left - 1;
  }

  frameAt(t: number, surfaceId?: string): InternalFrame | undefined {
    const history =
      surfaceId === undefined
        ? this.frames
        : (this.surfaceFrames.get(surfaceId) ?? []);
    return history[this.frameIndexAt(t, surfaceId)];
  }

  align(
    item: PendingGaze,
    horizon = this.lastFlush,
  ): Omit<AlignedGaze, "alignedTimeMs"> {
    const {
      sample: s,
      captureTimeMs: t,
      receivedTimeMs,
      uncertaintyMs,
      late,
    } = item;
    const flags: string[] = [];
    if (late) flags.push("late-arrival");
    if (!s.valid) flags.push("invalid-measurement");
    if (s.blink) flags.push("blink");
    if (this.sources.get(s.sourceId)?.timestampKind === "host-receipt")
      flags.push("receipt-time-only");
    if (s.confidence === null) flags.push("confidence-unavailable");
    else if (s.confidence < this.config.minConfidence)
      flags.push("low-confidence");
    if (uncertaintyMs > this.config.maxClockUncertaintyMs)
      flags.push("clock-uncertain");
    if (t + uncertaintyMs > horizon)
      flags.push("incomplete-uncertainty-window");
    if (t > receivedTimeMs + uncertaintyMs) flags.push("future-capture");
    if (receivedTimeMs - t > this.config.maxLatencyMs)
      flags.push("high-latency");
    const f = t > horizon ? undefined : this.frameAt(t, s.surfaceId);
    const result: Omit<AlignedGaze, "alignedTimeMs"> = {
      eye: s.eye,
      clockId: s.clockId,
      clockEpoch: s.clockEpoch,
      ...(s.calibrationId === undefined
        ? {}
        : { calibrationId: s.calibrationId }),
      ...(s.captureId === undefined ? {} : { captureId: s.captureId }),
      sampleId: s.id,
      sourceId: s.sourceId,
      type: s.type,
      captureTimeMs: t,
      receivedTimeMs,
      latencyMs: receivedTimeMs - t,
      clockUncertaintyMs: uncertaintyMs,
      frameId: f?.id ?? null,
      surfaceId: s.surfaceId,
      surfaceEpoch: s.surfaceEpoch,
      viewportPoint: null,
      contentPoint: null,
      rayHit: null,
      usable: false,
      flags,
    };
    if (!f) {
      flags.push("missing-history");
      return result;
    }
    result.presentationTimeMs = f.t;
    result.contentId = f.contentId;
    result.presentationTiming = f.timing;
    result.causeIds = [...f.causeIds];
    if (f.surface.id !== s.surfaceId) flags.push("surface-id-mismatch");
    if (f.surface.epoch !== s.surfaceEpoch)
      flags.push("surface-epoch-mismatch");
    if (f.surface.active === false) flags.push("surface-inactive");
    if (uncertaintyMs > 0) {
      const history = this.surfaceFrames.get(s.surfaceId) ?? [];
      const lower = this.frameIndexAt(t - uncertaintyMs, s.surfaceId),
        upper = this.frameIndexAt(t + uncertaintyMs, s.surfaceId);
      const before = history[lower];
      let changed = !before;
      for (let i = lower + 1; !changed && i <= upper; i++) {
        changed =
          history[i].geometryKeys[s.type] !== before.geometryKeys[s.type];
      }
      if (changed) flags.push("ambiguous-presentation");
    }
    if (
      !s.valid ||
      s.blink ||
      flags.some(
        (x) => x === "surface-id-mismatch" || x === "surface-epoch-mismatch",
      )
    )
      return result;
    let p: Point | undefined;
    if (s.type === "pog2d") {
      if (s.space === "viewport") p = { ...s.point };
      else if (s.space === "normalized-viewport")
        p = { x: s.point.x * f.view.width, y: s.point.y * f.view.height };
      else if (f.surface.display) {
        const d = f.surface.display;
        p = {
          x: s.point.x * d.width - d.left,
          y: s.point.y * d.height - d.top,
        };
      } else flags.push("missing-display-layout");
    } else if (s.type === "direction3d") {
      flags.push("direction-only");
      return result;
    } else {
      if (f.surface.plane && f.surface.plane.static !== true) {
        const age = t - f.surface.poseTimeMs!;
        if (age < -uncertaintyMs) flags.push("pose-after-capture");
        if (age > this.config.maxPoseAgeMs) flags.push("stale-plane-pose");
      }
      const layout =
        f.surface.planeSpace === "display" ? f.surface.display : undefined;
      const hit = projectRay(
        s.ray,
        f.surface.plane,
        layout?.width ?? f.view.width,
        layout?.height ?? f.view.height,
      );
      if (hit.reason) flags.push(hit.reason);
      else {
        p = layout
          ? { x: hit.point!.x - layout.left, y: hit.point!.y - layout.top }
          : hit.point;
        result.rayHit = {
          frameId: f.surface.plane!.frameId,
          pointMeters: hit.hit!,
          distanceMeters: hit.distanceMeters!,
        };
      }
    }
    if (!p) return result;
    if (![p.x, p.y].every(Number.isFinite)) {
      flags.push("non-finite-projection");
      return result;
    }
    let contentPoint;
    try {
      contentPoint = applyAffine(f.inverseMatrix, p);
    } catch {
      flags.push("non-finite-projection");
      return result;
    }
    const display = f.surface.display;
    if (
      display &&
      !inside(
        { x: p.x + display.left, y: p.y + display.top },
        display.width,
        display.height,
      )
    )
      flags.push("off-display");
    result.viewportPoint = p;
    result.contentPoint = contentPoint;
    if (!inside(p, f.view.width, f.view.height)) flags.push("off-viewport");
    if (!inside(result.contentPoint, f.view.contentWidth, f.view.contentHeight))
      flags.push("off-content");
    result.usable = flags.every((x) =>
      ["late-arrival", "high-latency", "confidence-unavailable"].includes(x),
    );
    return result;
  }

  flush(
    now: number,
    { final = false }: { final?: boolean } = {},
  ): AlignedGaze[] {
    finite(now, "flush time");
    if (typeof final !== "boolean")
      throw new TypeError("final must be boolean");
    if (now < this.lastFlush) throw new RangeError("Flush time regressed");
    const cutoff =
      now -
      (final
        ? 0
        : Math.max(
            this.config.reorderWindowMs,
            this.config.maxClockUncertaintyMs,
          ));
    const ready = this.pending
      .filter(
        (p) =>
          (p.quarantined || p.captureTimeMs <= cutoff) &&
          p.receivedTimeMs <= now,
      )
      .sort(
        (a, b) => a.captureTimeMs - b.captureTimeMs || a.sequence - b.sequence,
      );
    const selected = new Set(ready);
    const results = ready.map((p) => ({
      ...this.align(p, now),
      alignedTimeMs: now,
    }));
    this.pending = this.pending.filter((p) => !selected.has(p));
    for (const p of ready) this.pendingKeys.delete(observationKey(p.sample));
    this.lastFlush = now;
    this.aligned.push(...results);
    for (const a of results)
      this.diagnostics.aligned(
        a.flags,
        a.captureTimeMs,
        a.sourceId,
        a.eye,
        a.surfaceId,
      );
    if (this.aligned.length > this.config.maxRecords) {
      const count = this.aligned.length - this.config.maxRecords;
      this.aligned.splice(0, count);
      this.alignedDropped += count;
    }
    this.finalizedThrough = Math.max(this.finalizedThrough, cutoff);
    this.record("flush", { now, final });
    return clone(results);
  }

  export(): Recording {
    return clone({
      schemaVersion: SCHEMA_VERSION,
      implementationVersion: IMPLEMENTATION_VERSION,
      recordCount: this.recordSequence,
      config: this.config,
      clocks: this.clocks.export(),
      sources: [...this.sources.values()].map(clone),
      diagnostics: this.diagnostics.report(),
      recordsDropped: this.recordsDropped,
      alignedDropped: this.alignedDropped,
      pendingCount: this.pending.length,
      records: this.records,
      aligned: this.aligned,
    });
  }
}

/** Recompute from raw source records. Do not treat a truncated recording as an exact replay. */
export function replay(recording: Recording): GazeSession {
  if (
    recording.schemaVersion !== SCHEMA_VERSION ||
    recording.implementationVersion !== IMPLEMENTATION_VERSION
  )
    throw new Error(
      "Unsupported recording schema or implementation version; exact replay requires the original version",
    );
  if (recording.recordsDropped)
    throw new Error(
      "Recording was truncated; persist raw chunks before buffer rollover",
    );
  if (
    !Array.isArray(recording.records) ||
    recording.recordCount !== recording.records.length
  )
    throw new Error("Recording is not complete: record count differs");
  recording.records.forEach((record, i) => {
    if (record.sequence !== i + 1)
      throw new Error("Recording sequence is not complete or ordered");
  });
  const session = new GazeSession(recording.config);
  for (const source of recording.sources) session.registerSource(source);
  for (const clock of recording.clocks) session.clocks.register(clock);
  for (const { type, payload } of recording.records) {
    if (type === "frame") session.present(payload);
    else if (type === "input") session.input(payload);
    else if (type === "gaze")
      session.gaze(payload.sample, payload.receivedTimeMs);
    else if (type === "flush")
      session.flush(payload.now, { final: payload.final });
    else throw new Error(`Unsupported recording record: ${type}`);
  }
  return session;
}
