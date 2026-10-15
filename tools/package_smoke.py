"""Build local distributions and verify clean installs. Never contacts a publish endpoint."""

from pathlib import Path
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import venv

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / "package.json").read_text())["version"]
OUT = ROOT / "artifacts/release" / VERSION


def run(args, cwd=ROOT, **kwargs):
    return subprocess.run([str(a) for a in args], cwd=cwd, check=True, **kwargs)


def main():
    (OUT / "python").mkdir(parents=True, exist_ok=True)
    (OUT / "npm").mkdir(exist_ok=True)
    run(["npm", "run", "release:check"])
    run([sys.executable, "-m", "build", ROOT / "python", "--outdir", OUT / "python"])
    distributions = sorted((OUT / "python").glob("*"))
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
                "import {GazeSession} from 'gazesync'; import {ModelAdapter} from 'gazesync/adapters'; import {generateExperiment,executeExperiment,summarizeExperiment} from 'gazesync/simulation'; import {attachBrowserControls} from 'gazesync/browser'; const e=generateExperiment({width:390,height:844,displayHz:120,inputHz:1000,gazeHz:600,rightGazeHz:120,mode:'binocular-independent'}); const s=summarizeExperiment(e,executeExperiment(e)); if(s.frameMismatches||!s.replayExact)throw Error('Installed npm smoke failed'); console.log(JSON.stringify(s))",
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
