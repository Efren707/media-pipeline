# backend/

Spring Boot API (Java 21), running on EC2 behind an Application Load Balancer, using the `myS3Role` instance profile.

Planned responsibilities:
- Authentication with Spring Security + JWT (Cognito is blocked in the sandbox)
- Users and searchable labels in RDS PostgreSQL
- Issuing presigned S3 upload URLs
- Job status and list endpoints (status JSON is read from S3)
- A watchdog that marks stuck jobs as `FAILED`

Not scaffolded yet. We'll generate it with Spring Initializr once the design in [../docs/media_pipeline.md](../docs/media_pipeline.md) is final.
