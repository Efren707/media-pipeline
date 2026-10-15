package com.mediapipeline.backend;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = "mp.media-bucket=mp-test-media-bucket")
class BackendApplicationTests {

  @Test
  void contextLoads() {}
}
