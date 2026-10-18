"""Build local distributions and verify clean installs. Never contacts a publish endpoint."""

from pathlib import Path
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import venv
import zipfile

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
    if len(names) != len(set(names)):
        raise ValueError("Python archive contains duplicate paths")
    if set(names) != set(expected) | generated:
        raise ValueError(
            f"Python archive file inventory differs: {sorted(set(names) ^ (set(expected) | generated))}"
        )
    for name, source in expected.items():
        if payloads[name] != source.read_bytes():
            raise ValueError(f"Python archive does not match reviewed source: {name}")
    return len(names)


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
        run(
            [
                "node",
                "--input-type=module",
                "-e",
                "import {GazeSession} from 'gazesync'; import {ModelAdapter} from 'gazesync/adapters'; import {generateExperiment,executeExperiment,summarizeExperiment} from 'gazesync/simulation'; import {attachBrowserControls,createGazeSurface} from 'gazesync/browser'; const e=generateExperiment({width:390,height:844,displayHz:120,inputHz:1000,gazeHz:600,rightGazeHz:120,mode:'binocular-independent',contentMotion:true}); const s=summarizeExperiment(e,executeExperiment(e)); if(s.frameMismatches||!s.replayExact)throw Error('Installed npm smoke failed'); console.log(JSON.stringify(s))",
            ],
            cwd=tmp,
        )
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
