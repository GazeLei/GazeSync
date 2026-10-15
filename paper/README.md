# GazeSync extension report

[main.tex](main.tex) is a new, self-contained technical-report manuscript. It
requires no figures, class files, bibliography files or inputs from the original
paper folder. It can be copied independently into `paper/` in the future repository.
Open it in the built-in LaTeX editor for a live PDF preview, or compile with:

```sh
mkdir -p build
pdflatex -interaction=nonstopmode -halt-on-error -output-directory=build main.tex
pdflatex -interaction=nonstopmode -halt-on-error -output-directory=build main.tex
```

The title, abstract and main manuscript describe the 0.2.0 implementation and
schema 1.1. Original GazeSync study findings appear as prior work. The new results
are software tests and synthetic scenarios, not another participant study. The
author list was carried from the supplied original source for review; publication
metadata, license and authorship must be finalized before release.

Recorded verification: default simulation seed 41; desktop/mobile 9-second
scenarios; 120 Hz gaze and 60 Hz display; 47 automated tests and strict TypeScript
consumer checks. The performance paragraph is one macOS ARM64 / Node 26.7.0 run
of `npm run bench`. Rerun and update the numeric table, test count and performance
paragraph when the implementation changes. Do not replace measured values with
estimates. Generated PDFs and build intermediates stay outside source control.
