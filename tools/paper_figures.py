"""Rebuild publication vector figures from reviewed synthetic data (GPL-3.0-only)."""

from pathlib import Path
import json
import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import (
    FancyBboxPatch,
    Polygon,
    FancyArrowPatch,
)
from matplotlib.ticker import MaxNLocator

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "paper/figures"
OUT.mkdir(exist_ok=True)
DATA = json.loads((ROOT / "paper/data/validation.json").read_text())
TIMING = json.loads((ROOT / "paper/data/timing.json").read_text())
INK, MUTED, BLUE, ORANGE, GREEN = "#1D2939", "#667085", "#0072B2", "#D55E00", "#00876C"
LINE, PALE = "#D0D5DD", "#F4F6F8"
plt.rcParams.update(
    {
        "font.family": "DejaVu Sans",
        "font.size": 8,
        "text.color": INK,
        "axes.labelcolor": INK,
        "xtick.color": MUTED,
        "ytick.color": MUTED,
        "axes.edgecolor": LINE,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "pdf.fonttype": 42,
        "ps.fonttype": 42,
        "svg.fonttype": "none",
        "figure.facecolor": "white",
        "savefig.facecolor": "white",
    }
)


def save(fig, name):
    for ext in ("pdf", "svg"):
        fig.savefig(
            OUT / f"{name}.{ext}",
            bbox_inches="tight",
            pad_inches=0.03,
            metadata={"Creator": "GazeSync reproducible figure script"},
        )
    svg = OUT / f"{name}.svg"
    svg.write_text(
        "\n".join(line.rstrip() for line in svg.read_text().splitlines()) + "\n"
    )
    plt.close(fig)


def box(ax, x, y, w, h, title, body, color=BLUE):
    ax.add_patch(
        FancyBboxPatch(
            (x, y),
            w,
            h,
            boxstyle="round,pad=0.012,rounding_size=.05",
            fc="white",
            ec=LINE,
            lw=0.85,
        )
    )
    ax.plot(
        [x + 0.13, x + 0.13],
        [y + 0.13, y + h - 0.13],
        color=color,
        lw=2.5,
        solid_capstyle="round",
    )
    ax.text(x + 0.26, y + h - 0.25, title, fontsize=8.7, weight="bold", va="center")
    ax.text(
        x + 0.26,
        y + h - 0.49,
        body,
        fontsize=7.6,
        color=MUTED,
        va="top",
        linespacing=1.4,
    )


def arrow(ax, a, b, color=MUTED):
    ax.add_patch(
        FancyArrowPatch(
            a,
            b,
            arrowstyle="-|>",
            mutation_scale=9,
            lw=1.1,
            color=color,
            connectionstyle="arc3,rad=0",
        )
    )


# Architecture: reader follows two independent streams into one auditable join.
fig, ax = plt.subplots(figsize=(7.1, 2.5))
ax.set(xlim=(0, 10), ylim=(0, 3.65))
ax.axis("off")
for x, label in [(0, "01  ACQUIRE"), (3.35, "02  REGISTER"), (6.6, "03  RECONSTRUCT")]:
    ax.text(x, 3.48, label, fontsize=8, weight="bold", color=MUTED)
box(
    ax,
    0.02,
    2.02,
    2.9,
    1.13,
    "Screen interaction",
    "Mouse / keys / selection\nPinch / pan / orientation",
)
box(
    ax,
    0.02,
    0.52,
    2.9,
    1.13,
    "Gaze observations",
    "Models or tracker records\nIndependent eyes; 2D / 3D",
    ORANGE,
)
box(
    ax,
    3.35,
    2.02,
    2.85,
    1.13,
    "Presented state",
    "Surface, layout, content\nRendered matrix and pose",
)
box(
    ax,
    3.35,
    0.52,
    2.85,
    1.13,
    "Clock mapping",
    "Capture time + bound\nEye identity and validity",
    ORANGE,
)
box(
    ax,
    6.6,
    1.28,
    3.33,
    1.35,
    "Capture-time join",
    "Select the capture-time frame\nProject and invert geometry\nRetain validity and uncertainty",
    GREEN,
)
arrow(ax, (2.96, 2.58), (3.30, 2.58), BLUE)
arrow(ax, (2.96, 1.08), (3.30, 1.08), ORANGE)
arrow(ax, (6.23, 2.58), (6.56, 2.23), BLUE)
arrow(ax, (6.23, 1.08), (6.56, 1.67), ORANGE)
ax.text(6.72, 0.79, "Content-relative gaze", fontsize=9, weight="bold", color=GREEN)
ax.text(6.72, 0.47, "Records / diagnostics / replay", fontsize=7.5, color=MUTED)
ax.text(
    0.02,
    0.08,
    "One JSON contract     /     Python + TypeScript     /     Independent acquisition rates",
    fontsize=8,
    color=INK,
)
save(fig, "architecture")

# Timing: actual synthetic deliveries, not decorative arrows placed arbitrarily.
fig = plt.figure(figsize=(7.1, 2.6))
gs = fig.add_gridspec(1, 2, width_ratios=[1.05, 1], wspace=0.35)
a = fig.add_subplot(gs[0, 0])
b = fig.add_subplot(gs[0, 1])
s = next(s for s in TIMING["samples"] if 140 < s["capture"] < 160)
lo, hi = 110, 240
frames = np.array([f["t"] for f in TIMING["frames"] if lo <= f["t"] <= hi])
a.scatter(
    frames, np.full(len(frames), 2), marker="|", s=140, lw=1.3, color=BLUE, zorder=3
)
a.scatter([s["capture"]], [1], s=35, color=GREEN, zorder=4)
a.scatter([s["arrival"]], [0], s=35, color=ORANGE, zorder=4)
a.hlines([0, 1, 2], lo, hi, color=LINE, lw=0.8, zorder=0)
a.axvspan(s["frame"], s["frame"] + 1000 / 60, color=GREEN, alpha=0.10)
a.plot([s["capture"], s["capture"]], [1, 2], color=GREEN, lw=1.3)
a.plot([s["arrival"], s["arrival"]], [0, 2], color=ORANGE, lw=1, ls="--")
a.annotate(
    "",
    xy=(s["arrival"], 0.5),
    xytext=(s["capture"], 0.5),
    arrowprops={"arrowstyle": "<->", "color": MUTED, "lw": 0.8},
)
a.text(
    (s["capture"] + s["arrival"]) / 2,
    0.67,
    f"{s['arrival'] - s['capture']:.1f} ms delay",
    ha="center",
    fontsize=7,
)
a.text(s["frame"] + 2, 2.48, "Capture frame", color=GREEN, fontsize=7)
a.text(s["arrivalFrame"] + 1, 2.29, "Receipt frame", color=ORANGE, fontsize=7)
a.set(
    xlim=(lo, hi),
    ylim=(-0.3, 2.85),
    yticks=[0, 1, 2],
    yticklabels=["Receipt", "Exposure", "Display"],
    xlabel="Session time (ms)",
)
a.set_title(
    "A   Two times, different screen states",
    loc="left",
    fontsize=8.8,
    weight="bold",
    pad=10,
)
a.spines["left"].set_visible(False)
a.tick_params(axis="y", length=0)
a.xaxis.set_major_locator(MaxNLocator(4))
plot_samples = sorted(
    TIMING["samples"]
    + [{"capture": 384, "arrivalError": float("nan"), "error": float("nan")}],
    key=lambda s: s["capture"],
)
x = np.array([s["capture"] for s in plot_samples])
wrong = np.array([s["arrivalError"] for s in plot_samples])
right = np.array([s["error"] for s in plot_samples])
b.plot(x, wrong, color=ORANGE, lw=1.2, label="Receipt-time baseline")
b.plot(x, right, color=GREEN, lw=1.6, label="Capture-time join")
b.axvspan(368, 400, color=PALE, zorder=-1)
b.text(384, 65, "Blink", rotation=90, ha="center", va="center", fontsize=7, color=MUTED)
b.set(
    xlim=(0, 800),
    ylim=(-3, 125),
    xlabel="Capture time (ms)",
    ylabel="Reconstruction residual (logical px)",
)
b.grid(axis="y", color=PALE)
b.legend(loc="upper left", fontsize=6.8, frameon=False)
b.set_title(
    "B   Error in the same synthetic trace",
    loc="left",
    fontsize=8.8,
    weight="bold",
    pad=10,
)
fig.subplots_adjust(bottom=0.2, top=0.85, left=0.09, right=0.99)
save(fig, "timing")

# Geometry: distinct metric origins and the independently calculated window example.
GEOMETRY = json.loads((ROOT / "contracts/geometry-fixtures.json").read_text())
fig = plt.figure(figsize=(7.1, 3.4))
gs = fig.add_gridspec(1, 2, width_ratios=[1.12, 1], wspace=0.25)
a = fig.add_subplot(gs[0, 0])
b = fig.add_subplot(gs[0, 1])
for ax in (a, b):
    ax.axis("off")
a.set(xlim=(-0.33, 0.64), ylim=(-0.56, 0.34), aspect="equal")
a.set_title(
    "A   Camera, eye and screen origins", loc="left", fontsize=8.8, weight="bold", pad=8
)
proj = lambda xyz: np.array([xyz[0] + 0.85 * xyz[2], xyz[1] - 0.5 * xyz[2]])
p = GEOMETRY["plane"]
corners = [p["topLeft"], [0.265, 0.165, 0], [0.265, -0.165, 0], [-0.265, -0.165, 0]]
a.add_patch(
    Polygon([proj(c) for c in corners], closed=True, fc="#EAF4F2", ec=GREEN, lw=1)
)
p0 = proj(p["topLeft"])
world = proj([0, 0, 0])
camera = proj(GEOMETRY["cameraCenterWorld"])
a.scatter(*p0, s=17, color=GREEN, zorder=5)
a.text(-0.29, 0.20, r"$P$: screen top-left", fontsize=7.2, color=GREEN)
a.scatter(*world, s=26, marker="+", color=INK, zorder=6)
a.text(-0.22, -0.045, r"$O_W$: panel centre", fontsize=7.2, color=INK)
arrow(a, p0, p0 + np.array([0.10, 0]), GREEN)
arrow(a, p0, p0 + np.array([0, -0.10]), GREEN)
a.text(-0.18, 0.178, r"$u$", fontsize=7.5, color=GREEN)
a.text(-0.29, 0.07, r"$v$", fontsize=7.5, color=GREEN)
a.scatter(*camera, s=20, marker="s", color=INK, zorder=6)
a.annotate(
    r"$C_W$: camera centre",
    xy=camera,
    xytext=(0.10, 0.28),
    fontsize=7.3,
    ha="left",
    arrowprops={"arrowstyle": "-", "color": MUTED, "lw": 0.7},
)
for c, color, label, delta in zip(
    GEOMETRY["cases"][:2],
    [BLUE, ORANGE],
    [r"$O_L$", r"$O_R$"],
    [(-0.055, -0.06), (0.018, 0.015)],
):
    origin = proj(c["originWorld"])
    a.scatter(*origin, s=24, color=color, zorder=5)
    arrow(a, origin, world, color)
    a.text(*(origin + np.array(delta)), label, fontsize=8, color=color)
a.text(0.29, -0.15, "Separate eye origins", fontsize=7.2, color=MUTED)
a.text(-0.27, -0.205, "Active panel: 0.53 × 0.33 m", fontsize=7.2, color=GREEN)
a.text(-0.30, -0.43, r"$p_W=R_{WC}p_C+t_{WC}$", fontsize=9, color=INK)
a.text(-0.30, -0.51, r"$d_W=R_{WC}d_C$", fontsize=9, color=INK)
a.text(
    0.23,
    -0.45,
    "Translate points.\nRotate directions.",
    fontsize=7.2,
    linespacing=1.5,
    color=MUTED,
)

b.set(xlim=(-0.08, 2.05), ylim=(-0.48, 1.75), aspect="equal")
b.set_title(
    "B   Full display to cropped viewport",
    loc="left",
    fontsize=8.8,
    weight="bold",
    pad=8,
)
b.add_patch(
    Polygon(
        [[0, 1.48], [1.92, 1.48], [1.92, 0.40], [0, 0.40]],
        closed=True,
        fc=PALE,
        ec=LINE,
        lw=1,
    )
)
b.add_patch(
    Polygon(
        [[0.1, 1.4], [1.1, 1.4], [1.1, 0.8], [0.1, 0.8]],
        closed=True,
        fc="#EAF2F8",
        ec=BLUE,
        lw=1.2,
    )
)
b.scatter([0, 0.1], [1.48, 1.4], s=15, color=[INK, BLUE], zorder=5)
b.text(0, 1.61, "Display origin (0, 0)", fontsize=7.3, color=INK)
b.annotate(
    "Viewport origin\nD = (100, 80)",
    xy=(0.1, 1.4),
    xytext=(1.25, 1.25),
    fontsize=7.2,
    color=BLUE,
    arrowprops={"arrowstyle": "-", "color": BLUE, "lw": 0.7},
    linespacing=1.4,
)
b.scatter([0.96], [0.94], s=25, color=GREEN, zorder=6)
b.annotate(
    "Same physical hit",
    xy=(0.96, 0.94),
    xytext=(1.18, 0.58),
    fontsize=7.2,
    color=GREEN,
    arrowprops={"arrowstyle": "-", "color": GREEN, "lw": 0.7},
)
b.text(0.22, 1.05, "Viewport", fontsize=8, color=BLUE)
b.text(0.05, 0.27, "Display: 1920 × 1080 logical px", fontsize=7.4, color=MUTED)
b.text(0.05, 0.14, "Viewport: 1000 × 600 logical px", fontsize=7.4, color=MUTED)
b.text(0.05, -0.05, r"$p_D=(960,540)$", fontsize=9, color=GREEN)
b.text(0.05, -0.23, r"$p_V=(960-100,540-80)$", fontsize=9, color=BLUE)
b.text(0.05, -0.41, r"$\phantom{p_V}=(860,460)$", fontsize=9, color=BLUE)
fig.subplots_adjust(left=0.02, right=0.99, top=0.87, bottom=0.05)
save(fig, "geometry")

# Controlled matrix and a separate context-coverage panel.
rows = [r for r in DATA["rows"] if r["name"].startswith("rate-")]
displays = sorted(set(r["displayHz"] for r in rows))
gazes = sorted(set(r["gazeHz"] for r in rows))
matrix = np.array(
    [
        [
            next(
                r["arrivalBaselineP95Px"]
                for r in rows
                if r["displayHz"] == d and r["gazeHz"] == g
            )
            for g in gazes
        ]
        for d in displays
    ]
)
fig = plt.figure(figsize=(7.1, 3.4))
gs = fig.add_gridspec(1, 2, width_ratios=[1.48, 1], wspace=0.25)
a = fig.add_subplot(gs[0, 0])
b = fig.add_subplot(gs[0, 1])
b.axis("off")
im = a.imshow(matrix, cmap="cividis", aspect="auto", vmin=50, vmax=80)
for j in range(len(displays)):
    for i in range(len(gazes)):
        a.text(
            i,
            j,
            f"{matrix[j, i]:.1f}",
            ha="center",
            va="center",
            fontsize=7.3,
            color="white" if matrix[j, i] < 65 else INK,
        )
a.set(
    xticks=range(len(gazes)),
    xticklabels=gazes,
    yticks=range(len(displays)),
    yticklabels=displays,
    xlabel="Gaze rate per eye (Hz)",
    ylabel="Display rate (Hz)",
)
a.tick_params(length=0)
a.set_title(
    "A   Receipt-time baseline: P95 error",
    loc="left",
    fontsize=8.7,
    weight="bold",
    pad=10,
)
cbar = fig.colorbar(
    im, ax=a, orientation="horizontal", fraction=0.08, pad=0.25, aspect=35
)
cbar.set_label("Logical viewport pixels", fontsize=7.5)
cbar.ax.tick_params(labelsize=7)
b.text(
    0,
    1.045,
    "B   Independent validation checks",
    weight="bold",
    fontsize=8.7,
    transform=b.transAxes,
)
for y, value, label in [
    (0.85, str(DATA["experimentCases"]), "configurations"),
    (0.59, f"{DATA['totalSamples']:,}", "observations"),
    (
        0.33,
        str(sum(r["frameMismatches"] for r in DATA["rows"])),
        "capture-frame mismatches",
    ),
]:
    b.text(0, y, value, weight="bold", fontsize=19, color=BLUE, transform=b.transAxes)
    b.text(0, y - 0.07, label, color=MUTED, fontsize=8, transform=b.transAxes)
b.text(
    0,
    0.06,
    "42 rate cells + 36 context cases\n9 viewports × 4 eye modes",
    fontsize=8.1,
    linespacing=1.55,
    transform=b.transAxes,
)
b.text(
    0,
    -0.20,
    "Maximum reconstruction residual\n"
    + f"{max(r['maxReconstructionErrorPx'] for r in DATA['rows']):.2e} logical px",
    fontsize=8.1,
    color=GREEN,
    linespacing=1.45,
    transform=b.transAxes,
)
fig.subplots_adjust(left=0.085, right=0.99, bottom=0.24, top=0.9)
save(fig, "validation")
print("Generated architecture, timing, geometry and validation as PDF + SVG.")
