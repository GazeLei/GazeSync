# Implementation report

**GazeSync: Reproducible Synchronization of Screen Interaction and Multi-Source
Eye Tracking** extends the original GazeSync paper with the independent codebase,
Python/TypeScript contract, multi-source adapters and synthetic verification.

The implementation report authors are **Yaxiong Lei, Shijing He, Xinya Gong and
Juan Ye**, in that order. The original paper citation retains its published
eight-author list. The implementation report is a draft, has not been accepted at
CHI, and has no arXiv identifier yet. Metadata is explicit in `metadata.json`.
Both BibTeX entries appear directly in the repository README and CITATION files.

[Read the compiled report](GazeSync-implementation.pdf) or edit [main.tex](main.tex).

## Rebuild data, figures and manuscript

```sh
npm run test:conformance
node tools/paper-data.mjs
.venv/bin/python -m pip install -r paper/requirements.txt
# The checked-in 3D assets can be reused; to rebuild them:
blender --background --factory-startup --python tools/render_geometry_scene.py
.venv/bin/python tools/paper_figures.py
cd paper
latexmk -pdf -interaction=nonstopmode -halt-on-error main.tex
```

Use Python 3.12+ for the pinned plotting environment. The library itself supports
Python 3.10+. The 3D scene was rendered with Blender 4.3.2; see
[the editable scene and its build guide](scenes/README.md). Blender is an optional
figure-generation dependency, not a runtime dependency of either package.

LaTeX needs `acmart`, `flushend` and the packages in `main.tex` (tested with TeX
Live 2025). Keep both `figures/` and `tables/` beside the source. The two-column
layout uses `sigconf,screen,nonacm` without an acceptance claim or fabricated DOI.

## Visual assets and provenance

- **Figure 1:** vector device illustrations and a conceptual acquisition-to-content
  story. Maps, touch gestures and paths are schematic artwork.
- **Figure 2:** capture/receipt intervals and residuals from the saved synthetic
  timing trace; the simulated blink remains a gap.
- **Figure 3:** a reproducible 3D world scene, eye-origin cutaway and correct
  display-to-viewport mapping. Its origins and rays use the independent analytic
  fixture. The ocular anatomy is illustrative. Rendered imagery is 600 dpi in
  PDF/SVG, with vector labels and projection-derived annotation anchors.
- **Figure 4:** the controlled rate heatmap and a cumulative plot of per-case
  Python–TypeScript viewport agreement. Values come from the validation JSON.
- **Tables:** consistent booktabs rules, spacing and explicit units. The numerical
  results table is generated as `tables/validation.tex` from the same JSON.

PDF/SVG and 400-dpi PNG versions of every figure are included. The checked-in
`data/validation.json` records all 78 configurations; `data/timing.json` contains
the representative synthetic trace. No participant data or private parent-project
assets are included. Figure scripts, the Blender scene and cached renders make
both editing and reproduction possible.

Counts refer to observations: one capture can produce PoG and ray records for
each eye. Tiny reconstruction residuals indicate numerical consistency, not
physical gaze accuracy. Context cases vary multiple factors and are not a causal
frequency study. Hardware adapters have synthetic contract tests rather than
physical-device certification. Public registry publication remains disabled.

Section 5 gives the audited origins, rigid-frame transformations, camera-centre
inversion, screen/viewport equations, marker registration and the numerical
(860,460) regression. See `docs/COORDINATES.md` for integration guidance.
Implementation 0.4.1 uses schema 2.1; earlier recordings need their original code.

Manuscript and generated figure publication rights are reserved pending author
approval (root NOTICE). The supplied original LaTeX archive is not redistributed
here; the editable implementation draft is maintained in this independent repo.

## Overleaf and the current review

Build a minimal manuscript archive from the repository root:

```sh
python3 tools/overleaf.py zip --out artifacts/overleaf/GazeSync-Overleaf.zip
```

The archive has `main.tex` at its root, four PDF figures, the numerical table,
compiler configuration and usage/rights notes. It excludes runtime code, raw
Blender assets and private parent-project files. The exported project compiles
with pdfLaTeX / TeX Live 2025 without Python, Node, Blender or shell escape.
The [Overleaf guide](OVERLEAF.txt) explains native GitHub sync and the local
bidirectional helper, including conflict handling. GitHub sync is explicitly
triggered with push/pull; it is not automatic continuous synchronization.

The connected project is [GazeSync on Overleaf](https://www.overleaf.com/project/6ad3f558d2464b55e6b8f509),
using pdfLaTeX and TeX Live 2025. Its private manuscript mirror is
[GazeLei/GazeSync-paper](https://github.com/GazeLei/GazeSync-paper).
The canonical repository remains GazeLei/GazeSync; the import/export helper
maps its `paper/` files to the manuscript mirror's root. Always pull the mirror
and import any Overleaf edits before editing the canonical files.
Both directions were verified on 17 October 2026: a local README change reached
Overleaf through GitHub, and a note entered in Overleaf returned through GitHub
and the import helper. The mirror checkout is `../GazeSync-paper` in this workspace.

```sh
git -C ../GazeSync-paper pull --ff-only
python3 tools/overleaf.py import --directory ../GazeSync-paper --apply
# After editing and reviewing the canonical manuscript:
python3 tools/overleaf.py export --directory ../GazeSync-paper --apply
# Review/commit/push in the mirror, then use Overleaf's GitHub Pull button.
```

The [17 October review](reviewer-notes.txt) identifies specific issues in the
comparison baseline, experiment duration, usable coverage, Figure 4B, moving
geometry, related systems and default thresholds. These are discussion items;
the patch updates implementation facts without fabricating the missing studies.
