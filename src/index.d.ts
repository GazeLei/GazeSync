export interface Point {
  x: number
  y: number
}
export type Vector3 = [number, number, number]
/** Canvas/DOM order: x'=a*x+c*y+e; y'=b*x+d*y+f. */
export type Affine = [number, number, number, number, number, number]
export interface View {
  width: number
  height: number
  contentWidth: number
  contentHeight: number
  minZoom: number
  maxZoom: number
  scale: number
  tx: number
  ty: number
}
export interface ViewOptions {
  width: number
  height: number
  contentWidth: number
  contentHeight: number
  minZoom?: number
  maxZoom?: number
}
export interface Plane {
  frameId: string
  topLeft: Vector3
  right: Vector3
  down: Vector3
  widthMeters: number
  heightMeters: number
  static?: boolean
}
export interface Ray {
  frameId: string
  origin: Vector3
  direction: Vector3
}
export interface Surface {
  id: string
  epoch: string
  active?: boolean
  plane?: Plane
  poseTimeMs?: number
  display?: { width: number; height: number; left: number; top: number }
}
export interface ClockMapping {
  id: string
  epoch: string
  sourceOriginMs: number
  sessionOriginMs: number
  rate?: number
  uncertaintyMs?: number
  driftUncertaintyPpm?: number
}
export class ClockRegistry {
  register(mapping: ClockMapping): Required<ClockMapping>
  map(
    id: string,
    epoch: string,
    sourceTimeMs: number,
  ): { timeMs: number; uncertaintyMs: number }
  export(): Required<ClockMapping>[]
}
export interface GazeBase {
  id: string
  sourceId: string
  clockId: string
  clockEpoch: string
  timeMs: number
  surfaceId: string
  surfaceEpoch: string
  confidence: number
  valid: boolean
  blink?: boolean
  calibrationId?: string
}
type Measurement<T> =
  | ({ valid: true; blink?: false } & T)
  | ({ valid: false; blink?: boolean } & Partial<T>)
  | ({ valid: true; blink: true } & Partial<T>)
/** A valid, non-blink measurement requires the entire typed payload. */
export type PoG2D = Omit<GazeBase, 'valid' | 'blink'> & {
  type: 'pog2d'
} & Measurement<{
    space: 'viewport' | 'normalized-viewport' | 'normalized-display'
    point: Point
  }>
export type GazeRay3D = Omit<GazeBase, 'valid' | 'blink'> & {
  type: 'ray3d'
} & Measurement<{ ray: Ray }>
export type GazeSample = PoG2D | GazeRay3D
export interface InputEventRecord {
  id: string
  t: number
  kind: string
  [key: string]: unknown
}
export interface Presentation {
  t: number
  view: View
  surface: Surface
  contentId?: string
  matrix?: Affine
  causeIds?: string[]
  timing?: 'render-callback' | 'display-feedback' | 'synthetic'
}
export interface PresentationRecord extends Presentation {
  id: string
  matrix: Affine
}
export interface AlignedGaze {
  sampleId: string
  sourceId: string
  type: GazeSample['type']
  captureTimeMs: number
  receivedTimeMs: number
  alignedTimeMs: number
  latencyMs: number
  clockUncertaintyMs: number
  frameId: string | null
  presentationTimeMs?: number
  presentationTiming?: Presentation['timing']
  surfaceId: string
  surfaceEpoch: string
  contentId?: string
  causeIds?: string[]
  usable: boolean
  flags: string[]
  viewportPoint: Point | null
  contentPoint: Point | null
  rayHit: { pointMeters: Vector3; distanceMeters: number } | null
}
export interface SessionConfig {
  reorderWindowMs?: number
  maxClockUncertaintyMs?: number
  minConfidence?: number
  maxPoseAgeMs?: number
  maxLatencyMs?: number
  maxFrames?: number
  maxRecords?: number
  maxPending?: number
}
export interface Recording {
  schemaVersion: '1.1'
  implementationVersion: '0.2.0'
  recordCount: number
  config: Required<SessionConfig>
  clocks: ClockMapping[]
  recordsDropped: number
  alignedDropped: number
  pendingCount: number
  records: {
    sequence: number
    type: 'input' | 'frame' | 'gaze' | 'flush'
    payload: unknown
  }[]
  aligned: AlignedGaze[]
}
export class GazeSession {
  constructor(config?: SessionConfig)
  readonly config: Required<SessionConfig>
  readonly clocks: ClockRegistry
  readonly aligned: AlignedGaze[]
  readonly pending: unknown[]
  readonly frames: readonly PresentationRecord[]
  frameAt(t: number, surfaceId?: string): PresentationRecord | undefined
  input(event: InputEventRecord): void
  present(presentation: Presentation): PresentationRecord
  gaze(sample: GazeSample, receivedTimeMs: number): void
  flush(now: number, options?: { final?: boolean }): AlignedGaze[]
  export(): Recording
}
export function replay(recording: Recording): GazeSession
export interface PointerInput extends Point {
  id: number | string
  t: number
  pointerType?: 'mouse' | 'touch' | 'pen'
  shiftKey?: boolean
  button?: number
}
export class ZoomController {
  constructor(
    view: View,
    options?: {
      onInput?: (event: InputEventRecord) => void
      dragThreshold?: number
      doubleTapMs?: number
      doubleTapDistance?: number
      inputPrefix?: string
    },
  )
  view: View
  readonly pointers: Map<number | string, unknown>
  readonly selection: { start: Point; end: Point } | null
  setMode(mode: 'pan' | 'box'): void
  wheel(
    event: Point & { deltaY: number; deltaMode?: 0 | 1 | 2; t: number },
  ): void
  zoom(factor: number, t: number, anchor?: Point): void
  reset(t: number): void
  resize(width: number, height: number, t: number): void
  pointerDown(event: PointerInput): boolean
  pointerMove(event: PointerInput): boolean
  pointerUp(event: PointerInput): boolean
  doubleTap(event: Point & { t: number }): void
  cancel(t: number, reason?: string): void
  key(event: {
    key: string
    t: number
    ctrlKey?: boolean
    metaKey?: boolean
  }): boolean
}
export function createView(options: ViewOptions): View
export function resetView(view: View): View
export function resizeView(view: View, width: number, height: number): View
export function zoomAt(
  view: View,
  factor: number,
  anchor: Point,
  destination?: Point,
): View
export function zoomToBox(
  view: View,
  start: Point,
  end: Point,
  minimumSize?: number,
): View
export function panBy(view: View, dx: number, dy: number): View
export function zoomLevel(view: View): number
export function contentToViewport(view: View, point: Point): Point
export function viewportToContent(view: View, point: Point): Point
export function viewMatrix(view: View): Affine
export function applyAffine(matrix: Affine, point: Point): Point
export function invertAffine(matrix: Affine): Affine
export function projectRay(
  ray: Ray,
  plane: Plane | undefined,
  width: number,
  height: number,
):
  | { reason: string; point?: never; hit?: never; distanceMeters?: never }
  | { reason?: never; point: Point; hit: Vector3; distanceMeters: number }
export const SCHEMA_VERSION: '1.1'
export const IMPLEMENTATION_VERSION: '0.2.0'
