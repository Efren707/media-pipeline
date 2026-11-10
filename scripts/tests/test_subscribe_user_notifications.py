from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "subscribe-user-notifications.sh"
USER_ID = "550e8400-e29b-41d4-a716-446655440000"
EMAIL = "student@example.com"


class SubscribeUserNotificationsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.temp = Path(self.temporary_directory.name)
        self.fake_bin = self.temp / "bin"
        self.fake_bin.mkdir()
        self.aws_log = self.temp / "aws.log"
        self._write_fake_aws()

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def _write_fake_aws(self) -> None:
        fake_aws = self.fake_bin / "aws"
        fake_aws.write_text(
            """#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >> "$FAKE_AWS_LOG"
for argument in "$@"; do
  if [[ "$argument" == file://* ]]; then
    cat "${argument#file://}" >> "$FAKE_AWS_LOG"
    printf '\n' >> "$FAKE_AWS_LOG"
  fi
done

if [[ "$1 $2" == "sts get-caller-identity" ]]; then
  if [[ "${FAKE_AWS_MODE:-}" == "expired" ]]; then
    printf 'ExpiredToken: token expired\n' >&2
    exit 255
  elif [[ "${FAKE_AWS_MODE:-}" == "wrong-identity" ]]; then
    printf 'arn:aws:iam::123456789012:user/not-academy\n'
  else
    printf 'arn:aws:sts::123456789012:assumed-role/voclabs/test-session\n'
  fi
  exit 0
fi

if [[ "$1 $2" == "cloudformation describe-stacks" ]]; then
  if [[ "${FAKE_AWS_MODE:-}" == "cloudformation-error" ]]; then
    printf 'AccessDenied for arn:aws:sts::123456789012:assumed-role/voclabs/session\n' >&2
    exit 255
  fi
  printf 'arn:aws:sns:us-east-1:123456789012:mp-fahad-results\n'
  exit 0
fi

if [[ "$1 $2" == "sns list-subscriptions-by-topic" ]]; then
  if [[ "${FAKE_AWS_MODE:-}" == "list-error" ]]; then
    printf 'Denied topic arn:aws:sns:us-east-1:123456789012:mp-fahad-results\n' >&2
    exit 255
  elif [[ "${FAKE_AWS_MODE:-}" == "existing" || "${FAKE_AWS_MODE:-}" == "attribute-error" ]]; then
    cat <<'JSON'
{"Subscriptions":[{"SubscriptionArn":"arn:aws:sns:us-east-1:123456789012:mp-fahad-results:existing","Owner":"123456789012","Protocol":"email","Endpoint":"student@example.com","TopicArn":"arn:aws:sns:us-east-1:123456789012:mp-fahad-results"}]}
JSON
  elif [[ "${FAKE_AWS_MODE:-}" == "pending" ]]; then
    cat <<'JSON'
{"Subscriptions":[{"SubscriptionArn":"PendingConfirmation","Owner":"123456789012","Protocol":"email","Endpoint":"student@example.com","TopicArn":"arn:aws:sns:us-east-1:123456789012:mp-fahad-results"}]}
JSON
  else
    printf '{"Subscriptions":[]}\n'
  fi
  exit 0
fi

if [[ "$1 $2" == "sns subscribe" ]]; then
  printf 'arn:aws:sns:us-east-1:123456789012:mp-fahad-results:new\n'
  exit 0
fi

if [[ "$1 $2" == "sns set-subscription-attributes" ]]; then
  if [[ "${FAKE_AWS_MODE:-}" == "attribute-error" ]]; then
    printf 'Denied subscription arn:aws:sns:us-east-1:123456789012:mp-fahad-results:existing\n' >&2
    exit 255
  fi
  exit 0
fi

printf 'Unexpected fake aws call: %s\n' "$*" >&2
exit 2
""",
            encoding="utf-8",
        )
        fake_aws.chmod(0o755)

    def _run(
        self,
        user_id: str = USER_ID,
        *,
        email: str = EMAIL,
        mode: str = "new",
    ) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        environment.update(
            {
                "AWS_REGION": "us-east-1",
                "FAKE_AWS_LOG": str(self.aws_log),
                "FAKE_AWS_MODE": mode,
                "MP_OWNER": "fahad",
                "PATH": f"{self.fake_bin}:{environment['PATH']}",
            }
        )
        return subprocess.run(
            ["bash", str(SCRIPT), user_id],
            cwd=ROOT,
            env=environment,
            input=f"{email}\n",
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )

    def _log(self) -> str:
        return self.aws_log.read_text(encoding="utf-8") if self.aws_log.exists() else ""

    def test_rejects_invalid_user_id_before_aws_call(self) -> None:
        result = self._run("../other-user")

        self.assertEqual(result.returncode, 2)
        self.assertEqual(self._log(), "")
        self.assertNotIn(EMAIL, result.stdout + result.stderr)

    def test_requires_a_voclabs_identity(self) -> None:
        result = self._run(mode="wrong-identity")

        self.assertEqual(result.returncode, 2)
        self.assertIn("sts get-caller-identity", self._log())
        self.assertNotIn("sns ", self._log())
        self.assertNotIn(EMAIL, result.stdout + result.stderr)

    def test_reports_expired_credentials_with_safe_exit(self) -> None:
        result = self._run(mode="expired")

        self.assertEqual(result.returncode, 2)
        self.assertIn("temporary voclabs credentials", result.stderr)
        self.assertNotIn("ExpiredToken", result.stderr)
        self.assertNotIn("sns ", self._log())

    def test_reports_missing_owner_with_safe_exit(self) -> None:
        environment = os.environ.copy()
        environment.update(
            {
                "AWS_REGION": "us-east-1",
                "FAKE_AWS_LOG": str(self.aws_log),
                "PATH": f"{self.fake_bin}:{environment['PATH']}",
            }
        )
        environment.pop("MP_OWNER", None)

        result = subprocess.run(
            ["bash", str(SCRIPT), USER_ID],
            cwd=ROOT,
            env=environment,
            input=f"{EMAIL}\n",
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )

        self.assertEqual(result.returncode, 2)
        self.assertIn("Set MP_OWNER", result.stderr)
        self.assertEqual(self._log(), "")

    def test_hides_cloudformation_failure_details(self) -> None:
        result = self._run(mode="cloudformation-error")

        self.assertEqual(result.returncode, 2)
        self.assertIn("Could not read the results topic", result.stderr)
        self.assertNotIn("123456789012", result.stdout + result.stderr)
        self.assertNotIn("arn:aws", result.stdout + result.stderr)

    def test_hides_subscription_listing_failure_details(self) -> None:
        result = self._run(mode="list-error")

        self.assertEqual(result.returncode, 2)
        self.assertIn("Could not inspect email subscriptions", result.stderr)
        self.assertNotIn("123456789012", result.stdout + result.stderr)
        self.assertNotIn("arn:aws", result.stdout + result.stderr)

    def test_hides_attribute_failure_details(self) -> None:
        result = self._run(mode="attribute-error")

        self.assertEqual(result.returncode, 2)
        self.assertIn("Could not configure the user filter", result.stderr)
        self.assertNotIn("123456789012", result.stdout + result.stderr)
        self.assertNotIn("arn:aws", result.stdout + result.stderr)

    def test_new_subscription_stops_for_confirmation_before_filtering(self) -> None:
        result = self._run()

        self.assertEqual(result.returncode, 0, result.stderr)
        log = self._log()
        self.assertIn("sns subscribe", log)
        self.assertNotIn("sns set-subscription-attributes", log)
        self.assertIn('"ReturnSubscriptionArn":true', log)
        self.assertIn('"FilterPolicyScope":"MessageBody"', log)
        self.assertIn(f"results/{USER_ID}/", log)
        self.assertIn("Confirm the AWS email", result.stdout)

    def test_pending_subscription_is_reused_without_filter_calls(self) -> None:
        result = self._run(mode="pending")

        self.assertEqual(result.returncode, 0, result.stderr)
        log = self._log()
        self.assertNotIn("sns subscribe", log)
        self.assertNotIn("sns set-subscription-attributes", log)
        self.assertIn("awaiting confirmation", result.stdout)

    def test_reuses_confirmed_subscription_without_duplicate(self) -> None:
        result = self._run(mode="existing")

        self.assertEqual(result.returncode, 0, result.stderr)
        log = self._log()
        self.assertIn("sns list-subscriptions-by-topic", log)
        self.assertNotIn("sns subscribe", log)
        self.assertEqual(log.count("sns set-subscription-attributes"), 3)
        deny_marker = '"AttributeName":"FilterPolicy","AttributeValue":"{\\"__mp_never__\\"'
        deny_position = log.index(deny_marker)
        scope_position = log.index('"AttributeName":"FilterPolicyScope"')
        user_policy_position = log.index(f"results/{USER_ID}/")
        self.assertLess(deny_position, scope_position)
        self.assertLess(scope_position, user_policy_position)
        self.assertIn('"AttributeName":"FilterPolicyScope"', log)
        self.assertIn('"AttributeValue":"MessageBody"', log)
        self.assertIn(f"results/{USER_ID}/", log)

    def test_does_not_echo_email_or_write_a_tracked_file(self) -> None:
        script_text = SCRIPT.read_text(encoding="utf-8")
        self.assertIn('read -r -s -p "Notification email: " EMAIL', script_text)

        before = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=True,
        ).stdout

        result = self._run()

        after = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn(EMAIL, result.stdout + result.stderr)
        self.assertEqual(after, before)


if __name__ == "__main__":
    unittest.main()
