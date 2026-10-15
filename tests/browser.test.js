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
