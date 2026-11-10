from __future__ import annotations

import hashlib
import json
import os
import sys
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SOURCE))

import handler as analyze_handler  # noqa: E402


class S3ClientError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.response = {"Error": {"Code": code}}


class FakeS3:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], dict] = {}
        self.put_calls: list[dict] = []
        self.get_requests: list[dict] = []

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

    def get_object(self, *, Bucket: str, Key: str, **kwargs):
        self.get_requests.append({"Bucket": Bucket, "Key": Key, **kwargs})
        try:
            stored = self.objects[(Bucket, Key)]
        except KeyError:
            raise S3ClientError("NoSuchKey") from None
        if_match = kwargs.get("IfMatch")
        if if_match and if_match.strip('"') != stored["ETag"]:
            raise S3ClientError("PreconditionFailed")
        return {
            "Body": BytesIO(stored["Body"]),
            "ETag": f'"{stored["ETag"]}"',
            "Metadata": stored["Metadata"],
        }

    def put_object(self, *, Bucket: str, Key: str, Body: bytes, **kwargs):
        if isinstance(Body, str):
            Body = Body.encode("utf-8")
        existing = self.objects.get((Bucket, Key))
        if kwargs.get("IfNoneMatch") == "*" and existing is not None:
            raise S3ClientError("PreconditionFailed")
        if_match = kwargs.get("IfMatch")
        if if_match and (existing is None or if_match.strip('"') != existing["ETag"]):
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


class FakeModel:
    def __init__(
        self,
        labels: list[str] | None = None,
        confidences: list[float] | None = None,
        *,
        error: Exception | None = None,
    ) -> None:
        self.labels = labels or ["tabby cat", "tiger cat"]
        self.confidences = confidences or [0.90, 0.10]
        self.error = error
        self.calls = 0

    def predict(self, image_bytes: bytes) -> list[float]:
        self.calls += 1
        if image_bytes != b"validated-image":
            raise AssertionError("Analyze did not read the validated source bytes")
        if self.error:
            raise self.error
        return self.confidences


def s3_event(bucket: str, key: str, etag: str) -> dict:
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


class AnalyzeHandlerTests(unittest.TestCase):
    bucket = "mp-test-media-123456789012"
    user_id = "demo-user"
    job_id = "550e8400-e29b-41d4-a716-446655440000"
    source_key = f"uploads/{user_id}/{job_id}.png"
    thumbnail_key = f"thumbnails/{user_id}/{job_id}.jpg"
    manifest_key = f"stage/analyze/{user_id}/{job_id}.json"
    status_key = f"status/{user_id}/{job_id}.json"
    result_key = f"results/{user_id}/{job_id}.json"

    def setUp(self) -> None:
        self.s3 = FakeS3()
        self.model = FakeModel()
        analyze_handler._S3_CLIENT = self.s3
        analyze_handler._MODEL = self.model
        self.environment = patch.dict(
            os.environ,
            {
                "MEDIA_BUCKET_NAME": self.bucket,
                "EXPECTED_BUCKET_OWNER": "123456789012",
                "MODEL_KEY": "models/squeezenet1.1-7.onnx",
                "LABELS_KEY": "models/imagenet-labels.txt",
                "MODEL_VERSION": "squeezenet1.1-7",
                "MIN_LABEL_CONFIDENCE": "0.05",
                "MODERATION_THRESHOLD": "0.20",
            },
            clear=False,
        )
        self.environment.start()
        self.source_etag = self.s3.seed(
            self.bucket,
            self.source_key,
            b"validated-image",
            "image/png",
        )
        self.manifest = self._manifest(self.source_etag)
        self._seed_status("READY_FOR_ANALYSIS", self.source_etag)
        self.manifest_etag = self.s3.seed_json(
            self.bucket,
            self.manifest_key,
            self.manifest,
        )

    def tearDown(self) -> None:
        self.environment.stop()
        analyze_handler._S3_CLIENT = None
        analyze_handler._MODEL = None

    def _manifest(self, source_etag: str) -> dict:
        return {
            "schemaVersion": "1.0",
            "jobId": self.job_id,
            "userId": self.user_id,
            "sourceKey": self.source_key,
            "sourceETag": source_etag,
            "thumbnailKey": self.thumbnail_key,
            "statusKey": self.status_key,
            "detectedFormat": "PNG",
            "originalDimensions": {"width": 640, "height": 480},
            "thumbnailDimensions": {"width": 320, "height": 240},
            "createdAt": "2026-11-09T18:00:00Z",
        }

    def _seed_status(self, state: str, source_etag: str) -> None:
        self.s3.seed_json(
            self.bucket,
            self.status_key,
            {
                "schemaVersion": "1.0",
                "jobId": self.job_id,
                "userId": self.user_id,
                "state": state,
                "sourceKey": self.source_key,
                "sourceETag": source_etag,
                "thumbnailKey": self.thumbnail_key,
                "resultKey": None,
                "updatedAt": "2026-11-09T18:00:00Z",
                "error": None,
            },
        )

    def _status(self) -> dict:
        return json.loads(self.s3.objects[(self.bucket, self.status_key)]["Body"])

    def _result(self) -> dict:
        return json.loads(self.s3.objects[(self.bucket, self.result_key)]["Body"])

    def _invoke(self) -> dict:
        return analyze_handler.handler(
            s3_event(self.bucket, self.manifest_key, self.manifest_etag),
            None,
        )

    def test_safe_image_creates_result_and_complete_status(self) -> None:
        summary = self._invoke()

        self.assertEqual(summary, {"processed": 1, "failed": 0, "skipped": 0})
        self.assertEqual(self._status()["state"], "COMPLETE")
        self.assertEqual(self._status()["resultKey"], self.result_key)
        self.assertEqual(self._result()["sourceETag"], self.source_etag)
        self.assertEqual(self._result()["labels"][0], {"name": "tabby cat", "confidence": 0.9})
        self.assertEqual(self._result()["moderation"]["verdict"], "SAFE")
        source_request = next(
            request for request in self.s3.get_requests if request["Key"] == self.source_key
        )
        self.assertEqual(source_request["IfMatch"], self.source_etag)

    def test_restricted_label_creates_flagged_status(self) -> None:
        self.model.labels = ["assault rifle", "tabby cat"]
        self.model.confidences = [0.80, 0.20]

        summary = self._invoke()

        self.assertEqual(summary, {"processed": 1, "failed": 0, "skipped": 0})
        self.assertEqual(self._status()["state"], "FLAGGED")
        self.assertEqual(self._result()["moderation"]["categories"], ["weapons"])

    def test_cross_user_manifest_fails_without_reading_foreign_source(self) -> None:
        self.manifest["sourceKey"] = f"uploads/other-user/{self.job_id}.png"
        self.manifest_etag = self.s3.seed_json(
            self.bucket,
            self.manifest_key,
            self.manifest,
        )

        summary = self._invoke()

        self.assertEqual(summary, {"processed": 0, "failed": 1, "skipped": 0})
        self.assertEqual(self._status()["state"], "FAILED")
        self.assertEqual(self._status()["error"]["code"], "INVALID_MANIFEST")
        self.assertFalse(
            any(
                request["Key"].startswith("uploads/other-user/") for request in self.s3.get_requests
            )
        )

    def test_stale_source_etag_fails_without_analyzing_replacement_bytes(self) -> None:
        stale_etag = "0" * 32
        self.manifest = self._manifest(stale_etag)
        self._seed_status("READY_FOR_ANALYSIS", stale_etag)
        self.manifest_etag = self.s3.seed_json(
            self.bucket,
            self.manifest_key,
            self.manifest,
        )

        summary = self._invoke()

        self.assertEqual(summary, {"processed": 0, "failed": 1, "skipped": 0})
        self.assertEqual(self._status()["error"]["code"], "SOURCE_CHANGED")
        self.assertEqual(self.model.calls, 0)

    def test_duplicate_event_does_not_replace_result_or_rerun_model(self) -> None:
        first = self._invoke()
        result_etag = self.s3.objects[(self.bucket, self.result_key)]["ETag"]

        second = self._invoke()

        self.assertEqual(first, {"processed": 1, "failed": 0, "skipped": 0})
        self.assertEqual(second, {"processed": 0, "failed": 0, "skipped": 1})
        self.assertEqual(self.model.calls, 1)
        self.assertEqual(self.s3.objects[(self.bucket, self.result_key)]["ETag"], result_etag)

    def test_terminal_failed_status_blocks_analysis(self) -> None:
        self._seed_status("FAILED", self.source_etag)

        summary = self._invoke()

        self.assertEqual(summary, {"processed": 0, "failed": 0, "skipped": 1})
        self.assertEqual(self.model.calls, 0)
        self.assertNotIn((self.bucket, self.result_key), self.s3.objects)

    def test_model_runtime_error_is_raised_for_lambda_retry(self) -> None:
        self.model.error = RuntimeError("inference unavailable")

        with self.assertRaisesRegex(RuntimeError, "inference unavailable"):
            self._invoke()

        self.assertEqual(self._status()["state"], "ANALYZING")
        self.assertNotIn((self.bucket, self.result_key), self.s3.objects)


if __name__ == "__main__":
    unittest.main()
