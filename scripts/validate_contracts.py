"""Validate the shared JSON examples without third-party dependencies."""

from __future__ import annotations

import json
from pathlib import Path
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]
CONTRACTS = ROOT / "docs" / "contracts"
ALLOWED_STATES = {
    "QUEUED",
    "VALIDATING",
    "READY_FOR_ANALYSIS",
    "ANALYZING",
    "COMPLETE",
    "FLAGGED",
    "FAILED",
}


def load(relative_path: str) -> dict:
    path = CONTRACTS / relative_path
    with path.open(encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise AssertionError(f"{relative_path} must contain a JSON object")
    return value


def require(value: dict, fields: set[str], filename: str) -> None:
    missing = fields - value.keys()
    if missing:
        raise AssertionError(f"{filename} is missing: {', '.join(sorted(missing))}")


def main() -> None:
    status = load("status.example.json")
    require(
        status,
        {
            "schemaVersion",
            "jobId",
            "userId",
            "state",
            "sourceKey",
            "sourceETag",
            "thumbnailKey",
            "resultKey",
            "updatedAt",
            "error",
        },
        "status.example.json",
    )
    UUID(status["jobId"])
    if status["state"] not in ALLOWED_STATES:
        raise AssertionError("status.example.json contains an unknown state")
    expected_prefix = f"uploads/{status['userId']}/{status['jobId']}."
    if not status["sourceKey"].startswith(expected_prefix):
        raise AssertionError("status sourceKey does not match its userId and jobId")

    result = load("result.example.json")
    require(
        result,
        {
            "schemaVersion",
            "jobId",
            "userId",
            "sourceKey",
            "thumbnailKey",
            "modelVersion",
            "labels",
            "moderation",
            "completedAt",
        },
        "result.example.json",
    )
    if result["jobId"] != status["jobId"] or result["userId"] != status["userId"]:
        raise AssertionError("status and result examples must describe the same sample job")

    create_upload = load("api/create-upload.response.json")
    require(create_upload, {"jobId", "state", "upload"}, "api/create-upload.response.json")
    if create_upload["state"] != "QUEUED" or create_upload["upload"]["expiresInSeconds"] > 300:
        raise AssertionError("upload example must be QUEUED with a URL lasting at most 300 seconds")

    job_status = load("api/job-status.response.json")
    require(
        job_status,
        {"schemaVersion", "jobId", "state", "thumbnailUrl", "updatedAt", "error"},
        "api/job-status.response.json",
    )
    if job_status["state"] not in ALLOWED_STATES:
        raise AssertionError("job-status response contains an unknown state")

    print("Validated 4 JSON contract examples.")


if __name__ == "__main__":
    main()
