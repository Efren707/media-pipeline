"""Validate the shared JSON examples without third-party dependencies."""

from __future__ import annotations

import json
import re
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
            "sourceETag",
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
    if not isinstance(result["labels"], list) or not 1 <= len(result["labels"]) <= 5:
        raise AssertionError("result labels must contain between one and five entries")
    confidences = [label["confidence"] for label in result["labels"]]
    if confidences != sorted(confidences, reverse=True):
        raise AssertionError("result labels must be ordered by descending confidence")
    require(
        result["moderation"],
        {"verdict", "confidence", "categories"},
        "result.example.json moderation",
    )
    if result["moderation"]["verdict"] not in {"SAFE", "FLAGGED"}:
        raise AssertionError("result moderation verdict must be SAFE or FLAGGED")

    create_request = load("api/create-upload.request.json")
    require(create_request, {"contentType", "sizeBytes"}, "api/create-upload.request.json")
    if create_request["contentType"] not in {"image/jpeg", "image/png", "image/webp"}:
        raise AssertionError("upload request example must use a supported image type")

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

    job_list = load("api/job-list.response.json")
    require(job_list, {"items", "truncated"}, "api/job-list.response.json")
    if not isinstance(job_list["items"], list) or not isinstance(job_list["truncated"], bool):
        raise AssertionError("job-list items must be a list and truncated a boolean")
    for item in job_list["items"]:
        require(item, set(job_status.keys()) | {"result"}, "api/job-list.response.json item")
        if item["state"] not in ALLOWED_STATES:
            raise AssertionError("job-list response contains an unknown state")

    credentials = load("api/auth-credentials.request.json")
    require(credentials, {"username", "password"}, "api/auth-credentials.request.json")
    if not re.fullmatch(r"[A-Za-z0-9_]{3,32}", credentials["username"]) or not (
        8 <= len(credentials["password"]) <= 72
    ):
        raise AssertionError("credentials example breaks the username or password rules")

    token = load("api/auth-token.response.json")
    require(
        token, {"tokenType", "accessToken", "expiresAt", "user"}, "api/auth-token.response.json"
    )
    require(token["user"], {"id", "username"}, "api/auth-token.response.json user")
    if token["tokenType"] != "Bearer":
        raise AssertionError("token example must use tokenType Bearer")

    print("Validated 8 JSON contract examples.")


if __name__ == "__main__":
    main()
