import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ClockRegistry,
  createView,
  GazeSession,
  replay,
  zoomAt,
} from '../src/index.js'
import { rayForPoint, simulatedPlane } from '../src/simulation.js'

const initial = () =>
  createView({
    width: 1000,
    height: 600,
    contentWidth: 2000,
    contentHeight: 1200,
  })
const surface = (epoch = '1') => ({
  id: 'screen',
  epoch,
  plane: simulatedPlane('desktop'),
})
const sample = (t, extra = {}) => ({
  id: `s-${t}`,
  sourceId: 'tracker',
  clockId: 'session',
  clockEpoch: '0',
  timeMs: t,
  surfaceId: 'screen',
  surfaceEpoch: '1',
  confidence: 0.99,
  valid: true,
  type: 'pog2d',
  space: 'viewport',
  point: { x: 600, y: 300 },
  ...extra,
})
const near = (a, b, eps = 1e-8) =>
  assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`)

test('delayed gaze is joined to capture-time view, never arrival/current zoom; exact boundary is inclusive', () => {
  const s = new GazeSession(),
    v = initial()
  s.present({ t: 0, view: v, surface: surface() })
  s.present({
    t: 100,
    view: zoomAt(v, 2, { x: 500, y: 300 }),
    surface: surface(),
  })
  s.gaze(sample(90), 180)
  s.gaze(sample(100), 181)
  const [old, current] = s.flush(300)
  near(old.contentPoint.x, 1200)
  near(current.contentPoint.x, 1100)
  assert.equal(old.frameId, 'frame-1')
  assert.equal(current.frameId, 'frame-2')
  assert.throws(
    () => s.present({ t: 200, view: v, surface: surface() }),
    /watermark/,
  )
})

test('affine clock offset/drift is frozen per epoch and uncertainty grows away from clock anchors', () => {
  const clock = new ClockRegistry()
  const m = {
    id: 'camera',
    epoch: 'boot-1',
    sourceOriginMs: 4000,
    sessionOriginMs: 100,
    rate: 1.001,
    uncertaintyMs: 0.5,
    driftUncertaintyPpm: 100,
  }
  clock.register(m)
  near(clock.map('camera', 'boot-1', 5000).timeMs, 1101)
  near(clock.map('camera', 'boot-1', 5000).uncertaintyMs, 0.6001)
  assert.throws(
    () => clock.register({ ...m, sessionOriginMs: 200 }),
    /immutable/,
  )
  assert.throws(() => clock.map('camera', 'boot-2', 5000), /Unregistered/)
  clock.register({ ...m, epoch: 'boot-2', sessionOriginMs: 200 })
  near(clock.map('camera', 'boot-1', 5000).timeMs, 1101)
})

test('buffered delivery order, late samples, no interpolation across blinks; latency stays observable', () => {
  const s = new GazeSession()
  s.present({ t: 0, view: initial(), surface: surface() })
  s.gaze(sample(40), 50)
  s.gaze(sample(20), 51)
  assert.equal(s.flush(70).length, 0)
  assert.deepEqual(
    s.flush(110).map((a) => a.captureTimeMs),
    [20, 40],
  )
  s.gaze(sample(30, { id: 'late' }), 400)
  s.gaze(sample(80, { valid: false, blink: true, point: undefined }), 401)
  const results = s.flush(500)
  assert.ok(results[0].flags.includes('late-arrival'))
  assert.ok(results[0].flags.includes('high-latency'))
  assert.equal(results[1].viewportPoint, null)
  assert.equal(results[1].usable, false)
  assert.ok(results[1].flags.includes('blink'))
})

test('clock uncertainty spanning a visual change is flagged; static repeat frames are unambiguous', () => {
  const s = new GazeSession(),
    v = initial()
  s.clocks.register({
    id: 'sensor',
    epoch: 'a',
    sourceOriginMs: 0,
    sessionOriginMs: 0,
    uncertaintyMs: 3,
  })
  s.present({ t: 0, view: v, surface: surface() })
  s.present({ t: 50, view: v, surface: surface() })
  s.present({
    t: 100,
    view: zoomAt(v, 2, { x: 500, y: 300 }),
    surface: surface(),
  })
  s.gaze(sample(49, { clockId: 'sensor', clockEpoch: 'a' }), 120)
  s.gaze(sample(99, { clockId: 'sensor', clockEpoch: 'a' }), 121)
  const [staticPoint, transition] = s.flush(200)
  assert.equal(staticPoint.usable, true)
  assert.ok(transition.flags.includes('ambiguous-presentation'))
  assert.equal(transition.usable, false)
})

test('floating-point clock conversion at a frame boundary cannot silently certify the wrong view', () => {
  const s = new GazeSession(),
    v = initial(),
    rate = 1.00012,
    offset = 84000
  s.clocks.register({
    id: 'sensor',
    epoch: 'boot',
    sourceOriginMs: -offset / rate,
    sessionOriginMs: 0,
    rate,
  })
  s.present({ t: 0, view: v, surface: surface() })
  s.present({
    t: 100,
    view: zoomAt(v, 2, { x: 500, y: 300 }),
    surface: surface(),
  })
  s.gaze(
    sample((100 - offset) / rate, { clockId: 'sensor', clockEpoch: 'boot' }),
    180,
  )
  const [a] = s.flush(250)
  assert.ok(a.clockUncertaintyMs > 0)
  assert.ok(a.flags.includes('ambiguous-presentation'))
  assert.equal(a.usable, false)
})

test('stored frame snapshots are immutable and 2D remains usable across independent 3D pose changes', () => {
  const s = new GazeSession(),
    v = initial(),
    first = surface()
  s.clocks.register({
    id: 'sensor',
    epoch: 'boot',
    sourceOriginMs: 0,
    sessionOriginMs: 0,
    uncertaintyMs: 2,
  })
  s.present({ t: 0, view: v, surface: first })
  first.plane.topLeft[0] = -100
  assert.notEqual(s.frames[0].surface.plane.topLeft[0], -100)
  assert.throws(() => {
    s.frames[0].matrix[0] = 99
  }, TypeError)
  const second = surface()
  second.plane.topLeft[2] = 0.01
  s.present({ t: 100, view: v, surface: second })
  s.gaze(sample(99, { clockId: 'sensor', clockEpoch: 'boot' }), 130)
  assert.equal(s.flush(200)[0].usable, true)
})

test('orientation/window epochs protect stale coordinates; full-display PoG uses explicit window offsets', () => {
  const s = new GazeSession()
  s.present({
    t: 0,
    view: initial(),
    surface: {
      ...surface(),
      display: { width: 1920, height: 1080, left: 100, top: 80 },
    },
  })
  s.present({ t: 100, view: initial(), surface: surface('2') })
  s.gaze(
    sample(40, { space: 'normalized-display', point: { x: 0.5, y: 0.5 } }),
    60,
  )
  s.gaze(sample(110), 120)
  const [a, b] = s.flush(220)
  near(a.viewportPoint.x, 860)
  near(a.viewportPoint.y, 460)
  assert.ok(b.flags.includes('surface-epoch-mismatch'))
  assert.equal(b.contentPoint, null)
})

test('identically sized stimuli retain separate content IDs and source uncertainty cannot hide a stimulus switch', () => {
  const s = new GazeSession(),
    view = initial()
  s.clocks.register({
    id: 'sensor',
    epoch: 'boot',
    sourceOriginMs: 0,
    sessionOriginMs: 0,
    uncertaintyMs: 2,
  })
  s.present({ t: 0, view, surface: surface(), contentId: 'image-A' })
  s.present({ t: 100, view, surface: surface(), contentId: 'image-B' })
  s.gaze(sample(90), 180)
  s.gaze(sample(110), 181)
  s.gaze(sample(99, { clockId: 'sensor', clockEpoch: 'boot' }), 182)
  const results = s.flush(250)
  assert.equal(results[0].contentId, 'image-A')
  assert.ok(results[1].flags.includes('ambiguous-presentation'))
  assert.equal(results[2].contentId, 'image-B')
})

test('3D sources project using metric frame geometry; missing, mismatched, stale or future poses abstain', () => {
  const v = initial(),
    plane = simulatedPlane('desktop')
  const make = (override) => {
    const s = new GazeSession()
    s.present({ t: 0, view: v, surface: { ...surface(), ...override } })
    s.gaze(
      sample(40, {
        type: 'ray3d',
        ray: rayForPoint({ x: 600, y: 300 }, v, plane),
      }),
      60,
    )
    return s.flush(200)[0]
  }
  near(make({}).contentPoint.x, 1200)
  assert.ok(make({ plane: undefined }).flags.includes('missing-plane'))
  assert.ok(
    make({ plane: { ...plane, frameId: 'other' } }).flags.includes(
      'coordinate-frame-mismatch',
    ),
  )
  assert.ok(
    make({
      plane: { ...plane, static: false },
      poseTimeMs: -20,
    }).flags.includes('stale-plane-pose'),
  )
  assert.ok(
    make({ plane: { ...plane, static: false }, poseTimeMs: 50 }).flags.includes(
      'pose-after-capture',
    ),
  )
})

test('affine host rotation and content hit testing retain original measurements outside the viewport', () => {
  const s = new GazeSession()
  s.present({
    t: 0,
    view: initial(),
    surface: surface(),
    matrix: [0, 1, -1, 0, 1000, 0],
  })
  s.gaze(sample(10, { point: { x: 600, y: 300 } }), 20)
  s.gaze(sample(11, { point: { x: -100, y: 300 } }), 21)
  const [a, b] = s.flush(200)
  near(a.contentPoint.x, 300)
  near(a.contentPoint.y, 400)
  near(b.viewportPoint.x, -100)
  assert.ok(b.flags.includes('off-viewport'))
  assert.equal(b.usable, false)
})

test('invalid quality and future capture cannot silently become a valid attention sample', () => {
  const s = new GazeSession()
  s.present({ t: 0, view: initial(), surface: surface() })
  s.gaze(sample(50, { confidence: 0.1 }), 60)
  s.gaze(sample(60), 20)
  const [a, b] = s.flush(200)
  assert.equal(a.usable, false)
  assert.ok(a.flags.includes('low-confidence'))
  assert.equal(b.usable, false)
  assert.ok(b.flags.includes('future-capture'))
  assert.throws(() => s.gaze(sample(60), 200), /Duplicate/)
  assert.throws(
    () => s.gaze(sample(80, { point: { x: NaN, y: 1 } }), 200),
    /finite/,
  )
  assert.throws(
    () => s.gaze(sample(81, { valid: false, point: { x: NaN, y: 1 } }), 200),
    /finite/,
  )
  assert.throws(() => {
    s.config.minConfidence = 0
  }, TypeError)
})

test('retention/pending limits are explicit, and a truncated recording cannot claim exact replay', () => {
  const s = new GazeSession({ maxFrames: 2, maxRecords: 5, maxPending: 2 })
  for (const t of [0, 10, 20])
    s.present({ t, view: initial(), surface: surface() })
  s.gaze(sample(1), 50)
  s.gaze(sample(2), 51)
  assert.throws(() => s.gaze(sample(3), 52), /buffer full/)
  const results = s.flush(200)
  assert.ok(results.every((a) => a.flags.includes('missing-history')))
  assert.throws(() => replay(s.export()), /truncated/)
  assert.equal(s.export().recordsDropped, 1)
})

test('record/replay preserves source data, frame causes, raw rays and aligned records exactly', () => {
  const s = new GazeSession()
  s.input({ id: 'wheel-1', t: 0, kind: 'wheel' })
  s.present({
    t: 0,
    view: initial(),
    surface: surface(),
    causeIds: ['wheel-1'],
  })
  s.gaze(sample(20), 40)
  s.flush(200)
  const recording = JSON.parse(JSON.stringify(s.export()))
  const restored = replay(recording)
  assert.deepEqual(restored.export(), recording)
  recording.records[1].payload.matrix[0] = 999
  assert.equal(s.frames[0].matrix[0], 0.5)
})
