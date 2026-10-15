from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SMOKE_SCRIPT = ROOT / "scripts" / "checkpoint-smoke-test.sh"
CI_WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"


class CheckpointSmokeTestTests(unittest.TestCase):
    def test_ci_runs_script_regression_tests(self) -> None:
        workflow = CI_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn(
            "python -m unittest discover -s scripts/tests -v",
            workflow,
        )

    def test_ready_status_waits_until_both_artifacts_are_visible(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            temp = Path(temporary_directory)
            fake_bin = temp / "bin"
            fake_bin.mkdir()
            image = temp / "test.png"
            image.write_bytes(b"fake image contents")
            state = temp / "head-count"

            fake_aws = fake_bin / "aws"
            fake_aws.write_text(
                """#!/usr/bin/env bash
set -euo pipefail

if [[ "$1 $2" == "sts get-caller-identity" ]]; then
  echo "123456789012"
  exit 0
fi

if [[ "$1 $2" == "s3 cp" ]]; then
  if [[ "$3" == s3://* ]]; then
    cat > "$4" <<'JSON'
{"state":"READY_FOR_ANALYSIS"}
JSON
  fi
  exit 0
fi

if [[ "$1 $2" == "s3api head-object" ]]; then
  count=0
  if [[ -f "$FAKE_AWS_STATE" ]]; then
    count="$(cat "$FAKE_AWS_STATE")"
  fi
  count=$((count + 1))
  echo "$count" > "$FAKE_AWS_STATE"
  if [[ "$count" -eq 1 ]]; then
    exit 1
  fi
  exit 0
fi

echo "Unexpected fake aws call: $*" >&2
exit 2
""",
                encoding="utf-8",
            )
            fake_aws.chmod(0o755)

            fake_sleep = fake_bin / "sleep"
            fake_sleep.write_text("#!/usr/bin/env bash\nexit 0\n", encoding="utf-8")
            fake_sleep.chmod(0o755)

            environment = os.environ.copy()
            environment.update(
                {
                    "FAKE_AWS_STATE": str(state),
                    "MP_OWNER": "fahad",
                    "PATH": f"{fake_bin}:{environment['PATH']}",
                }
            )
            result = subprocess.run(
                ["bash", str(SMOKE_SCRIPT), str(image)],
                cwd=ROOT,
                env=environment,
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("reached READY_FOR_ANALYSIS", result.stdout)
            self.assertEqual(state.read_text(encoding="utf-8").strip(), "3")


if __name__ == "__main__":
    unittest.main()
