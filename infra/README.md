# infra/

AWS CDK app that deploys the whole stack into your own AWS Academy sandbox account.

The CDK language is still to be decided (TypeScript or Python). Before writing any infra code, read [SETUP.md §5](../SETUP.md#5-using-aws-cdk-in-the-sandbox-read-only-iam). The sandbox's IAM is read-only, so:
- no default `cdk bootstrap`; use `CliCredentialsStackSynthesizer`
- import the existing roles (`lambda-run-role` for Lambdas, the `myS3Role` instance profile for EC2)
- no constructs that create hidden roles
