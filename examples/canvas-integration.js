import { createView, GazeSession, ZoomController } from "../dist/index.js";
import { attachBrowserControls } from "../dist/browser.js";

/** Copyable host integration: the estimator delivers samples through pushGaze(). */
export function createGazeCanvas(
  canvas,
  { contentId, contentWidth, contentHeight, draw, onAligned = () => {} },
) {
  const document = canvas.ownerDocument;
  const window = document.defaultView;
  const performance = window.performance;
  const requestAnimationFrame = window.requestAnimationFrame.bind(window);
  const cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  const session = new GazeSession();
  let epoch = 1,
    active = !document.hidden,
    causeIds = [],
    animation,
    disposed = false;
  const size = () => ({
    width: Math.max(1, canvas.clientWidth),
    height: Math.max(1, canvas.clientHeight),
  });
  const controller = new ZoomController(
    createView({ ...size(), contentWidth, contentHeight }),
    {
      onInput: (event) => {
        session.input(event);
        causeIds.push(event.id);
      },
    },
  );
  const controls = attachBrowserControls(canvas, controller, {
    onLifecycle: (reason) => {
      if (["background", "foreground"].includes(reason)) {
        active = reason === "foreground";
        epoch++;
        // rAF may stop immediately in a hidden tab. Record the lifecycle boundary now.
        if (!active) commit(performance.now());
      }
    },
  });
  const observer = new window.ResizeObserver(() => {
    const { width, height } = size();
    if (width !== controller.view.width || height !== controller.view.height) {
      controller.resize(width, height, performance.now());
      epoch++;
    }
  });
  observer.observe(canvas);
  function commit(now) {
    session.present({
      t: now,
      contentId,
      view: controller.view,
      surface: { id: "canvas", epoch: String(epoch), active },
      causeIds,
    });
    causeIds = [];
    onAligned(session.flush(now));
  }
  function frame() {
    if (disposed) return;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(controller.view.width * dpr),
      height = Math.round(controller.view.height * dpr);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, controller.view, controller.selection);
    const now = performance.now(); // A render callback estimate, not photon onset.
    commit(now);
    animation = requestAnimationFrame(frame);
  }
  animation = requestAnimationFrame(frame);
  return {
    session,
    controller,
    get captureContext() {
      return { surfaceId: "canvas", surfaceEpoch: String(epoch) };
    },
    // Stamp captureContext AT EXPOSURE, not when inference returns. Register external clocks first.
    pushGaze(sample) {
      if (disposed) throw new Error("Gaze canvas is disposed");
      const now = performance.now();
      session.gaze(sample, now);
      if (!active) onAligned(session.flush(now));
    },
    dispose() {
      if (disposed) return session.export();
      disposed = true;
      cancelAnimationFrame(animation);
      observer.disconnect();
      controls.dispose();
      session.flush(performance.now(), { final: true });
      return session.export();
    },
  };
}
