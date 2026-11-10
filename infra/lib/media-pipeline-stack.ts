import * as path from "node:path";
import {
  CfnOutput,
  CfnParameter,
  Duration,
  RemovalPolicy,
  Size,
  Stack,
  StackProps,
  Tags,
  Validations
} from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sns from "aws-cdk-lib/aws-sns";
import { Construct } from "constructs";

/** Opt-in PostgreSQL (Phase 7). Leave it out and the stack stays S3 + Lambda only. */
export interface DatabaseProps {
  /** The only address allowed to reach port 5432, as a single IPv4 /32. */
  readonly clientCidr: string;
}

export interface MediaPipelineStackProps extends StackProps {
  readonly owner: string;
  readonly corsOrigins: string[];
  readonly database?: DatabaseProps;
}

const SINGLE_IPV4_CIDR =
  /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)\/32$/;

export class MediaPipelineStack extends Stack {
  public readonly mediaBucketName: string;
  public readonly validateFunctionName: string;
  public readonly analyzeFunctionName: string;

  constructor(scope: Construct, id: string, props: MediaPipelineStackProps) {
    if (props.database && !SINGLE_IPV4_CIDR.test(props.database.clientCidr)) {
      throw new Error(
        `dbClientCidr must be a single IPv4 address as /32, got "${props.database.clientCidr}".`
      );
    }
    super(scope, id, props);

    const account = Stack.of(this).account;
    const prefix = `mp-${props.owner}`;
    this.mediaBucketName = `${prefix}-media-${account}`;
    this.validateFunctionName = `${prefix}-validate`;
    this.analyzeFunctionName = `${prefix}-analyze`;

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

    const resultsTopic = new sns.CfnTopic(this, "ResultsTopic", {
      topicName: `${prefix}-results`
    });
    const resultsTopicPolicy = new sns.CfnTopicPolicy(this, "ResultsTopicPolicy", {
      topics: [resultsTopic.ref],
      policyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "AllowMediaBucketPublish",
            Effect: "Allow",
            Principal: { Service: "s3.amazonaws.com" },
            Action: "sns:Publish",
            Resource: resultsTopic.ref,
            Condition: {
              ArnEquals: {
                "aws:SourceArn": `arn:${Stack.of(this).partition}:s3:::${this.mediaBucketName}`
              },
              StringEquals: { "aws:SourceAccount": account }
            }
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

    const analyzeLogGroup = new logs.LogGroup(this, "AnalyzeLogGroup", {
      logGroupName: `/aws/lambda/${this.analyzeFunctionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY
    });

    const analyzeFunction = new lambda.Function(this, "AnalyzeFunction", {
      functionName: this.analyzeFunctionName,
      description: "Classifies validated images and writes labels, moderation and final status.",
      runtime: lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.X86_64,
      code: lambda.Code.fromAsset(
        path.resolve(__dirname, "../../lambdas/analyze/dist")
      ),
      handler: "handler.handler",
      role: lambdaRole,
      logGroup: analyzeLogGroup,
      memorySize: 3008,
      timeout: Duration.seconds(120),
      ephemeralStorageSize: Size.mebibytes(2048),
      reservedConcurrentExecutions: 5,
      retryAttempts: 2,
      environment: {
        MEDIA_BUCKET_NAME: this.mediaBucketName,
        EXPECTED_BUCKET_OWNER: account,
        MODEL_KEY: "models/squeezenet1.1-7.onnx",
        LABELS_KEY: "models/imagenet-labels.txt",
        MODEL_VERSION: "squeezenet1.1-7",
        MIN_LABEL_CONFIDENCE: "0.05",
        MODERATION_THRESHOLD: "0.20"
      }
    });

    const allowS3InvokeAnalyze = new lambda.CfnPermission(
      this,
      "AllowMediaBucketInvokeAnalyze",
      {
        action: "lambda:InvokeFunction",
        functionName: analyzeFunction.functionName,
        principal: "s3.amazonaws.com",
        sourceAccount: account,
        sourceArn: `arn:${Stack.of(this).partition}:s3:::${this.mediaBucketName}`
      }
    );

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
        },
        {
          event: "s3:ObjectCreated:*",
          function: analyzeFunction.functionArn,
          filter: {
            s3Key: {
              rules: [{ name: "prefix", value: "stage/analyze/" }]
            }
          }
        }
      ],
      topicConfigurations: [
        {
          event: "s3:ObjectCreated:*",
          topic: resultsTopic.ref,
          filter: {
            s3Key: {
              rules: [{ name: "prefix", value: "results/" }]
            }
          }
        }
      ]
    };
    mediaBucket.addResourceDependency(allowS3Invoke);
    mediaBucket.addResourceDependency(allowS3InvokeAnalyze);
    mediaBucket.addResourceDependency(resultsTopicPolicy);

    new CfnOutput(this, "MediaBucketName", {
      value: mediaBucket.ref,
      description: "Private bucket used by the Media Pipeline"
    });
    new CfnOutput(this, "ValidateFunctionName", {
      value: validateFunction.functionName,
      description: "Validate-stage Lambda function"
    });
    new CfnOutput(this, "AnalyzeFunctionName", {
      value: analyzeFunction.functionName,
      description: "Analyze-stage Lambda function"
    });
    new CfnOutput(this, "ResultsTopicArn", {
      value: resultsTopic.ref,
      description: "SNS topic receiving completed result-object events"
    });

    if (props.database) {
      this.addDatabase(prefix, props.database);
    }
  }

  /**
   * One db.t3.micro PostgreSQL in the default VPC (no VpcId or subnet group, as in the sandbox
   * probe), reachable only from one client IP. Destroyed with the stack, no backups.
   */
  private addDatabase(prefix: string, database: DatabaseProps): void {
    const password = new CfnParameter(this, "DbPassword", {
      type: "String",
      noEcho: true,
      minLength: 16,
      allowedPattern: "[A-Za-z0-9]+",
      description: "RDS master password (MP_DB_PASSWORD in .env). Never stored in the template."
    });

    const securityGroup = new ec2.CfnSecurityGroup(this, "DbSecurityGroup", {
      groupName: `${prefix}-db`,
      groupDescription: "PostgreSQL from one developer IP only",
      securityGroupIngress: [
        {
          ipProtocol: "tcp",
          fromPort: 5432,
          toPort: 5432,
          cidrIp: database.clientCidr,
          description: "Developer laptop"
        }
      ]
    });

    const instance = new rds.CfnDBInstance(this, "Database", {
      dbInstanceIdentifier: `${prefix}-db`,
      engine: "postgres",
      engineVersion: "18.3",
      dbInstanceClass: "db.t3.micro",
      allocatedStorage: "20",
      storageType: "gp2",
      storageEncrypted: true,
      multiAz: false,
      backupRetentionPeriod: 0,
      deletionProtection: false,
      publiclyAccessible: true,
      dbName: "mediapipeline",
      masterUsername: "mpadmin",
      masterUserPassword: password.valueAsString,
      vpcSecurityGroups: [securityGroup.attrGroupId]
    });
    instance.applyRemovalPolicy(RemovalPolicy.DESTROY);
    // Both are deliberate Phase 7 choices (docs/plans/07-auth-users.md); revisit in Phase 10.
    Validations.of(instance).acknowledge(
      {
        id: "CloudFormation-Validate::W1011",
        reason: "NoEcho parameter from the untracked .env; SSM write access is unproven in the sandbox."
      },
      {
        id: "CloudFormation-Validate::W9011",
        reason:
          "Public only so a laptop backend can connect: the security group allows one /32 and TLS is forced."
      }
    );

    new CfnOutput(this, "DbEndpoint", {
      value: instance.attrEndpointAddress,
      description: "PostgreSQL host for MP_DB_URL"
    });
    new CfnOutput(this, "DbPort", {
      value: instance.attrEndpointPort,
      description: "PostgreSQL port"
    });
  }
}
