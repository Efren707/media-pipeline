"""Image classification and restricted-label moderation for the Analyze stage."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


@dataclass(frozen=True)
class LabelScore:
    name: str
    confidence: float


@dataclass(frozen=True)
class ModerationResult:
    verdict: str
    confidence: float
    categories: tuple[str, ...]


@dataclass(frozen=True)
class AnalysisResult:
    labels: tuple[LabelScore, ...]
    moderation: ModerationResult


class ImageModel(Protocol):
    labels: Sequence[str]

    def predict(self, image_bytes: bytes) -> Sequence[float]: ...


DEFAULT_RESTRICTED_LABELS: dict[str, tuple[str, ...]] = {
    "alcohol": ("beer bottle", "beer glass", "cocktail", "red wine", "wine bottle"),
    "tobacco": ("cigar", "cigarette"),
    "weapons": (
        "assault rifle",
        "cannon",
        "dagger",
        "missile",
        "revolver",
        "rifle",
        "sword",
    ),
}


def analyze_image(
    image_bytes: bytes,
    model: ImageModel,
    *,
    minimum_confidence: float = 0.05,
    moderation_threshold: float = 0.20,
    restricted_labels: dict[str, tuple[str, ...]] | None = None,
) -> AnalysisResult:
    """Return ranked labels and a transparent restricted-label policy verdict."""

    confidences = tuple(float(value) for value in model.predict(image_bytes))
    if len(confidences) != len(model.labels):
        raise ValueError("The model returned a confidence count that does not match its labels.")

    ranked = sorted(
        (
            LabelScore(name=str(name), confidence=confidence)
            for name, confidence in zip(model.labels, confidences, strict=True)
            if confidence >= minimum_confidence
        ),
        key=lambda item: (-item.confidence, item.name.casefold()),
    )
    output_labels = tuple(ranked[:5])

    policy = restricted_labels or DEFAULT_RESTRICTED_LABELS
    matched: set[str] = set()
    moderation_confidence = 0.0
    for label in ranked:
        normalized = label.name.casefold()
        if label.confidence < moderation_threshold:
            continue
        for category, phrases in policy.items():
            if any(phrase.casefold() in normalized for phrase in phrases):
                matched.add(category)
                moderation_confidence = max(moderation_confidence, label.confidence)

    moderation = ModerationResult(
        verdict="FLAGGED" if matched else "SAFE",
        confidence=moderation_confidence,
        categories=tuple(sorted(matched)),
    )
    return AnalysisResult(labels=output_labels, moderation=moderation)


class OnnxImageModel:
    """SqueezeNet-compatible ONNX classifier loaded from trusted local files."""

    def __init__(self, model_path: Path, labels_path: Path, *, input_size: int = 224) -> None:
        import onnxruntime as ort

        self.labels = tuple(
            line.strip()
            for line in labels_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        )
        if not self.labels:
            raise ValueError("The model label file is empty.")
        self.input_size = input_size
        self.session = ort.InferenceSession(
            str(model_path),
            providers=["CPUExecutionProvider"],
        )
        self.input_name = self.session.get_inputs()[0].name
        self.output_name = self.session.get_outputs()[0].name

    def predict(self, image_bytes: bytes) -> Sequence[float]:
        from io import BytesIO

        import numpy as np
        from PIL import Image, ImageOps

        with Image.open(BytesIO(image_bytes)) as image:
            rgb = ImageOps.exif_transpose(image).convert("RGB")
            fitted = ImageOps.fit(
                rgb,
                (self.input_size, self.input_size),
                method=Image.Resampling.BILINEAR,
            )
            array = np.asarray(fitted, dtype=np.float32) / 255.0

        mean = np.asarray([0.485, 0.456, 0.406], dtype=np.float32)
        std = np.asarray([0.229, 0.224, 0.225], dtype=np.float32)
        normalized = (array - mean) / std
        tensor = np.transpose(normalized, (2, 0, 1))[np.newaxis, ...]
        logits = np.asarray(
            self.session.run([self.output_name], {self.input_name: tensor})[0],
            dtype=np.float64,
        ).reshape(-1)
        logits -= logits.max()
        probabilities = np.exp(logits)
        probabilities /= probabilities.sum()
        return probabilities.tolist()
