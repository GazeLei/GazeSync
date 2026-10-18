import { ZoomController } from "./controller.js";
import { createView, viewMatrix } from "./geometry.js";
import { GazeSession } from "./session.js";
import type {
  AlignedGaze,
  GazeSample,
  ViewOptions,
  View,
  Surface,
} from "./types.js";
export interface BrowserOptions {
  onChange?: () => void;
  onLifecycle?: (reason: string) => void;
}
/** Browser-only adapter. Importing the core does not require a DOM. */
export function attachBrowserControls(
  element: HTMLElement,
  controller: ZoomController,
  { onChange = () => {}, onLifecycle = () => {} }: BrowserOptions = {},
) {
  const document = element.ownerDocument ?? globalThis.document;
  const window = document.defaultView ?? globalThis.window;
  const now = () => (window.performance ?? globalThis.performance).now();
  const interactive = (event: Event) => {
    for (const target of event.composedPath?.() ?? [event.target]) {
      if (target === element) break;
      if (
        (target as Element)?.matches?.(
          'input,textarea,select,button,a[href],[contenteditable]:not([contenteditable="false"])',
        )
      )
        return true;
    }
    return false;
  };
  const disposers: (() => void)[] = [];
  const previous = {
    touchAction: element.style.touchAction,
    tabIndex: element.getAttribute("tabindex"),
  };
  element.style.touchAction = "none";
  if (!element.hasAttribute("tabindex")) element.tabIndex = 0;
  const listen = <T extends Event>(
    target: EventTarget,
    type: string,
    handler: (event: T) => void,
    options?: AddEventListenerOptions,
  ) => {
    target.addEventListener(type, handler as EventListener, options);
    disposers.push(() =>
      target.removeEventListener(type, handler as EventListener, options),
    );
  };
  const time = (e: Event) => {
    const current = now();
    return Number.isFinite(e.timeStamp) &&
      Math.abs(e.timeStamp - current) < 60000
      ? e.timeStamp
      : current;
  };
  const local = (e: MouseEvent) => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    // Border is outside the local viewport. Axis-aligned CSS scaling is supported.
    const sx = element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1;
    const sy =
      element.offsetHeight > 0 ? rect.height / element.offsetHeight : 1;
    const width = element.clientWidth > 0 ? element.clientWidth : rect.width;
    const height =
      element.clientHeight > 0 ? element.clientHeight : rect.height;
    return {
      x:
        ((e.clientX - rect.left - (element.clientLeft || 0) * sx) *
          controller.view.width) /
        (width * sx),
      y:
        ((e.clientY - rect.top - (element.clientTop || 0) * sy) *
          controller.view.height) /
        (height * sy),
    };
  };
  const captured = new Set<number>();
  const release = () => {
    for (const id of captured)
      if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
    captured.clear();
  };
  listen(
    element,
    "wheel",
    (e: WheelEvent) => {
      if (interactive(e)) return;
      const p = local(e);
      if (!p) return;
      e.preventDefault();
      controller.wheel({
        ...p,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        t: time(e),
      });
      if (!controller.pointers.size) release();
      onChange();
    },
    { passive: false },
  );
  listen(element, "pointerdown", (e: PointerEvent) => {
    if (interactive(e)) return;
    const p = local(e);
    if (!p) return;
    if (
      controller.pointerDown({
        ...p,
        id: e.pointerId,
        t: time(e),
        pointerType: e.pointerType as "mouse" | "touch" | "pen",
        shiftKey: e.shiftKey,
        button: e.button,
      })
    ) {
      e.preventDefault();
      element.focus({ preventScroll: true });
      element.setPointerCapture(e.pointerId);
      captured.add(e.pointerId);
      onChange();
    }
  });
  listen(element, "pointermove", (e: PointerEvent) => {
    const p = local(e);
    if (p && controller.pointerMove({ ...p, id: e.pointerId, t: time(e) }))
      onChange();
  });
  listen(element, "pointerup", (e: PointerEvent) => {
    const p = local(e);
    if (p && controller.pointerUp({ ...p, id: e.pointerId, t: time(e) }))
      onChange();
    captured.delete(e.pointerId);
    if (element.hasPointerCapture(e.pointerId))
      element.releasePointerCapture(e.pointerId);
  });
  const cancel = (reason: string) => {
    controller.cancel(now(), reason);
    release();
    onLifecycle(reason);
    onChange();
  };
  listen(element, "pointercancel", (e: PointerEvent) => {
    if (controller.pointers.has(e.pointerId)) cancel("pointer-cancel");
  });
  listen(element, "lostpointercapture", (e: PointerEvent) => {
    if (controller.pointers.has(e.pointerId)) cancel("capture-lost");
  });
  listen(element, "keydown", (e: KeyboardEvent) => {
    if (interactive(e) || e.altKey) return;
    if (
      controller.key({
        key: e.key,
        t: time(e),
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
      })
    ) {
      e.preventDefault();
      if (!controller.pointers.size) release();
      onChange();
    }
  });
  listen(window, "blur", () => cancel("blur"));
  listen(document, "visibilitychange", () => {
    if (document.hidden) cancel("background");
    else {
      onLifecycle("foreground");
      onChange();
    }
  });
  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      disposers.forEach((dispose) => dispose());
      controller.cancel(now(), "dispose");
      release();
      element.style.touchAction = previous.touchAction;
      if (previous.tabIndex === null) element.removeAttribute("tabindex");
      else element.setAttribute("tabindex", previous.tabIndex);
    },
  };
}

const ownedSessions = new WeakSet<GazeSession>();
const ownedViewports = new WeakSet<HTMLElement>();
const ownedContents = new WeakSet<HTMLElement | SVGElement>();

export interface GazeSurfaceOptions {
  contentWidth: number;
  contentHeight: number;
  contentId?: string;
  surfaceId?: string;
  panBounds?: ViewOptions["panBounds"];
  minZoom?: number;
  maxZoom?: number;
  enableRotation?: boolean;
  session?: GazeSession;
  onAligned?: (rows: AlignedGaze[]) => void;
  getGeometry?: (
    view: View,
    t: number,
  ) => Omit<Surface, "id" | "epoch" | "active">;
}

/**
 * One fixed-size content layer (image, text, SVG, video, or a group) in a clipped DOM viewport.
 * Owns rendering, resize/lifecycle snapshots and input; never fabricates eye measurements.
 * The viewport must have zero padding and no rotated/skewed CSS ancestors. Border is supported.
 */
export function createGazeSurface(
  viewport: HTMLElement,
  content: HTMLElement | SVGElement,
  options: GazeSurfaceOptions,
) {
  if (content.parentElement !== viewport)
    throw new Error("content must be a direct child of viewport");
  if (ownedViewports.has(viewport) || ownedContents.has(content))
    throw new Error(
      "Viewport or content is already owned by a GazeSync DOM surface",
    );
  const doc = viewport.ownerDocument,
    win = doc.defaultView!;
  const style = win.getComputedStyle(viewport);
  if (
    [
      style.paddingLeft,
      style.paddingRight,
      style.paddingTop,
      style.paddingBottom,
    ].some((v) => parseFloat(v) !== 0)
  )
    throw new Error(
      "GazeSync viewport needs zero padding; put padding on an outer wrapper",
    );
  const width = viewport.clientWidth,
    height = viewport.clientHeight;
  const session = options.session ?? new GazeSession();
  if (ownedSessions.has(session))
    throw new Error(
      "Session is already owned by a GazeSync DOM surface; coordinate multiple surfaces through the core API",
    );
  const contentId = options.contentId ?? "content",
    surfaceId = options.surfaceId ?? "surface";
  if (!contentId || !surfaceId)
    throw new Error("contentId and surfaceId must be nonempty");
  const initial = createView({
    width,
    height,
    contentWidth: options.contentWidth,
    contentHeight: options.contentHeight,
    panBounds: options.panBounds ?? "none",
    minZoom: options.minZoom,
    maxZoom: options.maxZoom,
  });
  let epoch = 1,
    active = !doc.hidden,
    disposed = false,
    animation = 0;
  let causes: string[] = [];
  const now = () => win.performance.now();
  const controller = new ZoomController(initial, {
    enableRotation: options.enableRotation,
    inputPrefix: `${surfaceId}:input`,
    onInput: (event) => {
      session.input(event);
      causes.push(event.id);
    },
  });
  const previousViewport = {
    position: viewport.style.position,
    overflow: viewport.style.overflow,
  };
  const previousContent = {
    position: content.style.position,
    left: content.style.left,
    top: content.style.top,
    width: content.style.width,
    height: content.style.height,
    transform: content.style.transform,
    transition: content.style.transition,
    animation: content.style.animation,
    transformOrigin: content.style.transformOrigin,
    margin: content.style.margin,
    boxSizing: content.style.boxSizing,
  };
  ownedSessions.add(session);
  ownedViewports.add(viewport);
  ownedContents.add(content);
  if (style.position === "static") viewport.style.position = "relative";
  viewport.style.overflow = "hidden";
  Object.assign(content.style, {
    position: "absolute",
    left: "0px",
    top: "0px",
    margin: "0px",
    boxSizing: "border-box",
    transition: "none",
    animation: "none",
    width: `${options.contentWidth}px`,
    height: `${options.contentHeight}px`,
    transformOrigin: "0px 0px",
  });
  const aligned = (rows: AlignedGaze[]) => {
    if (rows.length) options.onAligned?.(rows);
  };
  const beforeTick = (t: number) =>
    t - Math.max(1, Math.abs(t)) * Number.EPSILON;
  let presentedView = { ...controller.view };
  function commit(t: number) {
    session.present({
      t,
      view: presentedView,
      contentId,
      surface: {
        ...options.getGeometry?.(presentedView, t),
        id: surfaceId,
        epoch: String(epoch),
        active,
      },
      causeIds: causes.splice(0),
      timing: "render-callback",
    });
    // Keep the current clock tick open: performance.now() may return the same value again.
    aligned(session.flush(beforeTick(t)));
  }
  function render() {
    if (disposed) return;
    // A zero-size/hidden layout has no usable viewport; preserve its last geometry and mark inactive.
    const w = viewport.clientWidth,
      h = viewport.clientHeight;
    const visible = !doc.hidden && w > 0 && h > 0;
    if (
      visible &&
      (w !== controller.view.width || h !== controller.view.height)
    ) {
      controller.resize(w, h, now());
      epoch++;
    }
    if (active !== visible) {
      active = visible;
      epoch++;
    }
    presentedView = { ...controller.view };
    content.style.transform = `matrix(${viewMatrix(presentedView).join(",")})`;
    commit(now());
    animation = win.requestAnimationFrame(render);
  }
  const controls = attachBrowserControls(viewport, controller, {
    onLifecycle: (reason) => {
      if (reason === "background") {
        active = false;
        epoch++;
        commit(now());
      }
      // Foreground is committed only with the next rendered state.
    },
  });
  // Images must drag the content layer, not start the browser's native image-drag session.
  const preventDrag = (event: DragEvent) => event.preventDefault();
  viewport.addEventListener("dragstart", preventDrag);
  function cleanup() {
    disposed = true;
    win.cancelAnimationFrame(animation);
    controls.dispose();
    viewport.removeEventListener("dragstart", preventDrag);
    Object.assign(viewport.style, previousViewport);
    Object.assign(content.style, previousContent);
    ownedSessions.delete(session);
    ownedViewports.delete(viewport);
    ownedContents.delete(content);
  }
  try {
    render();
  } catch (error) {
    cleanup();
    throw error;
  }
  return {
    session,
    controller,
    get captureContext() {
      return { surfaceId, surfaceEpoch: String(epoch) };
    },
    /** Capture captureContext at exposure and register the source clock through session.clocks. */
    pushGaze(sample: GazeSample, receivedTimeMs = now()) {
      if (disposed) throw new Error("Gaze surface is disposed");
      session.gaze(sample, receivedTimeMs);
      if (!active) aligned(session.flush(beforeTick(receivedTimeMs)));
    },
    dispose() {
      if (disposed) return session.export();
      try {
        aligned(session.flush(now(), { final: true }));
      } finally {
        cleanup();
      }
      return session.export();
    },
  };
}
