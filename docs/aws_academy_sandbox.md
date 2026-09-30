# AWS Academy Cloud Architecting 3 - Sandbox
## Lab Overview
This is a sandbox environment for ad-hoc exploration of AWS services.

You will be restricted to the following services and usage:
  AWS Cloud9
    - Supported Instance types: nano, micro, and small
  Amazon CloudFormation
  Amazon CloudFront
  AWS CloudShell
  AWS CloudTrail
  Amazon CloudWatch
  Amazon DynamoDB
  Amazon Elastic Compute Cloud (EC2)
    - Instance types - only the following instance types can be launched: t2.nano, t2.micro, t2.small, t2.medium, t3.nano, t3.micro, t3.small, t3.medium.
    - EBS volumes - sizes up to 35 GB and type General Purpose SSD (gp2).
    - On-Demand instances.
    - AMIs - Amazon provided Linux and Windows AMIs.
    - Instance quantity - You can launch up to 9 instances. Attempts to launch more instances will result in your lab account being suspended.
  Amazon EC2 Auto Scaling
  Elastic Load Balancing
  AWS Identity and Access Management (IAM)
    - Read-only access
  AWS Key Management Service (KMS)
    - List access
  AWS Lambda
  Amazon Relational Database Service (RDS)
    - DB Instance Class Types - db.t3 instances of type db.t3.micro to db.t3.medium.
    - EBS volumes - size up to 100 GB and type General Purpose SSD (gp2).
    - On-Demand DB instance class types.
    - DatabaseEngine - Amazon Aurora, MySQL, PostgreSQL and MariaDB.
    - Multi-AZ deployments are not supported (choose Dev/Test or Free tier template if prompted and do not create a standby instance).
    - Enhanced monitoring is not supported (you must uncheck this default setting).
  Amazon Route53
    - You cannot register a domain
  Amazon Simple Storage Service (S3)
  Amazon S3 Glacier
  Amazon Simple Notification Service (SNS)
  AWS Systems Manager (SSM)
  Tagging