package com.mediapipeline.backend.jobs;

import java.util.Arrays;
import java.util.Optional;

/** Upload types the Validate Lambda accepts; the extension must match the encoded format. */
enum ImageType {
  JPEG("image/jpeg", "jpg"),
  PNG("image/png", "png"),
  WEBP("image/webp", "webp");

  private final String contentType;
  private final String extension;

  ImageType(String contentType, String extension) {
    this.contentType = contentType;
    this.extension = extension;
  }

  String contentType() {
    return contentType;
  }

  String extension() {
    return extension;
  }

  static Optional<ImageType> fromContentType(String contentType) {
    return Arrays.stream(values())
        .filter(t -> t.contentType.equalsIgnoreCase(contentType))
        .findFirst();
  }
}
