"""S3-triggered image analysis stage for the Media Pipeline."""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import unquote_plus

from analysis import OnnxImageModel, analyze_image

LOGGER = logging.getLogger()
LOGGER.setLevel(logging.INFO)

MANIFEST_KEY = re.compile(
    r"^stage/analyze/(?P<user_id>[A-Za-z0-9_-]{1,64})/"
    r"(?P<job_id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$"
)
SOURCE_KEY = re.compile(
    r"^uploads/(?P<user_id>[A-Za-z0-9_-]{1,64})/"
    r"(?P<job_id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\."
    r"(?:jpe?g|png|webp)$",
    re.IGNORECASE,
)
TERMINAL_STATES = frozenset({"COMPLETE", "FLAGGED", "FAILED"})
CONDITIONAL_WRITE_ATTEMPTS = 3
_S3_CLIENT: Any | None = None
_MODEL: Any | None = None


class PermanentAnalysisError(Exception):
    def __init__(self, code: str, public_message: str) -> None:
        super().__init__(public_message)
        self.code = code
        self.public_message = public_message


def _s3_client() -> Any:
    global _S3_CLIENT
    if _S3_CLIENT is None:
        import boto3

        _S3_CLIENT = boto3.client("s3")
    return _S3_CLIENT


def _utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _expected_owner_args() -> dict[str, str]:
    owner = os.environ.get("EXPECTED_BUCKET_OWNER", "").strip()
    return {"ExpectedBucketOwner": owner} if owner else {}


def _normalize_etag(value: str | None) -> str:
    return (value or "").strip('"')


def _error_code(error: Exception) -> str:
    response = getattr(error, "response", {})
    return str(response.get("Error", {}).get("Code", ""))


def _is_precondition_failed(error: Exception) -> bool:
    return _error_code(error) in {"PreconditionFailed", "412"}


def _is_conditional_conflict(error: Exception) -> bool:
    return _error_code(error) in {"ConditionalRequestConflict", "409"}


def _put_json(
    client: Any,
    *,
    bucket: str,
    key: str,
    payload: dict[str, Any],
    if_match: str | None = None,
    if_none_match: bool = False,
    metadata: dict[str, str] | None = None,
) -> str:
    request: dict[str, Any] = {
        "Bucket": bucket,
        "Key": key,
        "Body": json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"),
        "ContentType": "application/json",
        "CacheControl": "no-store",
        "ServerSideEncryption": "AES256",
        **_expected_owner_args(),
    }
    if if_match:
        request["IfMatch"] = if_match
    if if_none_match:
        request["IfNoneMatch"] = "*"
    if metadata:
        request["Metadata"] = metadata

    for attempt in range(CONDITIONAL_WRITE_ATTEMPTS):
        try:
            response = client.put_object(**request)
            etag = _normalize_etag(response.get("ETag"))
            if not etag:
                raise RuntimeError(f"S3 did not return an ETag for {key}.")
            return etag
        except Exception as error:
            if _is_conditional_conflict(error) and attempt + 1 < CONDITIONAL_WRITE_ATTEMPTS:
                continue
            raise
    raise RuntimeError("Conditional S3 write attempts were exhausted.")


def _read_json(
    client: Any,
    *,
    bucket: str,
    key: str,
    if_match: str | None = None,
) -> tuple[dict[str, Any], str]:
    request: dict[str, Any] = {
        "Bucket": bucket,
        "Key": key,
        **_expected_owner_args(),
    }
    if if_match:
        request["IfMatch"] = if_match
    response = client.get_object(**request)
    etag = _normalize_etag(response.get("ETag"))
    if not etag:
        raise RuntimeError(f"S3 did not return an ETag for {key}.")
    payload = json.loads(response["Body"].read().decode("utf-8"))
    if not isinstance(payload, dict):
        raise PermanentAnalysisError("INVALID_MANIFEST", "The analysis manifest is invalid.")
    return payload, etag


def _status_key(user_id: str, job_id: str) -> str:
    return f"status/{user_id}/{job_id}.json"


def _thumbnail_key(user_id: str, job_id: str) -> str:
    return f"thumbnails/{user_id}/{job_id}.jpg"


def _result_key(user_id: str, job_id: str) -> str:
    return f"results/{user_id}/{job_id}.json"


def _parse_manifest_key(key: str) -> tuple[str, str]:
    match = MANIFEST_KEY.fullmatch(key)
    if match is None:
        raise PermanentAnalysisError(
            "INVALID_OBJECT_KEY",
            "The analysis manifest key does not follow the required format.",
        )
    return match.group("user_id"), match.group("job_id")


def _validate_manifest(payload: dict[str, Any], user_id: str, job_id: str) -> dict[str, str]:
    expected_status = _status_key(user_id, job_id)
    expected_thumbnail = _thumbnail_key(user_id, job_id)
    source_key = str(payload.get("sourceKey") or "")
    source_match = SOURCE_KEY.fullmatch(source_key)
    source_etag = _normalize_etag(str(payload.get("sourceETag") or ""))
    valid = (
        payload.get("schemaVersion") == "1.0"
        and payload.get("userId") == user_id
        and payload.get("jobId") == job_id
        and payload.get("statusKey") == expected_status
        and payload.get("thumbnailKey") == expected_thumbnail
        and source_match is not None
        and source_match.group("user_id") == user_id
        and source_match.group("job_id") == job_id
        and bool(source_etag)
    )
    if not valid:
        raise PermanentAnalysisError(
            "INVALID_MANIFEST",
            "The analysis manifest does not match its job identity.",
        )
    return {
        "source_key": source_key,
        "source_etag": source_etag,
        "thumbnail_key": expected_thumbnail,
        "status_key": expected_status,
        "result_key": _result_key(user_id, job_id),
    }


def _status_payload(
    existing: dict[str, Any],
    *,
    state: str,
    result_key: str | None = None,
    error: dict[str, str] | None = None,
) -> dict[str, Any]:
    return {
        "schemaVersion": "1.0",
        "jobId": existing["jobId"],
        "userId": existing["userId"],
        "state": state,
        "sourceKey": existing["sourceKey"],
        "sourceETag": _normalize_etag(existing["sourceETag"]),
        "thumbnailKey": existing.get("thumbnailKey"),
        "resultKey": result_key,
        "updatedAt": _utc_now(),
        "error": error,
    }


def _read_bound_status(
    client: Any,
    *,
    bucket: str,
    user_id: str,
    job_id: str,
    source_key: str | None = None,
    source_etag: str | None = None,
) -> tuple[dict[str, Any], str]:
    status, etag = _read_json(
        client,
        bucket=bucket,
        key=_status_key(user_id, job_id),
    )
    if status.get("userId") != user_id or status.get("jobId") != job_id:
        raise PermanentAnalysisError("INVALID_STATUS", "The job status identity is invalid.")
    if source_key and status.get("sourceKey") != source_key:
        raise PermanentAnalysisError("INVALID_STATUS", "The job status source key is invalid.")
    if source_etag and _normalize_etag(status.get("sourceETag")) != source_etag:
        raise PermanentAnalysisError("INVALID_STATUS", "The job status source version is invalid.")
    return status, etag


def _claim_analysis(
    client: Any,
    *,
    bucket: str,
    user_id: str,
    job_id: str,
    source_key: str,
    source_etag: str,
) -> tuple[dict[str, Any], str] | None:
    for _ in range(CONDITIONAL_WRITE_ATTEMPTS):
        status, status_etag = _read_bound_status(
            client,
            bucket=bucket,
            user_id=user_id,
            job_id=job_id,
            source_key=source_key,
            source_etag=source_etag,
        )
        state = str(status.get("state") or "")
        if state in TERMINAL_STATES:
            return None
        if state == "ANALYZING":
            return status, status_etag
        if state != "READY_FOR_ANALYSIS":
            return None
        analyzing = _status_payload(status, state="ANALYZING")
        try:
            new_etag = _put_json(
                client,
                bucket=bucket,
                key=_status_key(user_id, job_id),
                payload=analyzing,
                if_match=status_etag,
            )
            return analyzing, new_etag
        except Exception as error:
            if _is_precondition_failed(error):
                continue
            raise
    return None


def _fail_job(
    client: Any,
    *,
    bucket: str,
    user_id: str,
    job_id: str,
    error: PermanentAnalysisError,
) -> bool:
    for _ in range(CONDITIONAL_WRITE_ATTEMPTS):
        status, status_etag = _read_bound_status(
            client,
            bucket=bucket,
            user_id=user_id,
            job_id=job_id,
        )
        if status.get("state") in TERMINAL_STATES:
            return False
        failed = _status_payload(
            status,
            state="FAILED",
            error={"code": error.code, "message": error.public_message},
        )
        try:
            _put_json(
                client,
                bucket=bucket,
                key=_status_key(user_id, job_id),
                payload=failed,
                if_match=status_etag,
            )
            return True
        except Exception as write_error:
            if _is_precondition_failed(write_error):
                continue
            raise
    return False


def _configured_model(client: Any, bucket: str) -> Any:
    global _MODEL
    if _MODEL is not None:
        return _MODEL

    model_key = os.environ["MODEL_KEY"]
    labels_key = os.environ["LABELS_KEY"]
    for configured_key in (model_key, labels_key):
        if not configured_key.startswith("models/") or ".." in configured_key.split("/"):
            raise RuntimeError("Model assets must use fixed keys under models/.")

    cache = Path("/tmp/media-pipeline-models")
    cache.mkdir(parents=True, exist_ok=True)
    model_path = cache / "model.onnx"
    labels_path = cache / "labels.txt"
    if not model_path.exists():
        response = client.get_object(
            Bucket=bucket,
            Key=model_key,
            **_expected_owner_args(),
        )
        model_path.write_bytes(response["Body"].read())
    if not labels_path.exists():
        response = client.get_object(
            Bucket=bucket,
            Key=labels_key,
            **_expected_owner_args(),
        )
        labels_path.write_bytes(response["Body"].read())
    _MODEL = OnnxImageModel(model_path, labels_path)
    return _MODEL


def _put_result_if_absent(
    client: Any,
    *,
    bucket: str,
    key: str,
    payload: dict[str, Any],
    job_id: str,
    source_key: str,
    source_etag: str,
) -> bool:
    try:
        _put_json(
            client,
            bucket=bucket,
            key=key,
            payload=payload,
            if_none_match=True,
            metadata={
                "job-id": job_id,
                "source-key": source_key,
                "source-etag": source_etag,
            },
        )
        return True
    except Exception as error:
        if not _is_precondition_failed(error):
            raise

    existing, _ = _read_json(client, bucket=bucket, key=key)
    if (
        existing.get("jobId") == job_id
        and existing.get("sourceKey") == source_key
        and _normalize_etag(existing.get("sourceETag")) == source_etag
    ):
        return True
    return False


def _write_terminal_status(
    client: Any,
    *,
    bucket: str,
    user_id: str,
    job_id: str,
    status: dict[str, Any],
    status_etag: str,
    state: str,
    result_key: str,
) -> bool:
    payload = _status_payload(status, state=state, result_key=result_key)
    try:
        _put_json(
            client,
            bucket=bucket,
            key=_status_key(user_id, job_id),
            payload=payload,
            if_match=status_etag,
        )
        return True
    except Exception as error:
        if _is_precondition_failed(error):
            return False
        raise


def _process_record(client: Any, record: dict[str, Any]) -> str:
    event_name = str(record.get("eventName", ""))
    if not event_name.startswith("ObjectCreated:"):
        return "skipped"
    bucket = record["s3"]["bucket"]["name"]
    if bucket != os.environ["MEDIA_BUCKET_NAME"]:
        LOGGER.warning("Ignoring event from an unexpected bucket")
        return "skipped"

    key = unquote_plus(record["s3"]["object"]["key"])
    try:
        user_id, job_id = _parse_manifest_key(key)
    except PermanentAnalysisError:
        LOGGER.warning("Ignoring object with an invalid Analyze manifest key")
        return "skipped"

    event_etag = _normalize_etag(record["s3"]["object"].get("eTag"))
    try:
        manifest, _ = _read_json(
            client,
            bucket=bucket,
            key=key,
            if_match=event_etag or None,
        )
        identity = _validate_manifest(manifest, user_id, job_id)
        claimed = _claim_analysis(
            client,
            bucket=bucket,
            user_id=user_id,
            job_id=job_id,
            source_key=identity["source_key"],
            source_etag=identity["source_etag"],
        )
        if claimed is None:
            return "skipped"
        status, status_etag = claimed

        try:
            response = client.get_object(
                Bucket=bucket,
                Key=identity["source_key"],
                IfMatch=identity["source_etag"],
                **_expected_owner_args(),
            )
        except Exception as error:
            if _is_precondition_failed(error):
                raise PermanentAnalysisError(
                    "SOURCE_CHANGED",
                    "The uploaded image changed after validation.",
                ) from error
            raise
        image_bytes = response["Body"].read()
        model = _configured_model(client, bucket)
        result = analyze_image(
            image_bytes,
            model,
            minimum_confidence=float(os.environ.get("MIN_LABEL_CONFIDENCE", "0.05")),
            moderation_threshold=float(os.environ.get("MODERATION_THRESHOLD", "0.20")),
        )
        result_payload = {
            "schemaVersion": "1.0",
            "jobId": job_id,
            "userId": user_id,
            "sourceKey": identity["source_key"],
            "sourceETag": identity["source_etag"],
            "thumbnailKey": identity["thumbnail_key"],
            "modelVersion": os.environ["MODEL_VERSION"],
            "labels": [asdict(label) for label in result.labels],
            "moderation": asdict(result.moderation),
            "completedAt": _utc_now(),
        }
        if not _put_result_if_absent(
            client,
            bucket=bucket,
            key=identity["result_key"],
            payload=result_payload,
            job_id=job_id,
            source_key=identity["source_key"],
            source_etag=identity["source_etag"],
        ):
            raise PermanentAnalysisError(
                "JOB_ID_REUSED",
                "The job ID is already bound to another image.",
            )
        terminal_state = "FLAGGED" if result.moderation.verdict == "FLAGGED" else "COMPLETE"
        if not _write_terminal_status(
            client,
            bucket=bucket,
            user_id=user_id,
            job_id=job_id,
            status=status,
            status_etag=status_etag,
            state=terminal_state,
            result_key=identity["result_key"],
        ):
            return "skipped"
        LOGGER.info(json.dumps({"event": "analysis_complete", "jobId": job_id}))
        return "processed"
    except PermanentAnalysisError as error:
        changed = _fail_job(
            client,
            bucket=bucket,
            user_id=user_id,
            job_id=job_id,
            error=error,
        )
        LOGGER.info(json.dumps({"event": "analysis_failed", "jobId": job_id, "code": error.code}))
        return "failed" if changed else "skipped"


def handler(event: dict[str, Any], context: Any) -> dict[str, int]:
    """AWS Lambda entry point."""

    del context
    client = _s3_client()
    summary = {"processed": 0, "failed": 0, "skipped": 0}
    for record in event.get("Records", []):
        outcome = _process_record(client, record)
        summary[outcome] += 1
    return summary
