import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyAffine,
  createView,
  GazeSession,
  invertAffine,
  replay,
  ZoomController,
} from '../src/index.js'

const view = () =>
  createView({
    width: 400,
    height: 600,
    contentWidth: 800,
    contentHeight: 1200,
  })
const gaze = (t, extra = {}) => ({
  id: `sample-${t}`,
  sourceId: 'tracker',
  clockId: 'session',
  clockEpoch: '0',
  timeMs: t,
  surfaceId: 'A',
  surfaceEpoch: '1',
  type: 'pog2d',
  space: 'viewport',
  point: { x: 200, y: 300 },
  confidence: 1,
  valid: true,
  ...extra,
})
const present = (session, t = 0, extra = {}) =>
  session.present({
    t,
    view: view(),
    surface: { id: 'A', epoch: '1' },
    ...extra,
  })

test('audit: a keyboard zoom during drag survives the next pointer move', () => {
  const c = new ZoomController(view())
  c.zoom(2, 0)
  c.pointerDown({ id: 1, x: 100, y: 200, t: 1 })
  c.pointerMove({ id: 1, x: 150, y: 200, t: 2 })
  c.key({ key: '+', t: 3 })
  const changed = { ...c.view }
  c.pointerMove({ id: 1, x: 160, y: 200, t: 4 })
  assert.deepEqual(c.view, changed)
})

test('audit: two simultaneous surfaces map against their own histories', () => {
  const s = new GazeSession()
  present(s, 0)
  present(s, 5, {
    surface: { id: 'B', epoch: '1' },
    view: createView({
      width: 200,
      height: 300,
      contentWidth: 800,
      contentHeight: 1200,
    }),
  })
  s.gaze(gaze(20), 40)
  s.gaze(gaze(21, { surfaceId: 'B', point: { x: 100, y: 150 } }), 41)
  const result = s.flush(100)
  assert.ok(result.every((a) => a.usable))
  assert.deepEqual(
    result.map((a) => a.contentPoint),
    [
      { x: 400, y: 600 },
      { x: 400, y: 600 },
    ],
  )
})

test('audit: retention keeps the current state of an unchanged second display', () => {
  const s = new GazeSession({ maxFrames: 2 })
  present(s, 0)
  for (const t of [1, 2, 3, 4])
    present(s, t, { surface: { id: 'B', epoch: '1' } })
  assert.equal(s.frames.length, 2)
  s.gaze(gaze(5), 10)
  assert.equal(s.flush(100)[0].usable, true)
  assert.throws(
    () => present(s, 110, { surface: { id: 'C', epoch: '1' } }),
    /another surface/,
  )
})

test('audit: scale-independent inversion accepts a well-conditioned thumbnail of a huge image', () => {
  const m = [1e-8, 0, 0, 1e-8, 10, 20]
  const p = applyAffine(invertAffine(m), { x: 110, y: 220 })
  assert.ok(Math.abs(p.x - 1e10) < 1e-4)
  assert.ok(Math.abs(p.y - 2e10) < 1e-4)
  assert.throws(
    () => invertAffine([1e308, 1e308, 1e308, 1e308, 0, 0]),
    /Singular|condition/,
  )
})

test('audit: malformed presentation metadata cannot destroy pending gaze during flush', () => {
  const s = new GazeSession()
  assert.throws(() => present(s, 0, { causeIds: {} }), /causeIds/)
  assert.equal(s.frames.length, 0)
  present(s, 0)
  s.gaze(gaze(10), 20)
  assert.equal(s.flush(100)[0].usable, true)
})

test('audit: inactive-state strings and non-JSON metadata are rejected at ingestion', () => {
  const s = new GazeSession()
  assert.throws(
    () => present(s, 0, { surface: { id: 'A', epoch: '1', active: 'false' } }),
    /active/,
  )
  present(s)
  assert.throws(
    () => s.gaze(gaze(10, { metadata: new Map([['hidden', 'value']]) }), 20),
    /JSON|plain/,
  )
  assert.throws(() => s.gaze(gaze(10, { blink: 'false' }), 20), /blink/)
  assert.throws(() => s.flush(100, { final: 'false' }), /boolean/)
  assert.throws(() => new GazeSession({ constructor: 4 }), /Unknown/)
  s.gaze(gaze(10), 20)
  assert.equal(s.flush(100)[0].usable, true)
})

test('audit: far-future source timestamps are quarantined promptly instead of filling the reorder buffer', () => {
  const s = new GazeSession()
  present(s)
  s.gaze(gaze(1e12), 40)
  const result = s.flush(100)
  assert.equal(result.length, 1)
  assert.ok(result[0].flags.includes('future-capture'))
  assert.equal(result[0].usable, false)
  assert.equal(s.pending.length, 0)
})

test('audit: replay rejects missing records even when the caller claims the log is complete', () => {
  const s = new GazeSession()
  present(s)
  s.input({ id: 'event-1', kind: 'test', t: 1 })
  s.gaze(gaze(20), 40)
  s.flush(100)
  const recording = s.export()
  recording.records.splice(1, 1)
  assert.throws(() => replay(recording), /sequence|complete/)
})
