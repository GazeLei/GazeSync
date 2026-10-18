"""Build local distributions and verify clean installs. Never contacts a publish endpoint."""

from pathlib import Path
import json
import os
import posixpath
import re
import subprocess
import sys
import tarfile
import tempfile
import venv
import zipfile
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / "package.json").read_text())["version"]
OUT = ROOT / "artifacts/release" / VERSION


def run(args, cwd=ROOT, **kwargs):
    return subprocess.run([str(a) for a in args], cwd=cwd, check=True, **kwargs)


def verify_python_archive(path: Path, *, root: Path = ROOT, version: str = VERSION):
    """Check actual payloads against the reviewed inventory, not just build include patterns."""
    manifest = json.loads((root / "public-files.json").read_text())
    if path.suffix == ".whl":
        expected = {
            name.removeprefix("python/src/"): root / name
            for name in manifest["repositoryFiles"]
            if name.startswith("python/src/")
        }
        info = f"gazesync-{version}.dist-info/"
        expected[info + "licenses/LICENSE"] = root / "python/LICENSE"
        generated = {
            info + name for name in ("METADATA", "WHEEL", "entry_points.txt", "RECORD")
        }
        with zipfile.ZipFile(path) as archive:
            names = [i.filename for i in archive.infolist() if not i.is_dir()]
            payloads = {name: archive.read(name) for name in names}
    else:
        prefix = f"gazesync-{version}/"
        expected = {
            prefix + name.removeprefix("python/"): root / name
            for name in manifest["repositoryFiles"]
            if name.startswith("python/")
        }
        # Hatch includes the repository VCS ignore file in the sdist.
        expected[prefix + ".gitignore"] = root / ".gitignore"
        generated = {prefix + "PKG-INFO"}
        with tarfile.open(path) as archive:
            members = [m for m in archive.getmembers() if not m.isdir()]
            if any(not m.isfile() for m in members):
                raise ValueError("Python archive contains a link or special file")
            names = [m.name for m in members]
            payloads = {m.name: archive.extractfile(m).read() for m in members}
    return _verify_payloads("Python", names, payloads, expected, generated)


def _verify_payloads(label, names, payloads, expected, generated=()):
    if len(names) != len(set(names)):
        raise ValueError(f"{label} archive contains duplicate paths")
    allowed = set(expected) | set(generated)
    if set(names) != allowed:
        raise ValueError(
            f"{label} archive file inventory differs: {sorted(set(names) ^ allowed)}"
        )
    for name, source in expected.items():
        if payloads[name] != source.read_bytes():
            raise ValueError(f"{label} archive does not match reviewed source: {name}")
    return len(names)


def verify_npm_archive(path: Path, *, root: Path = ROOT):
    """Inspect the actual tarball, including exports, local docs and source-map targets."""
    pkg = json.loads((root / "package.json").read_text())
    inventory = json.loads((root / "public-files.json").read_text())
    reviewed = set(inventory["repositoryFiles"]) | set(
        inventory.get("generatedFiles", [])
    )
    if set(pkg["files"]) - reviewed:
        raise ValueError("npm files include an unreviewed path")
    expected = {
        "package/" + name: root / name for name in [*pkg["files"], "package.json"]
    }
    with tarfile.open(path) as archive:
        members = [m for m in archive.getmembers() if not m.isdir()]
        if any(not m.isfile() for m in members):
            raise ValueError("npm archive contains a link or special file")
        names = [m.name for m in members]
        payloads = {m.name: archive.extractfile(m).read() for m in members}
    count = _verify_payloads("npm", names, payloads, expected)

    def require_local(base, target):
        parsed = urlsplit(target)
        if parsed.scheme or parsed.netloc:
            raise ValueError(f"npm local target is external: {target}")
        name = posixpath.normpath(
            posixpath.join(posixpath.dirname(base), unquote(parsed.path))
        )
        if name not in payloads:
            raise ValueError(
                f"npm archive has a missing local target: {base} -> {target}"
            )
        return name

    def export_targets(value):
        if isinstance(value, str):
            if not value.startswith("./"):
                raise ValueError("npm exports must target packaged local files")
            require_local("package/package.json", value)
        elif isinstance(value, dict):
            for child in value.values():
                export_targets(child)
        else:
            raise ValueError("Unsupported npm export mapping")

    export_targets(pkg["exports"])
    for name, content in payloads.items():
        if name.endswith(".md"):
            for ref in re.findall(r"\]\(([^)\s]+)\)", content.decode()):
                if not ref.startswith("#") and not urlsplit(ref).scheme:
                    require_local(name, ref)
        if name.endswith(".js.map"):
            source_map = json.loads(content)
            if source_map.get("sourceRoot"):
                raise ValueError("npm source maps must use local relative sources")
            for i, source in enumerate(source_map["sources"]):
                target = require_local(name, source)
                embedded = source_map.get("sourcesContent", [])
                if (
                    i < len(embedded)
                    and embedded[i] is not None
                    and embedded[i].encode() != payloads[target]
                ):
                    raise ValueError(
                        "npm source-map content does not match its reviewed source"
                    )
    return count


def main():
    (OUT / "python").mkdir(parents=True, exist_ok=True)
    (OUT / "npm").mkdir(exist_ok=True)
    run(["npm", "run", "release:check"])
    run([sys.executable, "-m", "build", ROOT / "python", "--outdir", OUT / "python"])
    distributions = sorted((OUT / "python").glob("*"))
    for distribution in distributions:
        verify_python_archive(distribution)
    run([sys.executable, "-m", "twine", "check", *distributions])
    packed = run(
        ["npm", "pack", "--json", "--pack-destination", OUT / "npm"],
        capture_output=True,
        text=True,
    )
    info = json.loads(packed.stdout)[0]
    archive = OUT / "npm" / info["filename"]
    verify_npm_archive(archive)
    wheel = OUT / "python" / f"gazesync-{VERSION}-py3-none-any.whl"
    sdist = OUT / "python" / f"gazesync-{VERSION}.tar.gz"
    with tempfile.TemporaryDirectory(prefix="gazesync-install-") as tmp:
        tmp = Path(tmp)
        venv.EnvBuilder(with_pip=True).create(tmp / "venv")
        python = (
            tmp / "venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        )
        run([python, "-m", "pip", "install", "--no-index", "--no-deps", wheel], cwd=tmp)
        run(
            [
                python,
                "-I",
                "-m",
                "gazesync",
                "simulate",
                "--mode",
                "binocular-independent",
                "--gaze-hz",
                "600",
                "--content-motion",
                "--right-gaze-hz",
                "120",
            ],
            cwd=tmp,
        )
        with tarfile.open(sdist) as source:
            # Python 3.12+ is used for this packaging utility, not required by the library.
            source.extractall(tmp / "source", filter="data")
        source_root = next((tmp / "source").iterdir())
        assert (source_root / "tests/fixtures/adapter-fixtures.json").is_file()
        run(
            [
                sys.executable,
                "-m",
                "build",
                "--wheel",
                source_root,
                "--outdir",
                tmp / "rebuilt",
            ],
            cwd=tmp,
        )
        verify_python_archive(next((tmp / "rebuilt").glob("*.whl")))
        (tmp / "package.json").write_text('{"private":true,"type":"module"}\n')
        run(
            ["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", archive],
            cwd=tmp,
        )
        run(["node", ROOT / "tools/npm_consumer_check.mjs", tmp], cwd=tmp)

    print(
        json.dumps(
            {
                "wheel": wheel.name,
                "sdist": sdist.name,
                "npm": archive.name,
                "cleanInstallsPassed": True,
                "published": False,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
