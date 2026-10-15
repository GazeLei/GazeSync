import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createView,
  contentToViewport,
  viewportToContent,
  ZoomController,
  zoomLevel,
} from '../src/index.js'

const make = (onInput) =>
  new ZoomController(
    createView({
      width: 400,
      height: 600,
      contentWidth: 800,
      contentHeight: 1200,
    }),
    { onInput },
  )
const down = (c, id, x, y, t = 0, extra = {}) =>
  c.pointerDown({ id, x, y, t, pointerType: 'touch', ...extra })
const move = (c, id, x, y, t = 10) => c.pointerMove({ id, x, y, t })
const up = (c, id, x, y, t = 20) => c.pointerUp({ id, x, y, t })
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`)

test('wheel units convert line/page deltas and pointer coordinates remain independent of gaze', () => {
  const a = make(),
    b = make(),
    c = make()
  a.wheel({ x: 200, y: 300, deltaY: -32, t: 1 })
  b.wheel({ x: 200, y: 300, deltaY: -2, deltaMode: 1, t: 1 })
  c.wheel({ x: 200, y: 300, deltaY: -32 / 600, deltaMode: 2, t: 1 })
  assert.deepEqual(a.view, b.view)
  assert.deepEqual(a.view, c.view)
})

test('moving midpoint pinch preserves content pivot and pinch-to-pan does not jump', () => {
  const c = make()
  down(c, 1, 150, 300)
  down(c, 2, 250, 300, 1)
  const content = viewportToContent(c.view, { x: 200, y: 300 })
  move(c, 1, 100, 330)
  move(c, 2, 300, 330)
  near(zoomLevel(c.view), 2)
  const pivot = contentToViewport(c.view, content)
  near(pivot.x, 200)
  near(pivot.y, 330)
  up(c, 2, 300, 330)
  const before = { ...c.view }
  move(c, 1, 100, 330, 25)
  assert.deepEqual(c.view, before)
  move(c, 1, 110, 340, 30)
  near(c.view.tx, before.tx + 10)
  near(c.view.ty, before.ty + 10)
  up(c, 1, 110, 340, 40)
  assert.equal(c.pointers.size, 0)
})

test('mouse reverse marquee, tiny drag, Escape cancellation, Ctrl+0 and Home', () => {
  const c = make()
  c.setMode('box')
  down(c, 1, 300, 450, 0, { pointerType: 'mouse' })
  up(c, 1, 100, 150)
  near(zoomLevel(c.view), 2)
  down(c, 2, 100, 100, 30, { pointerType: 'mouse' })
  move(c, 2, 200, 200, 40)
  const before = { ...c.view }
  c.key({ key: 'Escape', t: 45 })
  assert.deepEqual(c.view, before)
  assert.equal(c.selection, null)
  c.key({ key: '0', ctrlKey: true, t: 50 })
  near(zoomLevel(c.view), 1)
  c.zoom(3, 60)
  c.key({ key: 'Home', t: 70 })
  near(zoomLevel(c.view), 1)
})

test('double tap toggles zoom; dragging/pinching/long press cannot create a double tap', () => {
  const c = make()
  down(c, 1, 200, 300, 0)
  up(c, 1, 200, 300, 30)
  down(c, 1, 202, 301, 170)
  up(c, 1, 202, 301, 200)
  near(zoomLevel(c.view), 2.5)
  down(c, 1, 200, 300, 500)
  up(c, 1, 200, 300, 530)
  down(c, 1, 200, 300, 650)
  up(c, 1, 200, 300, 680)
  near(zoomLevel(c.view), 1)
  down(c, 1, 200, 300, 900)
  move(c, 1, 210, 300, 950)
  up(c, 1, 200, 300, 1000)
  down(c, 1, 200, 300, 1100)
  up(c, 1, 200, 300, 1130)
  near(zoomLevel(c.view), 1)
  c.cancel(1200, 'blur')
  down(c, 1, 200, 300, 1300)
  up(c, 1, 200, 300, 1800)
  down(c, 1, 200, 300, 1900)
  up(c, 1, 200, 300, 1930)
  near(zoomLevel(c.view), 1)
})

test('third finger, lost capture, cancellation and resize leave no stuck gestures', () => {
  const c = make()
  down(c, 1, 100, 300)
  down(c, 2, 300, 300, 1)
  assert.equal(down(c, 3, 200, 400, 2), false)
  c.cancel(10, 'pointer-cancel')
  assert.equal(c.pointers.size, 0)
  assert.equal(move(c, 1, 100, 100), false)
  down(c, 4, 100, 100, 20)
  c.resize(600, 400, 30)
  assert.equal(c.pointers.size, 0)
  assert.equal(c.selection, null)
  near(zoomLevel(c.view), 1)
})

test('events have stable unique IDs and preserve original input timestamps', () => {
  const events = [],
    c = make((e) => events.push(e))
  down(c, 7, 100, 200, 12)
  move(c, 7, 150, 220, 18)
  up(c, 7, 150, 220, 24)
  assert.equal(new Set(events.map((e) => e.id)).size, events.length)
  assert.equal(events[0].pointerId, 7)
  assert.equal(events[0].t, 12)
})
