# GazeSync implementation report

**GazeSync: Reproducible Synchronization of Screen Interaction and Multi-Source
Eye Tracking** documents the Python/TypeScript framework, coordinate and timing
contracts, source adapters and synthetic validation.

Authors: **Yaxiong Lei, Shijing He, Xinya Gong and Juan Ye**, in that order.
The original GazeSync paper retains its published eight-author citation. The
implementation report is prepared for arXiv; its identifier will be added to
`metadata.json` and the citation files after submission.

[Read the PDF](GazeSync-implementation.pdf) or edit [main.tex](main.tex).
Implementation 0.5.3 uses recording schema 2.1. Initial software distribution is
through [GitHub Releases](https://github.com/GazeLei/GazeSync/releases/tag/v0.5.3);
PyPI and npm publication is deferred.

## Rebuild the report

```sh
npm run test:conformance
node tools/paper-data.mjs
.venv/bin/python -m pip install -r paper/requirements.txt
.venv/bin/python tools/paper_figures.py
cd paper
latexmk -pdf -interaction=nonstopmode -halt-on-error main.tex
```

Figure generation uses Python 3.12+ and the pinned plotting environment. The
library supports Python 3.10+. The checked-in geometry renders can be reused;
[scenes/README.md](scenes/README.md) describes the optional Blender 4.3.2 rebuild.
The manuscript compiles with pdfLaTeX and TeX Live 2025 using `acmart`, `flushend`
and the packages declared in `main.tex`.

## Submission archives

From the repository root:

```sh
python3 tools/overleaf.py zip --format arxiv --out artifacts/arxiv/GazeSync-arXiv.zip
python3 tools/overleaf.py zip --out artifacts/overleaf/GazeSync-Overleaf.zip
```

The arXiv ZIP contains `main.tex`, four PDF figures and the results table. The
references are embedded in `main.tex`. It omits the compiled manuscript, logs,
build tools and repository documentation. Select `main.tex`, pdfLaTeX and TeX
Live 2025 during submission, then inspect the PDF compiled by arXiv. See
[ARXIV.txt](ARXIV.txt) for submission fields and checks.

The Overleaf ZIP also includes compiler configuration, usage notes and a source
manifest. [OVERLEAF.txt](OVERLEAF.txt) documents the connected
[Overleaf project](https://www.overleaf.com/project/6ad3f558d2464b55e6b8f509) and its
private [GitHub mirror](https://github.com/GazeLei/GazeSync-paper). Synchronization
uses explicit push/pull operations. Import any mirror edits before changing the
canonical files:

```sh
git -C ../GazeSync-paper pull --ff-only
python3 tools/overleaf.py import --directory ../GazeSync-paper --apply
# After editing and checking the canonical manuscript:
python3 tools/overleaf.py export --directory ../GazeSync-paper --apply
```

## Data and figures

- Figure 1 shows schematic desktop/mobile interaction and capture-time alignment.
- Figure 2 uses the saved synthetic timing trace, including its blink interval.
- Figure 3 combines a procedural 3D scene with labels anchored to the independent
  geometry fixture. The editable Blender scene and cached renders are included.
- Figure 4 and Table 3 use the 78-case validation JSON. The table reports usable
  observations and coverage alongside reconstruction residuals.

The baseline contains 107,070 observations, of which 102,768 (95.98%) have usable
content coordinates. Eight additional content-motion cases are recorded
separately. Reconstruction residuals use the known perturbed target; device and
participant validation are discussed in the paper's Limitations section.

Manuscript and figure publication rights are reserved by the authors under the
root `NOTICE`. Software and synthetic validation data use GPL-3.0-only.
[reviewer-notes.txt](reviewer-notes.txt) retains the review history; implementation
findings and verification are in the repository's `docs/AUDIT.md`.
