import type {
  ControllerOptions,
  Gesture,
  InputEventRecord,
  Point,
  PointerInput,
  PointerState,
  View,
} from "./types.js";
import {
  angleDelta,
  rotateAt,
  transformAt,
  clamp,
  constrain,
  createView,
  finite,
  panBy,
  point,
  positive,
  resetView,
  resizeView,
  zoomAt,
  zoomLevel,
  zoomToBox,
} from "./geometry.js";

const middle = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
const angle = (a: Point, b: Point) => Math.atan2(b.y - a.y, b.x - a.x);
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Platform-neutral gesture state machine. No gaze is used as a gesture or hidden control. */
export class ZoomController {
  view: View;
  onInput: (event: InputEventRecord) => void;
  dragThreshold: number;
  doubleTapMs: number;
  doubleTapDistance: number;
  mode: "pan" | "box" | "rotate" = "pan";
  enableRotation: boolean;
  pointers = new Map<number | string, PointerState>();
  selection: { start: Point; end: Point } | null = null;
  gesture: Gesture | null = null;
  lastTap: (Point & { t: number }) | null = null;
  sequence = 0;
  inputPrefix: string;
  constructor(
    view: View,
    {
      onInput = () => {},
      dragThreshold = 5,
      doubleTapMs = 320,
      doubleTapDistance = 24,
      inputPrefix = "input",
      enableRotation = true,
    }: ControllerOptions = {},
  ) {
    if (typeof enableRotation !== "boolean")
      throw new TypeError("enableRotation must be boolean");
    this.enableRotation = enableRotation;
    positive(dragThreshold, "dragThreshold");
    positive(doubleTapMs, "doubleTapMs");
    positive(doubleTapDistance, "doubleTapDistance");
    if (typeof inputPrefix !== "string" || !inputPrefix)
      throw new TypeError("inputPrefix must be a nonempty string");
    createView(view);
    positive(view.scale, "view.scale");
    finite(view.tx, "view.tx");
    finite(view.ty, "view.ty");
    this.view = constrain({ ...view });
    this.onInput = onInput;
    this.dragThreshold = dragThreshold;
    this.doubleTapMs = doubleTapMs;
    this.doubleTapDistance = doubleTapDistance;
    this.mode = "pan";
    this.selection = null;
    this.gesture = null;
    this.lastTap = null;
    this.sequence = 0;
    this.inputPrefix = inputPrefix;
  }

  emit(kind: string, t: number, details: Record<string, unknown> = {}) {
    finite(t, "input time");
    const event = {
      ...details,
      id: `${this.inputPrefix}-${++this.sequence}`,
      t,
      kind,
    };
    this.onInput(structuredClone(event));
    return event;
  }

  setMode(mode: "pan" | "box" | "rotate") {
    if (!["pan", "box", "rotate"].includes(mode))
      throw new TypeError("Mode must be pan, box or rotate");
    if (mode === "rotate" && !this.enableRotation)
      throw new Error("Rotation is disabled");
    this.mode = mode;
    this.lastTap = null;
    this.rebase();
  }

  /** Switch containment without losing the recording of the change. */
  setPanBounds(panBounds: "content" | "none", t: number) {
    finite(t, "input time");
    const next = constrain({ ...this.view, panBounds });
    this.cancel(t, "bounds-change");
    this.view = next;
    this.emit("pan-bounds", t, { panBounds });
  }

  /** Move content in viewport logical pixels, independent of zoom and rotation. */
  move(dx: number, dy: number, t: number) {
    finite(t, "input time");
    const next = panBy(this.view, dx, dy);
    this.cancel(t, "move-interrupt");
    this.view = next;
    this.emit("move", t, { dx, dy });
  }

  /** Positive radians rotate clockwise around a viewport anchor. */
  rotate(
    radians: number,
    t: number,
    anchor = { x: this.view.width / 2, y: this.view.height / 2 },
  ) {
    finite(t, "input time");
    if (!this.enableRotation) throw new Error("Rotation is disabled");
    const next = rotateAt(this.view, radians, anchor);
    this.cancel(t, "rotate-interrupt");
    this.view = next;
    this.emit("rotate", t, { radians, anchor });
  }

  wheel({
    x,
    y,
    deltaY,
    deltaMode = 0,
    t,
  }: Point & { deltaY: number; deltaMode?: number; t: number }) {
    point({ x, y });
    finite(deltaY, "deltaY");
    finite(t, "input time");
    if (![0, 1, 2].includes(deltaMode))
      throw new RangeError("Unknown wheel deltaMode");
    this.lastTap = null;
    if (this.pointers.size) this.cancel(t, "wheel-interrupt");
    const pixels =
      deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? this.view.height : 1);
    this.view = zoomAt(this.view, Math.exp(clamp(-pixels * 0.002, -4, 4)), {
      x,
      y,
    });
    this.emit("wheel", t, { x, y, deltaY, deltaMode });
  }

  zoom(
    factor: number,
    t: number,
    anchor = { x: this.view.width / 2, y: this.view.height / 2 },
  ) {
    finite(t, "input time");
    const next = zoomAt(this.view, factor, anchor);
    this.lastTap = null;
    if (this.pointers.size) this.cancel(t, "zoom-interrupt");
    this.view = next;
    this.emit("zoom", t, { factor, anchor });
  }

  reset(t: number) {
    this.cancel(t, "reset");
    this.view = resetView(this.view);
    this.emit("reset", t);
  }

  resize(width: number, height: number, t: number) {
    const next = resizeView(this.view, width, height);
    this.cancel(t, "layout-change");
    this.view = next;
    this.emit("resize", t, { width, height });
  }

  rebase() {
    const pointers = [...this.pointers.values()];
    this.selection = null;
    if (pointers.length === 2) {
      pointers.forEach((p) => {
        p.pinched = true;
      });
      this.gesture = {
        type: "pinch",
        base: { ...this.view },
        start: middle(pointers[0], pointers[1]),
        distance: Math.max(distance(pointers[0], pointers[1]), 1),
        angle: angle(pointers[0], pointers[1]),
        rotation: 0,
        suspended: distance(pointers[0], pointers[1]) < this.dragThreshold,
      };
    } else if (pointers.length === 1) {
      const p = pointers[0];
      if (
        this.mode === "rotate" &&
        p.type !== "touch" &&
        p.button !== 1 &&
        !p.shiftKey
      ) {
        const anchor = { x: this.view.width / 2, y: this.view.height / 2 };
        this.gesture = {
          type: "rotate",
          base: { ...this.view },
          start: { x: p.x, y: p.y },
          anchor,
          angle: angle(anchor, p),
          rotation: 0,
          suspended: distance(anchor, p) < this.dragThreshold,
        };
        return;
      }
      this.gesture = {
        type:
          p.type === "mouse" &&
          (this.mode === "box" || p.shiftKey) &&
          p.button !== 1
            ? "box"
            : "pan",
        base: { ...this.view },
        start: { x: p.x, y: p.y },
      };
    } else this.gesture = null;
  }

  pointerDown({
    id,
    x,
    y,
    t,
    pointerType = "mouse",
    shiftKey = false,
    button = 0,
  }: PointerInput) {
    point({ x, y });
    finite(t, "input time");
    if (
      this.pointers.has(id) ||
      this.pointers.size >= 2 ||
      (pointerType === "mouse" && ![0, 1].includes(button))
    )
      return false;
    if (id === undefined) throw new TypeError("Pointer id is required");
    this.pointers.set(id, {
      id,
      x,
      y,
      type: pointerType,
      shiftKey,
      button,
      down: { x, y },
      downTime: t,
      moved: false,
      pinched: false,
    });
    this.rebase();
    this.emit("pointer", t, {
      phase: "down",
      pointerId: id,
      x,
      y,
      pointerType,
    });
    return true;
  }

  pointerMove({ id, x, y, t }: PointerInput) {
    point({ x, y });
    finite(t, "input time");
    const p = this.pointers.get(id);
    if (!p) return false;
    p.x = x;
    p.y = y;
    if (distance(p.down, p) >= this.dragThreshold) p.moved = true;
    const g = this.gesture!;
    const pointers = [...this.pointers.values()];
    if (g.type === "pinch") {
      const span = distance(pointers[0], pointers[1]);
      if (span < this.dragThreshold) g.suspended = true;
      else if (g.suspended)
        this.rebase(); // Coincident fingers have no meaningful angle.
      else {
        const nextAngle = angle(pointers[0], pointers[1]);
        g.rotation += angleDelta(nextAngle - g.angle);
        g.angle = nextAngle;
        this.view = transformAt(
          g.base,
          span / g.distance,
          this.enableRotation ? g.rotation : 0,
          g.start,
          middle(pointers[0], pointers[1]),
        );
      }
    } else if (g.type === "rotate") {
      if (distance(g.anchor, p) < this.dragThreshold) g.suspended = true;
      else if (g.suspended) this.rebase();
      else if (p.moved) {
        const nextAngle = angle(g.anchor, p);
        g.rotation += angleDelta(nextAngle - g.angle);
        g.angle = nextAngle;
        this.view = rotateAt(g.base, g.rotation, g.anchor);
      }
    } else if (p.moved || p.pinched) {
      if (g.type === "box")
        this.selection = { start: { ...g.start }, end: { x, y } };
      else this.view = panBy(g.base, x - g.start.x, y - g.start.y);
    }
    this.emit("pointer", t, {
      phase: "move",
      pointerId: id,
      x,
      y,
      gesture: g.type,
    });
    return true;
  }

  pointerUp({ id, x, y, t }: PointerInput) {
    if (!this.pointers.has(id)) return false;
    // A platform may deliver the final position only in pointerup.
    this.pointerMove({ id, x, y, t });
    const p = this.pointers.get(id)!;
    if (this.gesture!.type === "box" && this.selection) {
      this.view = zoomToBox(
        this.view,
        this.selection.start,
        this.selection.end,
      );
      this.emit("box-zoom", t, this.selection);
    }
    const tap =
      p.type === "touch" &&
      !p.moved &&
      !p.pinched &&
      t - p.downTime <= this.doubleTapMs;
    this.pointers.delete(id);
    this.rebase(); // Pinch -> one-finger pan starts from the current view, without a jump.
    if (tap) {
      if (
        this.lastTap &&
        t - this.lastTap.t >= 0 &&
        t - this.lastTap.t <= this.doubleTapMs &&
        distance(p, this.lastTap) <= this.doubleTapDistance
      ) {
        this.doubleTap({ x, y, t });
        this.lastTap = null;
      } else this.lastTap = { x, y, t };
    } else this.lastTap = null;
    this.emit("pointer", t, { phase: "up", pointerId: id, x, y });
    return true;
  }

  doubleTap({ x, y, t }: Point & { t: number }) {
    point({ x, y });
    finite(t, "input time");
    if (this.pointers.size) this.cancel(t, "double-tap-interrupt");
    this.view =
      zoomLevel(this.view) > 1.01
        ? resetView(this.view)
        : zoomAt(this.view, 2.5, { x, y });
    this.emit("double-tap", t, { x, y });
  }

  cancel(t: number, reason = "cancel") {
    finite(t, "input time");
    const active = this.pointers.size > 0;
    this.pointers.clear();
    this.gesture = null;
    this.selection = null;
    this.lastTap = null;
    if (active || reason !== "cancel") this.emit("cancel", t, { reason });
  }

  key({
    key,
    t,
    ctrlKey = false,
    metaKey = false,
  }: {
    key: string;
    t: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
  }) {
    finite(t, "input time");
    if ((key === "0" && (ctrlKey || metaKey)) || key === "Home") this.reset(t);
    else if (key === "Escape") {
      if (this.pointers.size) this.cancel(t, "escape");
      else this.reset(t);
    } else if (key === "+" || key === "=") this.zoom(1.25, t);
    else if (key === "-") this.zoom(0.8, t);
    else if (
      (key === "[" || key === "]") &&
      this.enableRotation &&
      !ctrlKey &&
      !metaKey
    )
      this.rotate(((key === "[" ? -1 : 1) * Math.PI) / 12, t);
    else if (
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)
    ) {
      this.lastTap = null;
      if (this.pointers.size) this.cancel(t, "key-interrupt");
      this.view = panBy(
        this.view,
        key === "ArrowLeft" ? -48 : key === "ArrowRight" ? 48 : 0,
        key === "ArrowUp" ? -48 : key === "ArrowDown" ? 48 : 0,
      );
      this.emit("key-pan", t, { key });
    } else return false;
    return true;
  }
}
