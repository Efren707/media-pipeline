"""S3-triggered validation stage for the Media Pipeline."""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import UTC, datetime
from typing import Any
from urllib.parse import unquote_plus

from image_processing import PermanentValidationError, build_thumbnail

LOGGER = logging.getLogger()
LOGGER.setLevel(logging.INFO)

UPLOAD_KEY = re.compile(
    r"^uploads/(?P<user_id>[A-Za-z0-9_-]{1,64})/"
    r"(?P<job_id>[A-Za-z0-9_-]{1,64})\.(?P<extension>jpe?g|png|webp)$",
    re.IGNORECASE,
)
TRANSITIONABLE_STATES = frozenset({"QUEUED", "VALIDATING"})
CONDITIONAL_WRITE_ATTEMPTS = 3
_S3_CLIENT: Any | None = None


def _s3_client() -> Any:
    global _S3_CLIENT
    if _S3_CLIENT is None:
        import boto3  # Lambda includes the AWS SDK; tests inject a fake client.

        _S3_CLIENT = boto3.client("s3")
    return _S3_CLIENT


def _utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _expected_owner_args() -> dict[str, str]:
    owner = os.environ.get("EXPECTED_BUCKET_OWNER", "").strip()
    return {"ExpectedBucketOwner": owner} if owner else {}


def _parse_upload_key(key: str) -> tuple[str, str, str]:
    match = UPLOAD_KEY.fullmatch(key)
    if match is None:
        raise PermanentValidationError(
            "INVALID_OBJECT_KEY",
            "The upload key does not follow the required format.",
        )
    return match.group("user_id"), match.group("job_id"), match.group("extension").lower()


def _status_key(user_id: str, job_id: str) -> str:
    return f"status/{user_id}/{job_id}.json"


def _thumbnail_key(user_id: str, job_id: str) -> str:
    return f"thumbnails/{user_id}/{job_id}.jpg"


def _manifest_key(user_id: str, job_id: str) -> str:
    return f"stage/analyze/{user_id}/{job_id}.json"


def _normalize_etag(value: str | None) -> str:
    return (value or "").strip('"')


def _error_code(error: Exception) -> str:
    response = getattr(error, "response", {})
    return str(response.get("Error", {}).get("Code", ""))


def _is_precondition_failed(error: Exception) -> bool:
    return _error_code(error) in {"PreconditionFailed", "412"}


def _is_conditional_conflict(error: Exception) -> bool:
    return _error_code(error) in {"ConditionalRequestConflict", "409"}


def _put_object(
    client: Any,
    *,
    bucket: str,
    key: str,
    body: bytes,
    if_none_match: bool = False,
    if_match: str | None = None,
    **kwargs: Any,
) -> dict[str, Any]:
    if if_none_match and if_match:
        raise ValueError("IfNoneMatch and IfMatch cannot be used together.")

    request: dict[str, Any] = {
        "Bucket": bucket,
        "Key": key,
        "Body": body,
        "ServerSideEncryption": "AES256",
        **kwargs,
        **_expected_owner_args(),
    }
    if if_none_match:
        request["IfNoneMatch"] = "*"
    if if_match:
        request["IfMatch"] = if_match

    for attempt in range(CONDITIONAL_WRITE_ATTEMPTS):
        try:
            return client.put_object(**request)
        except Exception as error:
            if _is_conditional_conflict(error) and attempt + 1 < CONDITIONAL_WRITE_ATTEMPTS:
                continue
            raise
    raise RuntimeError("Conditional S3 write attempts were exhausted.")


def _put_json(
    client: Any,
    bucket: str,
    key: str,
    payload: dict[str, Any],
    *,
    if_none_match: bool = False,
    if_match: str | None = None,
) -> str:
    response = _put_object(
        client,
        bucket=bucket,
        key=key,
        body=json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"),
        if_none_match=if_none_match,
        if_match=if_match,
        ContentType="application/json",
        CacheControl="no-store",
    )
    return _normalize_etag(response.get("ETag"))


def _read_existing_json(client: Any, bucket: str, key: str) -> tuple[dict[str, Any], str]:
    response = client.get_object(
        Bucket=bucket,
        Key=key,
        **_expected_owner_args(),
    )
    etag = _normalize_etag(response.get("ETag"))
    if not etag:
        raise RuntimeError(f"S3 did not return an ETag for {key}.")
    payload = json.loads(response["Body"].read().decode("utf-8"))
    return payload, etag


def _status_payload(
    *,
    user_id: str,
    job_id: str,
    state: str,
    source_key: str,
    source_etag: str,
    thumbnail_key: str | None = None,
    error: dict[str, str] | None = None,
) -> dict[str, Any]:
    return {
        "schemaVersion": "1.0",
        "jobId": job_id,
        "userId": user_id,
        "state": state,
        "sourceKey": source_key,
        "sourceETag": source_etag,
        "thumbnailKey": thumbnail_key,
        "resultKey": None,
        "updatedAt": _utc_now(),
        "error": error,
    }


def _claim_validation(
    client: Any,
    *,
    bucket: str,
    user_id: str,
    job_id: str,
    source_key: str,
    source_etag: str,
) -> bool:
    """Bind a job to this source before publishing any derived artifacts."""

    status_key = _status_key(user_id, job_id)
    payload = _status_payload(
        user_id=user_id,
        job_id=job_id,
        state="VALIDATING",
        source_key=source_key,
        source_etag=source_etag,
    )

    for _ in range(CONDITIONAL_WRITE_ATTEMPTS):
        try:
            _put_json(
                client,
                bucket,
                status_key,
                payload,
                if_none_match=True,
            )
            return True
        except Exception as write_error:
            if not _is_precondition_failed(write_error):
                raise

        existing, existing_etag = _read_existing_json(client, bucket, status_key)
        existing_source_key = str(existing.get("sourceKey") or "")
        existing_source_etag = _normalize_etag(existing.get("sourceETag"))
        if existing_source_key and existing_source_key != source_key:
            LOGGER.warning(json.dumps({"event": "job_key_reused", "jobId": job_id}))
            return False
        if existing_source_etag and existing_source_etag != source_etag:
            LOGGER.warning(json.dumps({"event": "job_etag_changed", "jobId": job_id}))
            return False
        if existing.get("state") not in TRANSITIONABLE_STATES:
            return False

        try:
            _put_json(
                client,
                bucket,
                status_key,
                payload,
                if_match=existing_etag,
            )
            return True
        except Exception as write_error:
            if _is_precondition_failed(write_error):
                continue
            raise

    raise RuntimeError(f"Status changed repeatedly while claiming job {job_id}.")


def _write_final_status(
    client: Any,
    *,
    bucket: str,
    user_id: str,
    job_id: str,
    state: str,
    source_key: str,
    source_etag: str,
    thumbnail_key: str | None = None,
    error: dict[str, str] | None = None,
) -> bool:
    status_key = _status_key(user_id, job_id)
    payload = _status_payload(
        user_id=user_id,
        job_id=job_id,
        state=state,
        source_key=source_key,
        source_etag=source_etag,
        thumbnail_key=thumbnail_key,
        error=error,
    )

    for _ in range(CONDITIONAL_WRITE_ATTEMPTS):
        try:
            _put_json(
                client,
                bucket,
                status_key,
                payload,
                if_none_match=True,
            )
            return True
        except Exception as write_error:
            if not _is_precondition_failed(write_error):
                raise

        existing, existing_etag = _read_existing_json(client, bucket, status_key)
        existing_source_key = str(existing.get("sourceKey") or "")
        existing_source_etag = _normalize_etag(existing.get("sourceETag"))
        if existing_source_key and existing_source_key != source_key:
            LOGGER.warning(json.dumps({"event": "job_key_reused", "jobId": job_id}))
            return False
        if existing_source_etag and existing_source_etag != source_etag:
            LOGGER.warning(json.dumps({"event": "job_etag_changed", "jobId": job_id}))
            return False
        if existing.get("state") not in TRANSITIONABLE_STATES:
            return False

        try:
            _put_json(
                client,
                bucket,
                status_key,
                payload,
                if_match=existing_etag,
            )
            return True
        except Exception as write_error:
            if _is_precondition_failed(write_error):
                continue
            raise

    raise RuntimeError(f"Status changed repeatedly while finalizing job {job_id}.")


def _put_thumbnail_if_absent(
    client: Any,
    *,
    bucket: str,
    key: str,
    body: bytes,
    job_id: str,
    source_key: str,
    source_etag: str,
) -> str:
    try:
        _put_object(
            client,
            bucket=bucket,
            key=key,
            body=body,
            if_none_match=True,
            ContentType="image/jpeg",
            CacheControl="private, max-age=3600",
            Metadata={
                "job-id": job_id,
                "source-key": source_key,
                "source-etag": source_etag,
            },
        )
        return "created"
    except Exception as error:
        if not _is_precondition_failed(error):
            raise

    existing = client.head_object(
        Bucket=bucket,
        Key=key,
        **_expected_owner_args(),
    )
    metadata = existing.get("Metadata", {})
    if (
        metadata.get("source-key") == source_key
        and _normalize_etag(metadata.get("source-etag")) == source_etag
    ):
        return "same"
    return "conflict"


def _put_manifest_if_absent(
    client: Any,
    *,
    bucket: str,
    key: str,
    payload: dict[str, Any],
    source_key: str,
    source_etag: str,
) -> str:
    try:
        _put_json(client, bucket, key, payload, if_none_match=True)
        return "created"
    except Exception as error:
        if not _is_precondition_failed(error):
            raise

    existing, _ = _read_existing_json(client, bucket, key)
    if (
        existing.get("sourceKey") == source_key
        and _normalize_etag(existing.get("sourceETag")) == source_etag
    ):
        return "same"
    return "conflict"


def _process_record(client: Any, record: dict[str, Any]) -> str:
    event_name = str(record.get("eventName", ""))
    if not event_name.startswith("ObjectCreated:"):
        return "skipped"

    bucket = record["s3"]["bucket"]["name"]
    expected_bucket = os.environ["MEDIA_BUCKET_NAME"]
    if bucket != expected_bucket:
        LOGGER.warning("Ignoring event from an unexpected bucket")
        return "skipped"

    key = unquote_plus(record["s3"]["object"]["key"])
    try:
        user_id, job_id, extension = _parse_upload_key(key)
    except PermanentValidationError:
        LOGGER.warning("Ignoring object with an invalid upload key")
        return "skipped"

    max_bytes = int(os.environ.get("MAX_IMAGE_BYTES", "10485760"))
    max_pixels = int(os.environ.get("MAX_IMAGE_PIXELS", "25000000"))
    max_side = int(os.environ.get("THUMBNAIL_MAX_SIDE", "320"))
    event_etag = _normalize_etag(record["s3"]["object"].get("eTag"))

    head = client.head_object(Bucket=bucket, Key=key, **_expected_owner_args())
    source_etag = _normalize_etag(head.get("ETag")) or event_etag
    if not source_etag:
        raise RuntimeError("S3 did not return an ETag for the uploaded image.")
    if event_etag and event_etag != source_etag:
        LOGGER.info(json.dumps({"event": "stale_upload_event", "jobId": job_id}))
        return "skipped"

    status_key = _status_key(user_id, job_id)
    thumbnail_key = _thumbnail_key(user_id, job_id)
    manifest_key = _manifest_key(user_id, job_id)

    try:
        content_length = int(head.get("ContentLength", 0))
        if content_length <= 0:
            raise PermanentValidationError("EMPTY_FILE", "The uploaded file is empty.")
        if content_length > max_bytes:
            raise PermanentValidationError(
                "FILE_TOO_LARGE",
                f"The image exceeds the {max_bytes // (1024 * 1024)} MB upload limit.",
            )

        response = client.get_object(
            Bucket=bucket,
            Key=key,
            IfMatch=source_etag,
            **_expected_owner_args(),
        )
        downloaded_etag = _normalize_etag(response.get("ETag"))
        if downloaded_etag and downloaded_etag != source_etag:
            raise RuntimeError("The downloaded image ETag changed during validation.")
        image_bytes = response["Body"].read(max_bytes + 1)
        if len(image_bytes) > max_bytes:
            raise PermanentValidationError(
                "FILE_TOO_LARGE",
                f"The image exceeds the {max_bytes // (1024 * 1024)} MB upload limit.",
            )

        thumbnail = build_thumbnail(
            image_bytes,
            max_side=max_side,
            max_pixels=max_pixels,
        )
        expected_format = {
            "jpg": "JPEG",
            "jpeg": "JPEG",
            "png": "PNG",
            "webp": "WEBP",
        }[extension]
        if thumbnail.detected_format != expected_format:
            raise PermanentValidationError(
                "FORMAT_MISMATCH",
                "The file extension does not match the encoded image format.",
            )
        claimed = _claim_validation(
            client,
            bucket=bucket,
            user_id=user_id,
            job_id=job_id,
            source_key=key,
            source_etag=source_etag,
        )
        if not claimed:
            LOGGER.info(json.dumps({"event": "validation_not_claimed", "jobId": job_id}))
            return "skipped"

        thumbnail_outcome = _put_thumbnail_if_absent(
            client,
            bucket=bucket,
            key=thumbnail_key,
            body=thumbnail.data,
            job_id=job_id,
            source_key=key,
            source_etag=source_etag,
        )
        if thumbnail_outcome == "conflict":
            LOGGER.warning(json.dumps({"event": "job_id_reused", "jobId": job_id}))
            return "skipped"

        manifest_outcome = _put_manifest_if_absent(
            client,
            bucket=bucket,
            key=manifest_key,
            payload={
                "schemaVersion": "1.0",
                "jobId": job_id,
                "userId": user_id,
                "sourceKey": key,
                "sourceETag": source_etag,
                "thumbnailKey": thumbnail_key,
                "statusKey": status_key,
                "detectedFormat": thumbnail.detected_format,
                "originalDimensions": {
                    "width": thumbnail.original_width,
                    "height": thumbnail.original_height,
                },
                "thumbnailDimensions": {
                    "width": thumbnail.thumbnail_width,
                    "height": thumbnail.thumbnail_height,
                },
                "createdAt": _utc_now(),
            },
            source_key=key,
            source_etag=source_etag,
        )
        if manifest_outcome == "conflict":
            LOGGER.warning(json.dumps({"event": "job_id_reused", "jobId": job_id}))
            return "skipped"

        status_changed = _write_final_status(
            client,
            bucket=bucket,
            user_id=user_id,
            job_id=job_id,
            state="READY_FOR_ANALYSIS",
            source_key=key,
            source_etag=source_etag,
            thumbnail_key=thumbnail_key,
        )
        LOGGER.info(json.dumps({"event": "validation_complete", "jobId": job_id}))
        if manifest_outcome == "created" or status_changed:
            return "processed"
        return "skipped"
    except PermanentValidationError as error:
        status_changed = _write_final_status(
            client,
            bucket=bucket,
            user_id=user_id,
            job_id=job_id,
            state="FAILED",
            source_key=key,
            source_etag=source_etag,
            error={"code": error.code, "message": error.public_message},
        )
        LOGGER.info(
            json.dumps({"event": "validation_rejected", "jobId": job_id, "code": error.code})
        )
        return "failed" if status_changed else "skipped"


def handler(event: dict[str, Any], context: Any) -> dict[str, int]:
    """AWS Lambda entry point."""

    del context
    client = _s3_client()
    summary = {"processed": 0, "failed": 0, "skipped": 0}
    for record in event.get("Records", []):
        outcome = _process_record(client, record)
        summary[outcome] += 1
    return summary
