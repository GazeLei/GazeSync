"""Rebuild the paper's vector figures, 3D composition and data-driven results table.

The 3D assets come from render_geometry_scene.py and the shared analytic fixture.
All device/map illustrations below are procedural schematic artwork, not data
from participants. Timing and validation plots use the checked-in result JSON.
"""

from pathlib import Path
import argparse
import json
import math
import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import (
    FancyBboxPatch,
    Rectangle,
    Circle,
    Ellipse,
    Polygon,
    FancyArrowPatch,
    PathPatch,
)
from matplotlib.path import Path as MplPath
from matplotlib.ticker import MaxNLocator
from matplotlib.transforms import Affine2D

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "paper/figures"
OUT.mkdir(exist_ok=True)
DATA = json.loads((ROOT / "paper/data/validation.json").read_text())
MOTION = json.loads((ROOT / "paper/data/interaction-validation.json").read_text())
TIMING = json.loads((ROOT / "paper/data/timing.json").read_text())
INK, MUTED, BLUE, ORANGE, GREEN = "#24343B", "#5F7078", "#0072B2", "#D55E00", "#00876C"
LINE, PALE = "#CDD7DA", "#F3F6F7"
plt.rcParams.update(
    {
        "font.family": "DejaVu Sans",
        "font.size": 8.2,
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
        "svg.hashsalt": "gazesync-paper-v2",
        "figure.facecolor": "white",
        "savefig.facecolor": "white",
        "axes.linewidth": 0.7,
    }
)


def save(fig, name):
    for ext in ("pdf", "svg", "png"):
        fig.savefig(
            OUT / f"{name}.{ext}",
            dpi=600 if ext in ("pdf", "svg") else 400,
            facecolor="white",
            bbox_inches=None,
            metadata={"Creator": "GazeSync procedural scientific figure pipeline"}
            if ext != "png"
            else {"Software": "GazeSync figure pipeline"},
        )
    p = OUT / f"{name}.svg"
    p.write_text("\n".join(x.rstrip() for x in p.read_text().splitlines()) + "\n")
    plt.close(fig)


def arrow(ax, start, end, color=MUTED, lw=1, scale=8, style="-|>", **kw):
    patch = FancyArrowPatch(
        start, end, arrowstyle=style, mutation_scale=scale, lw=lw, color=color, **kw
    )
    ax.add_patch(patch)
    return patch


def rounded(ax, rect, face="white", edge=LINE, radius=0.035, lw=0.8, zorder=1):
    x, y, w, h = rect
    p = FancyBboxPatch(
        (x, y),
        w,
        h,
        boxstyle=f"round,pad=0,rounding_size={radius}",
        facecolor=face,
        edgecolor=edge,
        lw=lw,
        zorder=zorder,
    )
    ax.add_patch(p)
    return p


def map_scene(ax, rect, zoom=1, focus=(0.5, 0.5), landmark=True, rotation=0):
    """One intrinsic scene with translation, scale and clockwise rotation."""
    x, y, w, h = rect
    clip = Rectangle((x, y), w, h, fc="#F5F3EC", ec="none", zorder=2)
    ax.add_patch(clip)
    scale = max(w, h) * zoom
    # Plot coordinates point up; screen-positive clockwise rotation points down.
    scene_transform = Affine2D().rotate_around(x + w / 2, y + h / 2, -rotation)

    def xy(p):
        return (
            x + w / 2 + (p[0] - focus[0]) * scale,
            y + h / 2 + (p[1] - focus[1]) * scale,
        )

    def add(p):
        ax.add_patch(p)
        p.set_transform(scene_transform + ax.transData)
        p.set_clip_path(clip)

    for polygon in [
        [(0.04, 0.52), (0.22, 0.48), (0.28, 0.72), (0.21, 0.95), (0.03, 0.91)],
        [(0.72, 0.04), (0.95, 0.08), (0.95, 0.38), (0.8, 0.4), (0.71, 0.27)],
        [(0.37, 0.71), (0.62, 0.73), (0.66, 0.92), (0.37, 0.95)],
    ]:
        add(Polygon([xy(p) for p in polygon], fc="#DCE7D6", ec="none", zorder=3))
    # River and paths share the same transform across desktop, phone and content view.
    river = [
        (-0.1, 0.12),
        (0.24, 0.15),
        (0.18, 0.42),
        (0.42, 0.38),
        (0.72, 0.32),
        (0.55, 0.58),
        (1.12, 0.63),
    ]
    path = MplPath([xy(p) for p in river], [MplPath.MOVETO] + [MplPath.CURVE4] * 6)
    add(
        PathPatch(
            path,
            fill=False,
            ec="#B8D9D9",
            lw=scale * 72 * 0.045,
            capstyle="round",
            zorder=4,
        )
    )
    roads = [
        [(0.05, 0.1), (0.32, 0.92)],
        [(0.09, 0.82), (0.94, 0.68)],
        [(0.04, 0.47), (0.98, 0.47)],
        [(0.55, 0.03), (0.69, 0.98)],
        [(0.2, 0.18), (0.91, 0.19)],
    ]
    for road in roads:
        p = MplPath([xy(q) for q in road], [MplPath.MOVETO, MplPath.LINETO])
        add(
            PathPatch(
                p,
                fill=False,
                ec="#DFDBD0",
                lw=scale * 72 * 0.043,
                capstyle="round",
                zorder=5,
            )
        )
        add(
            PathPatch(
                p,
                fill=False,
                ec="#FFFFFF",
                lw=scale * 72 * 0.028,
                capstyle="round",
                zorder=6,
            )
        )
    buildings = [
        (0.36, 0.53, 0.10, 0.09),
        (0.49, 0.54, 0.075, 0.10),
        (0.72, 0.52, 0.15, 0.075),
        (0.72, 0.82, 0.14, 0.065),
        (0.34, 0.25, 0.11, 0.10),
        (0.48, 0.24, 0.08, 0.11),
        (0.08, 0.29, 0.10, 0.11),
        (0.78, 0.25, 0.12, 0.10),
    ]
    for bx, by, bw, bh in buildings:
        a = xy((bx, by))
        add(
            FancyBboxPatch(
                a,
                bw * scale,
                bh * scale,
                boxstyle=f"round,pad=0,rounding_size={0.008 * scale}",
                fc="#D1D3C8",
                ec="#C7CBC0",
                lw=0.25,
                zorder=7,
            )
        )
    if landmark:
        p = xy((0.62, 0.55))
        add(Circle(p, 0.025 * scale, fc=GREEN, ec="white", lw=0.6, zorder=9))
        p = scene_transform.transform(p)
        if x < p[0] < x + w and y < p[1] < y + h and 0.05 * scale * 72 >= 5.5:
            ax.text(
                *p,
                "A",
                fontsize=5.8,
                weight="bold",
                color="white",
                ha="center",
                va="center",
                zorder=10,
                clip_on=True,
                clip_path=clip,
            )
    return lambda p: scene_transform.transform(xy(p)), clip


def device_monitor(ax, rect):
    x, y, w, h = rect
    rounded(
        ax,
        (x + 0.025, y - 0.025, w, h),
        face="#E6ECEE",
        edge="none",
        radius=0.045,
        zorder=0,
    )
    rounded(ax, rect, face="#314149", edge="#26363D", radius=0.045, lw=0.8)
    view = (x + 0.04, y + 0.12, w - 0.08, h - 0.18)
    coords, clip = map_scene(ax, view, 1.0, (0.5, 0.5))
    ax.add_patch(
        Rectangle(
            (x + 0.04, y + h - 0.105),
            w - 0.08,
            0.055,
            fc="#EDF1F2",
            ec="none",
            zorder=10,
        )
    )
    for i in range(3):
        ax.add_patch(
            Circle(
                (x + 0.09 + i * 0.045, y + h - 0.077),
                0.009,
                fc="#9AAEB5",
                ec="none",
                zorder=11,
            )
        )
    ax.add_patch(
        Polygon(
            [
                (x + w * 0.44, y),
                (x + w * 0.56, y),
                (x + w * 0.61, y - 0.12),
                (x + w * 0.39, y - 0.12),
            ],
            fc="#53636A",
            ec="none",
            zorder=0,
        )
    )
    rounded(
        ax,
        (x + w * 0.28, y - 0.15, w * 0.44, 0.045),
        face="#53636A",
        edge="none",
        radius=0.018,
        zorder=0,
    )
    a = coords((0.46, 0.41))
    b = coords((0.79, 0.69))
    p = Rectangle(
        a,
        b[0] - a[0],
        b[1] - a[1],
        fc="none",
        ec=BLUE,
        lw=0.9,
        ls=(0, (3, 2)),
        zorder=12,
    )
    ax.add_patch(p)
    p.set_clip_path(clip)
    pointer = np.array(
        [
            [0, 0],
            [0, -0.13],
            [0.034, -0.094],
            [0.069, -0.14],
            [0.088, -0.128],
            [0.052, -0.081],
            [0.101, -0.074],
        ]
    )
    ax.add_patch(
        Polygon(
            pointer + np.array((b[0] - 0.01, b[1] + 0.02)),
            fc="white",
            ec=INK,
            lw=0.7,
            zorder=13,
        )
    )


def device_phone(ax, rect):
    x, y, w, h = rect
    rounded(
        ax,
        (x + 0.025, y - 0.025, w, h),
        face="#DCE5E8",
        edge="none",
        radius=0.065,
        zorder=14,
    )
    rounded(ax, rect, face="#263940", edge="#1F3037", radius=0.06, lw=0.8, zorder=15)
    # Give this map its own z-order group above the monitor.
    before = len(ax.patches)
    before_text = len(ax.texts)
    map_scene(ax, (x + 0.035, y + 0.07, w - 0.07, h - 0.14), 2.0, (0.62, 0.55))
    for p in ax.patches[before:]:
        p.set_zorder(p.get_zorder() + 16)
    for t in ax.texts[before_text:]:
        t.set_zorder(t.get_zorder() + 16)
    rounded(
        ax,
        (x + w * 0.35, y + h - 0.055, w * 0.30, 0.025),
        face="#15252B",
        edge="none",
        radius=0.012,
        zorder=40,
    )
    rounded(
        ax,
        (x + w * 0.35, y + 0.025, w * 0.30, 0.014),
        face="#D5DFE3",
        edge="none",
        radius=0.006,
        zorder=40,
    )
    for px, py, dx, dy in [
        (x + w * 0.32, y + h * 0.38, -0.085, -0.10),
        (x + w * 0.67, y + h * 0.68, 0.085, 0.10),
    ]:
        ax.add_patch(
            Circle((px, py), 0.044, fc="white", ec=INK, lw=1, zorder=41, alpha=0.92)
        )
        ax.add_patch(Circle((px, py), 0.014, fc=INK, ec="none", zorder=42))
        ar = arrow(
            ax,
            (px + dx * 0.55, py + dy * 0.55),
            (px + dx, py + dy),
            INK,
            lw=0.8,
            scale=6,
        )
        ar.set_zorder(43)


def teaser():
    fig, ax = plt.subplots(figsize=(7.1, 2.75))
    fig.subplots_adjust(0, 0, 1, 1)
    ax.set(xlim=(0, 7.1), ylim=(0, 2.75), aspect="equal")
    ax.axis("off")
    for x, label in [
        (0.04, "A  Natural interaction"),
        (2.46, "B  Capture-time alignment"),
        (4.91, "C  Content-relative attention"),
    ]:
        ax.text(x, 2.57, label, fontsize=9.2, weight="bold", va="center")
    ax.plot([2.32, 2.32], [0.25, 2.35], color=LINE, lw=0.65)
    ax.plot([4.76, 4.76], [0.25, 2.35], color=LINE, lw=0.65)
    device_monitor(ax, (0.10, 1.02, 1.72, 1.12))
    device_phone(ax, (1.47, 0.73, 0.63, 1.18))
    ax.text(0.80, 0.69, "Mouse + keyboard", fontsize=7.5, color=MUTED, ha="center")
    ax.text(1.80, 0.55, "Touch", fontsize=7.5, color=MUTED, ha="center")
    for i, (color, xx) in enumerate([(BLUE, 0.35), (ORANGE, 0.62)]):
        ax.add_patch(Ellipse((xx, 0.33), 0.19, 0.10, fc="white", ec=color, lw=0.8))
        ax.add_patch(Circle((xx, 0.33), 0.025, fc=color, ec="none"))
    ax.text(0.84, 0.33, "2D PoG / 3D rays", fontsize=7.5, color=MUTED, va="center")
    states = [
        (1.0, (0.5, 0.5), 0),
        (1.65, (0.62, 0.55), 0.30),
        (1.95, (0.56, 0.63), -0.42),
    ]
    for i, (zoom, focus, rotation) in enumerate(states):
        x = 2.59 + i * 0.65
        map_scene(ax, (x, 1.74, 0.53, 0.48), zoom, focus, rotation=rotation)
        ax.add_patch(
            Rectangle(
                (x, 1.74),
                0.53,
                0.48,
                fc="none",
                ec=GREEN if i == 1 else LINE,
                lw=1.4 if i == 1 else 0.7,
                zorder=14,
            )
        )
        ax.text(x + 0.265, 1.60, rf"$M_{i}$", fontsize=8.5, ha="center")
        ax.plot(
            [x + 0.265, x + 0.265],
            [1.48, 1.35],
            color=GREEN if i == 1 else MUTED,
            lw=0.8,
        )
    ax.text(3.52, 2.32, "Move / zoom / rotate", fontsize=7.4, color=MUTED, ha="center")
    ax.axhspan(0, 0, alpha=0)  # Keep the coordinate system fixed.
    ax.add_patch(
        Rectangle((3.505, 1.19), 0.65, 0.23, fc="#DFF1E9", ec="none", zorder=0)
    )
    arrow(ax, (2.58, 1.30), (4.59, 1.30), MUTED, lw=0.8, scale=6)
    for x in [2.855, 3.505, 4.155]:
        ax.plot([x, x], [1.24, 1.36], color=MUTED, lw=0.9)
    capture, receipt = 3.68, 4.42
    ax.plot([capture, capture], [0.79, 1.44], color=GREEN, lw=1.05)
    ax.plot([receipt, receipt], [0.79, 1.42], color=MUTED, lw=0.8, ls=(0, (2, 2)))
    ax.text(capture - 0.03, 1.47, r"$t_c$", fontsize=8, color=GREEN, ha="right")
    ax.text(receipt + 0.02, 1.47, r"$t_r$", fontsize=8, color=MUTED)
    arrow(ax, (capture, 0.98), (receipt, 0.98), MUTED, lw=0.7, scale=5, style="<->")
    ax.text(
        (capture + receipt) / 2,
        1.07,
        "delivery delay",
        fontsize=7.5,
        color=MUTED,
        ha="center",
    )
    for y, color, label, xs in [
        (0.75, BLUE, "L", np.arange(2.77, 4.55, 0.13)),
        (0.49, ORANGE, "R", np.arange(2.80, 4.55, 0.23)),
    ]:
        ax.plot([2.7, 4.57], [y, y], color=LINE, lw=0.65)
        ax.scatter(xs, np.full(len(xs), y), s=7, color=color, zorder=3)
        ax.text(2.53, y, label, color=color, fontsize=8, weight="bold", va="center")
    ax.scatter([capture], [0.75], s=28, fc="white", ec=GREEN, lw=1.1, zorder=5)
    ax.scatter([capture], [0.75], s=6, color=GREEN, zorder=6)
    ax.text(
        3.59, 0.24, "Independent sample times", fontsize=7.5, color=MUTED, ha="center"
    )
    arrow(ax, (2.19, 1.95), (2.55, 1.95), MUTED, lw=1, scale=7)
    arrow(ax, (4.55, 1.95), (4.95, 1.95), GREEN, lw=1.15, scale=8)
    coords, clip = map_scene(ax, (5.12, 0.61, 1.78, 1.62), 1, (0.5, 0.5))
    ax.add_patch(
        Rectangle((5.12, 0.61), 1.78, 1.62, fc="none", ec=LINE, lw=0.75, zorder=15)
    )
    for points, color, marker in [
        (
            [(0.22, 0.30), (0.31, 0.40), (0.42, 0.48), (0.52, 0.50), (0.62, 0.55)],
            BLUE,
            "o",
        ),
        (
            [(0.23, 0.25), (0.33, 0.35), (0.44, 0.43), (0.55, 0.52), (0.62, 0.55)],
            ORANGE,
            "D",
        ),
    ]:
        xy = np.array([coords(p) for p in points])
        (line,) = ax.plot(xy[:, 0], xy[:, 1], color=color, lw=0.9, zorder=16)
        line.set_clip_path(clip)
        dots = ax.scatter(
            xy[:, 0],
            xy[:, 1],
            s=14,
            marker=marker,
            fc="white",
            ec=color,
            lw=0.85,
            zorder=17,
        )
        dots.set_clip_path(clip)
    ax.text(
        6.01,
        0.40,
        "Original content coordinates",
        fontsize=7.5,
        color=MUTED,
        ha="center",
    )
    ax.text(
        6.01,
        0.20,
        "Replay + quality-tagged records",
        fontsize=7.3,
        color=MUTED,
        ha="center",
    )
    save(fig, "architecture")


def timing():
    fig = plt.figure(figsize=(7.1, 2.8))
    a = fig.add_axes([0.09, 0.22, 0.38, 0.61])
    b = fig.add_axes([0.61, 0.22, 0.37, 0.61])
    fig.text(
        0.045,
        0.94,
        "A  Exposure and receipt select different states",
        fontsize=9.2,
        weight="bold",
    )
    fig.text(0.60, 0.94, "B  Reconstruction residual", fontsize=9.2, weight="bold")
    s = next(s for s in TIMING["samples"] if 140 < s["capture"] < 160)
    lo, hi = 110, 240
    frame_times = np.array([f["t"] for f in TIMING["frames"] if lo <= f["t"] <= hi])
    a.hlines([0, 1, 2], lo, hi, color=LINE, lw=0.8)
    a.scatter(
        frame_times,
        np.full(len(frame_times), 2),
        marker="|",
        s=160,
        lw=1.2,
        color=BLUE,
        zorder=3,
    )
    a.axvspan(s["frame"], s["frame"] + 1000 / 60, color=GREEN, alpha=0.10)
    a.scatter([s["capture"]], [1], s=32, color=GREEN, zorder=5)
    a.scatter([s["arrival"]], [0], s=32, marker="D", color=ORANGE, zorder=5)
    a.plot([s["capture"]] * 2, [1, 2], color=GREEN, lw=1.3)
    a.plot([s["arrival"]] * 2, [0, 2], color=ORANGE, lw=1, ls=(0, (3, 2)))
    arrow(
        a,
        (s["capture"], 0.48),
        (s["arrival"], 0.48),
        MUTED,
        lw=0.7,
        scale=6,
        style="<->",
    )
    a.text(
        (s["capture"] + s["arrival"]) / 2,
        0.66,
        f"{s['arrival'] - s['capture']:.1f} ms",
        ha="center",
        fontsize=7.7,
    )
    a.text(s["frame"] + 1, 2.35, "Capture frame", color=GREEN, fontsize=7.8)
    a.text(s["arrivalFrame"] + 1, 2.35, "Receipt frame", color=ORANGE, fontsize=7.8)
    a.set(
        xlim=(lo, hi),
        ylim=(-0.3, 2.75),
        yticks=[0, 1, 2],
        yticklabels=["Receipt", "Exposure", "Display"],
        xlabel="Session time (ms)",
    )
    a.spines["left"].set_visible(False)
    a.tick_params(axis="y", length=0, labelsize=8)
    a.xaxis.set_major_locator(MaxNLocator(4))
    samples = sorted(
        TIMING["samples"] + [{"capture": 384, "arrivalError": np.nan, "error": np.nan}],
        key=lambda s: s["capture"],
    )
    x = [s["capture"] for s in samples]
    b.plot(
        x,
        [s["arrivalError"] for s in samples],
        color=ORANGE,
        lw=1.05,
        label="Receipt-time baseline",
    )
    b.plot(
        x, [s["error"] for s in samples], color=GREEN, lw=1.5, label="Capture-time join"
    )
    b.axvspan(368, 400, color=PALE, zorder=-1)
    b.text(
        384,
        65,
        "Blink",
        rotation=90,
        ha="center",
        va="center",
        fontsize=7.3,
        color=MUTED,
    )
    b.set(
        xlim=(0, 800),
        ylim=(-3, 125),
        xlabel="Capture time (ms)",
        ylabel="Residual (logical px)",
    )
    b.grid(axis="y", color=PALE)
    b.legend(loc="upper left", fontsize=7.2, frameon=False, handlelength=1.8)
    fig.text(
        0.5,
        0.035,
        "Synthetic trace · 60 Hz display · 120 Hz per eye · 240 Hz input",
        ha="center",
        fontsize=7.5,
        color=MUTED,
    )
    save(fig, "timing")


def geometry():
    meta = json.loads((OUT / "assets/geometry-projections.json").read_text())
    views = meta["views"]
    fig = plt.figure(figsize=(7.1, 3.85))
    a = fig.add_axes([0.0, 0.10, 4.68 / 7.1, 3.12 / 3.85])
    a.imshow(
        plt.imread(OUT / "assets/geometry-world.png"),
        extent=[0, 1, 0, 1],
        aspect="auto",
    )
    a.set(xlim=(0, 1), ylim=(0, 1))
    a.axis("off")
    fig.text(0.015, 0.96, "A  Metric world geometry", fontsize=9.2, weight="bold")
    fig.text(0.705, 0.96, "B  Independent eye origins", fontsize=9.2, weight="bold")
    anchors = views["geometry-world"]

    def label(key, text, where, color=INK, ha="left"):
        target = anchors[key][:2]
        a.annotate(
            text,
            xy=target,
            xytext=where,
            fontsize=7.7,
            color=color,
            ha=ha,
            va="center",
            bbox={
                "boxstyle": "round,pad=.18",
                "fc": "white",
                "ec": "none",
                "alpha": 0.94,
            },
            arrowprops={
                "arrowstyle": "-",
                "color": color,
                "lw": 0.65,
                "shrinkA": 3,
                "shrinkB": 3,
            },
            zorder=10,
        )

    label("C", "Camera centre $C$", (0.64, 0.98), INK)
    label("P", "Screen origin $P$", (0.52, 0.84), GREEN)
    label("O_W", "World origin $O_W$", (0.57, 0.30), INK)
    label("O_L", "$O_L$", (0.04, 0.63), BLUE)
    label("O_R", "$O_R$", (0.04, 0.35), ORANGE)
    for key, color in [("O_L", BLUE), ("O_R", ORANGE)]:
        start = anchors[key][:2]
        end = anchors["O_W"][:2]
        a.plot(
            [start[0], end[0]],
            [start[1], end[1]],
            color=color,
            lw=0.9,
            alpha=0.9,
            zorder=8,
        )
    # Overlay the mathematical centres, which may lie inside an opaque eye shell.
    for key, color in [("O_L", BLUE), ("O_R", ORANGE)]:
        a.scatter(*anchors[key][:2], s=13, fc="white", ec=color, lw=0.85, zorder=11)
    for key, offset in [
        ("x_W", (0.012, -0.025)),
        ("y_W", (0.015, 0.01)),
        ("z_W", (-0.028, 0.015)),
    ]:
        u, v = anchors[key][:2]
        a.text(
            u + offset[0], v + offset[1], f"${key}$", fontsize=7.2, color=INK, zorder=12
        )
    fig.text(
        0.025,
        0.035,
        "Known target on the registered screen; each eye keeps its own ray.",
        fontsize=7.5,
        color=MUTED,
    )
    b = fig.add_axes([0.70, 0.55, 0.29, (0.29 * 7.1 * 1400 / 2200) / 3.85])
    b.imshow(
        plt.imread(OUT / "assets/geometry-eyes.png"), extent=[0, 1, 0, 1], aspect="auto"
    )
    b.set(xlim=(0, 1), ylim=(0, 1))
    b.axis("off")
    for key, color in [("O_L", BLUE), ("O_R", ORANGE)]:
        u, v = views["geometry-eyes"][key][:2]
        b.scatter(u, v, s=16, fc="white", ec=color, lw=0.9, zorder=10)
        b.annotate(
            "$" + key + "$",
            xy=(u, v),
            xytext=(u, v + 0.27),
            ha="center",
            fontsize=8,
            color=color,
            arrowprops={"arrowstyle": "-", "lw": 0.7, "color": color},
        )
    fig.text(
        0.845,
        0.52,
        "Cutaway view · 64 mm separation",
        ha="center",
        fontsize=7.5,
        color=MUTED,
    )
    fig.text(0.705, 0.45, "C  Display → viewport", fontsize=9.2, weight="bold")
    c = fig.add_axes([0.705, 0.04, 0.28, 0.375])
    c.axis("off")
    c.set(xlim=(-0.02, 2.05), ylim=(-0.34, 1.16), aspect="equal")
    c.add_patch(Rectangle((0, 0.02), 1.92, 1.08, fc=PALE, ec=LINE, lw=0.8))
    c.add_patch(Rectangle((0.10, 0.42), 1.0, 0.60, fc="#E9F2F8", ec=BLUE, lw=1))
    c.scatter([0.96], [0.56], s=20, color=GREEN, zorder=4)
    c.scatter([0, 0.1], [1.10, 1.02], s=10, color=[INK, BLUE], zorder=4)
    c.text(0.18, 0.77, "Viewport", fontsize=7.5, color=BLUE)
    c.text(1.18, 0.20, "Display", fontsize=7.3, color=MUTED)
    c.text(1.19, 0.80, "Offset\n(100, 80)", fontsize=7.5, color=MUTED)
    c.text(0, -0.13, r"$p_D=(960,540)$", fontsize=8, color=GREEN)
    c.text(0, -0.28, r"$p_V=(860,460)$", fontsize=8, color=BLUE)
    save(fig, "geometry")


def validation():
    rows = [r for r in DATA["rows"] if r["name"].startswith("rate-")]
    ds = sorted({r["displayHz"] for r in rows})
    gs = sorted({r["gazeHz"] for r in rows})
    values = np.array(
        [
            [
                next(
                    r["arrivalBaselineP95Px"]
                    for r in rows
                    if r["displayHz"] == d and r["gazeHz"] == g
                )
                for g in gs
            ]
            for d in ds
        ]
    )
    fig = plt.figure(figsize=(7.1, 3.05))
    a = fig.add_axes([0.07, 0.29, 0.50, 0.53])
    b = fig.add_axes([0.72, 0.29, 0.265, 0.53])
    fig.text(0.025, 0.94, "A  Receipt-time P95 residual", fontsize=9.2, weight="bold")
    fig.text(0.68, 0.94, "B  Cross-language agreement", fontsize=9.2, weight="bold")
    im = a.imshow(values, cmap="cividis", vmin=50, vmax=80, aspect="auto")
    for j in range(len(ds)):
        for i in range(len(gs)):
            a.text(
                i,
                j,
                f"{values[j, i]:.1f}",
                ha="center",
                va="center",
                fontsize=8,
                color="white" if values[j, i] < 64 else INK,
            )
    a.set(
        xticks=range(len(gs)),
        xticklabels=[f"{g:,}" for g in gs],
        yticks=range(len(ds)),
        yticklabels=ds,
        xlabel="Gaze rate per eye (Hz)",
        ylabel="Display rate (Hz)",
    )
    a.tick_params(length=0, labelsize=7.8)
    ca = fig.add_axes([0.07, 0.14, 0.50, 0.026])
    cb = fig.colorbar(im, cax=ca, orientation="horizontal")
    cb.set_label("Logical viewport pixels", fontsize=7.6, labelpad=3)
    cb.ax.tick_params(labelsize=7.3, length=2)
    gaps = np.sort([r["crossLanguageViewportDifferencePx"] for r in DATA["rows"]])
    fractions = np.arange(1, len(gaps) + 1) / len(gaps) * 100
    xx = np.r_[0, gaps * 1e13, 5]
    yy = np.r_[0, fractions, 100]
    b.step(xx, yy, where="post", color=GREEN, lw=1.4)
    b.fill_between(xx, yy, step="post", color=GREEN, alpha=0.08)
    b.scatter(gaps[-1] * 1e13, 100, s=18, color=GREEN, zorder=4)
    b.set(
        xlim=(0, 5),
        ylim=(0, 105),
        xticks=[0, 1, 2, 3, 4, 5],
        yticks=[0, 25, 50, 75, 100],
        xlabel=r"Viewport gap ($10^{-13}$ px)",
        ylabel="Cumulative cases (%)",
    )
    b.grid(axis="y", color=PALE)
    b.tick_params(labelsize=7.8)
    fig.text(
        0.85,
        0.13,
        f"{DATA['experimentCases']} deterministic cases",
        ha="center",
        fontsize=7.6,
        color=MUTED,
    )
    fig.text(
        0.85,
        0.055,
        r"Maximum: $4.55\times10^{-13}$ px",
        ha="center",
        fontsize=7.6,
        color=GREEN,
    )
    save(fig, "validation")


def tables():
    def sci(value):
        if value == 0:
            return "0"
        exp = int(math.floor(math.log10(abs(value))))
        return rf"${value / 10**exp:.2f}\times10^{{{exp}}}$"

    groups = [DATA["rows"], MOTION["rows"]]
    metrics = [
        (
            "Received observations",
            lambda rows: f"{sum(r['samples'] for r in rows):,}",
            "obs.",
        ),
        (
            "Usable observations",
            lambda rows: f"{sum(r['usableSamples'] for r in rows):,}",
            "obs.",
        ),
        (
            "Usable coverage",
            lambda rows: (
                f"{100 * sum(r['usableSamples'] for r in rows) / sum(r['samples'] for r in rows):.2f}"
            ),
            r"\%",
        ),
        (
            "Frame mismatches",
            lambda rows: str(sum(r["frameMismatches"] for r in rows)),
            "obs.",
        ),
        (
            "Exact replay",
            lambda rows: f"{sum(r['replayExact'] for r in rows)}/{len(rows)}",
            "cases",
        ),
        (
            "Pending after drain",
            lambda rows: str(sum(r["pendingSamples"] for r in rows)),
            "obs.",
        ),
    ]
    lines = [
        r"\begin{tabularx}{\columnwidth}{@{}Yrrl@{}}",
        r"\toprule",
        r"\textbf{Check} & \textbf{Baseline} & \textbf{Motion} & \textbf{Unit} \\",
        r"\midrule",
    ]
    for label, value, unit in metrics:
        lines.append(
            f"{label} & {value(groups[0])} & {value(groups[1])} & {unit} " + r"\\"
        )
    lines += [
        r"\addlinespace[3pt]",
        r"\multicolumn{4}{@{}l}{\textit{Maximum numerical differences}} \\",
        r"\addlinespace[2pt]",
    ]
    for label, key, unit in [
        ("Reconstruction residual", "maxReconstructionErrorPx", "px"),
        ("Python--TS viewport", "crossLanguageViewportDifferencePx", "px"),
        ("Python--TS content", "crossLanguageContentDifferenceUnits", "units"),
        ("Python--TS capture time", "crossLanguageTimeDifferenceMs", "ms"),
    ]:
        values = [sci(max(r[key] for r in rows)) for rows in groups]
        lines.append(f"{label} & {values[0]} & {values[1]} & {unit} " + r"\\")
    lines += [r"\bottomrule", r"\end{tabularx}"]
    target = ROOT / "paper/tables"
    target.mkdir(exist_ok=True)
    (target / "validation.tex").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--only", choices=["architecture", "timing", "geometry", "validation"]
    )
    args = parser.parse_args()
    builders = {
        "architecture": teaser,
        "timing": timing,
        "geometry": geometry,
        "validation": validation,
    }
    for name, build in builders.items():
        if args.only is None or args.only == name:
            build()
            print(f"Generated {name}: PDF, SVG, PNG")
    tables()
