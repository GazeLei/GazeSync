import type {
  GazeSample,
  GazeSession,
  InputEventRecord,
  Plane,
  Point,
  Presentation,
  Ray,
  Recording,
  View,
} from './index.js'
export interface SimulationOptions {
  seed?: number
  durationMs?: number
  gazeHz?: number
  displayHz?: number
  noiseSdPx?: number
  latencyMs?: number
  jitterMs?: number
  clockRate?: number
  clockOffsetMs?: number
}
export type Device = 'desktop' | 'mobile'
export const simulationDefaults: Readonly<
  Required<Omit<SimulationOptions, 'seed'>>
>
export interface Scenario {
  device: Device
  seed: number
  config: Required<Omit<SimulationOptions, 'seed'>>
  frames: (Presentation & {
    selection: { start: Point; end: Point } | null
    pointers: Point[]
  })[]
  inputs: InputEventRecord[]
  deliveries: { t: number; sample: GazeSample }[]
  truth: Map<
    string,
    {
      captureTimeMs: number
      screenTruth: Point
      noisy: Point
      frameTimeMs: number
      epoch: string
      content: Point
      behavior: string
    }
  >
  phases: {
    t: number
    mode: string
    x: number
    y: number
    label: string
    content: Point
  }[]
}
export interface SimulationSummary {
  device: Device
  seed: number
  gazeSamples: number
  usableSamples: number
  presentationFrames: number
  expectedSamples: number
  mappedSamples: number
  pairedSamples: number
  pendingSamples: number
  frameMismatches: number
  maxReconstructionErrorPx: number | null
  paired2D3DMaxDifferencePx: number
  meanInjectedGazeErrorPx: number
  p95InjectedGazeErrorPx: number
  naiveArrivalMappingMeanErrorPx: number
  naiveArrivalMappingP95ErrorPx: number
  finalZoom: number
  replayExact: boolean
  flagCounts: Record<string, number>
  assumptions: string
}
export function randomGenerator(seed: number): () => number
export function simulatedPlane(
  device: Device,
  landscape?: boolean,
  timeMs?: number,
  moving?: boolean,
): Plane
export function rayForPoint(
  point: Point,
  view: View,
  plane: Plane,
  timeMs?: number,
): Ray
export function buildScenario(
  device: Device,
  options?: SimulationOptions,
): Scenario
export function runScenario(
  device: Device,
  options?: SimulationOptions,
): {
  scenario: Scenario
  session: GazeSession
  recording: Recording
  summary: SimulationSummary
}
export function isScenarioPassing(summary: SimulationSummary): boolean
