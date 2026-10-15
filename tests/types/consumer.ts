import {
  createView,
  GazeSession,
  ZoomController,
  type GazeSample,
  type Recording,
} from 'gazesync'
import { attachBrowserControls } from 'gazesync/browser'
import { runScenario, type SimulationSummary } from 'gazesync/simulation'
const session = new GazeSession()
const controller = new ZoomController(
  createView({
    width: 800,
    height: 600,
    contentWidth: 1600,
    contentHeight: 1200,
  }),
  { inputPrefix: 'surface-A', onInput: (event) => session.input(event) },
)
const base = {
  id: 'sample',
  sourceId: 'eye', eye: 'unknown' as const,
  clockId: 'session',
  clockEpoch: '0',
  timeMs: 10,
  surfaceId: 'A',
  surfaceEpoch: '1',
  confidence: 1,
}
const sample: GazeSample = {
  ...base,
  type: 'pog2d',
  valid: true,
  point: { x: 0.5, y: 0.5 },
  space: 'normalized-viewport',
}
session.gaze(sample, 20)
const dropout: GazeSample = { ...base, type: 'ray3d', valid: false }
session.gaze(dropout, 20)
// @ts-expect-error valid PoG needs point and coordinate space
const missing: GazeSample = { ...base, type: 'pog2d', valid: true }
const wrongRay: GazeSample = {
  ...base,
  type: 'ray3d',
  valid: true,
  // @ts-expect-error ray origin needs exactly three components
  ray: { origin: [0, 0], direction: [0, 0, -1], frameId: 'world' },
}
const recording: Recording = session.export()
const summary: SimulationSummary = runScenario('desktop').summary
declare const element: HTMLCanvasElement
attachBrowserControls(element, controller).dispose()
void [recording, summary, missing, wrongRay]
