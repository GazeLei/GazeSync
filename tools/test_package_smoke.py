"""Release-boundary tests use tiny fake archives; no registry or build is invoked."""

import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
import zipfile
from package_smoke import verify_python_archive, verify_npm_archive


class ArchiveBoundary(unittest.TestCase):
    def test_wheel_inventory_and_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            names = ["python/src/gazesync/__init__.py", "python/LICENSE"]
            (root / "public-files.json").write_text(
                json.dumps({"repositoryFiles": names})
            )
            for name in names:
                (root / name).parent.mkdir(parents=True, exist_ok=True)
                (root / name).write_text("reviewed")
            info = "gazesync-1.0.dist-info/"
            files = {
                "gazesync/__init__.py": b"reviewed",
                info + "licenses/LICENSE": b"reviewed",
                **{
                    info + k: b"generated"
                    for k in ("METADATA", "WHEEL", "entry_points.txt", "RECORD")
                },
            }
            path = root / "example.whl"

            def write(rows):
                with zipfile.ZipFile(path, "w") as z:
                    for name, content in rows.items():
                        z.writestr(name, content)

            write(files)
            self.assertEqual(verify_python_archive(path, root=root, version="1.0"), 6)
            write({**files, "gazesync/private.txt": b"unreviewed"})
            with self.assertRaisesRegex(ValueError, "inventory"):
                verify_python_archive(path, root=root, version="1.0")
            write({**files, "gazesync/__init__.py": b"changed"})
            with self.assertRaisesRegex(ValueError, "match reviewed"):
                verify_python_archive(path, root=root, version="1.0")

    def test_sdist_rejects_unreviewed_files_and_links(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "public-files.json").write_text(
                json.dumps({"repositoryFiles": ["python/README.md"]})
            )
            (root / "python").mkdir()
            (root / "python/README.md").write_bytes(b"readme")
            (root / ".gitignore").write_bytes(b"ignore")
            path = root / "example.tar.gz"

            def write(extra=None, symlink=False):
                with tarfile.open(path, "w:gz") as t:
                    for name, data in {
                        "README.md": b"readme",
                        ".gitignore": b"ignore",
                        "PKG-INFO": b"generated",
                        **(extra or {}),
                    }.items():
                        item = tarfile.TarInfo("gazesync-1.0/" + name)
                        item.size = len(data)
                        t.addfile(item, io.BytesIO(data))
                    if symlink:
                        item = tarfile.TarInfo("gazesync-1.0/link")
                        item.type = tarfile.SYMTYPE
                        item.linkname = "../outside"
                        t.addfile(item)

            write()
            self.assertEqual(verify_python_archive(path, root=root, version="1.0"), 3)
            write({"private.txt": b"unreviewed"})
            with self.assertRaisesRegex(ValueError, "inventory"):
                verify_python_archive(path, root=root, version="1.0")
            write(symlink=True)
            with self.assertRaisesRegex(ValueError, "link or special"):
                verify_python_archive(path, root=root, version="1.0")


class NpmArchiveBoundary(unittest.TestCase):
    def test_inventory_payload_exports_docs_and_sources(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = {
                "README.md": b"[guide](docs/guide.md)",
                "docs/guide.md": b"guide",
                "src/index.ts": b"export const x = 1;",
                "dist/index.js": b"export const x = 1;",
                "dist/index.js.map": json.dumps(
                    {"sources": ["../src/index.ts"]}
                ).encode(),
            }
            pkg = {
                "files": list(files),
                "exports": {".": {"import": "./dist/index.js"}},
            }
            files["package.json"] = json.dumps(pkg).encode()
            for name, data in files.items():
                (root / name).parent.mkdir(parents=True, exist_ok=True)
                (root / name).write_bytes(data)
            (root / "public-files.json").write_text(
                json.dumps({"repositoryFiles": list(files)})
            )
            path = root / "gazesync.tgz"

            def write(changes=None, duplicate=False):
                with tarfile.open(path, "w:gz") as archive:
                    rows = list({**files, **(changes or {})}.items())
                    if duplicate:
                        rows.append(rows[0])
                    for name, data in rows:
                        item = tarfile.TarInfo("package/" + name)
                        item.size = len(data)
                        archive.addfile(item, io.BytesIO(data))

            write()
            self.assertEqual(verify_npm_archive(path, root=root), len(files))
            write({"private.txt": b"unreviewed"})
            with self.assertRaisesRegex(ValueError, "inventory"):
                verify_npm_archive(path, root=root)
            write({"dist/index.js": b"changed"})
            with self.assertRaisesRegex(ValueError, "match reviewed"):
                verify_npm_archive(path, root=root)
            write(duplicate=True)
            with self.assertRaisesRegex(ValueError, "duplicate"):
                verify_npm_archive(path, root=root)
            for name, data in [
                ("README.md", b"[bad](missing.md)"),
                (
                    "package.json",
                    json.dumps({**pkg, "exports": {".": "./missing.js"}}).encode(),
                ),
                (
                    "dist/index.js.map",
                    json.dumps({"sources": ["../../private.ts"]}).encode(),
                ),
            ]:
                original = files[name]
                files[name] = data
                (root / name).write_bytes(data)
                write()
                with self.assertRaisesRegex(ValueError, "missing local target"):
                    verify_npm_archive(path, root=root)
                files[name] = original
                (root / name).write_bytes(original)


if __name__ == "__main__":
    unittest.main()
