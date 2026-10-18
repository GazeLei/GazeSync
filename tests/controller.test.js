import test from "node:test";
import assert from "node:assert/strict";
import {
  createView,
  contentToViewport,
  viewportToContent,
  ZoomController,
  zoomLevel,
} from "../dist/index.js";

const make = (onInput) =>
  new ZoomController(
    createView({
      width: 400,
      height: 600,
      contentWidth: 800,
      contentHeight: 1200,
    }),
    { onInput },
  );
const down = (c, id, x, y, t = 0, extra = {}) =>
  c.pointerDown({ id, x, y, t, pointerType: "touch", ...extra });
const move = (c, id, x, y, t = 10) => c.pointerMove({ id, x, y, t });
const up = (c, id, x, y, t = 20) => c.pointerUp({ id, x, y, t });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test("wheel units convert line/page deltas and pointer coordinates remain independent of gaze", () => {
  const a = make(),
    b = make(),
    c = make();
  a.wheel({ x: 200, y: 300, deltaY: -32, t: 1 });
  b.wheel({ x: 200, y: 300, deltaY: -2, deltaMode: 1, t: 1 });
  c.wheel({ x: 200, y: 300, deltaY: -32 / 600, deltaMode: 2, t: 1 });
  assert.deepEqual(a.view, b.view);
  assert.deepEqual(a.view, c.view);
});

test("moving midpoint pinch preserves content pivot and pinch-to-pan does not jump", () => {
  const c = make();
  down(c, 1, 150, 300);
  down(c, 2, 250, 300, 1);
  const content = viewportToContent(c.view, { x: 200, y: 300 });
  move(c, 1, 100, 330);
  move(c, 2, 300, 330);
  near(zoomLevel(c.view), 2);
  const pivot = contentToViewport(c.view, content);
  near(pivot.x, 200);
  near(pivot.y, 330);
  up(c, 2, 300, 330);
  const before = { ...c.view };
  move(c, 1, 100, 330, 25);
  assert.deepEqual(c.view, before);
  move(c, 1, 110, 340, 30);
  near(c.view.tx, before.tx + 10);
  near(c.view.ty, before.ty + 10);
  up(c, 1, 110, 340, 40);
  assert.equal(c.pointers.size, 0);
});

test("mouse reverse marquee, tiny drag, Escape cancellation, Ctrl+0 and Home", () => {
  const c = make();
  c.setMode("box");
  down(c, 1, 300, 450, 0, { pointerType: "mouse" });
  up(c, 1, 100, 150);
  near(zoomLevel(c.view), 2);
  down(c, 2, 100, 100, 30, { pointerType: "mouse" });
  move(c, 2, 200, 200, 40);
  const before = { ...c.view };
  c.key({ key: "Escape", t: 45 });
  assert.deepEqual(c.view, before);
  assert.equal(c.selection, null);
  c.key({ key: "0", ctrlKey: true, t: 50 });
  near(zoomLevel(c.view), 1);
  c.zoom(3, 60);
  c.key({ key: "Home", t: 70 });
  near(zoomLevel(c.view), 1);
});

test("double tap toggles zoom; dragging/pinching/long press cannot create a double tap", () => {
  const c = make();
  down(c, 1, 200, 300, 0);
  up(c, 1, 200, 300, 30);
  down(c, 1, 202, 301, 170);
  up(c, 1, 202, 301, 200);
  near(zoomLevel(c.view), 2.5);
  down(c, 1, 200, 300, 500);
  up(c, 1, 200, 300, 530);
  down(c, 1, 200, 300, 650);
  up(c, 1, 200, 300, 680);
  near(zoomLevel(c.view), 1);
  down(c, 1, 200, 300, 900);
  move(c, 1, 210, 300, 950);
  up(c, 1, 200, 300, 1000);
  down(c, 1, 200, 300, 1100);
  up(c, 1, 200, 300, 1130);
  near(zoomLevel(c.view), 1);
  c.cancel(1200, "blur");
  down(c, 1, 200, 300, 1300);
  up(c, 1, 200, 300, 1800);
  down(c, 1, 200, 300, 1900);
  up(c, 1, 200, 300, 1930);
  near(zoomLevel(c.view), 1);
});

test("third finger, lost capture, cancellation and resize leave no stuck gestures", () => {
  const c = make();
  down(c, 1, 100, 300);
  down(c, 2, 300, 300, 1);
  assert.equal(down(c, 3, 200, 400, 2), false);
  c.cancel(10, "pointer-cancel");
  assert.equal(c.pointers.size, 0);
  assert.equal(move(c, 1, 100, 100), false);
  down(c, 4, 100, 100, 20);
  c.resize(600, 400, 30);
  assert.equal(c.pointers.size, 0);
  assert.equal(c.selection, null);
  near(zoomLevel(c.view), 1);
});

test("events have stable unique IDs and preserve original input timestamps", () => {
  const events = [],
    c = make((e) => events.push(e));
  down(c, 7, 100, 200, 12);
  move(c, 7, 150, 220, 18);
  up(c, 7, 150, 220, 24);
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  assert.equal(events[0].pointerId, 7);
  assert.equal(events[0].t, 12);
});

// Independent numeric fixtures: rotations are clockwise in the y-down viewport.
import {
  rotateAt,
  transformAt,
  panBy,
  resetView,
  resizeView,
  viewMatrix,
  InteractionController,
} from "../dist/index.js";
const free = () =>
  createView({
    width: 800,
    height: 600,
    contentWidth: 400,
    contentHeight: 200,
    panBounds: "none",
  });
test("quarter-turn, free movement at fit, zoom pivot, resize and restore have analytic coordinates", () => {
  assert.equal(InteractionController, ZoomController);
  const base = free(); // scale 2, translation (0,100)
  const v = rotateAt(base, Math.PI / 2);
  const p = contentToViewport(v, { x: 300, y: 100 });
  near(p.x, 400);
  near(p.y, 500);
  const moved = panBy(v, -30, 50);
  const q = viewportToContent(moved, { x: 370, y: 550 });
  near(q.x, 300);
  near(q.y, 100);
  const anchor = { x: 100, y: 200 },
    destination = { x: 140, y: 260 };
  const old = viewportToContent(moved, anchor);
  const transformed = transformAt(moved, 1.7, -0.2, anchor, destination);
  const pivot = contentToViewport(transformed, old);
  near(pivot.x, destination.x);
  near(pivot.y, destination.y);
  const resized = resizeView(transformed, 1200, 800);
  const oldCenter = viewportToContent(transformed, { x: 400, y: 300 });
  const newCenter = viewportToContent(resized, { x: 600, y: 400 });
  near(oldCenter.x, newCenter.x);
  near(oldCenter.y, newCenter.y);
  assert.deepEqual(
    resetView(resized),
    createView({
      width: 1200,
      height: 800,
      contentWidth: 400,
      contentHeight: 200,
      panBounds: "none",
    }),
  );
});

test("all four rotated corners determine bounds and legacy views still use zero rotation", () => {
  const v = rotateAt({ ...free(), panBounds: "content" }, Math.PI / 2);
  const corners = [
    { x: 0, y: 0 },
    { x: 400, y: 0 },
    { x: 0, y: 200 },
    { x: 400, y: 200 },
  ].map((p) => contentToViewport(v, p));
  near(Math.min(...corners.map((p) => p.x)), 200);
  near(Math.max(...corners.map((p) => p.x)), 600);
  const { rotation, panBounds, ...legacy } = free();
  assert.deepEqual(viewMatrix(legacy), [2, 0, 0, 2, 0, 100]);
  assert.deepEqual(panBy(legacy, 10, 10), legacy);
});

test("pinch, twist, midpoint translation and lift-to-pan keep the same intrinsic anchor", () => {
  const c = new ZoomController(free());
  down(c, 1, 350, 300, 0);
  down(c, 2, 450, 300, 1);
  // Initial midpoint content (200,100). Final midpoint (420,330), span 200, angle pi/2.
  move(c, 1, 420, 230, 2);
  move(c, 2, 420, 430, 3);
  near(c.view.rotation, Math.PI / 2);
  near(zoomLevel(c.view), 2);
  const pivot = contentToViewport(c.view, { x: 200, y: 100 });
  near(pivot.x, 420);
  near(pivot.y, 330);
  up(c, 2, 420, 430, 4);
  const previous = { ...c.view };
  move(c, 1, 430, 240, 5);
  near(c.view.tx, previous.tx + 10);
  near(c.view.ty, previous.ty + 10);
  near(c.view.rotation, previous.rotation);
  up(c, 1, 430, 240, 6);
  assert.equal(c.lastTap, null);
});

test("rotate drag unwraps at pi and coincident fingers resume without an unstable jump", () => {
  const c = new ZoomController(free());
  c.setMode("rotate");
  const pointAt = (a) => ({
    x: 400 + 100 * Math.cos(a),
    y: 300 + 100 * Math.sin(a),
  });
  c.pointerDown({ id: 1, ...pointAt((179 * Math.PI) / 180), t: 0 });
  c.pointerMove({ id: 1, ...pointAt((-175 * Math.PI) / 180), t: 1 });
  near(c.view.rotation, (6 * Math.PI) / 180);
  c.cancel(2);
  c.setMode("pan");
  down(c, 1, 400, 300, 3);
  down(c, 2, 400, 300, 4);
  const before = { ...c.view };
  move(c, 2, 440, 300, 5);
  assert.deepEqual(c.view, before);
  move(c, 2, 450, 300, 6);
  near(zoomLevel(c.view), 1.25);
  move(c, 2, 400, 300, 7);
  const collapsed = { ...c.view };
  move(c, 2, 400, 350, 8);
  assert.deepEqual(c.view, collapsed);
});

test("API and keyboard changes interrupt gestures, validate atomically and can disable rotation", () => {
  const events = [],
    c = new ZoomController(free(), { onInput: (e) => events.push(e) });
  c.move(30, 40, 1);
  near(c.view.tx, 30);
  near(c.view.ty, 140);
  c.key({ key: "ArrowLeft", t: 2 });
  near(c.view.tx, -18);
  down(c, 1, 200, 200, 3);
  c.rotate(Math.PI / 4, 4);
  assert.equal(c.pointers.size, 0);
  const before = { view: { ...c.view }, count: events.length };
  assert.throws(() => c.rotate(Infinity, 5), /finite/);
  assert.throws(() => c.setPanBounds("invalid", 5), /panBounds/);
  assert.deepEqual(c.view, before.view);
  assert.equal(events.length, before.count);
  c.key({ key: "Home", t: 6 });
  assert.deepEqual(c.view, free());
  const fixed = new ZoomController(free(), { enableRotation: false });
  down(fixed, 1, 350, 300, 0);
  down(fixed, 2, 450, 300, 1);
  move(fixed, 1, 400, 250, 2);
  move(fixed, 2, 400, 350, 3);
  near(fixed.view.rotation, 0);
  assert.equal(fixed.key({ key: "]", t: 4 }), false);
  assert.throws(() => fixed.setMode("rotate"), /disabled/);
});

test("another view command breaks a touch double-tap sequence", () => {
  for (const interrupt of [
    (c) => c.zoom(1.25, 20),
    (c) => c.wheel({ x: 200, y: 300, deltaY: -80, t: 20 }),
    (c) => c.key({ key: "ArrowLeft", t: 20 }),
  ]) {
    const c = make();
    down(c, 1, 200, 300, 0);
    up(c, 1, 200, 300, 10);
    interrupt(c);
    const before = { ...c.view };
    down(c, 1, 200, 300, 40);
    up(c, 1, 200, 300, 50);
    assert.deepEqual(c.view, before);
  }
});
