package com.mediapipeline.backend;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

@SpringBootTest(properties = "mp.media-bucket=mp-test-media-bucket")
@Import(TestcontainersConfiguration.class)
class BackendApplicationTests {

  @Test
  void contextLoads() {}
}
