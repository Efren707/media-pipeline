package com.mediapipeline.backend.config;

import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/**
 * S3 clients use the SDK default credential chain: {@code AWS_PROFILE=sandbox} locally and the
 * {@code myS3Role} instance profile on EC2. No keys live in config.
 */
@Configuration
class AwsConfig {

  @Bean
  S3Client s3Client(MediaProperties properties) {
    return S3Client.builder().region(Region.of(properties.awsRegion())).build();
  }

  @Bean
  S3Presigner s3Presigner(MediaProperties properties) {
    return S3Presigner.builder().region(Region.of(properties.awsRegion())).build();
  }

  @Bean
  Clock clock() {
    return Clock.systemUTC();
  }
}
