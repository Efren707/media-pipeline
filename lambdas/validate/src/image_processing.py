"""Pure image validation and thumbnail creation logic."""

from __future__ import annotations

import warnings
from dataclasses import dataclass
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError


ALLOWED_FORMATS = frozenset({"JPEG", "PNG", "WEBP"})


class PermanentValidationError(Exception):
    """An invalid input that should be reported without retrying the Lambda."""

    def __init__(self, code: str, public_message: str) -> None:
        super().__init__(public_message)
        self.code = code
        self.public_message = public_message


@dataclass(frozen=True)
class ThumbnailResult:
    data: bytes
    detected_format: str
    original_width: int
    original_height: int
    thumbnail_width: int
    thumbnail_height: int


def _magic_format(data: bytes) -> str | None:
    if data.startswith(b"\xff\xd8\xff"):
        return "JPEG"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "PNG"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "WEBP"
    return None


def build_thumbnail(
    data: bytes,
    *,
    max_side: int,
    max_pixels: int,
) -> ThumbnailResult:
    """Validate an encoded image and return a metadata-free JPEG thumbnail."""

    magic_format = _magic_format(data)
    if magic_format is None:
        raise PermanentValidationError(
            "UNSUPPORTED_FORMAT",
            "Upload a JPEG, PNG, or WebP image.",
        )

    previous_limit = Image.MAX_IMAGE_PIXELS
    Image.MAX_IMAGE_PIXELS = max_pixels
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as probe:
                detected_format = (probe.format or "").upper()
                original_width, original_height = probe.size
                probe.verify()

            if detected_format not in ALLOWED_FORMATS or detected_format != magic_format:
                raise PermanentValidationError(
                    "UNSUPPORTED_FORMAT",
                    "Upload a JPEG, PNG, or WebP image.",
                )

            if original_width <= 0 or original_height <= 0:
                raise PermanentValidationError("INVALID_IMAGE", "The image is invalid.")
            if original_width * original_height > max_pixels:
                raise PermanentValidationError(
                    "IMAGE_DIMENSIONS_TOO_LARGE",
                    "The decoded image dimensions are too large.",
                )

            with Image.open(BytesIO(data)) as source:
                oriented = ImageOps.exif_transpose(source)
                if "A" in oriented.getbands():
                    rgba = oriented.convert("RGBA")
                    rgb = Image.new("RGB", rgba.size, "white")
                    rgb.paste(rgba, mask=rgba.getchannel("A"))
                else:
                    rgb = oriented.convert("RGB")

                rgb.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
                output = BytesIO()
                rgb.save(
                    output,
                    format="JPEG",
                    quality=85,
                    optimize=True,
                    progressive=True,
                )
                thumbnail_width, thumbnail_height = rgb.size

        return ThumbnailResult(
            data=output.getvalue(),
            detected_format=detected_format,
            original_width=original_width,
            original_height=original_height,
            thumbnail_width=thumbnail_width,
            thumbnail_height=thumbnail_height,
        )
    except PermanentValidationError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise PermanentValidationError(
            "IMAGE_DIMENSIONS_TOO_LARGE",
            "The decoded image dimensions are too large.",
        ) from None
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError):
        raise PermanentValidationError(
            "INVALID_IMAGE",
            "The uploaded file is not a valid supported image.",
        ) from None
    finally:
        Image.MAX_IMAGE_PIXELS = previous_limit
