/** GazeSync wire protocol: logical pixels, metres, and monotonic milliseconds. */
export type Point = { x: number; y: number };
export type Vector3 = [number, number, number];
/** Row-major 3x3 proper rotation; points are column vectors. */
export type Matrix3 = [
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
export interface RigidTransform {
  fromFrameId: string;
  toFrameId: string;
  rotation: Matrix3;
  /** Target-frame coordinates of the source origin, in metres. */
  translation: Vector3;
  /** True only if this change of frame is time-invariant. */
  static?: boolean;
}
export type Affine = [number, number, number, number, number, number];
export type Eye = "left" | "right" | "combined" | "unknown";
export type GazeType = "pog2d" | "ray3d" | "direction3d";
export type TrackingMode =
  | "monocular"
  | "binocular-independent"
  | "binocular-fused"
  | "mixed"
  | "unspecified";
export type JSONValue =
  null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };
export interface View {
  width: number;
  height: number;
  contentWidth: number;
  contentHeight: number;
  minZoom: number;
  maxZoom: number;
  scale: number;
  tx: number;
  ty: number;
}
export type ViewOptions = Pick<
  View,
  "width" | "height" | "contentWidth" | "contentHeight"
> &
  Partial<Pick<View, "minZoom" | "maxZoom">>;
export interface Plane {
  frameId: string;
  topLeft: Vector3;
  right: Vector3;
  down: Vector3;
  widthMeters: number;
  heightMeters: number;
  static?: boolean;
}
export interface Ray {
  frameId: string;
  origin: Vector3;
  direction: Vector3;
}
export interface Surface {
  id: string;
  epoch: string;
  active?: boolean;
  plane?: Plane;
  /** Rectangle described by plane: cropped viewport or full active display. */
  planeSpace?: "viewport" | "display";
  poseTimeMs?: number;
  display?: { width: number; height: number; left: number; top: number };
  devicePixelRatio?: number;
  expectedPresentationHz?: number;
  presentationMode?: "per-frame" | "change-only";
}
export interface ClockMapping {
  id: string;
  epoch: string;
  sourceOriginMs: number;
  sessionOriginMs: number;
  rate?: number;
  uncertaintyMs?: number;
  driftUncertaintyPpm?: number;
}
export interface SourceDescriptor {
  id: string;
  kind: "model" | "tracker" | "simulated" | "custom";
  adapter: string;
  eyes: Eye[];
  trackingMode: TrackingMode;
  expectedHz?: number;
  eyeRatesHz?: Partial<Record<Eye, number>>;
  timestampKind?: "exposure" | "vendor-estimate" | "host-receipt";
  deviceModel?: string;
  modelVersion?: string;
  calibrationId?: string;
  hardwareValidated?: boolean;
}
export interface GazeBase {
  id: string;
  captureId?: string;
  sourceId: string;
  eye: Eye;
  clockId: string;
  clockEpoch: string;
  timeMs: number;
  surfaceId: string;
  surfaceEpoch: string;
  confidence: number | null;
  valid: boolean;
  blink?: boolean;
  calibrationId?: string;
  metadata?: { [key: string]: JSONValue };
}
type Measurement<T> =
  | ({ valid: true; blink?: false } & T)
  | ({ valid: false; blink?: boolean } & Partial<T>)
  | ({ valid: true; blink: true } & Partial<T>);
export type PoG2D = Omit<GazeBase, "valid" | "blink"> & {
  type: "pog2d";
} & Measurement<{
    space: "viewport" | "normalized-viewport" | "normalized-display";
    point: Point;
  }>;
export type GazeRay3D = Omit<GazeBase, "valid" | "blink"> & {
  type: "ray3d";
} & Measurement<{ ray: Ray }>;
export type GazeDirection3D = Omit<GazeBase, "valid" | "blink"> & {
  type: "direction3d";
} & Measurement<{ direction: Vector3; frameId: string }>;
export type GazeSample = PoG2D | GazeRay3D | GazeDirection3D;
export interface InputEventRecord {
  id: string;
  t: number;
  kind: string;
  [key: string]: unknown;
}
export interface Presentation {
  t: number;
  view: View;
  surface: Surface;
  contentId?: string;
  matrix?: Affine;
  causeIds?: string[];
  timing?: "render-callback" | "display-feedback" | "synthetic";
}
export interface PresentationRecord extends Presentation {
  id: string;
  contentId: string;
  matrix: Affine;
  causeIds: string[];
  timing: NonNullable<Presentation["timing"]>;
}
export interface InternalFrame extends PresentationRecord {
  inverseMatrix: Affine;
  geometryKeys: Record<GazeType, string>;
}
export interface AlignedGaze {
  sampleId: string;
  captureId?: string;
  sourceId: string;
  eye: Eye;
  type: GazeType;
  clockId: string;
  clockEpoch: string;
  calibrationId?: string;
  captureTimeMs: number;
  receivedTimeMs: number;
  alignedTimeMs: number;
  latencyMs: number;
  clockUncertaintyMs: number;
  frameId: string | null;
  presentationTimeMs?: number;
  presentationTiming?: Presentation["timing"];
  surfaceId: string;
  surfaceEpoch: string;
  contentId?: string;
  causeIds?: string[];
  usable: boolean;
  flags: string[];
  viewportPoint: Point | null;
  contentPoint: Point | null;
  rayHit: {
    frameId: string;
    pointMeters: Vector3;
    distanceMeters: number;
  } | null;
}
export interface SessionConfig {
  reorderWindowMs?: number;
  maxClockUncertaintyMs?: number;
  minConfidence?: number;
  maxPoseAgeMs?: number;
  maxLatencyMs?: number;
  maxFrames?: number;
  maxRecords?: number;
  maxPending?: number;
}
export interface PendingGaze {
  sample: GazeSample;
  receivedTimeMs: number;
  captureTimeMs: number;
  uncertaintyMs: number;
  late: boolean;
  sequence: number;
  quarantined: boolean;
}
export type RawRecord = { sequence: number } & (
  | { type: "input"; payload: InputEventRecord }
  | { type: "frame"; payload: PresentationRecord }
  | { type: "gaze"; payload: { sample: GazeSample; receivedTimeMs: number } }
  | { type: "flush"; payload: { now: number; final: boolean } }
);
export interface Diagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  remedy: string;
  timeMs: number;
  sourceId?: string;
  eye?: Eye;
  surfaceId?: string;
}
export interface DiagnosticIssue extends Diagnostic {
  count: number;
  lastTimeMs: number;
}
export interface StreamRate {
  sourceId: string;
  eye: Eye;
  type: GazeType;
  clockId: string;
  clockEpoch: string;
  observedHz: number | null;
  samples: number;
}
export interface DiagnosticReport {
  issues: DiagnosticIssue[];
  streams: StreamRate[];
}
export interface SessionObservers {
  onDiagnostic?: (diagnostic: Diagnostic) => void;
}
export interface Recording {
  schemaVersion: "2.1";
  implementationVersion: "0.4.0";
  recordCount: number;
  config: Required<SessionConfig>;
  clocks: Required<ClockMapping>[];
  sources: SourceDescriptor[];
  recordsDropped: number;
  alignedDropped: number;
  pendingCount: number;
  records: RawRecord[];
  aligned: AlignedGaze[];
  diagnostics: DiagnosticReport;
}
export interface PointerInput extends Point {
  id: number | string;
  t: number;
  pointerType?: "mouse" | "touch" | "pen";
  shiftKey?: boolean;
  button?: number;
}
export interface ControllerOptions {
  onInput?: (event: InputEventRecord) => void;
  dragThreshold?: number;
  doubleTapMs?: number;
  doubleTapDistance?: number;
  inputPrefix?: string;
}
export interface PointerState extends Point {
  id: number | string;
  type: string;
  shiftKey: boolean;
  button: number;
  down: Point;
  downTime: number;
  moved: boolean;
  pinched: boolean;
}
export type Gesture =
  | { type: "pinch"; base: View; start: Point; distance: number }
  | { type: "pan" | "box"; base: View; start: Point };
export type RayProjection =
  | { reason: string; point?: never; hit?: never; distanceMeters?: never }
  | { reason?: never; point: Point; hit: Vector3; distanceMeters: number };
export interface SimulationOptions {
  seed?: number;
  durationMs?: number;
  gazeHz?: number;
  displayHz?: number;
  noiseSdPx?: number;
  latencyMs?: number;
  jitterMs?: number;
  clockRate?: number;
  clockOffsetMs?: number;
}
export type Device = "desktop" | "mobile";
export type SimulationConfig = Required<Omit<SimulationOptions, "seed">> & {
  seed?: number;
};
export interface SimulationFrame extends Presentation {
  selection: { start: Point; end: Point } | null;
  pointers: Point[];
}
export interface SimulationTruth {
  captureTimeMs: number;
  screenTruth: Point;
  noisy: Point;
  frameTimeMs: number;
  epoch: string;
  content: Point;
  behavior: string;
}
export interface SimulationPhase {
  t: number;
  mode: string;
  x: number;
  y: number;
  label: string;
  content?: Point;
}
export interface Scenario {
  device: Device;
  seed: number;
  config: SimulationConfig;
  frames: SimulationFrame[];
  inputs: InputEventRecord[];
  deliveries: { t: number; sample: GazeSample }[];
  truth: Map<string, SimulationTruth>;
  phases: SimulationPhase[];
}
export interface SimulationSummary {
  device: Device;
  seed: number;
  gazeSamples: number;
  expectedSamples: number;
  mappedSamples: number;
  pairedSamples: number;
  usableSamples: number;
  presentationFrames: number;
  pendingSamples: number;
  frameMismatches: number;
  maxReconstructionErrorPx: number | null;
  paired2D3DMaxDifferencePx: number;
  meanInjectedGazeErrorPx: number;
  p95InjectedGazeErrorPx: number;
  naiveArrivalMappingMeanErrorPx: number;
  naiveArrivalMappingP95ErrorPx: number;
  finalZoom: number;
  replayExact: boolean;
  flagCounts: Record<string, number>;
  assumptions: string;
}
