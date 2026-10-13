import * as path from "node:path";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Size,
  Stack,
  StackProps,
  Tags
} from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface MediaPipelineStackProps extends StackProps {
  readonly owner: string;
  readonly corsOrigins: string[];
}

export class MediaPipelineStack extends Stack {
  public readonly mediaBucketName: string;
  public readonly validateFunctionName: string;

  constructor(scope: Construct, id: string, props: MediaPipelineStackProps) {
    super(scope, id, props);

    const account = Stack.of(this).account;
    const prefix = `mp-${props.owner}`;
    this.mediaBucketName = `${prefix}-media-${account}`;
    this.validateFunctionName = `${prefix}-validate`;

    Tags.of(this).add("Project", "MediaPipeline");
    Tags.of(this).add("Owner", props.owner);
    Tags.of(this).add("ManagedBy", "AWS-CDK");

    const mediaBucket = new s3.CfnBucket(this, "MediaBucket", {
      bucketName: this.mediaBucketName,
      bucketEncryption: {
        serverSideEncryptionConfiguration: [
          {
            serverSideEncryptionByDefault: { sseAlgorithm: "AES256" }
          }
        ]
      },
      ownershipControls: {
        rules: [{ objectOwnership: "BucketOwnerEnforced" }]
      },
      publicAccessBlockConfiguration: {
        blockPublicAcls: true,
        blockPublicPolicy: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true
      },
      corsConfiguration: {
        corsRules: [
          {
            allowedMethods: ["GET", "HEAD", "PUT"],
            allowedOrigins: props.corsOrigins,
            allowedHeaders: ["Content-Type", "x-amz-content-sha256", "x-amz-date"],
            exposedHeaders: ["ETag"],
            maxAge: 300
          }
        ]
      },
      lifecycleConfiguration: {
        rules: [
          {
            id: "AbortIncompleteMultipartUploads",
            status: "Enabled",
            abortIncompleteMultipartUpload: { daysAfterInitiation: 1 }
          },
          {
            id: "ExpireDemoData",
            status: "Enabled",
            expirationInDays: 30,
            prefix: "uploads/"
          },
          {
            id: "ExpireGeneratedArtifacts",
            status: "Enabled",
            expirationInDays: 30,
            prefix: "thumbnails/"
          },
          {
            id: "ExpireStageMessages",
            status: "Enabled",
            expirationInDays: 30,
            prefix: "stage/"
          },
          {
            id: "ExpireStatuses",
            status: "Enabled",
            expirationInDays: 30,
            prefix: "status/"
          },
          {
            id: "ExpireResults",
            status: "Enabled",
            expirationInDays: 30,
            prefix: "results/"
          }
        ]
      }
    });
    mediaBucket.applyRemovalPolicy(RemovalPolicy.DESTROY);

    new s3.CfnBucketPolicy(this, "RequireTlsBucketPolicy", {
      bucket: mediaBucket.ref,
      policyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "DenyInsecureTransport",
            Effect: "Deny",
            Principal: "*",
            Action: "s3:*",
            Resource: [mediaBucket.attrArn, `${mediaBucket.attrArn}/*`],
            Condition: { Bool: { "aws:SecureTransport": "false" } }
          }
        ]
      }
    });

    const lambdaRole = iam.Role.fromRoleName(
      this,
      "ImportedLambdaRunRole",
      "lambda-run-role",
      { mutable: false }
    );

    const validateLogGroup = new logs.LogGroup(this, "ValidateLogGroup", {
      logGroupName: `/aws/lambda/${this.validateFunctionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY
    });

    const validateFunction = new lambda.Function(this, "ValidateFunction", {
      functionName: this.validateFunctionName,
      description: "Validates uploaded images, creates thumbnails, and writes S3 status objects.",
      runtime: lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.X86_64,
      code: lambda.Code.fromAsset(
        path.resolve(__dirname, "../../lambdas/validate/dist")
      ),
      handler: "handler.handler",
      role: lambdaRole,
      logGroup: validateLogGroup,
      memorySize: 1024,
      timeout: Duration.seconds(60),
      ephemeralStorageSize: Size.mebibytes(512),
      reservedConcurrentExecutions: 10,
      retryAttempts: 2,
      environment: {
        MEDIA_BUCKET_NAME: this.mediaBucketName,
        EXPECTED_BUCKET_OWNER: account,
        MAX_IMAGE_BYTES: "10485760",
        MAX_IMAGE_PIXELS: "25000000",
        THUMBNAIL_MAX_SIDE: "320"
      }
    });

    const allowS3Invoke = new lambda.CfnPermission(this, "AllowMediaBucketInvoke", {
      action: "lambda:InvokeFunction",
      functionName: validateFunction.functionName,
      principal: "s3.amazonaws.com",
      sourceAccount: account,
      sourceArn: `arn:${Stack.of(this).partition}:s3:::${this.mediaBucketName}`
    });

    mediaBucket.notificationConfiguration = {
      lambdaConfigurations: [
        {
          event: "s3:ObjectCreated:*",
          function: validateFunction.functionArn,
          filter: {
            s3Key: {
              rules: [{ name: "prefix", value: "uploads/" }]
            }
          }
        }
      ]
    };
    mediaBucket.addResourceDependency(allowS3Invoke);

    new CfnOutput(this, "MediaBucketName", {
      value: mediaBucket.ref,
      description: "Private bucket used by the Media Pipeline"
    });
    new CfnOutput(this, "ValidateFunctionName", {
      value: validateFunction.functionName,
      description: "Validate-stage Lambda function"
    });
  }
}
