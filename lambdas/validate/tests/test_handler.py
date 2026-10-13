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


class FakeS3:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], dict] = {}
        self.put_calls: list[dict] = []
        self.get_calls: list[str] = []

    def seed(self, bucket: str, key: str, body: bytes, content_type: str) -> str:
        etag = hashlib.md5(body, usedforsecurity=False).hexdigest()
        self.objects[(bucket, key)] = {
            "Body": body,
            "ContentType": content_type,
            "ETag": etag,
        }
        return etag

    def head_object(self, *, Bucket: str, Key: str, **kwargs):
        del kwargs
        try:
            stored = self.objects[(Bucket, Key)]
        except KeyError:
            raise MissingObjectError() from None
        return {"ContentLength": len(stored["Body"]), "ETag": f'"{stored["ETag"]}"'}

    def get_object(self, *, Bucket: str, Key: str, **kwargs):
        del kwargs
        self.get_calls.append(Key)
        try:
            stored = self.objects[(Bucket, Key)]
        except KeyError:
            raise MissingObjectError() from None
        return {"Body": BytesIO(stored["Body"]), "ETag": f'"{stored["ETag"]}"'}

    def put_object(self, *, Bucket: str, Key: str, Body: bytes, **kwargs):
        if isinstance(Body, str):
            Body = Body.encode("utf-8")
        etag = hashlib.md5(Body, usedforsecurity=False).hexdigest()
        self.objects[(Bucket, Key)] = {
            "Body": Body,
            "ContentType": kwargs.get("ContentType"),
            "ETag": etag,
        }
        self.put_calls.append({"Bucket": Bucket, "Key": Key, **kwargs})
        return {"ETag": f'"{etag}"'}


def image_bytes(image_format: str = "PNG", size: tuple[int, int] = (640, 480)) -> bytes:
    output = BytesIO()
    Image.new("RGB", size, (20, 100, 180)).save(output, format=image_format)
    return output.getvalue()


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
