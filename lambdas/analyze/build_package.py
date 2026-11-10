"""Build a Lambda-compatible deployment directory for the Analyze function."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "src"
DIST = HERE / "dist"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--offline-local",
        action="store_true",
        help="Copy source only for local CDK tests and synthesis.",
    )
    args = parser.parse_args()

    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)

    if not args.offline_local:
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
                # Python 3.12 Lambda runs on Amazon Linux 2023 (glibc 2.34).
                # ONNX Runtime publishes cp312 wheels with a manylinux_2_28 tag.
                "manylinux_2_28_x86_64",
                "--implementation",
                "cp",
                "--python-version",
                "3.12",
                "--only-binary=:all:",
                "--upgrade",
                "--disable-pip-version-check",
                "--no-cache-dir",
            ],
            check=True,
        )
        # ONNX Runtime declares SymPy for optional tooling, but inference does not import it.
        # Removing the tooling-only dependency keeps the extracted Lambda package well below
        # AWS's 250 MB limit.
        for name in ("sympy", "mpmath"):
            shutil.rmtree(DIST / name, ignore_errors=True)
        for metadata in (*DIST.glob("sympy-*.dist-info"), *DIST.glob("mpmath-*.dist-info")):
            shutil.rmtree(metadata, ignore_errors=True)

    for source in SOURCE.glob("*.py"):
        shutil.copy2(source, DIST / source.name)

    print(f"Built Analyze Lambda package at {DIST}")


if __name__ == "__main__":
    main()
