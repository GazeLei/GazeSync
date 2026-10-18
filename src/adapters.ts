/** SDK-independent normalizers. Proprietary SDKs and transports are not bundled. */
import type {
  Diagnostic,
  Eye,
  GazeSample,
  GazeType,
  JSONValue,
  Point,
  SourceDescriptor,
  TrackingMode,
  Vector3,
} from "./types.js";
import { diagnosticCatalog } from "./diagnostics.js";
import { finite, positive } from "./geometry.js";
import { jsonRecord } from "./records.js";

type Raw = Record<string, unknown>;
export interface AdapterWarning {
  code: string;
  severity: Diagnostic["severity"];
  message: string;
  remedy: string;
  sourceId: string;
  eye?: Eye;
}
export interface AdapterResult {
  samples: GazeSample[];
  warnings: AdapterWarning[];
}
export interface AdapterContext {
  clockId: string;
  clockEpoch: string;
  surfaceId: string;
  surfaceEpoch: string;
  calibrationId?: string;
}
export interface AdapterOptions extends AdapterContext {
  sourceId: string;
  expectedHz?: number;
  eyeRatesHz?: Partial<Record<Eye, number>>;
  eyes?: Eye[];
  trackingMode?: TrackingMode;
  deviceModel?: string;
  frameId?: string;
  timestampKind?: SourceDescriptor["timestampKind"];
}
export type TimestampUnit = "s" | "ms" | "us" | "ns";
export type PointUnits =
  "viewport" | "normalized-viewport" | "normalized-display" | "display-pixels";
export interface ModelOptions extends AdapterOptions {
  type: GazeType;
  eye: Eye;
  timestampUnit: TimestampUnit;
  pointUnits?: PointUnits;
  originUnits?: "m" | "mm";
  displayPixels?: { width: number; height: number };
  yOrigin?: "top" | "bottom";
  fields?: {
    timestamp?: string;
    id?: string;
    point?: string;
    origin?: string;
    direction?: string;
    confidence?: string;
    valid?: string;
  };
}

function choice(value: unknown, allowed: readonly unknown[], name: string) {
  if (!allowed.includes(value))
    throw new TypeError(`${name} must be one of ${allowed.join(", ")}`);
}

const object = (value: unknown): Raw =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Raw)
    : {};
const field = (record: Raw, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        Object.hasOwn(object(value), key) ? object(value)[key] : undefined,
      record,
    );
const numbers = (value: unknown, length: number): number[] | null => {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return null;
  const a = Array.from(value as ArrayLike<unknown>);
  return a.length === length &&
    a.every((n) => typeof n === "number" && Number.isFinite(n))
    ? (a as number[])
    : null;
};
const coordinates = (value: unknown): Point | null => {
  const a = numbers(value, 2),
    o = object(value);
  return a
    ? { x: a[0], y: a[1] }
    : typeof o.x === "number" &&
        typeof o.y === "number" &&
        Number.isFinite(o.x) &&
        Number.isFinite(o.y)
      ? { x: o.x, y: o.y }
      : null;
};
const confidence = (value: unknown): number | null => {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  )
    throw new TypeError("Confidence must be null or a number in [0,1]");
  return value;
};
const stamp = (value: number): string => {
  const buffer = new ArrayBuffer(8),
    view = new DataView(buffer);
  view.setFloat64(0, value === 0 ? 0 : value, false);
  return (
    view.getUint32(0, false).toString(16).padStart(8, "0") +
    view.getUint32(4, false).toString(16).padStart(8, "0")
  );
};
const identifier = (value: unknown): string => {
  if (typeof value === "string" && value.length) return value;
  if (typeof value === "number" && Number.isSafeInteger(value))
    return String(value);
  throw new TypeError(
    "A provided sample ID must be a nonempty string or safe integer",
  );
};
export function timestampToMilliseconds(
  value: unknown,
  unit: TimestampUnit,
): number {
  const scale = { s: 1000, ms: 1, us: 0.001, ns: 0.000001 }[unit];
  if (scale === undefined || typeof value !== "number")
    throw new TypeError(
      "Explicit numeric timestamp and supported unit are required",
    );
  return finite(value * scale, "converted timestamp");
}

abstract class Adapter<T extends AdapterOptions> {
  protected readonly descriptor: SourceDescriptor;
  get source(): SourceDescriptor {
    return structuredClone(this.descriptor);
  }
  protected sequence = 0;
  constructor(
    protected readonly options: T,
    adapter: string,
    kind: SourceDescriptor["kind"],
    eyes: Eye[],
    mode: TrackingMode,
    timestampKind: SourceDescriptor["timestampKind"],
  ) {
    this.options = options = jsonRecord(options);
    for (const key of [
      "sourceId",
      "clockId",
      "clockEpoch",
      "surfaceId",
      "surfaceEpoch",
    ] as const)
      if (typeof options[key] !== "string" || !options[key])
        throw new TypeError(`${key} is required`);
    for (const key of ["frameId", "deviceModel", "calibrationId"] as const)
      if (
        options[key] !== undefined &&
        (typeof options[key] !== "string" || !options[key])
      )
        throw new TypeError(`${key} must be a nonempty string`);
    if (
      options.eyeRatesHz !== undefined &&
      (options.eyeRatesHz === null ||
        typeof options.eyeRatesHz !== "object" ||
        Array.isArray(options.eyeRatesHz))
    )
      throw new TypeError("eyeRatesHz must be a mapping");
    if (options.expectedHz !== undefined)
      positive(options.expectedHz, "expectedHz");
    if (
      !Array.isArray(eyes) ||
      !eyes.length ||
      new Set(eyes).size !== eyes.length ||
      eyes.some(
        (eye) => !["left", "right", "combined", "unknown"].includes(eye),
      )
    )
      throw new TypeError("Explicit eye selection is required");
    choice(
      options.trackingMode === undefined ? mode : options.trackingMode,
      [
        "monocular",
        "binocular-independent",
        "binocular-fused",
        "mixed",
        "unspecified",
      ],
      "trackingMode",
    );
    choice(
      options.timestampKind === undefined
        ? timestampKind
        : options.timestampKind,
      ["exposure", "vendor-estimate", "host-receipt"],
      "timestampKind",
    );
    for (const [eye, hz] of Object.entries(options.eyeRatesHz ?? {})) {
      if (!eyes.includes(eye as Eye))
        throw new TypeError("eyeRatesHz must describe declared eyes");
      positive(hz!, "eyeRatesHz");
    }
    this.descriptor = {
      id: options.sourceId,
      kind,
      adapter,
      eyes: [...eyes],
      trackingMode: options.trackingMode ?? mode,
      timestampKind: options.timestampKind ?? timestampKind,
      hardwareValidated: false,
      ...(options.expectedHz === undefined
        ? {}
        : { expectedHz: options.expectedHz }),
      ...(options.eyeRatesHz ? { eyeRatesHz: { ...options.eyeRatesHz } } : {}),
      ...(options.deviceModel ? { deviceModel: options.deviceModel } : {}),
      ...(options.calibrationId
        ? { calibrationId: options.calibrationId }
        : {}),
    };
  }
  protected base(
    id: string,
    t: number,
    eye: Eye,
    type: GazeType,
    score: number | null,
    valid: boolean,
    context: Partial<AdapterContext> = {},
    metadata: Record<string, JSONValue> = {},
  ) {
    const c = { ...this.options, ...context };
    return {
      id,
      captureId: id,
      sourceId: this.options.sourceId,
      eye,
      type,
      clockId: c.clockId,
      clockEpoch: c.clockEpoch,
      timeMs: t,
      surfaceId: c.surfaceId,
      surfaceEpoch: c.surfaceEpoch,
      confidence: score,
      valid,
      ...(c.calibrationId ? { calibrationId: c.calibrationId } : {}),
      metadata: { adapter: this.descriptor.adapter, ...metadata },
    };
  }
  protected warning(code: string, eye?: Eye): AdapterWarning {
    return {
      code,
      ...diagnosticCatalog[code],
      sourceId: this.options.sourceId,
      ...(eye ? { eye } : {}),
    };
  }
  protected partial(samples: GazeSample[], warnings: AdapterWarning[]): void {
    if (
      this.descriptor.eyes.includes("left") &&
      this.descriptor.eyes.includes("right") &&
      ["left", "right"].some(
        (eye) => !samples.some((s) => s.eye === eye && s.valid),
      )
    )
      warnings.push(this.warning("BINOCULAR_PARTIAL"));
  }
}

export class ModelAdapter extends Adapter<ModelOptions> {
  constructor(model: ModelOptions) {
    super(
      model,
      "generic-model-v1",
      "model",
      model.eyes ?? [model.eye],
      model.eye === "combined" || model.eye === "unknown"
        ? "unspecified"
        : "monocular",
      "vendor-estimate",
    );
    model = this.options;
    choice(model.type, ["pog2d", "ray3d", "direction3d"], "type");
    choice(model.timestampUnit, ["s", "ms", "us", "ns"], "timestampUnit");
    choice(
      model.pointUnits === undefined ? "normalized-viewport" : model.pointUnits,
      [
        "viewport",
        "normalized-viewport",
        "normalized-display",
        "display-pixels",
      ],
      "pointUnits",
    );
    choice(
      model.originUnits === undefined ? "m" : model.originUnits,
      ["m", "mm"],
      "originUnits",
    );
    choice(
      model.yOrigin === undefined ? "top" : model.yOrigin,
      ["top", "bottom"],
      "yOrigin",
    );
    if (!this.descriptor.eyes.includes(model.eye))
      throw new TypeError("Model eye must be included in declared eyes");
    if (
      model.fields !== undefined &&
      (model.fields === null ||
        typeof model.fields !== "object" ||
        Array.isArray(model.fields) ||
        Object.entries(model.fields).some(
          ([k, v]) =>
            ![
              "timestamp",
              "id",
              "point",
              "origin",
              "direction",
              "confidence",
              "valid",
            ].includes(k) ||
            typeof v !== "string" ||
            !v.split(".").every(Boolean),
        ))
    )
      throw new TypeError(
        "fields must map known model fields to nonempty dot paths",
      );
    if (
      model.type !== "pog2d" &&
      (typeof model.frameId !== "string" || !model.frameId)
    )
      throw new TypeError("frameId is required for a 3D model signal");
    if (model.pointUnits === "display-pixels") {
      positive(model.displayPixels?.width!, "displayPixels.width");
      positive(model.displayPixels?.height!, "displayPixels.height");
    }
  }
  adapt(record: Raw, context: Partial<AdapterContext> = {}): AdapterResult {
    const f = {
      timestamp: "timestamp",
      id: "id",
      point: "point",
      origin: "origin",
      direction: "direction",
      confidence: "confidence",
      valid: "valid",
      ...this.options.fields,
    };
    const t = timestampToMilliseconds(
        field(record, f.timestamp),
        this.options.timestampUnit,
      ),
      rawId = field(record, f.id);
    const id = rawId == null ? `model-${++this.sequence}` : identifier(rawId),
      score = confidence(field(record, f.confidence)),
      status = field(record, f.valid);
    if (status != null && typeof status !== "boolean")
      throw new TypeError("Model validity must be boolean");
    const warnings: AdapterWarning[] = [],
      type = this.options.type;
    let sample: GazeSample;
    if (type === "pog2d") {
      let p = coordinates(field(record, f.point));
      const units = this.options.pointUnits ?? "normalized-viewport";
      if (p && units === "display-pixels")
        p = {
          x: p.x / this.options.displayPixels!.width,
          y: p.y / this.options.displayPixels!.height,
        };
      if (p && this.options.yOrigin === "bottom") {
        if (units === "viewport")
          throw new TypeError(
            "Convert bottom-origin logical coordinates using the measured viewport height before ingestion",
          );
        p = { x: p.x, y: 1 - p.y };
      }
      sample = {
        ...this.base(
          id,
          t,
          this.options.eye,
          type,
          score,
          status !== false && p !== null,
          context,
        ),
        space: units === "display-pixels" ? "normalized-display" : units,
        ...(p ? { point: p } : {}),
      } as GazeSample;
    } else {
      const direction = numbers(
        field(record, f.direction),
        3,
      ) as Vector3 | null;
      if (type === "direction3d")
        sample = {
          ...this.base(
            id,
            t,
            this.options.eye,
            type,
            score,
            status !== false && direction !== null,
            context,
          ),
          ...(direction ? { direction, frameId: this.options.frameId! } : {}),
        } as GazeSample;
      else {
        const origin = numbers(field(record, f.origin), 3);
        sample = {
          ...this.base(
            id,
            t,
            this.options.eye,
            type,
            score,
            status !== false && origin !== null && direction !== null,
            context,
          ),
          ...(origin && direction
            ? {
                ray: {
                  origin: origin.map(
                    (n) => n * (this.options.originUnits === "mm" ? 0.001 : 1),
                  ) as Vector3,
                  direction,
                  frameId: this.options.frameId!,
                },
              }
            : {}),
        } as GazeSample;
        if (!origin || !direction)
          warnings.push(this.warning("GEOMETRY_UNAVAILABLE", this.options.eye));
      }
    }
    return { samples: [sample], warnings };
  }
}

export interface TobiiOptions extends AdapterOptions {
  timestamp?: "device" | "system";
  includeRay?: boolean;
}
export class TobiiProAdapter extends Adapter<TobiiOptions> {
  constructor(tobii: TobiiOptions) {
    const eyes = tobii.eyes ?? ["left", "right"];
    super(
      tobii,
      "tobii-pro-dictionary-v1",
      "tracker",
      eyes,
      eyes.length === 1 ? "monocular" : "binocular-independent",
      "vendor-estimate",
    );
    if (eyes.some((eye) => !["left", "right"].includes(eye)))
      throw new TypeError("Tobii per-eye channels must be left or right");
    if (tobii.includeRay && !tobii.frameId)
      throw new TypeError("Declare the Tobii UCS frameId before enabling rays");
  }
  adapt(record: Raw, context: Partial<AdapterContext> = {}): AdapterResult {
    const rawTime =
      record[
        this.options.timestamp === "system"
          ? "system_time_stamp"
          : "device_time_stamp"
      ];
    const t = timestampToMilliseconds(rawTime, "us"),
      id =
        record.id === undefined ? `tobii-${stamp(t)}` : identifier(record.id),
      samples: GazeSample[] = [],
      warnings: AdapterWarning[] = [];
    for (const eye of this.descriptor.eyes) {
      const p = coordinates(record[`${eye}_gaze_point_on_display_area`]);
      const validity = record[`${eye}_gaze_point_validity`];
      const valid = (validity === true || validity === 1) && p !== null;
      samples.push({
        ...this.base(id, t, eye, "pog2d", null, valid, context),
        space: "normalized-display",
        ...(p ? { point: p } : {}),
      } as GazeSample);
      if (this.options.includeRay) {
        const origin = numbers(
            record[`${eye}_gaze_origin_in_user_coordinate_system`],
            3,
          ),
          hit = numbers(
            record[`${eye}_gaze_point_in_user_coordinate_system`],
            3,
          );
        const originValidity = record[`${eye}_gaze_origin_validity`];
        const rayValid =
          valid &&
          (originValidity === true || originValidity === 1) &&
          origin !== null &&
          hit !== null;
        samples.push({
          ...this.base(id, t, eye, "ray3d", null, rayValid, context, {
            rayDefinition: "eye-origin-to-vendor-display-point",
          }),
          ...(origin && hit
            ? {
                ray: {
                  origin: origin.map((n) => n / 1000) as Vector3,
                  direction: hit.map(
                    (n, i) => (n - origin[i]) / 1000,
                  ) as Vector3,
                  frameId: this.options.frameId!,
                },
              }
            : {}),
        } as GazeSample);
        if (!rayValid) warnings.push(this.warning("GEOMETRY_UNAVAILABLE", eye));
      }
    }
    this.partial(samples, warnings);
    return { samples, warnings };
  }
}

export interface EyeLinkOptions extends AdapterOptions {
  displayPixels: { width: number; height: number };
  missingValue?: number;
}
export class EyeLinkAdapter extends Adapter<EyeLinkOptions> {
  constructor(eyelink: EyeLinkOptions) {
    const eyes = eyelink.eyes ?? ["left", "right"];
    super(
      eyelink,
      "eyelink-bridge-v1",
      "tracker",
      eyes,
      eyes.length === 1 ? "monocular" : "binocular-independent",
      "exposure",
    );
    if (eyes.some((eye) => !["left", "right"].includes(eye)))
      throw new TypeError("EyeLink per-eye channels must be left or right");
    positive(eyelink.displayPixels.width, "displayPixels.width");
    positive(eyelink.displayPixels.height, "displayPixels.height");
  }
  /** Packet fields: timeMs, optional id, left/right {gaze:[x,y], valid?, pupilSize?}. */
  adapt(record: Raw, context: Partial<AdapterContext> = {}): AdapterResult {
    const t = timestampToMilliseconds(record.timeMs, "ms"),
      id =
        record.id === undefined
          ? `eyelink-${++this.sequence}`
          : identifier(record.id),
      samples: GazeSample[] = [],
      warnings: AdapterWarning[] = [];
    for (const eye of this.descriptor.eyes) {
      const data = object(record[eye]),
        p = coordinates(data.gaze),
        missing = this.options.missingValue ?? -32768;
      if (data.valid !== undefined && typeof data.valid !== "boolean")
        throw new TypeError("EyeLink bridge validity must be boolean");
      const valid =
        data.valid !== false &&
        p !== null &&
        p.x !== missing &&
        p.y !== missing;
      samples.push({
        ...this.base(
          id,
          t,
          eye,
          "pog2d",
          null,
          valid,
          context,
          typeof data.pupilSize === "number" && Number.isFinite(data.pupilSize)
            ? { pupilSize: data.pupilSize, pupilUnit: "vendor-configured" }
            : {},
        ),
        space: "normalized-display",
        ...(p && p.x !== missing && p.y !== missing
          ? {
              point: {
                x: p.x / this.options.displayPixels.width,
                y: p.y / this.options.displayPixels.height,
              },
            }
          : {}),
      } as GazeSample);
    }
    this.partial(samples, warnings);
    return { samples, warnings };
  }
}

export type Homography = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
export interface PupilOptions extends AdapterOptions {
  sceneToSurface?: Homography;
  mappingId?: string;
  deduplicateEyes?: boolean;
  surfaceName?: string;
  maxMappingSkewMs?: number;
}
export class PupilCoreAdapter extends Adapter<PupilOptions> {
  private seen = new Set<string>();
  constructor(pupil: PupilOptions) {
    super(
      pupil,
      "pupil-core-datum-v1",
      "tracker",
      pupil.eyes ?? ["left", "right", "combined"],
      "mixed",
      "vendor-estimate",
    );
    if (
      pupil.sceneToSurface &&
      (!pupil.mappingId ||
        pupil.sceneToSurface.length !== 9 ||
        !pupil.sceneToSurface.every(Number.isFinite))
    )
      throw new TypeError(
        "A finite calibrated homography and mappingId are required",
      );
    if (pupil.maxMappingSkewMs !== undefined)
      positive(pupil.maxMappingSkewMs, "maxMappingSkewMs");
  }
  adapt(record: Raw, context: Partial<AdapterContext> = {}): AdapterResult {
    const t = timestampToMilliseconds(record.timestamp, "s"),
      topic = String(record.topic ?? ""),
      samples: GazeSample[] = [],
      warnings: AdapterWarning[] = [];
    const stagedKeys: string[] = [];
    const bases = Array.isArray(record.base_data)
      ? record.base_data.map(object)
      : [];
    const binocular = topic.includes(".01."),
      ids = binocular
        ? ["0", "1"]
        : topic.includes(".0.")
          ? ["0"]
          : topic.includes(".1.")
            ? ["1"]
            : [];
    for (const id of ids) {
      const eye: Eye = id === "0" ? "right" : "left";
      if (!this.descriptor.eyes.includes(eye)) continue;
      const base = bases.find((b) => String(b.id) === id),
        eyeTime =
          base?.timestamp === undefined || base.timestamp === null
            ? t
            : timestampToMilliseconds(base.timestamp, "s");
      const origin = numbers(
          binocular ? object(record.eye_centers_3d)[id] : record.eye_center_3d,
          3,
        ),
        direction = numbers(
          binocular
            ? object(record.gaze_normals_3d)[id]
            : record.gaze_normal_3d,
          3,
        );
      if (!origin || !direction || !this.options.frameId) {
        warnings.push(this.warning("GEOMETRY_UNAVAILABLE", eye));
        continue;
      }
      const captureId = `pupil-${eye}-${stamp(eyeTime)}`,
        key = JSON.stringify([
          context.clockId ?? this.options.clockId,
          context.clockEpoch ?? this.options.clockEpoch,
          captureId,
        ]);
      if (
        this.options.deduplicateEyes !== false &&
        (this.seen.has(key) || stagedKeys.includes(key))
      ) {
        warnings.push(this.warning("REUSED_EYE_SAMPLE", eye));
        continue;
      }
      stagedKeys.push(key);
      samples.push({
        ...this.base(
          captureId,
          eyeTime,
          eye,
          "ray3d",
          confidence(
            base && Object.hasOwn(base, "confidence")
              ? base.confidence
              : record.confidence,
          ),
          true,
          context,
          { vendorTopic: topic, vendorGazeTimeMs: t },
        ),
        ray: {
          origin: origin.map((n) => n / 1000) as Vector3,
          direction: direction as Vector3,
          frameId: this.options.frameId,
        },
      } as GazeSample);
    }
    const p = coordinates(record.norm_pos),
      eye: Eye = binocular
        ? "combined"
        : ids[0] === "0"
          ? "right"
          : ids[0] === "1"
            ? "left"
            : "unknown";
    if (p && this.descriptor.eyes.includes(eye)) {
      if (!this.options.sceneToSurface)
        warnings.push(this.warning("SURFACE_REGISTRATION_REQUIRED", eye));
      else {
        // Pupil norm coordinates start bottom-left; the calibration maps top-left scene -> top-left surface.
        const x = p.x,
          y = 1 - p.y,
          h = this.options.sceneToSurface,
          w = h[6] * x + h[7] * y + h[8];
        const mapped = {
          x: (h[0] * x + h[1] * y + h[2]) / w,
          y: (h[3] * x + h[4] * y + h[5]) / w,
        };
        const valid =
          Math.abs(w) > 1e-12 &&
          Number.isFinite(mapped.x) &&
          Number.isFinite(mapped.y);
        samples.push({
          ...this.base(
            `pupil-pog-${topic}-${stamp(t)}`,
            t,
            eye,
            "pog2d",
            confidence(record.confidence),
            valid,
            context,
            {
              mappingId: this.options.mappingId!,
              vendorTopic: topic,
              sceneToSurface: [...h],
              scenePoint: [p.x, p.y],
            },
          ),
          space: "normalized-viewport",
          ...(valid ? { point: mapped } : {}),
        } as GazeSample);
      }
    }
    for (const key of stagedKeys) {
      this.seen.add(key);
      if (this.seen.size > 4096)
        this.seen.delete(this.seen.values().next().value!);
    }
    return { samples, warnings };
  }
  /** Preferred 2D path for moving headsets: consume a named vendor-registered surface. */
  adaptSurface(
    record: Raw,
    context: Partial<AdapterContext> = {},
  ): AdapterResult {
    if (!this.options.surfaceName)
      throw new TypeError(
        "Declare surfaceName before consuming Pupil surface data",
      );
    if (record.name !== this.options.surfaceName)
      return {
        samples: [],
        warnings: [this.warning("SURFACE_REGISTRATION_REQUIRED")],
      };
    const mappingTimeMs = timestampToMilliseconds(record.timestamp, "s"),
      rows = Array.isArray(record.gaze_on_surfaces)
        ? record.gaze_on_surfaces
        : [];
    const samples: GazeSample[] = [],
      warnings: AdapterWarning[] = [];
    for (const row of rows) {
      const data = object(row),
        t = timestampToMilliseconds(data.timestamp, "s"),
        topic = String(data.topic ?? ""),
        p = coordinates(data.norm_pos);
      const eye: Eye = topic.includes(".01.")
        ? "combined"
        : topic.includes(".0.")
          ? "right"
          : topic.includes(".1.")
            ? "left"
            : "unknown";
      if (!this.descriptor.eyes.includes(eye)) continue;
      const skew = Math.abs(t - mappingTimeMs),
        valid = p !== null && skew <= (this.options.maxMappingSkewMs ?? 50);
      samples.push({
        ...this.base(
          `pupil-surface-${topic}-${stamp(t)}`,
          t,
          eye,
          "pog2d",
          confidence(data.confidence),
          valid,
          context,
          {
            surfaceName: this.options.surfaceName,
            mappingTimeMs,
            mappingSkewMs: skew,
            vendorTopic: topic,
          },
        ),
        space: "normalized-viewport",
        ...(p ? { point: { x: p.x, y: 1 - p.y } } : {}),
      } as GazeSample);
      if (skew > (this.options.maxMappingSkewMs ?? 50))
        warnings.push(this.warning("GEOMETRY_UNAVAILABLE", eye));
    }
    return { samples, warnings };
  }
}
