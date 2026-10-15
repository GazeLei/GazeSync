# Contributing to GazeSync

This repository is a research software draft. Publication is disabled while the
maintainer chooses a license and finalizes the public repository identity.

Use Node.js 22 or newer. Run `npm ci --ignore-scripts`, `npm test`,
`npm run test:types`, `npm run simulate`, and `npm run release:check` before proposing
a change. The core has no runtime dependencies. TypeScript is a pinned development
dependency for consumer declaration checks. Browser integrations need a focused
manual check of the affected input or lifecycle path.

Preserve exposure timestamps, coordinate frames, validity flags and source
provenance. Tests must include an independently known expected result when
changing geometry or synchronization. Do not treat replay agreement alone as
proof of physical accuracy. New recording semantics require a schema/implementation
version decision and a documented migration. Never silently reinterpret old logs.

New distributable files must be reviewed in `public-files.json` and, when shipped
in npm, in `package.json.files`. Runtime imports must remain inside this package.
Use synthetic fixtures; real participant recordings, identifiers, camera frames,
credentials and unpublished reference archives do not belong in a contribution.

Describe the observable bug or behavior, the change and its verification. Keep
scientific claims proportional to the evidence. Report security issues privately
to the repository maintainer once their contact is configured; do not place
private data in a public issue. Contributor and citation metadata will be reviewed
before the first public release.
