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
PROCESSED_STATES = frozenset(
    {"READY_FOR_ANALYSIS", "ANALYZING", "COMPLETE", "FLAGGED"}
)
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


def _put_json(client: Any, bucket: str, key: str, payload: dict[str, Any]) -> None:
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"),
        ContentType="application/json",
        CacheControl="no-store",
        ServerSideEncryption="AES256",
        **_expected_owner_args(),
    )


def _is_missing(error: Exception) -> bool:
    if isinstance(error, KeyError):
        return True
    response = getattr(error, "response", {})
    code = str(response.get("Error", {}).get("Code", ""))
    return code in {"NoSuchKey", "NotFound", "404"}


def _read_json_if_present(client: Any, bucket: str, key: str) -> dict[str, Any] | None:
    try:
        response = client.get_object(
            Bucket=bucket,
            Key=key,
            **_expected_owner_args(),
        )
    except Exception as error:  # boto3 ClientError is available only in Lambda/dev deps.
        if _is_missing(error):
            return None
        raise
    return json.loads(response["Body"].read().decode("utf-8"))


def _object_exists(client: Any, bucket: str, key: str) -> bool:
    try:
        client.head_object(Bucket=bucket, Key=key, **_expected_owner_args())
        return True
    except Exception as error:
        if _is_missing(error):
            return False
        raise


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


def _already_processed(
    client: Any,
    *,
    bucket: str,
    user_id: str,
    job_id: str,
    source_etag: str,
) -> bool:
    status = _read_json_if_present(client, bucket, _status_key(user_id, job_id))
    if not status or _normalize_etag(status.get("sourceETag")) != source_etag:
        return False
    if status.get("state") not in PROCESSED_STATES:
        return False
    if status.get("state") != "READY_FOR_ANALYSIS":
        return True
    return _object_exists(client, bucket, _thumbnail_key(user_id, job_id)) and _object_exists(
        client, bucket, _manifest_key(user_id, job_id)
    )


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

    if _already_processed(
        client,
        bucket=bucket,
        user_id=user_id,
        job_id=job_id,
        source_etag=source_etag,
    ):
        LOGGER.info(json.dumps({"event": "already_processed", "jobId": job_id}))
        return "skipped"

    status_key = _status_key(user_id, job_id)
    thumbnail_key = _thumbnail_key(user_id, job_id)
    manifest_key = _manifest_key(user_id, job_id)

    _put_json(
        client,
        bucket,
        status_key,
        _status_payload(
            user_id=user_id,
            job_id=job_id,
            state="VALIDATING",
            source_key=key,
            source_etag=source_etag,
        ),
    )

    try:
        content_length = int(head.get("ContentLength", 0))
        if content_length <= 0:
            raise PermanentValidationError("EMPTY_FILE", "The uploaded file is empty.")
        if content_length > max_bytes:
            raise PermanentValidationError(
                "FILE_TOO_LARGE",
                f"The image exceeds the {max_bytes // (1024 * 1024)} MB upload limit.",
            )

        response = client.get_object(Bucket=bucket, Key=key, **_expected_owner_args())
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
        client.put_object(
            Bucket=bucket,
            Key=thumbnail_key,
            Body=thumbnail.data,
            ContentType="image/jpeg",
            CacheControl="private, max-age=3600",
            ServerSideEncryption="AES256",
            Metadata={"job-id": job_id},
            **_expected_owner_args(),
        )

        ready_status = _status_payload(
            user_id=user_id,
            job_id=job_id,
            state="READY_FOR_ANALYSIS",
            source_key=key,
            source_etag=source_etag,
            thumbnail_key=thumbnail_key,
        )
        _put_json(client, bucket, status_key, ready_status)
        _put_json(
            client,
            bucket,
            manifest_key,
            {
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
        )
        LOGGER.info(json.dumps({"event": "validation_complete", "jobId": job_id}))
        return "processed"
    except PermanentValidationError as error:
        _put_json(
            client,
            bucket,
            status_key,
            _status_payload(
                user_id=user_id,
                job_id=job_id,
                state="FAILED",
                source_key=key,
                source_etag=source_etag,
                error={"code": error.code, "message": error.public_message},
            ),
        )
        LOGGER.info(
            json.dumps(
                {"event": "validation_rejected", "jobId": job_id, "code": error.code}
            )
        )
        return "failed"


def handler(event: dict[str, Any], context: Any) -> dict[str, int]:
    """AWS Lambda entry point."""

    del context
    client = _s3_client()
    summary = {"processed": 0, "failed": 0, "skipped": 0}
    for record in event.get("Records", []):
        outcome = _process_record(client, record)
        summary[outcome] += 1
    return summary
