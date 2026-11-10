from __future__ import annotations

import sys
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SOURCE))

from analysis import AnalysisResult, LabelScore, analyze_image  # noqa: E402


class FakeModel:
    def __init__(self, labels: list[str], confidences: list[float]) -> None:
        self.labels = labels
        self.confidences = confidences

    def predict(self, image_bytes: bytes) -> list[float]:
        if image_bytes != b"sample-image":
            raise AssertionError("The analyzer did not receive the original image bytes")
        return self.confidences


class AnalyzeImageTests(unittest.TestCase):
    def test_returns_five_labels_ranked_by_confidence(self) -> None:
        model = FakeModel(
            ["one", "two", "three", "four", "five", "six", "seven"],
            [0.01, 0.40, 0.20, 0.15, 0.10, 0.08, 0.06],
        )

        result = analyze_image(b"sample-image", model, minimum_confidence=0.05)

        self.assertEqual(
            result.labels,
            (
                LabelScore("two", 0.40),
                LabelScore("three", 0.20),
                LabelScore("four", 0.15),
                LabelScore("five", 0.10),
                LabelScore("six", 0.08),
            ),
        )
        self.assertEqual(result.moderation.verdict, "SAFE")

    def test_omits_labels_below_minimum_confidence(self) -> None:
        model = FakeModel(
            ["cat", "dog", "bird"],
            [0.60, 0.09, 0.01],
        )

        result = analyze_image(b"sample-image", model, minimum_confidence=0.10)

        self.assertEqual(result.labels, (LabelScore("cat", 0.60),))

    def test_flags_restricted_labels_above_moderation_threshold(self) -> None:
        model = FakeModel(
            ["tabby cat", "assault rifle", "red wine"],
            [0.55, 0.25, 0.20],
        )

        result = analyze_image(
            b"sample-image",
            model,
            moderation_threshold=0.20,
        )

        self.assertIsInstance(result, AnalysisResult)
        self.assertEqual(result.moderation.verdict, "FLAGGED")
        self.assertEqual(result.moderation.confidence, 0.25)
        self.assertEqual(result.moderation.categories, ("alcohol", "weapons"))

    def test_restricted_label_below_threshold_remains_safe(self) -> None:
        model = FakeModel(
            ["golden retriever", "revolver"],
            [0.90, 0.10],
        )

        result = analyze_image(
            b"sample-image",
            model,
            moderation_threshold=0.20,
        )

        self.assertEqual(result.moderation.verdict, "SAFE")
        self.assertEqual(result.moderation.categories, ())


if __name__ == "__main__":
    unittest.main()
