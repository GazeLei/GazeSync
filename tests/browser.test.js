import test from "node:test";
import assert from "node:assert/strict";
import {
  createView,
  viewportToContent,
  ZoomController,
} from "../dist/index.js";
import { attachBrowserControls } from "../dist/browser.js";

class SurfaceElement extends EventTarget {
  constructor() {
    super();
    this.style = { touchAction: "pan-y" };
    this.attributes = new Map();
    this.captured = new Set();
  }
  getAttribute(k) {
    return this.attributes.get(k) ?? null;
  }
  hasAttribute(k) {
    return this.attributes.has(k);
  }
  setAttribute(k, v) {
    this.attributes.set(k, String(v));
  }
  removeAttribute(k) {
    this.attributes.delete(k);
  }
  set tabIndex(value) {
    this.setAttribute("tabindex", value);
  }
  focus() {
    this.focused = true;
  }
  getBoundingClientRect() {
    return { left: 40, top: 60, width: 200, height: 300 };
  }
  setPointerCapture(id) {
    this.captured.add(id);
  }
  hasPointerCapture(id) {
    return this.captured.has(id);
  }
  releasePointerCapture(id) {
    this.captured.delete(id);
  }
}

test("browser adapter respects owner-document lifecycle, embedded inputs and unrelated contacts", () => {
  const element = new SurfaceElement(),
    ownerDocument = new EventTarget(),
    ownerWindow = new EventTarget();
  ownerDocument.defaultView = ownerWindow;
  element.ownerDocument = ownerDocument;
  const controller = new ZoomController(
    createView({
      width: 400,
      height: 600,
      contentWidth: 800,
      contentHeight: 1200,
    }),
  );
  controller.zoom(2, 0);
  const adapter = attachBrowserControls(element, controller);
  const input = { matches: () => true };
  const keyboard = dispatch(element, "keydown", {
    key: "Home",
    composedPath: () => [input, element],
  });
  assert.equal(keyboard.defaultPrevented, false);
  assert.equal(controller.view.scale, 1);
  dispatch(element, "pointerdown", {
    pointerId: 1,
    clientX: 140,
    clientY: 210,
    pointerType: "touch",
    button: 0,
  });
  dispatch(element, "pointercancel", { pointerId: 99 });
  assert.equal(controller.pointers.size, 1);
  ownerWindow.dispatchEvent(new Event("blur"));
  assert.equal(controller.pointers.size, 0);
  adapter.dispose();
});
const dispatch = (target, type, values = {}) => {
  const event = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(event, key, { value });
  target.dispatchEvent(event);
  return event;
};

test("browser adapter scales client coordinates, owns capture, cancels on lifecycle and removes listeners", () => {
  const oldWindow = globalThis.window,
    oldDocument = globalThis.document;
  globalThis.window = new EventTarget();
  globalThis.document = new EventTarget();
  try {
    const element = new SurfaceElement(),
      events = [];
    const controller = new ZoomController(
      createView({
        width: 400,
        height: 600,
        contentWidth: 800,
        contentHeight: 1200,
      }),
      { onInput: (e) => events.push(e) },
    );
    const life = [];
    const adapter = attachBrowserControls(element, controller, {
      onLifecycle: (e) => life.push(e),
    });
    const pivot = viewportToContent(controller.view, { x: 200, y: 300 });
    const wheel = dispatch(element, "wheel", {
      clientX: 140,
      clientY: 210,
      deltaY: -100,
      deltaMode: 0,
    });
    assert.equal(wheel.defaultPrevented, true);
    assert.deepEqual(
      viewportToContent(controller.view, { x: 200, y: 300 }),
      pivot,
    );
    dispatch(element, "pointerdown", {
      pointerId: 1,
      clientX: 140,
      clientY: 210,
      pointerType: "touch",
      button: 0,
    });
    assert.equal(element.hasPointerCapture(1), true);
    assert.equal(element.focused, true);
    dispatch(element, "pointermove", {
      pointerId: 1,
      clientX: 150,
      clientY: 220,
    });
    dispatch(element, "pointercancel", { pointerId: 1 });
    assert.equal(controller.pointers.size, 0);
    assert.equal(element.captured.size, 0);
    dispatch(element, "pointerdown", {
      pointerId: 2,
      clientX: 140,
      clientY: 210,
      pointerType: "touch",
      button: 0,
    });
    dispatch(element, "lostpointercapture", { pointerId: 2 });
    assert.equal(controller.pointers.size, 0);
    dispatch(window, "blur");
    document.hidden = true;
    dispatch(document, "visibilitychange");
    assert.ok(life.includes("blur"));
    assert.ok(life.includes("background"));
    const prior = element.style.touchAction;
    assert.equal(prior, "none");
    adapter.dispose();
    const count = events.length;
    adapter.dispose();
    assert.equal(element.style.touchAction, "pan-y");
    assert.equal(element.hasAttribute("tabindex"), false);
    dispatch(element, "wheel", {
      clientX: 140,
      clientY: 210,
      deltaY: -100,
      deltaMode: 0,
    });
    assert.equal(events.length, count);
  } finally {
    globalThis.window = oldWindow;
    globalThis.document = oldDocument;
  }
});

import { createGazeSurface } from "../dist/browser.js";
test("DOM content helper renders and records identical transforms, handles resize/hidden state, and restores ownership", () => {
  const viewport = new SurfaceElement(),
    content = {
      style: { transform: "original", position: "relative" },
      parentElement: viewport,
    };
  const doc = new EventTarget(),
    win = new EventTarget(),
    callbacks = new Map();
  let time = 0,
    id = 0;
  Object.assign(win, {
    performance: { now: () => time },
    getComputedStyle: () => ({
      position: "static",
      paddingLeft: "0px",
      paddingRight: "0px",
      paddingTop: "0px",
      paddingBottom: "0px",
    }),
    requestAnimationFrame: (cb) => {
      callbacks.set(++id, cb);
      return id;
    },
    cancelAnimationFrame: (key) => callbacks.delete(key),
  });
  Object.assign(doc, { defaultView: win, hidden: false });
  Object.assign(viewport, {
    ownerDocument: doc,
    clientWidth: 400,
    clientHeight: 600,
  });
  const app = createGazeSurface(viewport, content, {
    contentWidth: 800,
    contentHeight: 1200,
    contentId: "text",
  });
  assert.equal(content.style.transform, "matrix(0.5,0,0,0.5,0,0)");
  const step = (t) => {
    time = t;
    const [key, cb] = callbacks.entries().next().value;
    callbacks.delete(key);
    cb();
  };
  app.controller.rotate(Math.PI / 2, 2);
  app.controller.move(20, 30, 3);
  step(16);
  const frame = app.session.frames.at(-1);
  assert.equal(content.style.transform, `matrix(${frame.matrix.join(",")})`);
  assert.equal(frame.view.rotation, Math.PI / 2);
  assert.ok(frame.causeIds.length >= 2);
  app.pushGaze(
    {
      id: "g1",
      sourceId: "tracker",
      eye: "left",
      clockId: "session",
      clockEpoch: "0",
      timeMs: 20,
      ...app.captureContext,
      confidence: 1,
      valid: true,
      type: "pog2d",
      space: "viewport",
      point: { x: 220, y: 330 },
    },
    50,
  );
  step(100);
  const row = app.session.aligned[0];
  assert.equal(row.usable, true);
  assert.ok(
    Math.abs(row.contentPoint.x - 400) < 1e-8 &&
      Math.abs(row.contentPoint.y - 600) < 1e-8,
  );
  viewport.clientWidth = 600;
  step(120);
  assert.equal(app.captureContext.surfaceEpoch, "2");
  time = 130;
  doc.hidden = true;
  doc.dispatchEvent(new Event("visibilitychange"));
  assert.equal(app.session.frames.at(-1).surface.active, false);
  assert.equal(app.session.frames.at(-1).t, 130);
  doc.hidden = false;
  doc.dispatchEvent(new Event("visibilitychange"));
  assert.equal(app.session.frames.at(-1).surface.active, false); // No foreground presentation before rendering.
  step(150);
  assert.equal(app.session.frames.at(-1).surface.active, true);
  app.dispose();
  assert.equal(callbacks.size, 0);
  assert.equal(content.style.transform, "original");
  assert.equal(viewport.style.touchAction, "pan-y");
  assert.throws(() => app.pushGaze({}), /disposed/);
  app.dispose();
});

test("browser coordinates exclude borders, including when the frame is CSS-scaled", () => {
  const viewport = new SurfaceElement(),
    doc = new EventTarget(),
    win = new EventTarget();
  Object.assign(doc, { defaultView: win });
  Object.assign(viewport, {
    ownerDocument: doc,
    clientWidth: 400,
    clientHeight: 600,
    offsetWidth: 420,
    offsetHeight: 620,
    clientLeft: 10,
    clientTop: 10,
    getBoundingClientRect: () => ({
      left: 40,
      top: 60,
      width: 210,
      height: 310,
    }),
  });
  const controller = new ZoomController(
    createView({
      width: 400,
      height: 600,
      contentWidth: 800,
      contentHeight: 1200,
      panBounds: "none",
    }),
  );
  const adapter = attachBrowserControls(viewport, controller);
  dispatch(viewport, "pointerdown", {
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    clientX: 145,
    clientY: 215,
  });
  assert.equal(controller.pointers.get(1).x, 200);
  assert.equal(controller.pointers.get(1).y, 300);
  adapter.dispose();
});

test("DOM helper tolerates repeated clock ticks, rejects competing ownership, and cleans failed setup", () => {
  const doc = new EventTarget(),
    win = new EventTarget(),
    callbacks = new Map();
  let id = 0;
  Object.assign(win, {
    performance: { now: () => 1000 },
    getComputedStyle: () => ({
      position: "static",
      paddingLeft: "0px",
      paddingRight: "0px",
      paddingTop: "0px",
      paddingBottom: "0px",
    }),
    requestAnimationFrame: (cb) => {
      callbacks.set(++id, cb);
      return id;
    },
    cancelAnimationFrame: (key) => callbacks.delete(key),
  });
  Object.assign(doc, { defaultView: win, hidden: false });
  const makeSurface = () => {
    const viewport = new SurfaceElement();
    Object.assign(viewport, {
      ownerDocument: doc,
      clientWidth: 400,
      clientHeight: 600,
    });
    return [
      viewport,
      { parentElement: viewport, style: { transform: "original" } },
    ];
  };
  const [viewport, content] = makeSurface();
  const app = createGazeSurface(viewport, content, {
    contentWidth: 400,
    contentHeight: 600,
  });
  const [key, cb] = callbacks.entries().next().value;
  callbacks.delete(key);
  cb(); // performance.now can repeat within its resolution; this must not finalize away the current tick.
  assert.equal(app.session.frames.length, 2);
  assert.throws(
    () =>
      createGazeSurface(viewport, content, {
        contentWidth: 400,
        contentHeight: 600,
      }),
    /already owned/,
  );
  const sibling = { parentElement: viewport, style: {} };
  assert.throws(
    () =>
      createGazeSurface(viewport, sibling, {
        contentWidth: 400,
        contentHeight: 600,
      }),
    /already owned/,
  );
  const [other, otherContent] = makeSurface();
  assert.throws(
    () =>
      createGazeSurface(other, otherContent, {
        contentWidth: 400,
        contentHeight: 600,
        session: app.session,
      }),
    /already owned/,
  );
  assert.equal(other.style.touchAction, "pan-y");
  app.dispose();
  assert.equal(callbacks.size, 0);
  assert.equal(content.style.transform, "original");
  assert.throws(
    () =>
      createGazeSurface(other, otherContent, {
        contentWidth: 400,
        contentHeight: 600,
        getGeometry: () => ({ plane: {} }),
      }),
    /Plane/,
  );
  assert.equal(other.style.touchAction, "pan-y");
  assert.equal(otherContent.style.transform, "original");
  assert.equal(callbacks.size, 0);
  const replacement = createGazeSurface(viewport, content, {
    contentWidth: 400,
    contentHeight: 600,
  });
  replacement.dispose();
  assert.equal(callbacks.size, 0);
});
