import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyAffine,
  contentToViewport,
  createView,
  invertAffine,
  panBy,
  projectRay,
  resetView,
  resizeView,
  viewportToContent,
  zoomAt,
  zoomLevel,
  zoomToBox,
} from '../src/index.js'
import {
  randomGenerator,
  simulatedPlane,
  rayForPoint,
} from '../src/simulation.js'

const near = (a, b, eps = 1e-8) =>
  assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`)
const same = (a, b) => {
  near(a.x, b.x)
  near(a.y, b.y)
}
const initial = () =>
  createView({
    width: 1000,
    height: 600,
    contentWidth: 2000,
    contentHeight: 1200,
  })

test('wheel/zoom preserves cursor anchor when boundaries allow; limits center smaller content', () => {
  const view = initial(),
    anchor = { x: 650, y: 210 }
  const target = viewportToContent(view, anchor)
  same(contentToViewport(zoomAt(view, 3, anchor), target), anchor)
  near(zoomLevel(zoomAt(view, 1e10, anchor)), 16)
  assert.deepEqual(zoomAt(view, 1e-10, anchor), view)
  const tall = createView({
    width: 1000,
    height: 800,
    contentWidth: 500,
    contentHeight: 1000,
  })
  near(tall.tx, 300)
  near(tall.ty, 0)
  assert.deepEqual(panBy(tall, 9999, -9999), tall)
})

test('reverse selection box fits entire rectangle, tiny/empty selections cannot explode zoom', () => {
  const v = initial()
  const a = zoomToBox(v, { x: 750, y: 450 }, { x: 250, y: 150 })
  near(zoomLevel(a), 2)
  same(contentToViewport(a, { x: 500, y: 300 }), { x: 0, y: 0 })
  same(contentToViewport(a, { x: 1500, y: 900 }), { x: 1000, y: 600 })
  assert.deepEqual(zoomToBox(v, { x: -100, y: 0 }, { x: -10, y: 0 }), v)
  assert.deepEqual(zoomToBox(v, { x: 20, y: 20 }, { x: 21, y: 100 }), v)
})

test('resize retains content focus and relative zoom; reset restores fit after rotation', () => {
  const v = zoomAt(initial(), 3, { x: 500, y: 300 })
  const resized = resizeView(v, 600, 1000)
  near(zoomLevel(resized), 3)
  same(
    viewportToContent(v, { x: 500, y: 300 }),
    viewportToContent(resized, { x: 300, y: 500 }),
  )
  near(zoomLevel(resetView(resized)), 1)
})

test('general host affine handles rotation, mirror, pivot, pan and zoom in any composition', () => {
  const random = randomGenerator(19)
  for (let i = 0; i < 500; i++) {
    const angle = random() * Math.PI * 2,
      sx = 0.1 + random() * 8,
      sy = (random() < 0.5 ? -1 : 1) * (0.1 + random() * 8)
    const m = [
      Math.cos(angle) * sx,
      Math.sin(angle) * sx,
      -Math.sin(angle) * sy,
      Math.cos(angle) * sy,
      random() * 1000,
      random() * 1000,
    ]
    const p = { x: random() * 2000 - 500, y: random() * 1000 - 300 }
    same(applyAffine(invertAffine(m), applyAffine(m, p)), p)
  }
  assert.throws(() => invertAffine([0, 0, 0, 0, 1, 2]), /Singular/)
})

test('3D ray projection preserves offscreen coordinates, rejects reverse/parallel/missing frames', () => {
  const plane = simulatedPlane('desktop'),
    view = initial()
  for (const p of [
    { x: 0, y: 0 },
    { x: 350, y: 470 },
    { x: -50, y: 900 },
  ]) {
    same(
      projectRay(rayForPoint(p, view, plane), plane, view.width, view.height)
        .point,
      p,
    )
  }
  const base = { origin: [0, 0, 0.6], frameId: plane.frameId }
  assert.equal(
    projectRay({ ...base, direction: [1, 0, 0] }, plane, 100, 100).reason,
    'parallel-ray',
  )
  assert.equal(
    projectRay({ ...base, direction: [0, 0, 1] }, plane, 100, 100).reason,
    'ray-behind-plane',
  )
  assert.equal(
    projectRay({ ...base, direction: [0, 0, 0] }, plane, 100, 100).reason,
    'zero-ray',
  )
  assert.equal(
    projectRay(
      { ...base, direction: [0, 0, -1], frameId: 'head' },
      plane,
      100,
      100,
    ).reason,
    'coordinate-frame-mismatch',
  )
})

test('invalid zoom/geometry never introduces NaN into state', () => {
  assert.throws(() =>
    createView({ width: 0, height: 100, contentWidth: 20, contentHeight: 20 }),
  )
  for (const factor of [0, -1, NaN, Infinity])
    assert.throws(() => zoomAt(initial(), factor, { x: 0, y: 0 }))
  assert.throws(() => panBy(initial(), NaN, 1))
})

test('moving phone plane uses its rotated metric axes rather than a fixed screen assumption', () => {
  const view = createView({
    width: 390,
    height: 700,
    contentWidth: 1600,
    contentHeight: 1100,
  })
  for (const t of [100, 1300, 2900, 5100, 8300]) {
    const plane = simulatedPlane('mobile', false, t, true)
    assert.equal(plane.static, false)
    const p = { x: 315, y: 510 }
    same(
      projectRay(rayForPoint(p, view, plane, t), plane, view.width, view.height)
        .point,
      p,
    )
  }
})
