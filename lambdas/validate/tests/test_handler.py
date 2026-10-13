from __future__ import annotations

import hashlib
import json
import os
import sys
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from PIL import Image


SOURCE = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SOURCE))

import handler as validate_handler  # noqa: E402


class MissingObjectError(Exception):
    response = {"Error": {"Code": "NoSuchKey"}}


class S3ClientError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.response = {"Error": {"Code": code}}


class FakeS3:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], dict] = {}
        self.put_calls: list[dict] = []
        self.get_calls: list[str] = []
        self.get_requests: list[dict] = []
        self.missing_get_error_code = "NoSuchKey"
        self.replace_after_head: dict[tuple[str, str], tuple[bytes, str]] = {}

    def seed(
        self,
        bucket: str,
        key: str,
        body: bytes,
        content_type: str,
        *,
        metadata: dict[str, str] | None = None,
    ) -> str:
        etag = hashlib.md5(body, usedforsecurity=False).hexdigest()
        self.objects[(bucket, key)] = {
            "Body": body,
            "ContentType": content_type,
            "ETag": etag,
            "Metadata": metadata or {},
        }
        return etag

    def seed_json(self, bucket: str, key: str, payload: dict) -> str:
        return self.seed(
            bucket,
            key,
            json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"),
            "application/json",
        )

    def head_object(self, *, Bucket: str, Key: str, **kwargs):
        del kwargs
        try:
            stored = self.objects[(Bucket, Key)]
        except KeyError:
            raise MissingObjectError() from None
        response = {
            "ContentLength": len(stored["Body"]),
            "ETag": f'"{stored["ETag"]}"',
            "Metadata": stored.get("Metadata", {}),
        }
        replacement = self.replace_after_head.pop((Bucket, Key), None)
        if replacement is not None:
            body, content_type = replacement
            self.seed(Bucket, Key, body, content_type)
        return response

    def get_object(self, *, Bucket: str, Key: str, **kwargs):
        self.get_calls.append(Key)
        self.get_requests.append({"Bucket": Bucket, "Key": Key, **kwargs})
        try:
            stored = self.objects[(Bucket, Key)]
        except KeyError:
            raise S3ClientError(self.missing_get_error_code) from None
        if_match = kwargs.get("IfMatch")
        if if_match and if_match.strip('"') != stored["ETag"]:
            raise S3ClientError("PreconditionFailed")
        return {"Body": BytesIO(stored["Body"]), "ETag": f'"{stored["ETag"]}"'}

    def put_object(self, *, Bucket: str, Key: str, Body: bytes, **kwargs):
        if isinstance(Body, str):
            Body = Body.encode("utf-8")
        existing = self.objects.get((Bucket, Key))
        if kwargs.get("IfNoneMatch") == "*" and existing is not None:
            raise S3ClientError("PreconditionFailed")
        if_match = kwargs.get("IfMatch")
        if if_match and (
            existing is None or if_match.strip('"') != existing["ETag"]
        ):
            raise S3ClientError("PreconditionFailed")
        etag = hashlib.md5(Body, usedforsecurity=False).hexdigest()
        self.objects[(Bucket, Key)] = {
            "Body": Body,
            "ContentType": kwargs.get("ContentType"),
            "ETag": etag,
            "Metadata": kwargs.get("Metadata", {}),
        }
        self.put_calls.append({"Bucket": Bucket, "Key": Key, "Body": Body, **kwargs})
        return {"ETag": f'"{etag}"'}


def image_bytes(image_format: str = "PNG", size: tuple[int, int] = (640, 480)) -> bytes:
    output = BytesIO()
    Image.new("RGB", size, (20, 100, 180)).save(output, format=image_format)
    return output.getvalue()


def corrupted_png_bytes() -> bytes:
    data = bytearray(image_bytes("PNG"))
    chunk_type = data.index(b"IDAT")
    chunk_length = int.from_bytes(data[chunk_type - 4 : chunk_type], "big")
    crc_index = chunk_type + 4 + chunk_length
    data[crc_index] ^= 0x01
    return bytes(data)


def event(bucket: str, key: str, etag: str) -> dict:
    return {
        "Records": [
            {
                "eventName": "ObjectCreated:Put",
                "s3": {
                    "bucket": {"name": bucket},
                    "object": {"key": key, "eTag": etag},
                },
            }
        ]
    }


class ValidateHandlerTests(unittest.TestCase):
    bucket = "mp-test-media-123456789012"
    key = "uploads/demo-user/550e8400-e29b-41d4-a716-446655440000.png"
    status_key = "status/demo-user/550e8400-e29b-41d4-a716-446655440000.json"
    thumbnail_key = "thumbnails/demo-user/550e8400-e29b-41d4-a716-446655440000.jpg"
    manifest_key = "stage/analyze/demo-user/550e8400-e29b-41d4-a716-446655440000.json"

    def setUp(self) -> None:
        self.s3 = FakeS3()
        validate_handler._S3_CLIENT = self.s3
        self.environment = patch.dict(
            os.environ,
            {
                "MEDIA_BUCKET_NAME": self.bucket,
                "EXPECTED_BUCKET_OWNER": "123456789012",
                "MAX_IMAGE_BYTES": "10485760",
                "MAX_IMAGE_PIXELS": "25000000",
                "THUMBNAIL_MAX_SIDE": "320",
            },
            clear=False,
        )
        self.environment.start()

    def tearDown(self) -> None:
        self.environment.stop()
        validate_handler._S3_CLIENT = None

    def _status(self) -> dict:
        body = self.s3.objects[(self.bucket, self.status_key)]["Body"]
        return json.loads(body.decode("utf-8"))

    def test_valid_image_creates_thumbnail_manifest_and_ready_status(self) -> None:
        etag = self.s3.seed(self.bucket, self.key, image_bytes(), "image/png")

        result = validate_handler.handler(event(self.bucket, self.key, etag), None)

        self.assertEqual(result, {"processed": 1, "failed": 0, "skipped": 0})
        self.assertIn((self.bucket, self.thumbnail_key), self.s3.objects)
        self.assertIn((self.bucket, self.manifest_key), self.s3.objects)
        self.assertEqual(self._status()["state"], "READY_FOR_ANALYSIS")
        with Image.open(BytesIO(self.s3.objects[(self.bucket, self.thumbnail_key)]["Body"])) as thumb:
            self.assertEqual(thumb.format, "JPEG")
            self.assertLessEqual(max(thumb.size), 320)

        manifest_index = next(
            index
            for index, call in enumerate(self.s3.put_calls)
            if call["Key"] == self.manifest_key
        )
        ready_index = next(
            index
            for index, call in enumerate(self.s3.put_calls)
            if call["Key"] == self.status_key
            and json.loads(call["Body"].decode("utf-8"))["state"]
            == "READY_FOR_ANALYSIS"
        )
        validating_index = next(
            index
            for index, call in enumerate(self.s3.put_calls)
            if call["Key"] == self.status_key
            and json.loads(call["Body"].decode("utf-8"))["state"] == "VALIDATING"
        )
        self.assertLess(validating_index, manifest_index)
        self.assertLess(manifest_index, ready_index)

    def test_first_upload_works_when_missing_get_would_return_access_denied(self) -> None:
        self.s3.missing_get_error_code = "AccessDenied"
        etag = self.s3.seed(self.bucket, self.key, image_bytes(), "image/png")

        result = validate_handler.handler(event(self.bucket, self.key, etag), None)

        self.assertEqual(result, {"processed": 1, "failed": 0, "skipped": 0})
        self.assertEqual(self._status()["state"], "READY_FOR_ANALYSIS")

    def test_source_download_is_bound_to_the_head_etag(self) -> None:
        etag = self.s3.seed(self.bucket, self.key, image_bytes(), "image/png")

        validate_handler.handler(event(self.bucket, self.key, etag), None)

        source_request = next(
            request for request in self.s3.get_requests if request["Key"] == self.key
        )
        self.assertEqual(source_request.get("IfMatch"), etag)

    def test_stale_event_for_an_overwritten_source_is_ignored(self) -> None:
        current_etag = self.s3.seed(
            self.bucket,
            self.key,
            image_bytes(size=(320, 240)),
            "image/png",
        )
        self.assertNotEqual(current_etag, "stale-event-etag")

        result = validate_handler.handler(
            event(self.bucket, self.key, "stale-event-etag"), None
        )

        self.assertEqual(result, {"processed": 0, "failed": 0, "skipped": 1})
        self.assertNotIn((self.bucket, self.thumbnail_key), self.s3.objects)
        self.assertNotIn((self.bucket, self.manifest_key), self.s3.objects)
        self.assertNotIn((self.bucket, self.status_key), self.s3.objects)

    def test_source_overwrite_between_head_and_get_is_retried(self) -> None:
        original_etag = self.s3.seed(
            self.bucket,
            self.key,
            image_bytes(size=(640, 480)),
            "image/png",
        )
        self.s3.replace_after_head[(self.bucket, self.key)] = (
            image_bytes(size=(300, 200)),
            "image/png",
        )

        with self.assertRaises(S3ClientError) as raised:
            validate_handler.handler(event(self.bucket, self.key, original_etag), None)

        self.assertEqual(
            raised.exception.response["Error"]["Code"], "PreconditionFailed"
        )
        self.assertNotIn((self.bucket, self.manifest_key), self.s3.objects)

    def test_corrupted_png_is_failed_as_invalid_image(self) -> None:
        etag = self.s3.seed(
            self.bucket,
            self.key,
            corrupted_png_bytes(),
            "image/png",
        )

        result = validate_handler.handler(event(self.bucket, self.key, etag), None)

        self.assertEqual(result, {"processed": 0, "failed": 1, "skipped": 0})
        self.assertEqual(self._status()["state"], "FAILED")
        self.assertEqual(self._status()["error"]["code"], "INVALID_IMAGE")

    def test_late_duplicate_cannot_regress_complete_status(self) -> None:
        etag = self.s3.seed(self.bucket, self.key, image_bytes(), "image/png")
        original_build_thumbnail = validate_handler.build_thumbnail

        def complete_during_validation(*args, **kwargs):
            thumbnail = original_build_thumbnail(*args, **kwargs)
            self.s3.seed_json(
                self.bucket,
                self.status_key,
                {
                    "schemaVersion": "1.0",
                    "jobId": "550e8400-e29b-41d4-a716-446655440000",
                    "userId": "demo-user",
                    "state": "COMPLETE",
                    "sourceKey": self.key,
                    "sourceETag": etag,
                    "thumbnailKey": self.thumbnail_key,
                    "resultKey": "results/demo-user/result.json",
                    "updatedAt": "2026-10-13T20:00:00Z",
                    "error": None,
                },
            )
            return thumbnail

        with patch.object(
            validate_handler,
            "build_thumbnail",
            side_effect=complete_during_validation,
        ):
            validate_handler.handler(event(self.bucket, self.key, etag), None)

        self.assertEqual(self._status()["state"], "COMPLETE")
        self.assertEqual(
            self._status()["resultKey"], "results/demo-user/result.json"
        )

    def test_reusing_job_id_does_not_replace_existing_artifacts(self) -> None:
        first_etag = self.s3.seed(self.bucket, self.key, image_bytes(), "image/png")
        validate_handler.handler(event(self.bucket, self.key, first_etag), None)
        original_thumbnail = self.s3.objects[(self.bucket, self.thumbnail_key)]["Body"]
        original_manifest = self.s3.objects[(self.bucket, self.manifest_key)]["Body"]
        original_status = self.s3.objects[(self.bucket, self.status_key)]["Body"]

        second_etag = self.s3.seed(
            self.bucket,
            self.key,
            image_bytes(size=(300, 200)),
            "image/png",
        )
        result = validate_handler.handler(event(self.bucket, self.key, second_etag), None)

        self.assertEqual(result, {"processed": 0, "failed": 0, "skipped": 1})
        self.assertEqual(
            self.s3.objects[(self.bucket, self.thumbnail_key)]["Body"],
            original_thumbnail,
        )
        self.assertEqual(
            self.s3.objects[(self.bucket, self.manifest_key)]["Body"],
            original_manifest,
        )
        self.assertEqual(
            self.s3.objects[(self.bucket, self.status_key)]["Body"],
            original_status,
        )

    def test_failed_job_reuse_does_not_create_analysis_artifacts(self) -> None:
        first_etag = self.s3.seed(
            self.bucket,
            self.key,
            b"not really an image",
            "image/png",
        )
        first_result = validate_handler.handler(
            event(self.bucket, self.key, first_etag), None
        )
        original_status = self.s3.objects[(self.bucket, self.status_key)]["Body"]
        self.assertEqual(first_result, {"processed": 0, "failed": 1, "skipped": 0})

        second_etag = self.s3.seed(
            self.bucket,
            self.key,
            image_bytes(),
            "image/png",
        )
        second_result = validate_handler.handler(
            event(self.bucket, self.key, second_etag), None
        )

        self.assertEqual(second_result, {"processed": 0, "failed": 0, "skipped": 1})
        self.assertNotIn((self.bucket, self.thumbnail_key), self.s3.objects)
        self.assertNotIn((self.bucket, self.manifest_key), self.s3.objects)
        self.assertEqual(
            self.s3.objects[(self.bucket, self.status_key)]["Body"],
            original_status,
        )

    def test_watchdog_failed_status_blocks_analysis_artifacts(self) -> None:
        etag = self.s3.seed(self.bucket, self.key, image_bytes(), "image/png")
        original_status = {
            "schemaVersion": "1.0",
            "jobId": "550e8400-e29b-41d4-a716-446655440000",
            "userId": "demo-user",
            "state": "FAILED",
            "sourceKey": self.key,
            "sourceETag": etag,
            "thumbnailKey": None,
            "resultKey": None,
            "updatedAt": "2026-10-13T20:00:00Z",
            "error": {
                "code": "PROCESSING_TIMEOUT",
                "message": "Processing timed out.",
            },
        }
        self.s3.seed_json(self.bucket, self.status_key, original_status)

        result = validate_handler.handler(event(self.bucket, self.key, etag), None)

        self.assertEqual(result, {"processed": 0, "failed": 0, "skipped": 1})
        self.assertNotIn((self.bucket, self.thumbnail_key), self.s3.objects)
        self.assertNotIn((self.bucket, self.manifest_key), self.s3.objects)
        self.assertEqual(self._status(), original_status)

    def test_invalid_file_is_failed_without_retry_output(self) -> None:
        etag = self.s3.seed(self.bucket, self.key, b"not really an image", "image/png")

        result = validate_handler.handler(event(self.bucket, self.key, etag), None)

        self.assertEqual(result["failed"], 1)
        self.assertEqual(self._status()["state"], "FAILED")
        self.assertEqual(self._status()["error"]["code"], "UNSUPPORTED_FORMAT")
        self.assertNotIn((self.bucket, self.thumbnail_key), self.s3.objects)
        self.assertNotIn((self.bucket, self.manifest_key), self.s3.objects)

    def test_file_extension_must_match_encoded_format(self) -> None:
        mismatched_key = self.key.removesuffix(".png") + ".jpg"
        etag = self.s3.seed(self.bucket, mismatched_key, image_bytes("PNG"), "image/jpeg")

        result = validate_handler.handler(event(self.bucket, mismatched_key, etag), None)

        self.assertEqual(result["failed"], 1)
        self.assertEqual(self._status()["error"]["code"], "FORMAT_MISMATCH")
        self.assertNotIn((self.bucket, self.thumbnail_key), self.s3.objects)

    def test_oversized_file_fails_before_downloading_the_source(self) -> None:
        body = image_bytes()
        etag = self.s3.seed(self.bucket, self.key, body, "image/png")
        os.environ["MAX_IMAGE_BYTES"] = str(len(body) - 1)

        result = validate_handler.handler(event(self.bucket, self.key, etag), None)

        self.assertEqual(result["failed"], 1)
        self.assertEqual(self._status()["error"]["code"], "FILE_TOO_LARGE")
        self.assertNotIn(self.key, self.s3.get_calls)

    def test_duplicate_event_for_same_etag_is_idempotent(self) -> None:
        etag = self.s3.seed(self.bucket, self.key, image_bytes(), "image/png")
        validate_handler.handler(event(self.bucket, self.key, etag), None)
        first_put_count = len(self.s3.put_calls)

        result = validate_handler.handler(event(self.bucket, self.key, etag), None)

        self.assertEqual(result, {"processed": 0, "failed": 0, "skipped": 1})
        self.assertEqual(len(self.s3.put_calls), first_put_count)

    def test_untrusted_key_is_ignored(self) -> None:
        bad_key = "uploads/demo-user/../../secret.jpg"
        result = validate_handler.handler(event(self.bucket, bad_key, "abc"), None)
        self.assertEqual(result, {"processed": 0, "failed": 0, "skipped": 1})
        self.assertEqual(self.s3.put_calls, [])

    def test_event_from_another_bucket_is_ignored(self) -> None:
        result = validate_handler.handler(event("unexpected-bucket", self.key, "abc"), None)
        self.assertEqual(result, {"processed": 0, "failed": 0, "skipped": 1})
        self.assertEqual(self.s3.put_calls, [])


if __name__ == "__main__":
    unittest.main()
