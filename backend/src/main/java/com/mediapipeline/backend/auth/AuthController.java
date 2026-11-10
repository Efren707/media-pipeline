package com.mediapipeline.backend.auth;

import com.mediapipeline.backend.auth.AuthDtos.Credentials;
import com.mediapipeline.backend.auth.AuthDtos.TokenResponse;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Responses carry a bearer token, so they are never cached. */
@RestController
@RequestMapping("/api/auth")
class AuthController {

  private final AuthService auth;

  AuthController(AuthService auth) {
    this.auth = auth;
  }

  @PostMapping("/signup")
  ResponseEntity<TokenResponse> signup(@Valid @RequestBody Credentials credentials) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .cacheControl(CacheControl.noStore())
        .body(auth.signup(credentials));
  }

  @PostMapping("/login")
  ResponseEntity<TokenResponse> login(@Valid @RequestBody Credentials credentials) {
    return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(auth.login(credentials));
  }
}
