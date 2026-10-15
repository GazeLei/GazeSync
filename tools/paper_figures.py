"""Rebuild publication vector figures from reviewed synthetic data (GPL-3.0-only)."""

from pathlib import Path
import json
import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import (
    FancyBboxPatch,
    Ellipse,
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
    "Capture time and uncertainty\nEye identity and validity",
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

# Geometry: orthographic schematic, explicit asynchronous eye channels.
fig, ax = plt.subplots(figsize=(3.4, 3.05))
ax.set(xlim=(0, 5), ylim=(0, 4.55))
ax.axis("off")
plane = np.array([[2.05, 4.15], [4.35, 3.65], [4.72, 2.55], [2.42, 3.05]])
ax.add_patch(Polygon(plane, closed=True, fc="#EAF4F2", ec=GREEN, lw=1.1))
ax.text(3.3, 4.3, "Registered display plane", ha="center", weight="bold", fontsize=8)
arrow(ax, (2.05, 4.15), (3.06, 3.93), GREEN)
arrow(ax, (2.05, 4.15), (2.24, 3.60), GREEN)
ax.text(2.7, 4.08, "u", fontsize=8, color=GREEN)
ax.text(2.03, 3.58, "v", fontsize=8, color=GREEN)
ax.text(1.83, 4.18, "P", fontsize=8, color=GREEN)
origins = [(0.55, 2.8), (0.82, 2.1)]
hits = [(3.27, 3.43), (3.48, 3.22)]
for origin, hit, color, label in zip(
    origins, hits, [BLUE, ORANGE], ["Left eye", "Right eye"]
):
    ax.add_patch(Ellipse(origin, 0.36, 0.18, fc="white", ec=color, lw=1.2))
    ax.scatter(*origin, s=9, color=color)
    arrow(ax, (origin[0] + 0.2, origin[1]), hit, color)
    ax.scatter(*hit, s=17, color=color, zorder=4)
    ax.text(origin[0] - 0.3, origin[1] - 0.26, label, color=color, fontsize=7.5)
ax.text(3.62, 2.72, "Separate hits", color=GREEN, fontsize=7.3)
ax.text(
    1.9,
    1.95,
    "Measured origins + shared frame\nNo inferred origin or binocular average",
    fontsize=7.3,
    color=MUTED,
    ha="left",
)
ax.plot([0.05, 4.95], [1.55, 1.55], color=LINE, lw=0.7)
ax.text(0.05, 1.29, "Independent capture times", weight="bold", fontsize=8)
for y, color, rate, ticks in [
    (0.92, BLUE, "600 Hz", np.linspace(1.45, 4.7, 20)),
    (0.48, ORANGE, "120 Hz", np.linspace(1.55, 4.6, 4)),
]:
    ax.hlines(y, 1.35, 4.85, color=LINE, lw=0.7)
    ax.scatter(ticks, np.full(len(ticks), y), s=7, color=color)
    ax.text(0.05, y, rate, color=color, va="center", fontsize=7.8)
ax.text(1.35, 0.12, "Optional bounded pairing; no resampling", fontsize=7, color=MUTED)
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
    (0.85, "78", "configurations"),
    (0.59, "107,070", "observations"),
    (0.33, "0", "capture-frame mismatches"),
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
    "Maximum reconstruction residual\n7.85 × 10⁻¹³ logical px",
    fontsize=8.1,
    color=GREEN,
    linespacing=1.45,
    transform=b.transAxes,
)
fig.subplots_adjust(left=0.085, right=0.99, bottom=0.24, top=0.9)
save(fig, "validation")
print("Generated architecture, timing, geometry and validation as PDF + SVG.")
