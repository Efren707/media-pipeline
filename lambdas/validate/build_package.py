"""Build a Lambda-compatible deployment directory for the Validate function."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "src"
DIST = HERE / "dist"


def _copy_local_pillow() -> None:
    import PIL

    package_root = Path(PIL.__file__).resolve().parent.parent
    candidates = [package_root / "PIL"]
    candidates.extend(package_root.glob("pillow.libs"))
    candidates.extend(package_root.glob("pillow-*.dist-info"))
    for source in candidates:
        if source.exists():
            target = DIST / source.name
            if source.is_dir():
                shutil.copytree(source, target, dirs_exist_ok=True)
            else:
                shutil.copy2(source, target)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--offline-local",
        action="store_true",
        help="Copy the locally installed Pillow package instead of downloading a Lambda wheel.",
    )
    args = parser.parse_args()

    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)

    if args.offline_local:
        _copy_local_pillow()
    else:
        subprocess.run(
            [
                sys.executable,
                "-m",
                "pip",
                "install",
                "--requirement",
                str(HERE / "requirements.txt"),
                "--target",
                str(DIST),
                "--platform",
                "manylinux2014_x86_64",
                "--implementation",
                "cp",
                "--python-version",
                "3.12",
                "--only-binary=:all:",
                "--upgrade",
                "--disable-pip-version-check",
            ],
            check=True,
        )

    for source in SOURCE.glob("*.py"):
        shutil.copy2(source, DIST / source.name)

    print(f"Built Validate Lambda package at {DIST}")


if __name__ == "__main__":
    main()
