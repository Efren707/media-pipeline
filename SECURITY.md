# Security Policy

This is a student project and must not receive production or sensitive data.

## Reporting a problem

Do not publish credentials, presigned URLs, personal images, or exploit details in a public issue. Use the repository's private vulnerability-reporting feature when available, or contact a maintainer privately.

## Supported code

Only the latest `main` branch is supported. Dependency updates are reviewed through Dependabot pull requests and normal CI.

## Known sandbox limitation

AWS Academy supplies `lambda-run-role` and `myS3Role`; the team cannot edit their policies. Those roles are broader than the least-privilege roles we would create in a normal AWS account. The project mitigates this with separate owner-named buckets, private access, strict key validation, short-lived URLs, and no stored AWS credentials.
