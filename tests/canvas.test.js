import test from "node:test";
import assert from "node:assert/strict";
import { createGazeCanvas } from "../examples/canvas-integration.js";

test("canvas example records backgrounding without rAF and does not reallocate an unchanged backing store", () => {
  let time = 0,
    nextId = 0,
    allocations = 0;
  const frames = new Map(),
    aligned = [];
  const win = new EventTarget(),
    doc = new EventTarget(),
    canvas = new EventTarget();
  Object.assign(win, {
    performance: { now: () => time },
    devicePixelRatio: 2,
    requestAnimationFrame: (cb) => {
      frames.set(++nextId, cb);
      return nextId;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  });
  Object.assign(doc, { defaultView: win, hidden: false });
  const attrs = new Map();
  Object.assign(canvas, {
    ownerDocument: doc,
    clientWidth: 400,
    clientHeight: 600,
    style: { touchAction: "" },
    getAttribute: (k) => attrs.get(k) ?? null,
    setAttribute: (k, v) => attrs.set(k, v),
    hasAttribute: (k) => attrs.has(k),
    removeAttribute: (k) => attrs.delete(k),
    hasPointerCapture: () => false,
    getContext: () => ({ setTransform() {} }),
  });
  for (const key of ["width", "height"]) {
    let value = 0;
    Object.defineProperty(canvas, key, {
      get: () => value,
      set: (n) => {
        value = n;
        allocations++;
      },
    });
  }
  const runFrame = (t) => {
    time = t;
    const [id, cb] = frames.entries().next().value;
    frames.delete(id);
    cb(t);
  };
  const app = createGazeCanvas(canvas, {
    contentId: "image",
    contentWidth: 800,
    contentHeight: 1200,
    draw() {},
    onAligned: (a) => aligned.push(...a),
  });
  runFrame(16);
  runFrame(32);
  assert.equal(allocations, 2);
  time = 40;
  doc.hidden = true;
  doc.dispatchEvent(new Event("visibilitychange"));
  assert.equal(app.session.frames.at(-1).surface.active, false);
  assert.equal(app.session.frames.at(-1).t, 40);
  const sample = (id, t) => ({
    id,
    sourceId: "tracker",
    eye: "unknown",
    clockId: "session",
    clockEpoch: "0",
    timeMs: t,
    ...app.captureContext,
    valid: true,
    confidence: 1,
    type: "pog2d",
    space: "viewport",
    point: { x: 200, y: 300 },
  });
  time = 80;
  app.pushGaze(sample("hidden-1", 50));
  time = 180;
  app.pushGaze(sample("hidden-2", 100));
  assert.equal(aligned.length, 2);
  assert.ok(
    aligned.every((a) => a.flags.includes("surface-inactive") && !a.usable),
  );
  app.dispose();
  assert.equal(frames.size, 0);
  assert.throws(() => app.pushGaze(sample("disposed", 180)), /disposed/);
});
