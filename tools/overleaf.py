"""Minimal Overleaf ZIP and conflict-checked synchronization with a local checkout.

No network calls, credential handling, Git pushes, deletions or shell execution.
Import/export default to a dry run; --apply is required to copy reviewed files.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FILES = {
    "main.tex": "paper/main.tex",
    **{
        f"figures/{name}.pdf": f"paper/figures/{name}.pdf"
        for name in ("architecture", "timing", "geometry", "validation")
    },
    "tables/validation.tex": "paper/tables/validation.tex",
    "latexmkrc": "paper/latexmkrc",
    "README.txt": "paper/OVERLEAF.txt",
    "NOTICE": "NOTICE",
}


def checked(root: Path, name: str, *, required=True) -> Path:
    p = root / name
    for node in [p, *p.parents]:
        if node == root.parent:
            break
        if node.is_symlink():
            raise ValueError(f"Symlinks are not accepted: {name}")
    if not p.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"Path escapes directory: {name}")
    if p.exists() and (not p.is_file() or p.stat().st_size > 50_000_000):
        raise ValueError(f"Not a regular file below 50 MB: {name}")
    if required and not p.is_file():
        raise ValueError(f"Missing required file: {name}")
    return p


def digest(p: Path):
    return hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None


def bundle(root: Path, output: Path, archive_format="overleaf"):
    if archive_format not in ("overleaf", "arxiv"):
        raise ValueError("Unknown manuscript archive format")
    selected = {
        dest: src
        for dest, src in FILES.items()
        if archive_format == "overleaf" or dest.endswith((".tex", ".pdf"))
    }
    data = {dest: checked(root, src).read_bytes() for dest, src in selected.items()}
    manifest = {
        "schema": 1,
        "implementationVersion": json.loads((root / "release.json").read_text())[
            "version"
        ],
        "files": {
            name: hashlib.sha256(content).hexdigest() for name, content in data.items()
        },
    }
    if archive_format == "overleaf":
        data["SOURCE-MANIFEST.json"] = (json.dumps(manifest, indent=2) + "\n").encode()
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.is_symlink():
        raise ValueError("ZIP output must not be a symlink")
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in data.items():
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, content)
    return {
        "output": str(output),
        "format": archive_format,
        "files": list(data),
        "bytes": output.stat().st_size,
        "sha256": digest(output),
    }


def synchronize(root: Path, directory: Path, direction: str, apply=False):
    if directory.is_symlink():
        raise ValueError("Checkout must not be a symlink")
    directory = directory.resolve()
    if directory == root.resolve() or directory == (root / "paper").resolve():
        raise ValueError("Use a separate Overleaf checkout, not the source tree")
    key = hashlib.sha256(str(directory).encode()).hexdigest()
    state_path = root / "artifacts/overleaf-sync" / f"{key}.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else None
    if state is not None and (
        state.get("schema") != 1 or state.get("mapping") != FILES
    ):
        raise ValueError(
            "Sync mapping changed; reconcile the checkout before resetting its baseline"
        )
    baseline = state["hashes"] if state else {}
    changes, conflicts, hashes = [], [], {}
    for dest, src in FILES.items():
        local = checked(root, src)
        remote = checked(directory, dest, required=False)
        lh, rh = digest(local), digest(remote)
        wanted, current = (lh, rh) if direction == "export" else (rh, lh)
        if lh == rh:
            hashes[dest] = lh
            continue
        if wanted is None:
            conflicts.append(
                f"{dest}: missing incoming file; deletions are never imported"
            )
            continue
        if state is None:
            safe = direction == "export" and rh is None
        else:
            safe = current == baseline.get(dest)
        if not safe:
            conflicts.append(
                f"{dest}: destination changed since baseline; reconcile both versions first"
            )
            continue
        changes.append((local, remote) if direction == "export" else (remote, local))
        hashes[dest] = wanted
    if conflicts:
        raise ValueError("No files copied. " + "; ".join(conflicts))
    if apply:
        for source, target in changes:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        state_path.parent.mkdir(parents=True, exist_ok=True)
        new_state = {"schema": 1, "mapping": FILES, "hashes": hashes}
        temporary = state_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(new_state, indent=2) + "\n")
        temporary.replace(state_path)
    return {
        "direction": direction,
        "applied": apply,
        "checkout": str(directory),
        "copies": [{"from": str(a), "to": str(b)} for a, b in changes],
        "networkOperations": 0,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["zip", "export", "import"])
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--directory", type=Path)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--format", choices=["overleaf", "arxiv"], default="overleaf")
    args = parser.parse_args()
    try:
        if args.action == "zip":
            if args.out is None:
                parser.error("zip requires --out")
            result = bundle(args.root.resolve(), args.out.absolute(), args.format)
        else:
            if args.directory is None:
                parser.error("import/export requires --directory")
            result = synchronize(
                args.root.resolve(), args.directory, args.action, args.apply
            )
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
