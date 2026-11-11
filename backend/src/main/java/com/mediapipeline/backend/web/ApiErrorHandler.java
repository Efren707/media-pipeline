package com.mediapipeline.backend.web;

import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

/** Every error response has the shape {@code {"error": {"code": ..., "message": ...}}}. */
@RestControllerAdvice
class ApiErrorHandler {

  @ExceptionHandler(ApiException.class)
  ResponseEntity<Map<String, Object>> handle(ApiException e) {
    return body(e.status(), e.code(), e.getMessage());
  }

  @ExceptionHandler({MethodArgumentNotValidException.class, HttpMessageNotReadableException.class})
  ResponseEntity<Map<String, Object>> handleBadRequest(Exception e) {
    return body(
        HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "The request body is missing or malformed.");
  }

  @ExceptionHandler(MethodArgumentTypeMismatchException.class)
  ResponseEntity<Map<String, Object>> handleBadParameter(MethodArgumentTypeMismatchException e) {
    return body(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "A query parameter is malformed.");
  }

  private static ResponseEntity<Map<String, Object>> body(
      HttpStatus status, String code, String message) {
    return ResponseEntity.status(status)
        .body(Map.of("error", Map.of("code", code, "message", message)));
  }
}
