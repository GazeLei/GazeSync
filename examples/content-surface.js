import { createGazeSurface } from "../dist/browser.js";
import { zoomLevel } from "../dist/index.js";
const byId = (id) => document.getElementById(id);
const app = createGazeSurface(byId("viewport"), byId("content"), {
  contentWidth: 720,
  contentHeight: 600,
  contentId: "reading-page",
  panBounds: "none",
});
for (const id of ["move", "rotate"])
  byId(id).onclick = () => {
    app.controller.setMode(id === "move" ? "pan" : "rotate");
    for (const other of ["move", "rotate"])
      byId(other).setAttribute("aria-pressed", String(id === other));
  };
byId("left").onclick = () =>
  app.controller.rotate(-Math.PI / 12, performance.now());
byId("right").onclick = () =>
  app.controller.rotate(Math.PI / 12, performance.now());
byId("minus").onclick = () => app.controller.zoom(0.8, performance.now());
byId("plus").onclick = () => app.controller.zoom(1.25, performance.now());
byId("reset").onclick = () => app.controller.reset(performance.now());
byId("bounds").onchange = (e) =>
  app.controller.setPanBounds(e.target.value, performance.now());
byId("export").onclick = () => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(app.session.export())], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "gazesync-content-session.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const status = setInterval(() => {
  const v = app.controller.view;
  byId("status").textContent =
    `${zoomLevel(v).toFixed(2)}× · ${Math.round(((v.rotation ?? 0) * 180) / Math.PI)}°`;
}, 200);
window.addEventListener(
  "pagehide",
  () => {
    clearInterval(status);
    app.dispose();
  },
  { once: true },
);
