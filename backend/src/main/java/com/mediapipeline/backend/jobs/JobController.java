package com.mediapipeline.backend.jobs;

import com.mediapipeline.backend.jobs.JobDtos.CreateUploadRequest;
import com.mediapipeline.backend.jobs.JobDtos.CreateUploadResponse;
import com.mediapipeline.backend.jobs.JobDtos.JobStatusResponse;
import com.mediapipeline.backend.user.CurrentUser;
import com.mediapipeline.backend.web.ApiException;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Responses carry presigned URLs, so they are never cached. */
@RestController
@RequestMapping("/api")
class JobController {

  private final JobService jobs;
  private final CurrentUser currentUser;

  JobController(JobService jobs, CurrentUser currentUser) {
    this.jobs = jobs;
    this.currentUser = currentUser;
  }

  @PostMapping("/uploads")
  ResponseEntity<CreateUploadResponse> createUpload(
      @Valid @RequestBody CreateUploadRequest request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .cacheControl(CacheControl.noStore())
        .body(jobs.createUpload(currentUser.id(), request));
  }

  @GetMapping("/jobs/{jobId}")
  ResponseEntity<JobStatusResponse> getJob(@PathVariable String jobId) {
    JobStatusResponse job =
        jobs.findJob(currentUser.id(), jobId)
            .orElseThrow(
                () -> new ApiException(HttpStatus.NOT_FOUND, "JOB_NOT_FOUND", "No such job."));
    return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(job);
  }
}
