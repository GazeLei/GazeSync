# Contributing

Use Python 3.10+ and Node 22+; follow the README verification commands. The source
of truth is `src/*.ts` and `python/src/gazesync/`. `dist/` is generated. Keep both
cores free of runtime dependencies and keep SDK/transport setup in adapters.

Changes to timestamps, units, identity, flags or replay affect the shared wire
contract. Add a focused failing regression, implement the same behavior in both
languages, update `contracts/`, synchronize packaged fixture copies, and run
`npm run test:conformance`. Breaking records require a schema version change or
an explicit migration preserving provenance. Do not silently relabel old logs.

Prefer short pure adapters with synthetic fixtures. Do not commit participant
records, camera frames, tokens, SDK binaries, model weights or local machine
paths. Generated working output belongs in ignored `artifacts/`. Reviewed
aggregate synthetic paper data is deliberately included in `paper/data/`.

Format TypeScript/JavaScript with `npm run format`; format Python with
`ruff format python tools/*.py` (tested formatter 0.15.5). Re-review and update
`public-files.json` when adding files. `npm run release:check` verifies that
imports and package contents stay inside the standalone source boundary.

Submit code under GPL-3.0-only and identify third-party contributions and their
licenses. Preserve scholarly credit through the two citation entries. Manuscript
authorship is subject to contributor review; code contribution does not silently
change paper authorship. Keep public release disabled until maintainer approval.
